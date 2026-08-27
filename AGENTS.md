# Shared Lens repository guide

## Product and ownership

- Production site: `https://sharedlens.ca`.
- GitHub repository: `JaredTweed/wedding-photos`, primary branch `main`.
- Firebase project: `wedding-login-32785`; use the personal Jared account, never a work account.
- AWS production account: `339712861752`, region `ca-central-1`. Verify `aws sts get-caller-identity` before every AWS mutation and refuse any other account.
- Never commit, print, or copy passwords, Firebase service-account JSON, AWS credentials, Stripe secrets, or presigned URLs. Backend credentials live in AWS Secrets Manager under `sharedlens/firebase-retention-service-account`.

## Important files

- `home.html`: public gallery and upload experience. Preserve its layout and Poppins-based Playful theme unless the user explicitly asks to change it.
- `form.html`: authenticated gallery creation and management, payment gate, deletion, QR download, retention information, and owner-only bulk downloads.
- `config.js`: public managed-storage configuration and the gallery archive API URL. Values here are browser-visible and must never be secrets.
- `firestore.rules`: authorization for `sites` and `donations`.
- `tests/`: browser-source and Firestore rule regression tests.
- `backend/retention/`: three-year retention, warning email, and deletion Lambda.
- `backend/archive/`: authenticated archive API and on-demand Fargate ZIP worker.
- `firebase.json`: Firebase Hosting rewrites and its source-file exclusion list.

## Data and storage rules

- Public gallery documents are stored in Firestore collection `sites`; the document ID is the slug.
- The authenticated owner is `createdBy`. Never trust a client-supplied owner ID in backend authorization.
- Managed originals live only under `s3://the-wedding-share/sites/{storage-slug}/`. A gallery rename may retain its original storage prefix, so use the stored `objectPrefix` rather than rebuilding it from the current slug.
- Treat only a single-segment `sites/{slug}/` prefix as safe for archive or deletion operations. Never list, package, or delete a bucket-wide or `sites/` prefix.
- Thumbnails, JSON metadata, and `_720p.mp4` transcodes are not originals and do not belong in owner archives.
- `wedding-photos` is the permanent demo and must never expire.
- Backend-managed fields `createdAt`, `expiresAt`, `retentionExempt`, and `retentionPolicyId` must survive form edits and must not be writable by clients.

## Gallery themes and UI constraints

- Stored theme keys are `classic` and `refined`; user-facing labels are Playful and Refined.
- Keep legacy font values compatible through `resolveThemeKey`.
- Refined uses a strong active-tab underline rather than the Playful glider.
- Avoid rounded, shadow-heavy surfaces. Keep buttons, borders, focus states, and mobile pressed states professional and accessible.
- Do not alter page layout for a narrowly scoped behavior or copy change.

## Authentication and payment

- Firebase Authentication with Google identifies owners.
- Bulk archive API requests must include a fresh Firebase ID token. The API validates it with Firebase and independently verifies `sites/{slug}.createdBy`.
- Publishing requires `donations/{uid}.hasDonated == true` or the intentionally public `FREEWEDDING` coupon. Applying the coupon must preserve trusted payment fields.
- Stripe webhook fulfillment is server-owned; never let the browser set `hasDonated`.

## Archive service

- Stack: `sharedlens-gallery-archives`.
- API: `POST /exports` creates or reuses an archive job; `GET /exports/{jobId}` returns owner-authorized progress and short-lived links.
- Jobs are deterministic for owner + slug + gallery fingerprint, allowing unchanged archives to be reused.
- The worker is an ECS Fargate task that exists only while an archive is being built. It streams S3 objects into ZIP64 archives and splits near 4 GiB without loading the gallery into memory.
- Archives are stored in private bucket `sharedlens-gallery-exports-339712861752`. Public access must stay fully blocked.
- API links expire after 15 minutes. Job access expires after 24 hours. S3 lifecycle removes objects under `archives/` after one day and aborts abandoned multipart uploads.
- The task and API roles are deliberately prefix- and resource-scoped. Do not broaden them to `s3:*`, `dynamodb:*`, or account-wide resources.
- Deploy with `backend/archive/deploy.sh`; it hard-checks the AWS account, builds and pushes the worker image, packages the API, and updates CloudFormation. Keep `config.js` `EXPORT_API_URL` aligned with the `ApiUrl` stack output.

## Retention service

- Stack and Lambda: `sharedlens-retention`; EventBridge rule: `sharedlens-retention-daily`.
- Existing non-demo galleries use policy start `2026-08-27T07:00:00Z` and expire August 27, 2029. New galleries expire three calendar years after original creation.
- Retention policies are keyed by bucket + stored prefix so renaming cannot reset expiry.
- The deploy script defaults to dry-run, disabled schedule, and disabled email. To preserve the active cleanup schedule, pass the intended values explicitly, for example: `RETENTION_MODE=apply SCHEDULE_STATE=ENABLED EMAIL_ENABLED=false backend/retention/deploy.sh`.
- Never enable retention email until SES reports both the `sharedlens.ca` identity verified and production access enabled. Sender is `Shared Lens <notifications@sharedlens.ca>`.

## Validation

Run validation in proportion to the change:

- Main regression and Firestore rules: `npm test`.
- Archive backend: `npm --prefix backend/archive test`.
- Retention backend: `npm --prefix backend/retention test`.
- Production dependency audit: `npm audit --omit=dev --omit=optional --prefix backend/archive` and the corresponding retention command when it changes.
- Validate CloudFormation before deployment with `aws cloudformation validate-template`.
- Validate inline `form.html` scripts with Node's `vm.Script` because there is no bundler.
- Run `git diff --check` before committing.

## Publishing

- Firebase Hosting publishes the repository root but must exclude backend source, tests, rules, documentation, package manifests, dependencies, and dotfiles through `firebase.json`.
- Deploy the website with `firebase deploy --only hosting --project wedding-login-32785`.
- Deploy rules with `firebase deploy --only firestore:rules --project wedding-login-32785`; combine both targets when both changed.
- After hosting deploy, compare `https://sharedlens.ca/form` with local `form.html` and confirm the Git worktree is clean and synchronized.
- Preserve unrelated user changes. Use focused commits and push `main` only after tests pass.
