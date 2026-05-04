# Architecture Plan

Source PRD: `docs/v1-prd-and-data-model.md`  
Repo status: foundation scaffold with npm workspaces, a React/Vite web app, a Fastify service API, baseline lint/typecheck/test/build commands, and minimal CI.

## Stack Decisions

The following implementation decisions are confirmed for the first scaffold:

- **Frontend framework:** React, TypeScript, and Vite.
- **Package manager and layout:** npm workspaces with `apps/web` and `apps/service`.
- **Frontend hosting/deploy:** AWS Amplify.
- **Researcher/admin auth:** Amazon Cognito.
- **Service API:** Node.js, TypeScript, and Fastify.
- **Service hosting/deploy:** AWS App Runner.
- **Primary AWS data services:** DynamoDB for application records and run state, S3 for interview audio assets and generated exports.
- **Local/test provider mode:** fake providers are required from day one for auth/session, AI gap map/scoring, voice interview behavior, and storage-like behavior.

AI and realtime voice model providers remain open decisions. They should be integrated only through adapter boundaries so local development, tests, and early demos can use deterministic fakes.

## Recommendation

Use a service-first web application architecture. The service should own study configuration, run state, versioned artifacts, AI orchestration, scoring, exports, authorization, audit logging, and retention. The frontend should provide researcher and participant workflows over those service capabilities.

This fits the PRD because the core product behavior is not just screens; it is durable state, auditable AI artifacts, scoped access, and automatic transitions when runs complete, fail, or become stale.

## Major Components

- **Researcher web app:** React/Vite authenticated study setup, participant/run management, review, evidence drilldown, and export, deployed with AWS Amplify.
- **Participant web app:** React/Vite token-scoped consent, survey, voice interview, pause/resume, recovery, and thank-you flow, deployed with AWS Amplify.
- **Service API:** Node.js/TypeScript/Fastify endpoints for studies, configuration versions, slots, runs, artifacts, scoring, exports, and admin support, deployed with AWS App Runner.
- **Run orchestration service:** explicit state transitions, freshness enforcement, technical interruption handling, and scoring triggers.
- **AI orchestration layer:** gap map pass, interview pass/session integration, scoring pass, model metadata, prompt versioning, schema validation, retries, and error categorization.
- **Realtime voice adapter:** browser audio capture/playback, transcription, voice response, turn handling, connection state, and resume behavior.
- **Background worker:** gap map generation, scoring, stale-run sweeps, CSV generation, retention/deletion jobs, and operational cleanup.
- **DynamoDB:** authoritative study, run, artifact metadata, versioning, citations, audit logs, and telemetry records.
- **S3 object storage:** interview audio assets and any generated export files.
- **Admin/support surface:** privileged support tooling for operational events and carefully audited raw artifact access.

## Frontend Responsibilities

### Researcher

- Authenticate researcher/admin users.
- Create and edit study metadata.
- Configure consent content and method.
- Create, group, reorder, and version long-form survey questions.
- Create participant slots manually, by CSV import, or by platform generation.
- Create researcher-authorized runs for slots.
- Configure objectives, grade scales, grade examples, prompts, and evidence requirements.
- Display participant run status using participant-safe labels.
- Display scores, confidence, flags, rationales, evidence citations, and scoring metadata.
- Provide drilldown into raw survey responses, transcript turns, and audio spans when authorized.
- Request CSV export and download generated CSV.

### Participant

- Open a token-scoped run flow without account creation.
- Render consent and collect checkmark or electronic signature.
- Render required free-text survey questions.
- Submit survey once for the run.
- Transition automatically into interview once the gap map is ready.
- Provide sparse voice UI: AI caption, record/stop control, participant voice indication, AI voice wave, participant voice wave.
- Hide participant captions, transcript, rubrics, scores, gap map, and objective progress.
- Show calm retry/resume states for recoverable failures.
- Show stale, completed, unable-to-continue, and thank-you states.

### Admin Engineer

