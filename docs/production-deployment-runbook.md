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
- `docs/service-hosting.md` for the deployment, verification, redeploy, and rollback procedure.

The service must be verified at the default Elastic Beanstalk URL with `GET /health` before mapping
`api.voxaria.io`.
