Site: https://jaredtweed.github.io/wedding-photos/

https://sharedlens.ca

To Deploy:  `firebase deploy --only hosting`

To run: `npx http-server .`
<!-- 
To download: `aws s3 sync s3://the-wedding-share .`

To delete all the items on the server: `aws s3 rm s3://the-wedding-share --recursive`

Next task: Make thumbnails square so they have consistent quality.

## How to edit config

For all the following steps replace `the-wedding-share` with your bucket name.

### Step 1

Create an s3 bucket with the bucket policy below:
```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowPublicRead",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::the-wedding-share/*"
        }
    ]
}
```

and the CORS below:

```
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "PUT",
            "POST",
            "DELETE",
            "HEAD"
        ],
        "AllowedOrigins": [
            "*",
            "null"
        ],
        "ExposeHeaders": [
            "ETag",
            "x-amz-request-id",
            "x-amz-meta-description",
            "x-amz-meta-otherkey"
        ],
        "MaxAgeSeconds": 1800
    }
]
```

### Step 2

Create a role with the inline policy below.
```
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Effect": "Allow",
			"Action": "s3:ListBucket",
			"Resource": "arn:aws:s3:::the-wedding-share"
		},
		{
			"Effect": "Allow",
			"Action": [
				"s3:GetObject",
				"s3:PutObject",
				"s3:DeleteObject"
			],
			"Resource": "arn:aws:s3:::the-wedding-share/*"
		}
	]
}
```

### Step 3

Make an 'Cognito' identity pool with guest access attached to the above role. -->

