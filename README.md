Site: https://sharedlens.ca

To Deploy: `firebase deploy --only hosting` or `firebase deploy --only firestore:rules,hosting`

To run: `npx http-server .`
<!-- 
To download: `aws s3 sync s3://the-wedding-share .`

To delete all the items on the server: `aws s3 rm s3://the-wedding-share --recursive`


TODO:
- Make downloading the database possible from the form.
- Make purchasing a database an option over implementing your own.
- Make not found webpage for non-existent url paths.
- Make scrolling on the form not risk affecting the color.
- Make submiting the form show the URL rather than opening the webpage.
- Make it possible to delete your webpage.
-->

