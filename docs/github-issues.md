# GitHub Issues Plan

Source PRD: `docs/v1-prd-and-data-model.md`

## Epics

1. Foundation
2. Researcher Setup
3. Participant Runs
4. Participant Flow
5. AI Orchestration
6. Interview
7. Run Freshness
8. Scoring
9. Researcher Review
10. Exports
11. Operations
12. Quality
13. Docs

## Dependencies

- Foundation issues should land before product slices that require persistence, auth, or workers.
- Researcher study setup must precede participant slots/runs.
- Participant consent and survey must precede gap map generation.
- Gap map generation must precede the real interview orchestration path.
- Interview artifact persistence must precede scoring citations from interview evidence.
- Scoring must precede score review and CSV export.
- Observability, audit logging, and tenant isolation should be added early and expanded as sensitive surfaces ship.

## Suggested Labels

- `frontend`
- `service`
- `data`
- `ai`
- `voice`
- `security`
- `testing`
- `docs`
- `ops`
- `export`
- `mvp`
- `beta`

## Issues

### [Foundation] Scaffold web app, service, and development conventions

**Type:** chore  
**Priority:** P0  
**Labels:** service, frontend, docs, testing, mvp  
**Depends on:** None

**Problem**
The repo has planning docs only. Engineers need an application skeleton, development workflow, and conventions before feature implementation can proceed.

**Scope**
Create the initial app/service structure, package management, formatting/linting/test commands, environment file examples, README, and basic route/API health checks.

**Acceptance Criteria**
- [ ] Repo has a documented local setup path.
- [ ] App and service entry points run locally.
- [ ] Lint, typecheck, and test commands are documented and pass.
- [ ] Environment variable examples exist without secrets.

**Out of Scope**
Product features, real AI/voice integration, production deployment.

**Implementation Notes**
Choose the stack before implementation. Keep researcher and participant surfaces in one app unless a later decision splits them.

**Testing Notes**
Verify local startup, health check, and baseline CI commands.

### [Foundation] Define database schema and migration workflow

**Type:** feature  
**Priority:** P0  
**Labels:** data, service, mvp  
**Depends on:** [Foundation] Scaffold web app, service, and development conventions

**Problem**
The PRD depends on versioned studies, runs, artifacts, scoring, telemetry, and audit records, but no physical schema exists.

**Scope**
Create initial migrations for the logical PRD model, including users, studies, memberships, slots, versions, runs, artifacts, scoring, citations, operational events, and audit logs.

**Acceptance Criteria**
- [ ] Migration workflow is documented.
- [ ] Tables include primary keys, foreign keys, timestamps, and needed status fields.
- [ ] Configuration version tables support immutable run references.
- [ ] Seed or fixture data supports local development.

**Out of Scope**
Optimizing every index or adding provider-specific storage policies.

**Implementation Notes**
Use the PRD logical model as the baseline. Add indexes for study ownership, participant slots, runs, scoring runs, and citations.

**Testing Notes**
Run migrations from empty database and verify rollback/reset behavior if supported.

### [Foundation] Implement researcher authentication and role model

**Type:** feature  
**Priority:** P0  
**Labels:** service, frontend, security, mvp  
**Depends on:** [Foundation] Scaffold web app, service, and development conventions

**Problem**
Researchers and admin engineers need authenticated access, while participants must not create accounts.

**Scope**
Add researcher/admin login, user records, session handling, roles, and route protection for authenticated researcher/admin surfaces.

**Acceptance Criteria**
- [ ] Researchers can sign in and out.
- [ ] Admin engineers can be distinguished by role.
- [ ] Unauthenticated users cannot access researcher/admin routes.
- [ ] Participant routes do not require researcher login.

**Out of Scope**
Participant accounts, advanced organization management, SSO unless selected as the auth provider.

**Implementation Notes**
Use `users.role` and `study_memberships` as the service authorization foundation.

**Testing Notes**
Test authenticated, unauthenticated, researcher, and admin route access.

### [Foundation] Enforce study-scoped authorization helpers

**Type:** feature  
**Priority:** P0  
**Labels:** service, security, testing, mvp  
**Depends on:** [Foundation] Define database schema and migration workflow; [Foundation] Implement researcher authentication and role model

**Problem**
Researchers must only access studies and participant data they own or are members of.

**Scope**
Create reusable service authorization helpers for study reads/writes, run access, raw artifact access, and admin overrides.

**Acceptance Criteria**
- [ ] Every service query for study-owned data can be scoped by owner or membership.
- [ ] Admin override paths are explicit and auditable.
- [ ] Authorization failures return safe errors.
- [ ] Tests cover cross-study access denial.

**Out of Scope**
Full audit UI.

**Implementation Notes**
Keep authorization in the service layer so UI-only checks are never the security boundary.

**Testing Notes**
Use two researcher fixtures and verify neither can read or mutate the other's studies, slots, runs, scores, or artifacts.

