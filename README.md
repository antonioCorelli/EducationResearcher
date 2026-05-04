# EducationResearcher

EducationResearcher is an early-stage platform for formative education research studies. The V1 product lets researchers configure studies, collect participant consent and long-form survey responses, run voice-to-voice AI interviews, score combined evidence, review citations, and export CSV results.

For product context, start with:

- `PROJECT_CONTEXT.md`
- `docs/v1-prd-and-data-model.md`
- `docs/architecture-plan.md`
- `docs/open-questions.md`

## Current Repo Status

This repository is currently documentation-only. The app, service, package manifests, test configuration, and deployment files have not been scaffolded yet.

Issue #41 records implementation decisions and operating assumptions so the foundation scaffold can follow a shared target architecture.

## Chosen Stack

- **Frontend:** React, TypeScript, and Vite.
- **Frontend hosting/deploy:** AWS Amplify.
- **Researcher/admin authentication:** Amazon Cognito.
- **Service API:** Node.js, TypeScript, and Fastify.
- **Service hosting/deploy:** AWS App Runner.
- **Primary AWS data services:** DynamoDB for application data and state, S3 for interview audio assets and generated exports.
- **Local provider mode:** fake providers are required from day one for auth/session, AI gap maps/scoring, voice interviews, and storage-like behavior.

AI and realtime voice model providers are still open decisions. They must be wrapped behind service adapters so local development and tests can run without sending real participant data to external providers.

## Local Setup

Until the foundation scaffold lands, local setup is limited to cloning the repository and reviewing the planning documents:

```bash
git clone https://github.com/antonioCorelli/EducationResearcher.git
cd EducationResearcher
```

After the scaffold is added, the README should be updated with exact package manager commands, environment file setup, and verified startup/test commands from a fresh checkout.

## Planned Command Contract

The foundation scaffold should provide documented commands for:

- Installing dependencies.
- Running the React/Vite frontend locally.
- Running the Fastify service API locally.
- Running both frontend and service together.
- Linting.
- Typechecking.
- Running unit tests.
- Running integration or end-to-end tests with fake providers.
- Building production artifacts.

Do not assume command names until package manifests exist. When commands are added, verify them from a fresh checkout and replace this section with the exact commands.

## Provider Modes

Local development and deterministic tests must support fake providers from day one:

- **Fake auth/session:** simulate Cognito researcher/admin claims locally without requiring live AWS login.
- **Fake AI:** return deterministic gap map and scoring outputs, including malformed-output and provider-failure cases for tests.
- **Fake voice interview:** simulate transcript turns, audio metadata, connection events, interruption states, and completion.
- **Fake storage:** avoid writing sensitive test artifacts to production AWS resources; use local or isolated test storage behavior.

Real provider integrations should remain behind adapters so product workflows can be tested without live AWS, AI, or voice dependencies.

## Security And Data Handling

Treat survey responses, consent records, transcripts, interview audio, scores, citations, exports, operational telemetry, and audit logs as sensitive by default.

Important assumptions:

- Researcher access is enforced in the service, scoped by study ownership or membership.
- Participant access uses unguessable run-scoped links or tokens and does not require participant accounts.
- Cognito is for researcher/admin identity, not participant accounts.
- DynamoDB records should be keyed and queried around explicit tenant and study/run access patterns.
- S3 objects for audio and exports must use non-guessable keys and short-lived signed access.
- CSV exports must defend against spreadsheet formula injection.
- Participants must never see scoring objectives, rubrics, gap maps, scores, hidden progress, full transcripts, or participant speech captions.
- Researcher-facing errors must avoid vendor names, stack traces, device diagnostics, and raw system details.
- Admin access to sensitive artifacts must be role-limited and audit logged.
- Real participant data must not be sent to AI or voice providers until provider, privacy, and data-processing decisions are confirmed.

## Documentation Maintenance

When implementation begins, keep these documents in sync:

- Update this README with exact setup, commands, environment variables, and deployment steps.
- Update `docs/architecture-plan.md` when stack, provider, data, or deployment assumptions change.
- Update `docs/open-questions.md` as decisions are made.
- Preserve `docs/v1-prd-and-data-model.md` as source product context unless the product requirements themselves change.
