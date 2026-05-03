# Architecture Plan

Source PRD: `docs/v1-prd-and-data-model.md`  
Repo status: early planning repo with `docs/` only; no app framework, README, package files, AGENTS.md, or source tree exists yet.

## Recommendation

Use a service-first web application architecture. The service should own study configuration, run state, versioned artifacts, AI orchestration, scoring, exports, authorization, audit logging, and retention. The frontend should provide researcher and participant workflows over those service capabilities.

This fits the PRD because the core product behavior is not just screens; it is durable state, auditable AI artifacts, scoped access, and automatic transitions when runs complete, fail, or become stale.

## Major Components

- **Researcher web app:** authenticated study setup, participant/run management, review, evidence drilldown, and export.
- **Participant web app:** token-scoped consent, survey, voice interview, pause/resume, recovery, and thank-you flow.
- **Service API:** typed endpoints for studies, configuration versions, slots, runs, artifacts, scoring, exports, and admin support.
- **Run orchestration service:** explicit state transitions, freshness enforcement, technical interruption handling, and scoring triggers.
- **AI orchestration layer:** gap map pass, interview pass/session integration, scoring pass, model metadata, prompt versioning, schema validation, retries, and error categorization.
- **Realtime voice adapter:** browser audio capture/playback, transcription, voice response, turn handling, connection state, and resume behavior.
- **Background worker:** gap map generation, scoring, stale-run sweeps, CSV generation, retention/deletion jobs, and operational cleanup.
- **Relational database:** authoritative study, run, artifact metadata, versioning, citations, audit logs, and telemetry records.
- **Object storage:** interview audio assets and any generated export files.
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

Use a relational database for the logical model in the PRD, with these groups:

- **Identity and access:** `users`, `study_memberships`.
- **Study setup:** `studies`, `participant_slots`.
- **Versioned configuration:** `consent_versions`, `survey_versions`, `survey_groups`, `survey_questions`, `objective_versions`, `objective_grade_examples`, `interviewer_persona_versions`.
- **Run state:** `runs`, `consent_records`, `survey_responses`, `gap_maps`, `interview_sessions`, `interview_turns`, `interview_audio_assets`.
- **Scoring:** `scoring_runs`, `objective_scores`, `evidence_citations`.
- **Operations:** `operational_events`, `audit_logs`.

Use object storage for:

- Interview audio files.
- Optional generated CSV export files.
- Any future large artifacts that should not live in the database.

Important data properties:

- Configuration used by a run must be immutable by reference or snapshotted.
- Citations must be stable and resolve back to raw evidence even after rescoring.
- Object storage keys should be study/run scoped but not guessable.
- Soft deletion may be useful for researcher deletion workflows, but retention jobs must eventually purge governed data according to policy.

## External Integrations

- **Authentication provider:** researcher/admin login, role claims, and session management.
- **AI model provider:** gap map and scoring generation with structured output support.
- **Realtime voice AI provider:** voice-to-voice interview, transcription, audio playback, and connection state.
- **Object storage provider:** audio and export storage with signed access.
- **Observability provider:** logs, metrics, traces, and alerting.
- **Email or link distribution provider:** optional if V1 sends participant links rather than relying on researcher distribution.

Provider choices are not specified in the PRD and should be finalized before implementation.

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

- A single web application can serve researcher and participant routes for V1.
- A relational database and object storage are required from the beginning.
- Background workers or scheduled jobs are required before participant flows are production-ready.
- Secrets for AI, voice, auth, storage, and observability providers must be environment-managed.
- Production should separate local development, staging, and production data.
- Retention and deletion jobs should run in production with dry-run or audit mode support before destructive purge.
- The repo still needs app scaffolding, environment conventions, CI, and deployment documentation.

## Open Architecture Decisions

- Framework and language for the web app and service.
- Database vendor and migration tool.
- Object storage provider and signed URL approach.
- Authentication provider and role model.
- AI and realtime voice providers.
- Whether V1 includes study collaborators or only owner/admin access.
- Whether early implementation uses simulated voice interviews before real voice-to-voice integration.
- How participant links are generated and distributed.