### [Researcher Setup] Create and edit study shell

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, data, mvp  
**Depends on:** [Foundation] Enforce study-scoped authorization helpers

**Problem**
Researchers need a study container before configuring consent, surveys, slots, objectives, and runs.

**Scope**
Build create/edit study flows for title, freshness window, interview length cap, and default locked V1 interviewer persona copy.

**Acceptance Criteria**
- [ ] Researcher can create a study with required defaults.
- [ ] Researcher can edit title, freshness days, and max interview minutes.
- [ ] Freshness defaults to 14 days.
- [ ] Interview cap defaults to 45 minutes.
- [ ] Persona field is locked to the V1 default and not customizable.

**Out of Scope**
Consent, survey, objectives, participant slots, or run creation.

**Implementation Notes**
Persist `active_persona_version_id` once persona seed data exists.

**Testing Notes**
Test creation defaults, edits, validation, and unauthorized access.

### [Researcher Setup] Configure versioned consent

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, data, security, mvp  
**Depends on:** [Researcher Setup] Create and edit study shell

**Problem**
Every run must reference the consent version accepted by the participant.

**Scope**
Build consent editor for consent text and method, with version creation on edits and active version selection.

**Acceptance Criteria**
- [ ] Researcher can create consent content for a study.
- [ ] Researcher can choose checkmark or electronic signature.
- [ ] Editing active consent creates a new version.
- [ ] Existing runs retain their original consent version reference.
- [ ] UI copy avoids claiming legal or institutional sufficiency.

**Out of Scope**
Guardian consent workflow and legal review tooling.

**Implementation Notes**
Store `consent_versions.version_number`, `consent_text`, `consent_method`, and `is_active`.

**Testing Notes**
Test version creation and run references before and after consent edits.

### [Researcher Setup] Configure versioned long-form survey

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, data, mvp  
**Depends on:** [Researcher Setup] Create and edit study shell

**Problem**
Researchers need to define required free-text survey questions while preserving historical versions.

**Scope**
Build survey editor for optional group titles, required long-form questions, sort order, and versioning.

**Acceptance Criteria**
- [ ] Researcher can create ungrouped questions.
- [ ] Researcher can create grouped questions with visible group titles.
- [ ] Questions are long-form text only.
- [ ] At least one required question is enforced.
- [ ] Survey edits create a new active survey version.
- [ ] Existing runs keep their original survey version.

**Out of Scope**
Closed-ended question types, branching, validation beyond required text.

**Implementation Notes**
Use `survey_versions`, `survey_groups`, and `survey_questions`.

**Testing Notes**
Test grouped and ungrouped rendering data, versioning, ordering, and run references.

### [Researcher Setup] Configure versioned scoring objectives and rubrics

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, data, ai, mvp  
**Depends on:** [Researcher Setup] Create and edit study shell

**Problem**
Scoring depends on researcher-defined objectives, grade scales, examples, evidence requirements, and optional custom prompts.

**Scope**
Build objective editor with title, description, optional custom scoring prompt, grade labels, examples, evidence requirements, ordering, and versioning.

**Acceptance Criteria**
- [ ] Researcher can create one or more objectives.
- [ ] Each objective includes title and description.
- [ ] Grade labels support custom researcher-defined scales.
- [ ] Grade examples can be attached to labels.
- [ ] Evidence requirements can be captured.
- [ ] Objective edits create new versions without overwriting scoring history.

**Out of Scope**
Objective templates, analytics, public rubric sharing.

**Implementation Notes**
Use stable `objective_key` across versions so rescoring can relate objective history.

**Testing Notes**
Test versioning, validation, examples, and preservation of prior scoring references.

### [Participant Runs] Create participant slots manually

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, data, mvp  
**Depends on:** [Researcher Setup] Create and edit study shell

**Problem**
Researchers need study-scoped participant identities without requiring names, emails, or participant accounts.

**Scope**
Build participant slot creation and management for researcher-supplied participant codes.

**Acceptance Criteria**
- [ ] Researcher can add participant codes to a study.
- [ ] Codes are unique within a study.
- [ ] Slot list shows code, source, status, and archived state.
- [ ] Researcher can archive a slot.

**Out of Scope**
CSV import and platform-generated codes.

**Implementation Notes**
Use `participant_slots.code_source = researcher_supplied`.

**Testing Notes**
Test duplicate code rejection within a study and allowance across different studies.

### [Participant Runs] Import and generate participant slots

**Type:** feature  
**Priority:** P1  
**Labels:** frontend, service, data, mvp  
**Depends on:** [Participant Runs] Create participant slots manually

**Problem**
Small studies may still need bulk slot creation through CSV import or platform-generated codes.

**Scope**
Add CSV import for researcher-supplied codes and platform-generated participant code creation.