- View operational telemetry and participant-safe run status details.
- Investigate failures through privileged access controlled by role and audit logs.
- Avoid researcher-facing exposure of vendor names, stack traces, device diagnostics, or detailed system errors.

## Service Responsibilities

- Enforce researcher ownership and membership scoping on every study query.
- Enforce participant token scope, run validity, freshness, and single-run access.
- Manage immutable or versioned configuration for consent, survey, objectives, rubrics, prompts, and persona.
- Create participant slots and researcher-authorized runs.
- Snapshot active configuration references onto runs.
- Persist consent records and rendered consent snapshots.
- Persist survey responses and enforce one survey attempt per run.
- Generate and store gap maps after survey completion.
- Start, pause, resume, complete, and interrupt interview sessions.
- Persist transcript turns, audio asset metadata, timing metadata, and session summaries.
- Trigger scoring when interviews complete, runs become stale, or technical interruptions prevent continuation.
- Run manual rescoring without mutating prior scores.
- Persist scoring runs, objective scores, flags, citations, and model metadata.
- Generate CSV exports from latest or selected scoring runs.
- Enforce retention and researcher-initiated deletion.
- Record audit logs for data access and mutations.
- Record operational telemetry separately from researcher-facing data.

## Data And Storage Needs

Use DynamoDB as the primary physical data store for the logical model in the PRD. The logical entities still matter, but the physical model should be designed around access patterns, tenant isolation, study/run scoping, immutable version references, and auditability.

The data model includes these groups:

- **Identity and access:** `users`, `study_memberships`.
- **Study setup:** `studies`, `participant_slots`.
- **Versioned configuration:** `consent_versions`, `survey_versions`, `survey_groups`, `survey_questions`, `objective_versions`, `objective_grade_examples`, `interviewer_persona_versions`.
- **Run state:** `runs`, `consent_records`, `survey_responses`, `gap_maps`, `interview_sessions`, `interview_turns`, `interview_audio_assets`.
- **Scoring:** `scoring_runs`, `objective_scores`, `evidence_citations`.
- **Operations:** `operational_events`, `audit_logs`.

Use S3 object storage for:

- Interview audio files.
- Optional generated CSV export files.
- Any future large artifacts that should not live in the database.

Important data properties:

- Configuration used by a run must be immutable by reference or snapshotted.
- Citations must be stable and resolve back to raw evidence even after rescoring.
- Object storage keys should be study/run scoped but not guessable.
- DynamoDB keys and secondary indexes should make study-scoped authorization practical and hard to bypass.
- Soft deletion may be useful for researcher deletion workflows, but retention jobs must eventually purge governed data according to policy.

## External Integrations

- **AWS Amplify:** frontend hosting/deploy for the React/Vite app.
- **Amazon Cognito:** researcher/admin login, role claims, and session management.
- **AWS App Runner:** hosted container runtime for the Fastify service API.
- **DynamoDB:** study, run, versioned configuration, artifact metadata, scoring, telemetry, and audit records.
- **S3:** audio and export storage with signed access.
- **AI model provider:** gap map and scoring generation with structured output support; final provider not yet selected.
- **Realtime voice AI provider:** voice-to-voice interview, transcription, audio playback, and connection state; final provider not yet selected.
- **Observability provider:** logs, metrics, traces, and alerting.
- **Email or link distribution provider:** optional if V1 sends participant links rather than relying on researcher distribution.

Provider choices not listed above remain open and should be finalized before real participant data is processed.

## Fake Provider Modes

Fake providers are required from day one for local development, automated tests, and deterministic demos:

- **Fake auth/session:** simulate Cognito researcher/admin identities and role claims without requiring live AWS login.
- **Fake AI gap map/scoring:** return deterministic structured outputs, malformed outputs, and safe provider-error categories.
- **Fake voice interview:** simulate transcript turns, audio metadata, connection state, recoverable interruption, technical interruption, and completion.
- **Fake storage:** avoid production AWS writes in local/test flows while preserving the same service-level contract used by S3-backed storage.

