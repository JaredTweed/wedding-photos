Site: https://sharedlens.ca

To Deploy: `firebase deploy --only hosting` or `firebase deploy --only firestore:rules,hosting`

Use the `Download Photos` button on the form page to download everything at full resolution, or press `Ctrl+Shift+D` from the gallery page.

Use coupon code `FREEWEDDING` on the form page to skip payment and unlock publishing.

To run: `npx http-server .`
<!-- 
To download: `aws s3 sync s3://the-wedding-share .`

To delete all the items on the server: `aws s3 rm s3://the-wedding-share --recursive`

TODO:
- Make the managed S3 buckets purchasable.
-->
