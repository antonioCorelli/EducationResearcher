# DNS And TLS

Source issue: [#67](https://github.com/antonioCorelli/EducationResearcher/issues/67)

## Current Provider

`voxaria.io` DNS is hosted in Route 53.

| Item | Value |
| --- | --- |
| AWS account | `077317248751` |
| Region used for hosted services | `us-east-1` |
| Route 53 hosted zone | `Z02410783JLHRBD4MJ87Y` |
| Hosted zone name | `voxaria.io.` |

## Frontend Target

The EducationResearcher frontend is hosted by AWS Amplify:

| Setting | Value |
| --- | --- |
| Amplify app ID | `d2ho422yprknty` |
| Amplify app name | `EducationResearcher` |
| Branch | `main` |
| Default URL | `https://main.d2ho422yprknty.amplifyapp.com` |
| Custom domains | `https://voxaria.io`, `https://www.voxaria.io` |
| Repository | `https://github.com/antonioCorelli/EducationResearcher` |

The Amplify app is configured with:

```text
AMPLIFY_MONOREPO_APP_ROOT=apps/web
VITE_SERVICE_BASE_URL=https://api.voxaria.io
```

The Amplify domain association status is `AVAILABLE`. The root default URL, `https://voxaria.io`,
`https://www.voxaria.io`, and a participant deep link returned `200 OK`.

The configured SPA fallback rule is:

```text
</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/> -> /index.html, status 200
```

Keep this rule in place so researcher and participant deep links are served by the React app instead of S3 object paths.

## API Target

The EducationResearcher Service API is hosted by Elastic Beanstalk:

| Setting | Value |
| --- | --- |
| EB application | `education-researcher-service` |
| EB environment | `education-researcher-api-prod` |
| Environment ID | `e-2cved2uqzm` |
| Version | `prod-20260601-2308` |
| Platform | `Docker running on 64bit Amazon Linux 2023/4.13.1` |
| Default URL | `https://education-researcher-api-prod.eba-xpf5qcne.us-east-1.elasticbeanstalk.com` |
| ALB DNS | `awseb--AWSEB-ryIE5zt3ZjEb-1779189747.us-east-1.elb.amazonaws.com` |
| Custom domain | `https://api.voxaria.io` |
| API certificate | `arn:aws:acm:us-east-1:077317248751:certificate/4f828291-cc11-4346-81b9-990b9e8fbe60` |

The environment is `Green/Ok`, and `https://api.voxaria.io/health` returned:

```json
{"service":"education-researcher-service","status":"ok"}
```

## Current Records

As of June 1, 2026, Route 53 contains these public application records:

| Name | Type | Target |
| --- | --- | --- |
| `voxaria.io.` | `A` alias | `d2am5nz3zwr4jf.cloudfront.net.` |
| `www.voxaria.io.` | `CNAME` | `d2am5nz3zwr4jf.cloudfront.net.` |
| `api.voxaria.io.` | `A` alias | `awseb--AWSEB-ryIE5zt3ZjEb-1779189747.us-east-1.elb.amazonaws.com.` |
| `_e9e7ba6193b8cc1e07e9d9d58e919dfa.voxaria.io.` | `CNAME` | Amplify-managed certificate validation record. |
| `_10efeb3a3c226fe8b9d1c996d228ac51.api.voxaria.io.` | `CNAME` | ACM validation record for `api.voxaria.io`. |

Keep the certificate validation CNAME records in Route 53 so the Amplify-managed frontend certificate and ACM API
certificate can renew automatically.

## Prototype Cutover

Before this deployment, `voxaria.io` and `www.voxaria.io` pointed at an older prototype. The old prototype CloudFront
distribution `EU3TQU5NTNRGO` had the `voxaria.io` and `www.voxaria.io` aliases removed so Amplify could claim the custom
domains. The distribution remains enabled without those aliases.

## Verification

Use these checks after DNS or deployment changes:

```bash
aws amplify get-domain-association --region us-east-1 --app-id d2ho422yprknty --domain-name voxaria.io
aws elasticbeanstalk describe-environments --region us-east-1 --application-name education-researcher-service --environment-names education-researcher-api-prod
curl -I https://voxaria.io
curl -I https://www.voxaria.io
curl -I https://voxaria.io/participant/runs/test-token
curl https://api.voxaria.io/health
```
