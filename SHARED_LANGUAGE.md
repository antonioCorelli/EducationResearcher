# Shared Language

Source docs reviewed:

- `docs/agent-workflow.md`
- `docs/architecture-plan.md`
- `docs/github-issues.md`
- `docs/milestones.md`
- `docs/open-questions.md`
- `docs/prd-analysis.md`
- `docs/v1-prd-and-data-model.md`

Ignored: `docs/prompts/`.

This is the initial shared vocabulary for the product and codebase. Prefer these concept names in issues, docs, data models, UI copy, tests, and service boundaries unless a later decision intentionally renames them.

## Product Scope

| Concept | Initial meaning |
| --- | --- |
| V1 | The first product version for small formative education research studies. |
| MVP | The first build slice from study setup through participant completion, scoring, review, and CSV export. |
| Beta/Polish | The hardening phase for rescoring, retention/deletion, and admin support workflows. |
| Post-MVP | Deferred secondary capabilities such as optional JSON export. |
| Formative Education Research | The intended use case: understanding learner thinking, misconceptions, confidence, reasoning quality, or implementation experience. |
| High-Stakes Assessment | Explicitly out of scope: grading, diagnosis, employment, access decisions, or legally consequential evaluation. |
| First Build Slice | The demonstrable end-to-end workflow from study creation through CSV export. |

## Actors

| Concept | Initial meaning |
| --- | --- |
| Researcher | Authenticated user who owns or belongs to studies, configures study materials, authorizes runs, reviews evidence, and exports scores. |
| Participant | Non-account user who accesses a specific authorized run, consents, completes the survey, and participates in the interview. |
| Authorized Admin Engineer | Privileged operational role with role-limited, audited access for support, debugging, and maintenance. |
| Study Member | A researcher connected to a study through `study_memberships`; whether collaborators are in V1 remains open. |

## Study Setup

| Concept | Initial meaning |
| --- | --- |
| Study | Researcher-owned container for participant slots, versioned configuration, runs, artifacts, scoring, and exports. |
| Study Shell | The basic study record and defaults before consent, survey, objectives, slots, and runs are configured. |
| Study Context | Optional researcher-provided context for AI behavior; not yet finalized for V1. |
| Freshness Window | Researcher-configurable period, defaulting to 14 days, during which a participant can continue a run. |
| Interview Length Cap | Maximum interview duration for a run, defaulting to 45 minutes. |
| Participant Slot | Study-scoped participant identity, using a researcher-supplied or platform-generated participant code. |
| Participant Code | The visible code associated with a participant slot. |
| Code Source | Whether a participant code is `researcher_supplied` or `platform_generated`. |
| Participant Access Link | Unguessable, run-scoped link or token that lets a participant access a run without an account. |
| Access Code | Possible participant access mechanism; final V1 distribution workflow remains open. |

## Versioned Configuration

| Concept | Initial meaning |
| --- | --- |
| Versioned Configuration | Immutable or snapshotted configuration referenced by runs so later edits do not mutate historical data. |
| Consent Version | Versioned consent text and method for a study. |
| Consent Method | Either checkmark consent or electronic signature in V1. |
| Rendered Consent Snapshot | Exact consent text/version accepted by a participant and stored with the consent record. |
| Survey Version | Versioned set of long-form survey questions and groups. |
| Survey Group | Optional visible grouping label for survey questions. |
| Survey Question | Required long-form free-text question. Closed-ended question types are out of scope. |
| Scoring Objective | Researcher-defined rating objective used by the scoring pass. |
| Objective Version | Versioned scoring objective that preserves scoring history when objectives change. |
| Objective Key | Stable identifier connecting versions of the same scoring objective over time. |
| Rubric | Researcher-defined scoring guidance, including grade scale, examples, evidence requirements, and optional prompt text. |
| Grade Scale | Researcher-defined labels such as A-F, 1-4, or another scale; exact validation remains open. |
| Grade Example | Example work for a grade label, such as high- and low-scoring examples. |
| Evidence Requirement | Researcher-defined requirement for what evidence supports an objective score. |
| Custom Scoring Prompt | Optional objective-specific prompt content used during scoring. |
| Interviewer Persona | Fixed V1 interviewer style; researcher-selectable personas are out of scope. |
| Persona Version | Versioned interviewer persona prompt/style metadata referenced by runs. |

