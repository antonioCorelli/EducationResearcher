# Production Service Secrets And IAM

Source issue: [#64](https://github.com/antonioCorelli/EducationResearcher/issues/64)

## Decision

Use AWS Systems Manager Parameter Store `SecureString` parameters for production service secrets, then expose them to
Elastic Beanstalk through the native `aws:elasticbeanstalk:application:environmentsecrets` namespace.

Elastic Beanstalk supports fetching values from Secrets Manager and SSM Parameter Store during instance bootstrapping
and assigning them to application environment variables. The repository stores only stable parameter ARNs, never secret
values.

## Managed Secret Parameters

| Environment variable | SSM parameter path | Required now | Notes |
| --- | --- | --- | --- |
| `PARTICIPANT_ACCESS_TOKEN_SECRET` | `/education-researcher/prod/participant-access-token-secret` | Yes | HMAC secret for run-scoped participant access tokens. |
| `AUDIO_LINK_SIGNING_SECRET` | `/education-researcher/prod/audio-link-signing-secret` | Yes | HMAC secret for short-lived service audio links. |
| `OPENAI_API_KEY` | `/education-researcher/prod/openai-api-key` | No | Create and reference only after real provider mode is approved. |

Create or rotate the required parameters without printing values:

```powershell
$bytes = New-Object byte[] 64
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToBase64String($bytes)
aws ssm put-parameter --region us-east-1 --name /education-researcher/prod/participant-access-token-secret --type SecureString --value $secret --overwrite

$bytes = New-Object byte[] 64
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToBase64String($bytes)
aws ssm put-parameter --region us-east-1 --name /education-researcher/prod/audio-link-signing-secret --type SecureString --value $secret --overwrite
```

Do not place these values in `.env`, GitHub Actions logs, issue comments, screenshots, shell transcripts, or browser
bundles.

## Elastic Beanstalk Configuration

The production EB config is split by sensitivity:

- `.ebextensions/01-service.config` contains non-secret environment variables.
- `.ebextensions/02-secrets.config` maps secret environment variables to SSM parameter ARNs.

The service fails at startup in `NODE_ENV=production` when required production values are missing, unsafe, or set to
local/test modes.

## Required Non-Secret Production Environment

```text
NODE_ENV=production
AWS_REGION=us-east-1
EDUCATION_RESEARCHER_ENV=prod
SERVICE_HOST=0.0.0.0
PORT=4000
SERVICE_PORT=4000
SERVICE_PUBLIC_BASE_URL=https://api.voxaria.io
CORS_ORIGIN=https://voxaria.io,https://www.voxaria.io
COGNITO_USER_POOL_ID=us-east-1_jTLroPp4Z
COGNITO_CLIENT_ID=51gd0to7l28c5vi7veh0a7quu1
STUDY_SHELL_STORE=dynamodb
PARTICIPANT_SLOT_STORE=dynamodb
CONSENT_VERSION_STORE=dynamodb
SURVEY_VERSION_STORE=dynamodb
OBJECTIVE_VERSION_STORE=dynamodb
RUN_LIFECYCLE_STORE=dynamodb
OPERATIONS_STORE=dynamodb
PARTICIPANT_ACCESS_BASE_URL=https://voxaria.io
```

## Required Secret Environment

```text
PARTICIPANT_ACCESS_TOKEN_SECRET=arn:aws:ssm:us-east-1:077317248751:parameter/education-researcher/prod/participant-access-token-secret
AUDIO_LINK_SIGNING_SECRET=arn:aws:ssm:us-east-1:077317248751:parameter/education-researcher/prod/audio-link-signing-secret
```

In Elastic Beanstalk these are configured as environment secrets, not regular environment properties. At runtime the
application receives the resolved secret values in `process.env`.

## IAM For Elastic Beanstalk Instances

Attach a least-privilege policy like this to the Elastic Beanstalk EC2 instance profile role. Include index ARNs for
DynamoDB queries against GSIs.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadConfiguredServiceSecrets",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters"],
      "Resource": [
        "arn:aws:ssm:us-east-1:077317248751:parameter/education-researcher/prod/participant-access-token-secret",
        "arn:aws:ssm:us-east-1:077317248751:parameter/education-researcher/prod/audio-link-signing-secret"
      ]
    },
    {
      "Sid": "UseProductionCognitoUserPool",
      "Effect": "Allow",
      "Action": ["cognito-idp:InitiateAuth", "cognito-idp:GlobalSignOut"],
      "Resource": "arn:aws:cognito-idp:us-east-1:077317248751:userpool/us-east-1_jTLroPp4Z"
    },
    {
      "Sid": "UseProductionDataTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:TransactWriteItems"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-evidence-scoring",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-evidence-scoring/index/*",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-identity-access",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-identity-access/index/*",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-operations",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-operations/index/*",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-run-lifecycle",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-run-lifecycle/index/*",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-study-setup",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-study-setup/index/*",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-versioned-configuration",
        "arn:aws:dynamodb:us-east-1:077317248751:table/education-researcher-prod-versioned-configuration/index/*"
      ]
    }
  ]
}
```

If the parameters use a customer-managed KMS key instead of the AWS-managed SSM key, also grant `kms:Decrypt` for that
key to the instance profile role.

S3 IAM is intentionally not enabled yet because the current service storage adapter still uses local filesystem-backed
storage. Real participant data remains blocked until S3-backed artifact storage is implemented, deployed, and granted
least-privilege bucket access.

## Verification

Before deploying a new production EB version:

```bash
aws ssm get-parameter --region us-east-1 --name /education-researcher/prod/participant-access-token-secret --query "Parameter.ARN" --output text
aws ssm get-parameter --region us-east-1 --name /education-researcher/prod/audio-link-signing-secret --query "Parameter.ARN" --output text
```

After deployment, verify the EB default URL before `api.voxaria.io`:

```bash
curl https://<elastic-beanstalk-default-url>/health
```

Expected response:

```json
{"service":"education-researcher-service","status":"ok"}
```

If a required production value is missing or unsafe, the service should fail startup instead of serving traffic with
local defaults.