**Acceptance Criteria**
- [ ] Researcher can import participant codes from CSV.
- [ ] Import reports duplicates and invalid rows.
- [ ] Researcher can request a count of platform-generated slots.
- [ ] Generated codes are unique within the study.

**Out of Scope**
Emailing participants or public recruitment.

**Implementation Notes**
Finalize CSV format before implementation.

**Testing Notes**
Test valid import, duplicate import, malformed files, and generated code collisions.

### [Participant Runs] Create researcher-authorized runs

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, data, security, mvp  
**Depends on:** [Researcher Setup] Configure versioned consent; [Researcher Setup] Configure versioned long-form survey; [Researcher Setup] Configure versioned scoring objectives and rubrics; [Participant Runs] Create participant slots manually

**Problem**
Participants cannot create or reset runs themselves. Researchers need to authorize each fresh survey/interview cycle.

**Scope**
Build run creation for one or more participant slots, snapshotting active configuration references and computing freshness deadlines.

**Acceptance Criteria**
- [ ] Researcher can create a run for a slot.
- [ ] Researcher can bulk-create runs for selected slots.
- [ ] Run stores active survey, consent, objective set, and persona references.
- [ ] Run stores freshness deadline and max interview minutes.
- [ ] Participant cannot self-create a new run after completion.

**Out of Scope**
Participant link distribution email.

**Implementation Notes**
Set `current_run_for_slot` rules clearly when a new run is created for a slot.

**Testing Notes**
Test config references, multiple runs per slot, and participant self-reset denial.

### [Participant Runs] Generate secure participant run access links

**Type:** feature  
**Priority:** P0  
**Labels:** service, frontend, security, mvp  
**Depends on:** [Participant Runs] Create researcher-authorized runs

**Problem**
Participants need frictionless access to their assigned run without accounts, while access remains scoped and unguessable.

**Scope**
Create tokenized participant run links or access codes tied to a run and slot, with service validation for run state and freshness.

**Acceptance Criteria**
- [ ] Researcher can copy or view a participant-safe run link/access code.
- [ ] Token/code grants access only to the intended run.
- [ ] Completed, stale, deleted, or unauthorized runs are blocked.
- [ ] Failed access attempts return participant-safe messages.

**Out of Scope**
Email/SMS delivery.

**Implementation Notes**
Do not expose sequential run IDs as the only access secret.

**Testing Notes**
Test invalid, expired/stale, cross-run, completed, and valid token access.

### [Participant Runs] Implement run state machine

**Type:** feature  
**Priority:** P0  
**Labels:** service, data, testing, mvp  
**Depends on:** [Participant Runs] Create researcher-authorized runs

**Problem**
Run states drive participant access, scoring triggers, researcher status, freshness, and failure handling.

**Scope**
Implement explicit validated transitions for created, consented, survey in progress, survey completed, interview in progress, interview paused, interview completed, stale, partial, technical interruption, and scored.

**Acceptance Criteria**
- [ ] Happy path transitions are supported.
- [ ] Pause/resume transitions are supported.
- [ ] Stale transitions are supported from survey/interview active states.
- [ ] Technical interruption and partial transitions are supported.
- [ ] Invalid transitions are rejected.

**Out of Scope**
Full researcher UI for every status.

**Implementation Notes**
Prefer idempotent transition functions so retries do not corrupt state.

**Testing Notes**
Unit test all allowed and disallowed transitions.

### [Participant Flow] Capture participant consent record

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, data, security, mvp  
**Depends on:** [Participant Runs] Generate secure participant run access links; [Participant Runs] Implement run state machine

**Problem**
Participants must consent before the survey, and the platform must preserve what they accepted.

**Scope**
Build participant consent page using the run's consent version and capture consent method, timestamp, signature text if needed, and rendered consent snapshot.

**Acceptance Criteria**
- [ ] Consent page renders before survey access.
- [ ] Checkmark consent can be captured when configured.
- [ ] Electronic signature can be captured when configured.
- [ ] Consent record stores run ID, consent version, method, timestamp, and rendered text.
- [ ] Run transitions to consented after successful consent.

**Out of Scope**
Legal review, guardian consent, participant account history.

**Implementation Notes**
Prevent consent submission if run is stale, completed, deleted, or unauthorized.

**Testing Notes**
Test both consent methods and verify rendered snapshot persistence.

### [Participant Flow] Render and submit long-form survey

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, data, mvp  
**Depends on:** [Participant Flow] Capture participant consent record

**Problem**
The participant must complete the run's snapshotted free-text survey exactly once before interview.

**Scope**
Build survey page for grouped and ungrouped required long-form questions, response saving, and final submission.

**Acceptance Criteria**
- [ ] Survey renders from the run's survey version.
- [ ] Grouped and ungrouped questions display correctly.
- [ ] Required free-text responses are enforced.
- [ ] Submitted responses are persisted.
- [ ] Run transitions to survey_completed.
- [ ] Participant cannot submit a second survey attempt for the same run.