## Run Lifecycle

| Concept | Initial meaning |
| --- | --- |
| Run | One fresh survey/interview cycle for a participant slot, authorized by a researcher. |
| Current Run for Slot | The currently active or latest run associated with a participant slot. |
| Survey Attempt | A participant's one completed survey submission within a run. |
| Run State Machine | Explicit validated transitions that drive access, freshness, scoring, and researcher status. |
| Created | Initial run state before consent. |
| Consented | Run state after consent is captured. |
| Survey In Progress | Run state while the participant is completing survey questions. |
| Survey Completed | Run state after survey submission and before interview start. |
| Interview In Progress | Run state while an interview session is active. |
| Interview Paused | Run state when the participant may resume later within the freshness window. |
| Interview Completed | Run state after the interview finishes. |
| Stale | Run state when the freshness deadline has passed and continuation is blocked. |
| Partial | Run state when available evidence is incomplete but still scoreable. |
| Technical Interruption | Run state for non-recoverable microphone, voice, transcription, model, API, or disconnect failures. |
| Scored | Run state after scoring output has been produced. |
| Stale Sweep | Background process that marks eligible runs stale and triggers scoring from available evidence. |
| Participant-Safe Status | Researcher or participant-facing status that avoids vendor names, stack traces, diagnostics, and hidden scoring details. |

## Participant Flow

| Concept | Initial meaning |
| --- | --- |
| Consent Page | First participant screen in a run, rendering the run's consent version. |
| Long-Form Survey | Free-text survey with required sentence-to-paragraph responses. |
| Sparse Voice UI | Participant interview UI with AI caption, record/stop control, voice indications, and waves only. |
| AI Question Caption | Participant-visible caption/transcript for the AI question only. |
| Record Button | Participant control that can become a stop-record control. |
| Voice Wave | Visual indication for AI or participant speech activity. |
| Thank-You Screen | Participant completion screen shown after the run can no longer continue successfully. |
| Blocked State Screen | Participant-safe screen for stale, completed, invalid, unauthorized, or unable-to-continue runs. |

## AI Orchestration

| Concept | Initial meaning |
| --- | --- |
| AI Orchestration Layer | Service boundary for interview, scoring, prompt/version tracking, validation, retries, and error categorization. |
| Recommended Probe | Suggested interview question or follow-up targeting a gap. |
| Interviewer Instructions | Researcher-provided study context passed to the interviewer agent to guide follow-up questions independently from scoring objectives. |
| Interview Pass | AI behavior during the voice interview using survey responses, interviewer instructions, persona, time remaining, and run state. |
| Scoring Pass | AI pass that scores available survey/interview evidence against objective versions. |
| Structured Output Validation | Validation of AI scoring responses before persistence. |
| Model Metadata | Stored model name, version, prompt/version metadata, timestamps, and related scoring details. |
| Provider Error Category | Safe operational category for AI/model/voice failures, without leaking raw provider diagnostics. |

## Interview

| Concept | Initial meaning |
| --- | --- |
| Voice-to-Voice AI Interview | Participant interview conducted through realtime audio interaction. |
| Realtime Voice Adapter | Boundary for browser audio, transcription, voice response, turn handling, connection state, and resume behavior. |
| Interview Session | One active, paused, completed, or interrupted interview segment within a run. |
| Interview Turn | One AI or participant transcript turn with speaker label and optional timing metadata. |
| Interview Audio Asset | Stored audio file reference and metadata for a run/session. |
| Transcript | Persisted interview turns used as raw evidence and scoring input. |
| Audio Span | Timestamped portion of audio that can be cited as evidence. |
| Connection State | Voice/audio connection status used for telemetry and recovery. |
| Retry/Resume | Recovery behavior for recoverable interview failures. |
| Technical Failure | Microphone issue, AI voice unavailable, disconnect, transcription outage, model/API error, or similar interruption. |

