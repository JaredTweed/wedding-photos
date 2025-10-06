Site: https://sharedlens.ca

To Deploy: `firebase deploy --only hosting` or `firebase deploy --only firestore:rules,hosting`

Press `Ctrl+Shift+D` to download everything at full resolution.

To run: `npx http-server .`
<!-- 
To download: `aws s3 sync s3://the-wedding-share .`

To delete all the items on the server: `aws s3 rm s3://the-wedding-share --recursive`

TODO:
- Make the managed S3 buckets purchasable.
- Don't create duplicates in the firebase database when making changes (such as it currently does with the site title changes). Instead, replace that piece of information.
- Make not found webpage for non-existent url paths.
- Make scrolling on the form not risk affecting the color.
- Make it possible to delete your webpage.
-->