**Out of Scope**
Autosave, closed-ended questions, participant review after completion.

**Implementation Notes**
Expected answers are sentences to a single paragraph, but the service should not over-constrain useful long-form responses without product confirmation.

**Testing Notes**
Test required validation, duplicate submission, stale blocking, and versioned rendering.

### [Participant Flow] Add participant completion and blocked-state screens

**Type:** feature  
**Priority:** P1  
**Labels:** frontend, mvp  
**Depends on:** [Participant Runs] Generate secure participant run access links; [Participant Flow] Render and submit long-form survey

**Problem**
Participants need clear, calm end states when the run is complete, stale, interrupted, or unavailable.

**Scope**
Build participant-safe screens for thank-you, stale run, already completed run, unable to continue, and invalid access.

**Acceptance Criteria**
- [ ] Completed runs show a thank-you screen.
- [ ] Stale runs explain that the run can no longer continue.
- [ ] Technical interruption states use calm recovery language.
- [ ] Invalid/unauthorized access avoids leaking study or participant details.

**Out of Scope**
Researcher contact workflows or support ticketing.

**Implementation Notes**
Keep text participant-safe and avoid diagnostics.

**Testing Notes**
E2E test direct navigation to each blocked state.

### [AI Orchestration] Generate and persist survey gap map

**Type:** feature  
**Priority:** P0  
**Labels:** service, ai, data, mvp  
**Depends on:** [Participant Flow] Render and submit long-form survey; [Researcher Setup] Configure versioned scoring objectives and rubrics

**Problem**
The interview must be informed by survey evidence, ambiguities, contradictions, and missing evidence relative to scoring objectives.

**Scope**
Create AI gap map generation after survey submission, validate structured output, persist gap map JSON fields and model metadata, and make the result available to interview orchestration.

**Acceptance Criteria**
- [ ] Gap map job starts after survey completion.
- [ ] Gap map includes already answered, ambiguous, contradictory, missing, and recommended probe sections.
- [ ] Contradictions are represented as priority interview targets.
- [ ] Model name/version and generated timestamp are stored.
- [ ] Invalid AI output is handled without losing survey data.

**Out of Scope**
Researcher approval workflow for gap maps.

**Implementation Notes**
Use structured output/schema validation. Store gap maps as auditable artifacts.

**Testing Notes**
Use mocked AI responses for valid, invalid, and provider-failure cases.

### [AI Orchestration] Define fixed V1 interviewer persona prompt version

**Type:** feature  
**Priority:** P0  
**Labels:** service, ai, data, mvp  
**Depends on:** [Foundation] Define database schema and migration workflow

**Problem**
Runs must reference a fixed V1 interviewer persona/version, and participants should experience a calm research interviewer.

**Scope**
Seed and reference a default interviewer persona version with style instructions matching the PRD.

**Acceptance Criteria**
- [ ] Default V1 persona exists in data.
- [ ] New studies/runs reference the active default persona.
- [ ] Persona instructs the AI to be calm, warm, neutral, curious, and non-evaluative.
- [ ] Persona instructs the AI not to reveal scoring objectives, rubrics, grades, scores, or gap map internals.

**Out of Scope**
Researcher-selectable personas.

**Implementation Notes**
Track persona version metadata so future persona changes do not mutate existing runs.

**Testing Notes**
Verify seeded persona and run references.

### [AI Orchestration] Build AI provider abstraction and structured output validation

**Type:** feature  
**Priority:** P0  
**Labels:** service, ai, testing, mvp  
**Depends on:** [Foundation] Scaffold web app, service, and development conventions

**Problem**
Gap map and scoring passes need reliable AI calls with metadata, retries, safe error categories, and validated outputs.

**Scope**
Implement provider abstraction for non-voice AI calls, schema validation, retry handling, model metadata capture, and safe error categorization.

**Acceptance Criteria**
- [ ] Gap map and scoring code can call through the abstraction.
- [ ] Structured output validation rejects malformed responses.
- [ ] Model name/version and service request IDs are available for persistence.
- [ ] Provider errors map to safe operational categories.

**Out of Scope**
Realtime voice integration.

**Implementation Notes**
Keep prompts/versioning explicit and testable.

**Testing Notes**
Unit test success, malformed output, retryable error, and non-retryable error cases.

### [Interview] Implement interview session lifecycle

**Type:** feature  
**Priority:** P0  
**Labels:** service, data, voice, mvp  
**Depends on:** [Participant Runs] Implement run state machine; [AI Orchestration] Generate and persist survey gap map

**Problem**
The run can include zero or more interview sessions, and participants can pause/resume while the run remains fresh.

**Scope**
Create service endpoints and data persistence for starting, pausing, resuming, completing, and interrupting interview sessions.

