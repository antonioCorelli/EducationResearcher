# EducationResearcher

EducationResearcher is an early-stage platform for formative education research studies. The V1 product lets researchers configure studies, collect participant consent and long-form survey responses, run voice-to-voice AI interviews, score combined evidence, review citations, and export CSV results.

For product context, start with:

- `PROJECT_CONTEXT.md`
- `docs/v1-prd-and-data-model.md`
- `docs/architecture-plan.md`
- `docs/open-questions.md`

## Current Repo Status

This repository now has a foundation scaffold for local development:

- `apps/web`: React, TypeScript, and Vite health/status page.
- `apps/service`: Node.js, TypeScript, and Fastify API with a `/health` route.
- Root npm workspace scripts for linting, typechecking, testing, and building.
- Minimal GitHub Actions CI workflow.

## Chosen Stack

- **Package manager:** npm workspaces.
- **Frontend:** React, TypeScript, and Vite.
- **Frontend hosting/deploy:** AWS Amplify.
- **Researcher/admin authentication:** Amazon Cognito.
- **Service API:** Node.js, TypeScript, and Fastify.
- **Service hosting/deploy:** AWS App Runner.
- **Primary AWS data services:** DynamoDB for application data and state, S3 for interview audio assets and generated exports.
- **Local provider mode:** fake providers are required from day one for auth/session, AI gap maps/scoring, voice interviews, and storage-like behavior.

AI and realtime voice model providers are still open decisions. They must be wrapped behind service adapters so local development and tests can run without sending real participant data to external providers.

## Local Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/antonioCorelli/EducationResearcher.git
cd EducationResearcher
npm install
```

Copy the example environment file before local development:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Local development defaults `STUDY_SHELL_STORE=memory`, `PARTICIPANT_SLOT_STORE=memory`, `CONSENT_VERSION_STORE=memory`, and `SURVEY_VERSION_STORE=memory` so the researcher setup flow works without DynamoDB Local. Set a store variable to `dynamodb` when you want that slice to persist to its local DynamoDB table.

## Command Contract

Run the web app locally:

```bash
npm run dev:web
```

Run the service API locally in a second terminal:

```bash
npm run dev:service
```

The web app defaults to `http://127.0.0.1:5173`. The service API defaults to `http://127.0.0.1:4000`, with its health check at `http://127.0.0.1:4000/health`.

Run baseline checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Participant Slot Import Format

Participant slot CSV import accepts a single participant code column with an optional `participantCode` or
`participant_code` header:

```csv
participantCode
P001
P002
P003
```

Rows with duplicate, blank, malformed, overlong, or multi-column values are reported back to the researcher while valid
rows are still created. Platform-generated participant slots accept a count from 1 to 200 and retry code generation when
a generated code collides within the study.

## Database Workflow

The initial DynamoDB model uses a table per data domain and is defined in `packages/data-schema`. AWS CDK table definitions live in `apps/infra`.

Start DynamoDB Local:

```bash
npm run db:local
```

Create local tables, reset them with first-build-slice fixture data, or synthesize the CDK data stack:

```bash
npm run db:create
npm run db:reset
npm run infra:synth
```

See `docs/database-migration-workflow.md` for table names, fixture coverage, and migration workflow details.

Run package-specific commands when needed:

```bash
npm run dev --workspace @education-researcher/web
npm run dev --workspace @education-researcher/service
```

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
