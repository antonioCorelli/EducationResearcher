# Production Deployment Runbook

This runbook records production deployment steps and non-secret outputs. Do not commit passwords, API keys, access tokens, participant data, raw logs, exports, transcripts, audio, or private operational notes.

## Production Target

- AWS account: `077317248751`
- AWS region: `us-east-1`
- CDK environment context: `prod`
- Deployment date: June 1, 2026

## Cognito And DynamoDB Deployment

Source issue: [#62](https://github.com/antonioCorelli/EducationResearcher/issues/62)

### Commands Run

```bash
npx cdk diff --app "npx tsx src/app.ts" --all -c environment=prod
npx cdk bootstrap aws://077317248751/us-east-1
npx cdk deploy --app "npx tsx src/app.ts" --all -c environment=prod --require-approval never
```

Notes:

- The diff showed creation of `EducationResearcherAuth-prod` and `EducationResearcherData-prod`.
- `CDKToolkit` already existed in `us-east-1`.
- The bootstrap update was attempted because CDK reported an outdated bootstrap stack, but the current IAM user lacked `cloudformation:GetTemplate` on `CDKToolkit`. The prod stacks still deployed successfully with the existing bootstrap stack.

### Stack Outputs

| Stack | Output | Value |
| --- | --- | --- |
| `EducationResearcherAuth-prod` | `ResearcherUserPoolId` | `us-east-1_jTLroPp4Z` |
| `EducationResearcherAuth-prod` | `ResearcherUserPoolClientId` | `51gd0to7l28c5vi7veh0a7quu1` |

### DynamoDB Tables

The production data stack created the expected table-per-domain tables:

| Table | Status | Billing mode | PITR |
| --- | --- | --- | --- |
| `education-researcher-prod-evidence-scoring` | `ACTIVE` | `PAY_PER_REQUEST` | `ENABLED` |
| `education-researcher-prod-identity-access` | `ACTIVE` | `PAY_PER_REQUEST` | `ENABLED` |
| `education-researcher-prod-operations` | `ACTIVE` | `PAY_PER_REQUEST` | `ENABLED` |
| `education-researcher-prod-run-lifecycle` | `ACTIVE` | `PAY_PER_REQUEST` | `ENABLED` |
| `education-researcher-prod-study-setup` | `ACTIVE` | `PAY_PER_REQUEST` | `ENABLED` |
| `education-researcher-prod-versioned-configuration` | `ACTIVE` | `PAY_PER_REQUEST` | `ENABLED` |

The synthesized `EducationResearcherData-prod` CloudFormation template includes `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` for all six production DynamoDB tables.

## S3 Artifact Storage

Source issue: [#65](https://github.com/antonioCorelli/EducationResearcher/issues/65)

The CDK app now includes `EducationResearcherArtifacts-prod` for production interview audio and reserved generated
export object storage.

Expected production bucket:

| Stack | Output | Value |
| --- | --- | --- |
| `EducationResearcherArtifacts-prod` | `ArtifactBucketName` | `education-researcher-prod-artifacts-077317248751` |
| `EducationResearcherArtifacts-prod` | `AudioArtifactPrefix` | `audio/` |
| `EducationResearcherArtifacts-prod` | `ExportArtifactPrefix` | `exports/` |

The bucket is private, blocks public access, enforces SSL, uses S3-managed server-side encryption, enables versioning in
production, and has a 730-day lifecycle expiration rule for the default study-artifact retention window. Production stack
deletion retains the bucket.

The Elastic Beanstalk service environment must set:

```text
INTERVIEW_AUDIO_STORAGE_BACKEND=s3
ARTIFACT_STORAGE_BUCKET_NAME=education-researcher-prod-artifacts-077317248751
INTERVIEW_AUDIO_STORAGE_PREFIX=audio
```

### June 3, 2026 Production Audio Storage Fix

Production audio uploads were failing because the service was configured for
`education-researcher-prod-artifacts-077317248751`, but the bucket did not exist. A CDK deployment of
`EducationResearcherArtifacts-prod` failed because the S3 tag value `audio,exports` contained a comma. The CDK source was
updated to use the valid tag value `audio_exports`.

The stack is currently stuck in `ROLLBACK_COMPLETE`; the current deployment IAM user does not have
`cloudformation:DeleteStack`, so the failed stack could not be removed and redeployed. To restore production audio
immediately, the expected bucket was created directly with the S3 API and configured with:

- S3-managed server-side encryption.
- Versioning enabled.
- 730-day lifecycle expiration.
- Sensitive artifact tags.
- A bucket policy denying insecure transport.

The same IAM user could not apply S3 public access block or bucket ownership controls because it lacks
`s3:PutBucketPublicAccessBlock` and `s3:PutBucketOwnershipControls`. Grant those actions, delete the failed
`EducationResearcherArtifacts-prod` stack, and redeploy the corrected CDK stack so CloudFormation owns the bucket
configuration.

Verification completed on June 3, 2026:

- `https://api.voxaria.io/health` was green through the production smoke test.
- A synthetic non-real participant run uploaded `audio/webm` through the production participant API.
- DynamoDB stored an `interview_audio_asset` with `status=available` and an S3 URI under the production bucket.
- The analyze/raw-evidence path returned a signed audio URL and range playback returned `206 Partial Content`.

Before enabling real participant audio, attach the S3 least-privilege policy from
`docs/service-secrets-and-iam.md` to the Elastic Beanstalk instance profile and run a synthetic upload/playback smoke
test.

### Researcher User Setup

The pilot researcher user was created in the production user pool on June 1, 2026.

| Email | Status | Notes |
| --- | --- | --- |
| `taylorgrimescs@gmail.com` | `FORCE_CHANGE_PASSWORD` | Enabled, email verified, temporary-password flow active. |

For future production researcher users, prefer creating the Cognito user with an emailed temporary password:

```bash
aws cognito-idp admin-create-user --region us-east-1 --user-pool-id us-east-1_jTLroPp4Z --username <email> --user-attributes Name=email,Value=<email> Name=email_verified,Value=true --desired-delivery-mediums EMAIL
```

If a permanent password must be set administratively, use the AWS Console or another approved secret-handling path. Do not place passwords in Git, shell history, issue comments, docs, or chat logs.

### Verification Commands

```bash
aws cloudformation describe-stacks --region us-east-1 --stack-name EducationResearcherAuth-prod
aws cloudformation describe-stacks --region us-east-1 --stack-name EducationResearcherData-prod
aws dynamodb list-tables --region us-east-1 --query "TableNames[?starts_with(@, 'education-researcher-prod-')]"
aws cognito-idp list-users --region us-east-1 --user-pool-id us-east-1_jTLroPp4Z
```

## Service Hosting

Source issue: [#63](https://github.com/antonioCorelli/EducationResearcher/issues/63)

The production service hosting target is AWS Elastic Beanstalk on the Docker platform. The previous App Runner plan was
replaced because AWS documents that App Runner is no longer open to new customers after March 31, 2026, and the current
local IAM user cannot confirm legacy App Runner access for account `077317248751`.

The repository now includes:

- `Dockerfile` for the `@education-researcher/service` workspace.
- `Dockerrun.aws.json` to declare the Elastic Beanstalk Docker container port.
- `.ebextensions/01-service.config` for the Application Load Balancer process port and `/health` check.
- `.ebextensions/02-secrets.config` for managed SSM secret references.
- `docs/service-hosting.md` for the deployment, verification, redeploy, and rollback procedure.
- `docs/service-secrets-and-iam.md` for required service env vars, secret paths, and IAM policy shape.

The production API environment was created on June 1, 2026:

| Setting | Value |
| --- | --- |
| EB application | `education-researcher-service` |
| EB environment | `education-researcher-api-prod` |
| Environment ID | `e-2cved2uqzm` |
| Version | `prod-20260601-2308` |
| Default URL | `https://education-researcher-api-prod.eba-xpf5qcne.us-east-1.elasticbeanstalk.com` |
| Custom URL | `https://api.voxaria.io` |

The environment is `Green/Ok`. `GET https://api.voxaria.io/health` returns
`{"service":"education-researcher-service","status":"ok"}`.

## Web Hosting

Source issue: [#66](https://github.com/antonioCorelli/EducationResearcher/issues/66)

The production web app hosting target is AWS Amplify Hosting for `apps/web`. The repository includes `amplify.yml` with
the monorepo build settings:

- app root: `apps/web`
- build path: `/`
- Node runtime: `20`
- production API base URL: `VITE_SERVICE_BASE_URL=https://api.voxaria.io`
- build command: `npm run build --workspace @education-researcher/web`
- output directory: `apps/web/dist`

The web app should be verified on the Amplify default domain before adding `voxaria.io`. Configure the Amplify SPA
rewrite from `docs/web-hosting.md` so researcher and participant deep links, including `/participant/runs/<token>`, are
served by `index.html`.

`https://api.voxaria.io` remains the Elastic Beanstalk-hosted Service API origin; Amplify only serves the static web app.

### Amplify Production App

The production Amplify app was created from the GitHub repository on June 1, 2026:

| Setting | Value |
| --- | --- |
| App name | `EducationResearcher` |
| App ID | `d2ho422yprknty` |
| Production branch | `main` |
| Default domain | `https://main.d2ho422yprknty.amplifyapp.com` |
| API base URL | `https://api.voxaria.io` |

The first three Amplify release jobs for `main` completed build, deploy, and verify successfully. The default domain
returns `200 OK` for `/` and for participant deep links such as `/participant/runs/test-token`.

## Production UI Smoke Testing And Alerts

The repository includes a browser-based production smoke test that signs in through the live researcher login page with a
non-real smoke test user. The `Production Smoke` GitHub Actions workflow runs after successful `main` CI, installs
Playwright Chromium, and retries while Amplify finishes deploying the latest build.

The CDK app includes `EducationResearcherOperations-prod`, which defines the SNS topic and CloudWatch alarm for the UI
login smoke metric. See `docs/production-ui-smoke-testing.md` for the required GitHub secrets, GitHub OIDC role, SMS
subscription parameter, and manual alarm verification steps.

## DNS And TLS

Source issue: [#67](https://github.com/antonioCorelli/EducationResearcher/issues/67)

See `docs/dns-and-tls.md` for the current DNS state, records, TLS automation details, and renewal caveats.

`voxaria.io` is hosted in Route 53 in public hosted zone `Z02410783JLHRBD4MJ87Y`.

As of June 1, 2026, the public application records are:

```text
voxaria.io      A alias -> d2am5nz3zwr4jf.cloudfront.net.
www.voxaria.io  CNAME   -> d2am5nz3zwr4jf.cloudfront.net.
api.voxaria.io  A alias -> awseb--AWSEB-ryIE5zt3ZjEb-1779189747.us-east-1.elb.amazonaws.com.
```

The older prototype CloudFront distribution `EU3TQU5NTNRGO` had the `voxaria.io` and `www.voxaria.io` aliases removed
before the Amplify cutover.

### Managed Secret Parameters

Source issue: [#64](https://github.com/antonioCorelli/EducationResearcher/issues/64)

The production service expects these SecureString parameters in SSM Parameter Store:

| Runtime env var | SSM parameter path |
| --- | --- |
| `PARTICIPANT_ACCESS_TOKEN_SECRET` | `/education-researcher/prod/participant-access-token-secret` |
| `AUDIO_LINK_SIGNING_SECRET` | `/education-researcher/prod/audio-link-signing-secret` |
| `OPENAI_API_KEY` | `/education-researcher/prod/openai-api-key` |

`OPENAI_API_KEY` is required for production participant realtime voice interviews. Store it as a SecureString value and
expose it through Elastic Beanstalk environment secrets; never commit or print the key value.

These parameters were created as `SecureString` values on June 1, 2026 after SSM permissions were added for the local
deployment user. Both are standard-tier parameters at version 1. The values were generated locally as 64 random bytes,
base64 encoded, written directly to SSM, and not printed or committed. The OpenAI API key parameter must be created or
rotated from the approved provider key value without logging the key.