**Acceptance Criteria**
- [ ] Start interview creates an active interview session.
- [ ] Pause records session end or paused state and transitions run.
- [ ] Resume creates or continues a valid session while fresh.
- [ ] Completion records ended timestamp and transitions run.
- [ ] Interruption records safe status and preserves captured data.

**Out of Scope**
Browser audio UI and real voice provider integration.

**Implementation Notes**
Use `interview_sessions.session_number` and status fields to preserve history across resumes.

**Testing Notes**
Test lifecycle transitions, stale blocking, and multiple sessions per run.

### [Interview] Build sparse participant voice UI

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, voice, mvp  
**Depends on:** [Interview] Implement interview session lifecycle

**Problem**
Participants need a minimal voice interface that supports the interview without exposing hidden research/scoring data.

**Scope**
Build the participant interview screen with AI caption, record/stop control, voice input indication, AI wave, participant wave, pause/resume, and completion.

**Acceptance Criteria**
- [ ] UI shows AI question caption/transcript only.
- [ ] UI has a record button that becomes stop-record while recording.
- [ ] UI shows participant voice activity.
- [ ] UI shows AI and participant voice waves.
- [ ] UI does not show participant captions, full transcript, rubrics, scores, gap map, or objective progress.

**Out of Scope**
Researcher transcript review UI.

**Implementation Notes**
The UI should support a simulated voice adapter for local development if real provider integration is not ready.

**Testing Notes**
Use component and E2E tests to verify hidden data is absent from participant UI.

### [Interview] Integrate realtime voice interview provider

**Type:** feature  
**Priority:** P0  
**Labels:** service, frontend, voice, ai, mvp  
**Depends on:** [Interview] Build sparse participant voice UI; [AI Orchestration] Define fixed V1 interviewer persona prompt version

**Problem**
The participant interview must be voice-to-voice and informed by the survey, gap map, objectives, persona, remaining time, and run state.

**Scope**
Connect browser voice UI and service session state to the selected realtime voice provider.

**Acceptance Criteria**
- [ ] Interview prompt includes survey responses, gap map, objective context, persona, remaining time, and run state.
- [ ] AI asks one question at a time and can probe naturally.
- [ ] AI avoids revealing hidden scoring/gap/rubric details.
- [ ] Remaining time is available to the interview orchestration.
- [ ] Connection state is reported to the service for telemetry.

**Out of Scope**
Multiple interviewer personas and advanced researcher control of interview strategy.

**Implementation Notes**
Provider choice must be finalized first. Keep adapter boundaries clean so tests can use a fake provider.

**Testing Notes**
Run scripted provider/fake-provider tests for prompt inputs, connection events, and participant UI behavior.

### [Interview] Persist transcript turns and audio asset metadata

**Type:** feature  
**Priority:** P0  
**Labels:** service, data, voice, mvp  
**Depends on:** [Interview] Integrate realtime voice interview provider

**Problem**
Scoring and evidence review require durable transcripts, audio references, speaker labels, and timing metadata.

**Scope**
Persist AI and participant transcript turns, audio timing, audio asset storage references, duration, and transcript token counts.

**Acceptance Criteria**
- [ ] AI and participant turns are stored with speaker labels.
- [ ] Transcript turns include timing metadata when available.
- [ ] Audio asset metadata includes storage URI and duration.
- [ ] Interview session records audio duration and transcript token count.
- [ ] Data remains available for scoring and researcher citations.

**Out of Scope**
Bulk audio export.

**Implementation Notes**
Store audio in object storage and metadata in relational tables.

**Testing Notes**
Use fake provider transcripts/audio metadata to verify persistence and citation lookup.

### [Interview] Handle technical failures and retry/resume

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, voice, ops, mvp  
**Depends on:** [Interview] Implement interview session lifecycle; [Interview] Persist transcript turns and audio asset metadata

**Problem**
Microphone, AI voice, disconnect, transcription, and model/API failures must preserve data and produce safe user/researcher states.

**Scope**
Implement recovery UI, retry/resume behavior, technical interruption status, partial marking, and operational event capture for interview failures.

**Acceptance Criteria**
- [ ] Recoverable failures show retry/resume options.
- [ ] Captured audio/transcript data is preserved before failure handling.
- [ ] Non-recoverable failures mark technical interruption or partial status.
- [ ] Researcher status remains participant-safe.
- [ ] Operational events capture error category, audio state, latency, retry count, and service request ID.

**Out of Scope**
Detailed diagnostics in researcher UI.

**Implementation Notes**
Ensure scoring is triggered from available evidence after technical interruption.

**Testing Notes**
Simulate microphone failure, disconnect, provider error, and transcription outage.

### [Run Freshness] Enforce freshness window and stale scoring trigger

**Type:** feature  
**Priority:** P0  
**Labels:** service, data, testing, mvp  
**Depends on:** [Participant Runs] Implement run state machine