## Scoring And Evidence

| Concept | Initial meaning |
| --- | --- |
| Scoring Run | A versioned scoring attempt for a run, triggered automatically or by manual rescoring. |
| Automatic Scoring | Scoring triggered after interview completion, staleness, or technical interruption. |
| Manual Rescoring | Researcher-triggered scoring after objective/rubric changes; selection rules remain open. |
| Objective Score | Per-objective score output for a scoring run. |
| Grade | Required label assigned for each objective. |
| Confidence | Required confidence score for each objective score. |
| Low-Confidence Flag | Visual/researcher-facing flag when confidence is below a threshold. |
| Rationale | Short explanation for an objective score. |
| Score Flag | Structured scoring flag such as stale, partial, missing interview evidence, contradiction, or technical interruption. |
| Evidence Citation | Stable reference from a score to survey response, interview turn, or audio span. |
| Citation Resolution | Authorized lookup from a citation back to raw evidence. |
| Raw Evidence | Survey responses, transcript turns, and audio assets/spans. |
| Evidence Drilldown | Researcher view that opens the source evidence behind a citation. |
| Objective Version Set | The set of objective versions used for a scoring run. |
| Objective Version Set Hash | Metadata identifying the exact objective version set used in scoring. |

## Exports

| Concept | Initial meaning |
| --- | --- |
| CSV Export | Required V1 export containing per-objective participant scores and metadata. |
| JSON Export | Optional post-MVP full-fidelity export. |
| Export File | Generated export artifact, likely stored in S3 when asynchronous. |
| Spreadsheet Formula Injection | CSV security risk that must be mitigated by escaping dangerous cell values. |

## Security, Privacy, And Operations

| Concept | Initial meaning |
| --- | --- |
| Tenant Isolation | Guarantee that researchers can access only studies and participant data they own or belong to. |
| Study-Scoped Authorization | Service-level scoping by study ownership or membership. |
| Admin Override | Explicit privileged access path for authorized admin engineers, with audit logging. |
| Participant Token Scope | Access control that limits a participant link/token to one intended run. |
| Sensitive Study Artifact | Survey response, transcript, audio, score, citation, export, consent record, or similar participant data. |
| Audit Log | Record of actor, role, study, entity, action, metadata, and timestamp for sensitive reads and writes. |
| Operational Event | Telemetry record for run-related failures, retries, audio state, provider categories, latency, and service request IDs. |
| Operational Telemetry | Engineering diagnostics stored separately from researcher-facing data. |
| Service Request ID | Request identifier propagated across frontend, service, workers, and providers. |
| Retention | Default 2-year retention policy for study artifacts. |
| Researcher-Initiated Deletion | Researcher workflow to delete a study before default retention expiry. |
| Raw Artifact Access | Access to raw survey, transcript, or audio evidence, requiring authorization and audit logging. |
| Signed URL | Short-lived controlled access URL for audio or export artifacts. |

## Architecture And Delivery

