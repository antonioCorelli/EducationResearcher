# Service Hosting Decision

Source issue: [#63](https://github.com/antonioCorelli/EducationResearcher/issues/63)

## Decision

Host `api.voxaria.io` on AWS Elastic Beanstalk using the Docker platform.

The earlier architecture plan selected AWS App Runner, but AWS now documents that App Runner is not open to new customers after March 31, 2026. Existing App Runner customers can continue using it. Because the target production account could not be confirmed as App Runner-eligible from the current local IAM permissions, the production path is Elastic Beanstalk.

Elastic Beanstalk is a good fit for this service because:

- The API is a single long-running Fastify HTTP process.
- The service already respects cloud-provided `PORT` and binds to `0.0.0.0` in production.
- Docker gives one build path for local smoke testing and Elastic Beanstalk deployment.
- Elastic Beanstalk provides an Application Load Balancer, managed environment health, rolling deploys, CloudWatch logs, and straightforward custom domain routing without introducing ECS cluster operations yet.

Use ECS Fargate + ALB later if the API needs independent worker services, queue consumers, more granular autoscaling, sidecars, service discovery, or private subnet topology that is awkward in Elastic Beanstalk.

## Repository Configuration

- `Dockerfile` builds the `@education-researcher/service` workspace and runs `npm run start --workspace @education-researcher/service`.
- `Dockerrun.aws.json` explicitly maps Elastic Beanstalk to the service container port, matching the Dockerfile `EXPOSE 4000`.
- `.dockerignore` keeps local build output, dependencies, environment files, and development artifacts out of the image build context.
- `.ebextensions/01-service.config` configures the Elastic Beanstalk default process on port `80`, `/health` checks,
  production binding, and DynamoDB-backed stores. `Dockerrun.aws.json` maps the Docker container port `4000`; the
  load balancer targets the EB host/proxy port.

The committed Elastic Beanstalk configuration includes non-secret production defaults plus references to managed SSM
secret parameters. See `docs/service-secrets-and-iam.md` for the secret paths, IAM policy shape, and rotation guidance.
Do not commit secret values.

## Required Production Environment

The Elastic Beanstalk environment should include these non-secret values:

```text
NODE_ENV=production
SERVICE_HOST=0.0.0.0
PORT=4000
SERVICE_PORT=4000
SERVICE_PUBLIC_BASE_URL=https://api.voxaria.io
CORS_ORIGIN=https://voxaria.io,https://www.voxaria.io
AWS_REGION=us-east-1
EDUCATION_RESEARCHER_ENV=prod
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

Set these as managed secret references before production traffic:

```text
PARTICIPANT_ACCESS_TOKEN_SECRET=arn:aws:ssm:us-east-1:077317248751:parameter/education-researcher/prod/participant-access-token-secret
AUDIO_LINK_SIGNING_SECRET=arn:aws:ssm:us-east-1:077317248751:parameter/education-researcher/prod/audio-link-signing-secret
OPENAI_API_KEY=arn:aws:ssm:us-east-1:077317248751:parameter/education-researcher/prod/openai-api-key
```

Production participant voice interviews require `OPENAI_API_KEY`. Store the value as a SecureString parameter and expose it
through Elastic Beanstalk environment secrets; never commit or print the key value.

`CORS_ORIGIN` is limited to `https://voxaria.io,https://www.voxaria.io`. If the production Amplify app uses a different
canonical origin, update the runtime validation and deployment docs intentionally before deploying.

## IAM

The Elastic Beanstalk EC2 instance profile must allow the service to read and write only the required production DynamoDB tables:

- `education-researcher-prod-evidence-scoring`
- `education-researcher-prod-identity-access`
- `education-researcher-prod-operations`
- `education-researcher-prod-run-lifecycle`
- `education-researcher-prod-study-setup`
- `education-researcher-prod-versioned-configuration`

The service also needs Cognito IDP permissions for the configured user pool sign-in flow and SSM read access for the
managed secret parameters. See `docs/service-secrets-and-iam.md` for the policy template. Start narrowly with the exact
actions used by the service and expand only when a deployment error proves another action is required.

Do not enable real participant data collection until S3-backed interview audio storage, production secrets, provider data-processing approval, retention/deletion, observability, and incident response are complete in `docs/deployment-readiness.md`.

## Deployment

Build and smoke-test the image locally:

```bash
docker build -t education-researcher-service:prod .
docker run --rm -p 4000:4000 --env-file .env education-researcher-service:prod
curl http://127.0.0.1:4000/health
```

Create the Elastic Beanstalk application and environment with the Docker platform in `us-east-1`. The environment should
be load-balanced with an Application Load Balancer. Set `EnvironmentType=LoadBalanced` and
`LoadBalancerType=application` when creating the environment; those are create-time settings and should not be kept in
`.ebextensions` because they break later application-version updates.

The production environment is:

```text
Application=education-researcher-service
Environment=education-researcher-api-prod
Version=prod-20260601-2308
Default URL=https://education-researcher-api-prod.eba-xpf5qcne.us-east-1.elasticbeanstalk.com
```

After the first deployment, verify the default Elastic Beanstalk URL before adding the custom domain:

```bash
curl https://<elastic-beanstalk-default-url>/health
```

Expected response:

```json
{"service":"education-researcher-service","status":"ok"}
```

Then point `api.voxaria.io` at the Elastic Beanstalk load balancer using the approved DNS path, update `SERVICE_PUBLIC_BASE_URL` if needed, and re-run:

```bash
curl https://api.voxaria.io/health
```

## Redeploy

For a new application version:

```bash
git ls-files | tar -a -c -f education-researcher-service.zip -T -
```

Upload the zip as a new Elastic Beanstalk application version and deploy it to the existing production environment. Watch environment events and health until the new version is green, then verify `/health`.

## Rollback

Use Elastic Beanstalk's application version history to deploy the last known-good application version back to the production environment. Keep the custom domain mapped to the same environment unless the environment itself is unhealthy. After rollback completes:

```bash
curl https://<elastic-beanstalk-default-url>/health
curl https://api.voxaria.io/health
```

If the environment cannot recover, create a fresh Elastic Beanstalk environment from the last known-good application version, verify its default URL, then move `api.voxaria.io` to the replacement load balancer.

## App Runner Verification Note

A read-only check was attempted from local AWS credentials for account `077317248751`:

```bash
aws apprunner list-services --region us-east-1
```

The call failed with `AccessDeniedException` because the current IAM user does not have `apprunner:ListServices`. That means this repository change does not prove whether the account has legacy App Runner access. The selected production path no longer depends on App Runner.