**Problem**
Runs should not continue after the freshness deadline, but captured data should still be scored with stale/partial flags.

**Scope**
Block participant continuation after deadline, add stale sweep/job, mark stale runs, preserve data, and trigger scoring from available evidence.

**Acceptance Criteria**
- [ ] Freshness deadline is set at run creation.
- [ ] Participant continuation is blocked after deadline.
- [ ] Stale job marks eligible runs stale.
- [ ] Stale runs preserve captured artifacts.
- [ ] Scoring is triggered for stale runs with stale/partial context.

**Out of Scope**
Researcher deadline extension UI unless explicitly selected.

**Implementation Notes**
Default freshness is 14 days, configurable per study/run.

**Testing Notes**
Use time-controlled tests for before, at, and after freshness deadline.

### [Scoring] Implement automatic scoring job

**Type:** feature  
**Priority:** P0  
**Labels:** service, ai, data, mvp  
**Depends on:** [Interview] Persist transcript turns and audio asset metadata; [Run Freshness] Enforce freshness window and stale scoring trigger; [AI Orchestration] Build AI provider abstraction and structured output validation

**Problem**
The system must score every run after completion, staleness, or technical interruption.

**Scope**
Build automatic scoring job that gathers survey responses, gap map, transcript/audio metadata, objective versions, run flags, and produces validated objective scores.

**Acceptance Criteria**
- [ ] Scoring triggers after interview completion.
- [ ] Scoring triggers after stale or technical interruption states.
- [ ] Each active objective version receives a grade.
- [ ] Each score includes confidence, rationale, flags, citations, and model metadata.
- [ ] Low confidence, missing interview evidence, contradiction, stale, partial, and technical interruption flags can be emitted.

**Out of Scope**
Researcher-facing score UI.

**Implementation Notes**
Always score available evidence. Validate scoring output before persistence.

**Testing Notes**
Use mocked AI scoring outputs for completed, no-interview, stale, partial, and contradictory evidence cases.

### [Scoring] Persist citations and resolve evidence sources

**Type:** feature  
**Priority:** P0  
**Labels:** service, data, ai, mvp  
**Depends on:** [Scoring] Implement automatic scoring job

**Problem**
Researchers must be able to drill from scores into raw survey responses, transcript turns, and audio spans.

**Scope**
Persist evidence citations for survey responses, interview turns, and audio spans, and implement service lookup for authorized citation resolution.

**Acceptance Criteria**
- [ ] Citations can reference survey responses.
- [ ] Citations can reference interview turns.
- [ ] Citations can reference audio spans when timing is available.
- [ ] Citation lookup enforces researcher authorization.
- [ ] Citation source remains stable across rescoring.

**Out of Scope**
Advanced transcript search or annotation.

**Implementation Notes**
Use `evidence_citations.source_type`, `source_id`, `quote`, and optional audio timing.

**Testing Notes**
Test citation lookup, cross-study denial, missing source handling, and audio span metadata.

### [Scoring] Build researcher score review view

**Type:** feature  
**Priority:** P0  
**Labels:** frontend, service, data, mvp  
**Depends on:** [Scoring] Persist citations and resolve evidence sources

**Problem**
Researchers need to interpret scores with confidence, rationale, flags, and evidence.

**Scope**
Build participant/run score view showing per-objective grades, confidence, low-confidence flagging, rationale, scoring metadata, and citations.

**Acceptance Criteria**
- [ ] Scores are grouped by participant run and objective.
- [ ] Confidence and low-confidence flags are visually clear.
- [ ] Rationale is shown for each objective score.
- [ ] Flags are shown in researcher-safe language.
- [ ] Citation links open the referenced survey/interview/audio evidence.

**Out of Scope**
Publication-ready qualitative memo generation.

**Implementation Notes**
Keep participant-facing routes completely separate from score data.

**Testing Notes**
Test completed, stale, partial, and technical interruption score displays.

### [Scoring] Build raw evidence drilldown

**Type:** feature  
**Priority:** P1  
**Labels:** frontend, service, data, security, mvp  
**Depends on:** [Scoring] Persist citations and resolve evidence sources

**Problem**
Researchers need to inspect raw survey responses, transcript turns, and audio from citations.

**Scope**
Build authorized raw evidence view for a run, with survey responses, transcript turns, and audio playback or signed audio links where available.

**Acceptance Criteria**
- [ ] Researcher can view survey responses for authorized runs.
- [ ] Researcher can view interview transcript turns.
- [ ] Researcher can play or access audio for authorized runs.
- [ ] Citation navigation lands near the relevant source.
- [ ] Raw evidence access is audit logged.

**Out of Scope**
Participant transcript access and bulk transcript/audio export.

**Implementation Notes**
Use signed audio URLs and audit sensitive reads.

**Testing Notes**
Test authorization, citation navigation, signed URL generation, and audit log creation.

