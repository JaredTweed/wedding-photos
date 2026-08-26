Site: https://sharedlens.ca

To Deploy: `firebase deploy --only hosting` or `firebase deploy --only firestore:rules,hosting`

Use the `Download Photos` button on the form page to download everything at full resolution, or press `Ctrl+Shift+D` from the gallery page.

You can self-host this website for yourself here: https://github.com/JaredTweed/wedding-photos-self-host

Use coupon code `FREEWEDDING` on the form page to skip payment and unlock publishing.

The Stripe Buy Button is shown only after sign-in. Checkout sends the Firebase UID as Stripe's `client_reference_id` and pre-fills the signed-in email. The payment fulfiller must verify Stripe's webhook signature and set `donations/{client_reference_id}.hasDonated` to the boolean `true` with trusted server credentials after payment succeeds.

Run the payment/access regression suite with `npm test`.

To run: `npx http-server .`
<!-- 
To download: `aws s3 sync s3://the-wedding-share .`

To delete all the items on the server: `aws s3 rm s3://the-wedding-share --recursive`

TODO:
- Make the managed S3 buckets purchasable.
-->
