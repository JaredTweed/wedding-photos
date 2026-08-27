# Shared Lens email DNS setup

AWS SES sends retention notices as `Shared Lens <notifications@sharedlens.ca>` from `ca-central-1`.

Add these CNAME records in Porkbun:

| Host | Answer |
| --- | --- |
| `xsfwozjrnyx73k2aqy23d53j57yss5jk._domainkey` | `xsfwozjrnyx73k2aqy23d53j57yss5jk.dkim.amazonses.com` |
| `b7qysw6l3vszf7i2egsj7dajlmk7nwvb._domainkey` | `b7qysw6l3vszf7i2egsj7dajlmk7nwvb.dkim.amazonses.com` |
| `3exymh6lsgszw6sdx3pz7zx7mn4xyh7q._domainkey` | `3exymh6lsgszw6sdx3pz7zx7mn4xyh7q.dkim.amazonses.com` |

Recommended DMARC record:

| Type | Host | Answer |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; adkim=s; aspf=s` |

Do not enable `EMAIL_ENABLED=true` until SES reports both `VerifiedForSendingStatus: true` for `sharedlens.ca` and production sending access for the account.