### [Scoring] Add manual rescoring

**Type:** feature  
**Priority:** P1  
**Labels:** frontend, service, ai, data, beta  
**Depends on:** [Scoring] Implement automatic scoring job; [Researcher Setup] Configure versioned scoring objectives and rubrics

**Problem**
Researchers need to re-run scoring later when objectives or rubrics change, while preserving scoring history.

**Scope**
Add researcher-triggered rescoring for selected runs using selected or latest objective versions, preserving prior scoring runs.

**Acceptance Criteria**
- [ ] Researcher can trigger manual rescoring for an authorized run.
- [ ] New scoring run is created with trigger `manual_rescore`.
- [ ] Prior scoring runs remain available in data.
- [ ] Objective version set metadata is stored.
- [ ] UI distinguishes current/latest scoring run from older runs.

**Out of Scope**
Bulk rescoring and scoring comparison analytics.

**Implementation Notes**
Product must decide whether rescoring uses latest active objective versions or selectable versions.

**Testing Notes**
Test rescoring after objective edits and preservation of old scores.

### [Researcher Review] Build run status dashboard

**Type:** feature  
**Priority:** P1  
**Labels:** frontend, service, data, mvp  
**Depends on:** [Participant Runs] Implement run state machine; [Scoring] Implement automatic scoring job

**Problem**
Researchers need to monitor each participant run without seeing raw technical diagnostics.

**Scope**
Build study dashboard listing participant slots, current/latest runs, statuses, timestamps, stale/partial flags, scoring state, and captured artifact summaries.

**Acceptance Criteria**
- [ ] Dashboard lists participant slots and associated runs.
- [ ] Status labels are researcher-safe.
- [ ] Stale, partial, technical interruption, completed, and scored states are visible.
- [ ] Captured audio/transcript duration or counts are summarized.
- [ ] Detailed vendor/system errors are not shown.

**Out of Scope**
Operational admin telemetry UI.

**Implementation Notes**
Use service-level status mapping so raw internal errors never leak to UI.

**Testing Notes**
Test status display for all major run states.

### [Exports] Generate CSV export for scores

**Type:** feature  
**Priority:** P0  
**Labels:** service, export, data, mvp  
**Depends on:** [Scoring] Build researcher score review view

**Problem**
CSV export is mandatory for V1 and must include per-objective participant scores and metadata.

**Scope**
Build CSV generation for authorized study scores with participant ID, run ID, run date, survey version, interview status, stale/partial flags, objective version, grade, confidence, rationale, evidence citation IDs, and scoring run metadata.

**Acceptance Criteria**
- [ ] Researcher can request CSV export for an authorized study.
- [ ] CSV includes all PRD-required columns.
- [ ] Export includes one row per participant run objective score.
- [ ] CSV escapes commas, quotes, newlines, and spreadsheet formulas safely.
- [ ] Unauthorized researchers cannot export another study.

**Out of Scope**
JSON export and bulk audio/transcript export.

**Implementation Notes**
Decide whether CSV is generated synchronously for small studies or via background job.

**Testing Notes**
Snapshot-test CSV output with special characters, missing interview evidence, and multiple objectives.

### [Exports] Add optional JSON export

**Type:** feature  
**Priority:** P3  
**Labels:** service, export, data, post-mvp  
**Depends on:** [Exports] Generate CSV export for scores

**Problem**
JSON export is useful for full-fidelity downstream analysis but secondary to CSV.

**Scope**
Add full-fidelity JSON export for runs, scores, flags, citations, and metadata.

**Acceptance Criteria**
- [ ] Researcher can export JSON for an authorized study.
- [ ] JSON includes run, objective, score, citation, and metadata relationships.
- [ ] Raw audio files are referenced but not embedded.
- [ ] Unauthorized access is denied.

**Out of Scope**
Bulk audio/transcript archive export.

**Implementation Notes**
Keep schema versioned for future compatibility.

**Testing Notes**
Test JSON structure and authorization.

### [Operations] Record operational telemetry

**Type:** feature  
**Priority:** P1  
**Labels:** service, ops, data, mvp  
**Depends on:** [Foundation] Define database schema and migration workflow

**Problem**
Engineering needs diagnostics for interview and AI failures, but telemetry must not be exposed to researchers.

**Scope**
Record operational events with run ID, participant slot ID, browser/device basics, timestamps, audio connection state, model/API error category, latency, retry count, and service request IDs.

**Acceptance Criteria**
- [ ] Service can record operational events for run-related failures and retries.
- [ ] Telemetry includes PRD-required fields where available.
- [ ] Researcher APIs do not expose raw telemetry.
- [ ] Admin/support paths can access telemetry with authorization.

**Out of Scope**
Full observability dashboards.

**Implementation Notes**
Use safe categories, not raw stack traces, in database fields intended for support views.