| Concept | Initial meaning |
| --- | --- |
| Researcher Web App | React/Vite authenticated surface for study setup, runs, review, evidence, and exports. |
| Participant Web App | React/Vite token-scoped surface for consent, survey, interview, recovery, and completion. |
| Service API | Node.js/TypeScript/Fastify API that owns durable product behavior and authorization. |
| Run Orchestration Service | Service logic for run transitions, freshness enforcement, interruption handling, and scoring triggers. |
| Background Worker | Worker or scheduled-job capability for scoring, stale sweeps, exports, retention, and cleanup. |
| DynamoDB | Planned primary data store for application records, artifacts, run state, telemetry, and audit logs. |
| S3 | Planned object storage for interview audio assets and generated exports. |
| AWS Amplify | Planned frontend hosting/deploy target. |
| Amazon Cognito | Planned researcher/admin auth provider. |
| AWS App Runner | Planned service API hosting/deploy target. |
| AI Model Provider | Open provider decision for scoring passes. |
| Realtime Voice Provider | Open provider decision for voice-to-voice interview. |
| Observability Provider | Open provider decision for logs, metrics, traces, and alerts. |
| Fake Provider Mode | Deterministic local/test mode for auth/session, AI scoring, voice interview, and storage-like behavior. |
| Fake Auth/Session Provider | Local/test provider that simulates Cognito identities and roles. |
| Fake AI Scoring Provider | Local/test provider returning deterministic structured scoring outputs and safe failure categories. |
| Fake Voice Interview Provider | Local/test provider simulating transcript turns, audio metadata, interruptions, and completion. |
| Fake Storage Provider | Local/test provider avoiding production AWS writes while preserving service contracts. |
| Adapter Boundary | Small interface around an external provider so local tests and future provider changes remain isolated. |
| Contract Test | Test that validates provider/event/schema contracts, especially AI structured outputs and voice adapter events. |
| End-to-End First Build Slice Test | Test covering study setup, participant flow, mocked AI/voice, scoring, review, and CSV export. |

## Data Domains

| Concept | Initial meaning |
| --- | --- |
| Data Domain Table | DynamoDB table that owns one related slice of the product model rather than one table per individual entity. |
| Identity Access Table | Data domain table for researcher and authorized admin engineer user records. |
| Study Setup Table | Data domain table for study shells and participant slots. |
| Versioned Configuration Table | Data domain table for immutable consent, survey, objective, grade example, and persona versions. |
| Run Lifecycle Table | Data domain table for runs and raw run artifacts such as consent records, survey responses, interview sessions, turns, and audio metadata. |
| Evidence Scoring Table | Data domain table for scoring runs, objective scores, and evidence citations. |
| Operations Table | Data domain table for operational events and audit logs. |
| Schema Contract | Versioned TypeScript metadata defining data domain tables, primary keys, indexes, entity fields, relationship references, and local fixtures. |
| Relationship Reference | Documented foreign-key-like attribute in a DynamoDB item; the database does not enforce it, so service writes and tests must preserve it. |
| Local DynamoDB Workflow | DynamoDB Local create, reset, and seed flow used for local development and deterministic tests. |
| First Build Slice Fixture | Seed data covering the MVP path from researcher setup through participant evidence, scoring, citations, telemetry, and audit logging. |

## Open Decision Names

Use these names when discussing unresolved choices:

- First pilot user segment
- Study collaborator support
- Participant access distribution
- Participant slot CSV import format
- Participant code uniqueness scope
- Default consent template
- Consent sufficiency copy
- Grade scale validation
- Objective visibility during interview
- Manual rescoring objective selection
- Researcher audio playback requirement
- Freshness deadline extension
- DynamoDB physical data model
- Infrastructure-as-code approach
- Signed S3 access policy
- AI model provider
- Realtime voice provider
- Background job implementation
- AI structured output schema validation library
- Service request ID propagation
- Backup and restore strategy
- Researcher study setup flow
- Participant draft survey saving
- Participant recovery states
- Interview pause control
- AI thank-you presentation
- Citation-to-audio drilldown
- Low-confidence threshold
- Scoring history visibility
- Study artifact data classification
- Admin engineer data access roles
- Admin access elevation or reason capture
- Required audit events
- Participant token validity and revocation
- Researcher deletion effect on logs and telemetry
- CSV export protection after download
- Pilot AI/voice provider data handling
- Environments
- CI checks
- Observability platform
- Alert ownership
- Provider outage communication
- Operational support tooling
- Retention interaction with backups, logs, and exports
- Support runbooks
