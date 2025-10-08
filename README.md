Site: https://sharedlens.ca

To Deploy: `firebase deploy --only hosting` or `firebase deploy --only firestore:rules,hosting`

Press `Ctrl+Shift+D` to download everything at full resolution.

To run: `npx http-server .`
<!-- 
To download: `aws s3 sync s3://the-wedding-share .`

To delete all the items on the server: `aws s3 rm s3://the-wedding-share --recursive`

TODO:
- Make the managed S3 buckets purchasable.
- Make sure there wont be any issues if someone makes their site title "form" or "404.html".
- Make it possible to delete your webpage and/or all the data on it.
-->