**Testing Notes**
Test telemetry creation and researcher access denial.

### [Operations] Add audit logging for sensitive actions

**Type:** feature  
**Priority:** P0  
**Labels:** service, security, data, mvp  
**Depends on:** [Foundation] Enforce study-scoped authorization helpers

**Problem**
The system stores sensitive study artifacts, and privileged access must be traceable.

**Scope**
Add audit logs for study changes, run creation, consent/survey/objective changes, raw evidence reads, exports, deletion, admin access, and rescoring.

**Acceptance Criteria**
- [ ] Audit log records actor, role, study, entity, action, metadata, and timestamp.
- [ ] Sensitive raw artifact reads create audit entries.
- [ ] Admin override access creates audit entries.
- [ ] Audit logging failures are observable.

**Out of Scope**
Researcher-visible audit UI unless separately prioritized.

**Implementation Notes**
Avoid logging raw sensitive content in audit metadata.

**Testing Notes**
Test audit records for representative create, read, export, delete, and admin actions.

### [Operations] Implement retention and researcher deletion

**Type:** feature  
**Priority:** P1  
**Labels:** service, data, security, ops, beta  
**Depends on:** [Operations] Add audit logging for sensitive actions; [Interview] Persist transcript turns and audio asset metadata

**Problem**
Default retention is 2 years, and researchers can delete studies earlier.

**Scope**
Implement study deletion workflow and retention job planning/execution across database records and object storage artifacts.

**Acceptance Criteria**
- [ ] Study deletion prevents researcher and participant access.
- [ ] Deletion covers study data and object storage artifacts according to policy.
- [ ] Retention job identifies artifacts older than 2 years.
- [ ] Deletion/retention actions are audit logged.
- [ ] Behavior for backups/logs is documented.

**Out of Scope**
Legal hold workflows and custom retention periods.

**Implementation Notes**
Confirm hard-delete versus soft-delete policy before implementation.

**Testing Notes**
Test access after deletion and retention candidate selection.

### [Operations] Build privileged admin support view

**Type:** feature  
**Priority:** P2  
**Labels:** frontend, service, security, ops, beta  
**Depends on:** [Operations] Record operational telemetry; [Operations] Add audit logging for sensitive actions

**Problem**
Authorized admin engineers need support access for operations and debugging, but access should be role-limited and audited.

**Scope**
Build admin view for searching runs/studies, viewing operational events, and accessing privileged data where needed.

**Acceptance Criteria**
- [ ] Only admin engineers can access admin support routes.
- [ ] Admin can view operational telemetry by run.
- [ ] Privileged raw artifact access is explicit and audit logged.
- [ ] UI avoids casual browsing patterns for raw audio/transcripts.

**Out of Scope**
Customer support ticketing or broad analytics dashboards.

**Implementation Notes**
Use admin role checks and clear audit action names.

**Testing Notes**
Test researcher denial, admin access, and audit logs.

### [Quality] Add end-to-end first build slice test

**Type:** test  
**Priority:** P0  
**Labels:** testing, frontend, service, ai, voice, mvp  
**Depends on:** [Exports] Generate CSV export for scores

**Problem**
The V1 slice crosses many components and can regress easily without an end-to-end safety net.

**Scope**
Create an E2E test covering researcher study setup, run creation, participant consent/survey, mocked gap map, mocked/simulated interview, automatic scoring, researcher review, and CSV export.

**Acceptance Criteria**
- [ ] Test creates a study with consent, survey, slots, and objectives.
- [ ] Test completes participant consent and survey.
- [ ] Test uses mocked AI/voice outputs to complete interview and scoring.
- [ ] Test verifies score display and CSV output.
- [ ] Test runs in CI or documented local test command.

**Out of Scope**
Testing real provider availability.

**Implementation Notes**
Use fake AI and voice adapters for deterministic tests.

**Testing Notes**
This issue is itself a test deliverable; verify it fails on known broken paths.

### [Docs] Document implementation decisions and operating assumptions

**Type:** docs  
**Priority:** P1  
**Labels:** docs, ops, mvp  
**Depends on:** [Foundation] Scaffold web app, service, and development conventions

**Problem**
Future engineers and agents need a shared record of stack choices, provider decisions, data handling assumptions, and local workflows.

**Scope**
Create or update README/architecture docs with stack decisions, local commands, provider setup, data retention assumptions, testing strategy, and known open questions.

**Acceptance Criteria**
- [ ] README explains local setup and core commands.
- [ ] Architecture docs reflect actual chosen stack.
- [ ] Provider assumptions and fake-provider modes are documented.
- [ ] Security and data-handling assumptions are documented.
- [ ] Open questions are updated as decisions are made.

**Out of Scope**
Marketing documentation.

**Implementation Notes**
Keep docs in sync when product scope or provider choices change.

**Testing Notes**
Verify commands in docs work from a fresh checkout.