Real providers should be selected through environment configuration and accessed only through adapters. Tests should default to fake providers.

## Security Considerations

- Enforce tenant isolation in service queries, not only in UI routing.
- Scope every researcher request by study ownership or membership.
- Treat admin access as privileged and audit all sensitive reads.
- Use unguessable participant run tokens with expiry or revocation behavior tied to run state.
- Prevent participants from accessing completed, stale, deleted, or unauthorized runs.
- Do not expose raw system errors, vendor names, stack traces, or diagnostics to researchers or participants.
- Store participant identity minimally and study-scoped.
- Protect audio assets and exports with signed, short-lived access.
- Validate AI structured outputs before persistence.
- Sanitize CSV exports against spreadsheet formula injection.
- Keep scoring, hidden objectives, rubrics, gap map internals, and transcripts out of participant UI.
- Define deletion behavior across database, object storage, exports, logs, telemetry, and backups.

## Error Handling Approach

- Model run state transitions explicitly and idempotently.
- Preserve all captured data before attempting risky transitions or provider calls.
- Categorize provider/model errors into safe operational categories.
- Use retry policies for transient failures with bounded attempts.
- Surface calm participant recovery states where retry/resume is possible.
- Mark `technical_interruption`, `partial`, or `stale` when continuation is no longer valid.
- Trigger scoring from available evidence after stale or interrupted outcomes.
- Show researchers participant-safe statuses and captured artifact summaries.
- Record detailed diagnostics only in operational telemetry.

## Observability And Logging Needs

- Structured logs with request ID, service request ID, run ID, participant slot ID, study ID, and actor type where appropriate.
- Metrics for AI latency, voice connection state, retries, scoring completion, gap map failures, stale transitions, and export failures.
- Audit logs for researcher/admin access, study changes, run creation, raw artifact access, deletion, and rescoring.
- Operational events for browser/device basics, timestamps, audio state, model/API error category, latency, retry count, and service request IDs.
- Alerts for elevated interview interruption rates, failed scoring jobs, failed gap map jobs, retention job failures, and export job failures.

## Testing Strategy

- **Unit tests:** state machine transitions, authorization helpers, versioning rules, CSV generation, scoring output validation, citation resolution, retention filters.
- **Service integration tests:** study setup, run creation, consent/survey submission, gap map persistence, interview session state, automatic scoring triggers, manual rescoring, export.
- **Frontend component tests:** researcher forms, participant consent/survey flow, participant voice UI states, status displays, score/evidence drilldown.
- **End-to-end tests:** first build slice from study creation through participant completion, scoring, review, and CSV export.
- **Contract tests:** AI gap map/scoring schemas and voice adapter event handling.
- **Security tests:** tenant isolation, participant token scope, stale/completed run blocking, admin audit logging, CSV injection.
- **Failure tests:** microphone failure, disconnect, transcription/model outage, scoring failure/retry, stale sweep.

## Deployment Assumptions

- A single React/Vite web application can serve researcher and participant routes for V1.
- AWS Amplify hosts and deploys the frontend.
- AWS App Runner hosts and deploys the Fastify service API.
- Cognito manages researcher/admin authentication.
- DynamoDB and S3 are required from the beginning.
- Background workers or scheduled jobs are required before participant flows are production-ready.
- Secrets for AI, voice, auth, storage, and observability providers must be environment-managed.
- Production should separate local development, staging, and production data.
- Retention and deletion jobs should run in production with dry-run or audit mode support before destructive purge.
- The repo still needs app scaffolding, package management, environment conventions, CI, and deployment documentation.

## Open Architecture Decisions

- DynamoDB physical data model, index strategy, and local development approach.
- Infrastructure-as-code approach for Amplify, Cognito, App Runner, DynamoDB, S3, and supporting IAM.
- Signed URL and access policy details for S3 audio/export artifacts.
- Cognito role/group claim mapping for researcher and admin users.
- AI and realtime voice providers.
- Whether V1 includes study collaborators or only owner/admin access.
- How participant links are generated and distributed.
