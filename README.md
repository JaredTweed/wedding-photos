Site: https://sharedlens.ca

To Deploy: `firebase deploy --only hosting` or `firebase deploy --only firestore:rules,hosting`

Use the `Download Photos` button on the form page to download everything at full resolution, or press `Ctrl+Shift+D` from the gallery page.

You can self-host this website for yourself here: https://github.com/JaredTweed/wedding-photos-self-host

Use coupon code `FREEWEDDING` on the form page to skip payment and unlock publishing.

The Stripe Buy Button is shown only after sign-in. Checkout sends the Firebase UID as Stripe's `client_reference_id` and pre-fills the signed-in email. The payment fulfiller must verify Stripe's webhook signature and set `donations/{client_reference_id}.hasDonated` to the boolean `true` with trusted server credentials after payment succeeds.

Run the payment/access regression suite with `npm test`.

## Gallery retention

Managed galleries are retained for three years. The `wedding-photos` demo is permanently exempt. Existing galleries use August 27, 2026 as the start of their three-year period; new galleries use their original creation time. The scheduled backend in `backend/retention` owns retention dates, advance notices, and safe prefix-scoped cleanup.

The backend deploys to AWS account `339712861752`, uses a dedicated Lambda runtime role, and reads its narrowly scoped Firebase service-account credential from AWS Secrets Manager. Deployments start in `dry-run` mode with the schedule disabled. Enable `apply` mode only after reviewing a manual invocation. Email remains disabled until `sharedlens.ca` is verified in SES.

To run: `npx http-server .`

TODO:
- Make mass downloading better and make it only possible from the form (not the home.html).
- make it so that there is a warning email 30 days prior and 7 day prior to deletion with instructions on how to mass download.
- make sure the form warns about the 3 year expiry.
