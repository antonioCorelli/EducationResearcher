# Production UI Smoke Testing And Alerts

The production smoke path verifies that the live web app can submit the researcher login form with the non-real smoke
test user and render the signed-in researcher workspace. It is intentionally narrow infrastructure for now: app shell,
API health, browser login, and alerting on failure.

## What Runs

The `Production Smoke` GitHub Actions workflow runs after successful `main` CI and can also be started manually from the
Actions tab. The workflow waits briefly before the first attempt so Amplify has time to publish the latest `main` build,
then uses Playwright Chromium to:

1. Open `https://voxaria.io`.
2. Confirm the researcher sign-in page renders.
3. Fill the login form with `VOXARIA_SMOKE_USERNAME` and `VOXARIA_SMOKE_PASSWORD`.
4. Submit the form.
5. Confirm the app reaches `/researcher` and renders the signed-in researcher workspace.

On failure, the workflow uploads `.local/production-smoke/production-smoke-failure.png` as a GitHub Actions artifact.

## Alerting Infrastructure

`EducationResearcherOperations-<environment>` creates:

- SNS topic: `education-researcher-<environment>-production-smoke-alarms`.
- CloudWatch metric alarm: `education-researcher-<environment>-ui-login-smoke-failure`.
- Optional SMS subscription for the phone number supplied at deploy time.

The workflow publishes this metric after each run:

```text
Namespace: EducationResearcher/ProductionSmoke
Metric: UiLoginFailure
Dimension: Environment=prod
Success value: 0
Failure value: 1
```

The alarm treats missing data as not breaching. A successful run publishes `0`, which resets the alarm so a later failed
deployment can alert again.

## One-Time Setup

### 1. Create The Smoke Test Researcher

Create a non-real production Cognito researcher dedicated to smoke testing. Do not use the pilot researcher's account.

```bash
aws cognito-idp admin-create-user --region us-east-1 --user-pool-id us-east-1_jTLroPp4Z --username <smoke-email> --user-attributes Name=email,Value=<smoke-email> Name=email_verified,Value=true
aws cognito-idp admin-set-user-password --region us-east-1 --user-pool-id us-east-1_jTLroPp4Z --username <smoke-email> --password <strong-password> --permanent
```

### 2. Add GitHub Secrets

In GitHub, add repository secrets:

```text
VOXARIA_SMOKE_USERNAME=<smoke-email>
VOXARIA_SMOKE_PASSWORD=<strong-password>
PRODUCTION_SMOKE_AWS_ROLE_ARN=<github-oidc-role-arn>
```

### 3. Create The GitHub OIDC Role

Create an AWS IAM role trusted by GitHub Actions for this repository and branch. Use this trust policy shape, replacing
`<account-id>` if needed:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:antonioCorelli/EducationResearcher:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Attach this permissions policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "cloudwatch:PutMetricData",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "cloudwatch:namespace": "EducationResearcher/ProductionSmoke"
        }
      }
    }
  ]
}
```

### 4. Deploy The Alarm Stack With The SMS Number

From `apps/infra`, deploy the operations stack and pass the SMS destination in E.164 format:

```bash
npx cdk deploy --app "npx tsx src/app.ts" EducationResearcherOperations-prod -c environment=prod --parameters EducationResearcherOperations-prod:ProductionAlarmPhoneNumber=<sms-phone-number-e164>
```

Complete any SNS SMS confirmation or opt-in prompt that AWS sends.

### 5. Verify Manually

Run the workflow manually from GitHub Actions. If you want to test the alarm, temporarily use an incorrect
`VOXARIA_SMOKE_PASSWORD`, run the workflow, confirm the SMS arrives, then restore the correct secret and rerun the
workflow so the alarm returns to OK.

## Local Smoke Run

Install the browser once:

```bash
npx playwright install chromium
```

Create `.env.production-smoke.local` from `.env.production-smoke.example`, fill in the non-real smoke credentials, and
run:

```bash
npm run smoke:prod
```
