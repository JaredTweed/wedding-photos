Site: https://sharedlens.ca

To Deploy: `firebase deploy --only hosting` or `firebase deploy --only firestore:rules,hosting`

Use the `Download Photos` button on the form page to prepare a private, temporary archive of every original photo and video. Large galleries are split into parts near 4 GB. Prepared archives are reusable for 24 hours, while each owner-only download link expires after 15 minutes.

You can self-host this website for yourself here: https://github.com/JaredTweed/wedding-photos-self-host

Use coupon code `FREEWEDDING` on the form page to skip payment and unlock publishing.

The Stripe Buy Button is shown only after sign-in. Checkout sends the Firebase UID as Stripe's `client_reference_id` and pre-fills the signed-in email. The payment fulfiller must verify Stripe's webhook signature and set `donations/{client_reference_id}.hasDonated` to the boolean `true` with trusted server credentials after payment succeeds.

Run the payment/access regression suite with `npm test`.

## Gallery archives

The backend in `backend/archive` verifies the Firebase ID token and gallery ownership before starting an isolated AWS Fargate task. The task streams originals from the managed S3 prefix into a separate private export bucket, so the browser never has to hold the gallery in memory. DynamoDB tracks progress and reuse; S3 lifecycle cleanup removes temporary archives automatically.

Run archive tests with `npm --prefix backend/archive test`. Deploy the archive backend with `backend/archive/deploy.sh`, then keep `EXPORT_API_URL` in `config.js` aligned with the stack output.

## Gallery retention

Managed galleries are retained for three years. The `wedding-photos` demo is permanently exempt. Existing galleries use August 27, 2026 as the start of their three-year period; new galleries use their original creation time. The scheduled backend in `backend/retention` owns retention dates, advance notices, and safe prefix-scoped cleanup.

The backend deploys to AWS account `339712861752`, uses a dedicated Lambda runtime role, and reads its narrowly scoped Firebase service-account credential from AWS Secrets Manager. Deployments start in `dry-run` mode with the schedule disabled. Enable `apply` mode only after reviewing a manual invocation. Email remains disabled until `sharedlens.ca` is verified in SES.

To run: `npx http-server .`
