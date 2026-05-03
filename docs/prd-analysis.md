# PRD Analysis

Source PRD: `docs/v1-prd-and-data-model.md`  
Date analyzed: 2026-05-03

## Product Goal

Build a V1 online platform for education researchers running small formative studies with about 20-80 participants. The platform lets a researcher configure a study, collect participant consent and long-form survey responses, conduct an AI voice interview informed by those responses, and produce auditable per-participant scores against researcher-defined objectives.

The product substitutes for a research assistant in three bounded jobs:

- Identify what the written survey already answers and where it has gaps.
- Conduct a calm follow-up interview to gather richer evidence.
- Produce first-pass scoring with confidence, rationale, flags, and citations.

V1 is for formative research and should not be positioned as high-stakes assessment, diagnosis, grading, or legally consequential evaluation.

## Target Users

- **Researchers:** create studies, configure study materials, create participant slots and runs, monitor statuses, review evidence and scores, and export results.
- **Participants:** use a slot/run link, consent, complete a long-form survey, complete or resume a voice interview, and see a thank-you screen. They do not create accounts.
- **Authorized admin engineers:** access operational data and privileged support views for debugging, maintenance, and support.

## Core User Journeys

1. **Researcher creates a study**
   - Enters a title.
   - Configures freshness window and interview length cap.
   - Configures consent content and method.
   - Creates free-text survey questions, optionally grouped.
   - Defines scoring objectives, grade scales, examples, and evidence requirements.
   - Adds participant slots manually, through CSV, or through platform generation.

2. **Researcher authorizes participant runs**
   - Creates one or more runs for participant slots.
   - Each run snapshots active consent, survey, objective, and persona configuration.
   - Participant receives or opens a run-specific access flow.

3. **Participant completes consent and survey**
   - Opens the assigned run link.
   - Accepts consent through checkmark or electronic signature.
   - Completes required long-form survey questions once for that run.
   - The system persists responses and generates a gap map.

4. **Participant completes AI interview**
   - Interview starts after survey completion without researcher approval.
   - The AI uses the survey, gap map, objectives, persona, remaining time, and run state.
   - Participant can pause and resume while the run remains fresh.
   - The UI stays sparse and participant-safe.

5. **System scores the run**
   - Scoring runs automatically when the interview completes, becomes stale, or is technically interrupted.
   - Scoring produces one grade per objective with confidence, rationale, citations, flags, and model/version metadata.
   - Researchers can manually re-run scoring later when objectives change.

6. **Researcher reviews and exports results**
   - Views run status, raw evidence, scores, confidence, flags, rationale, and citations.
   - Drills into source survey responses, transcript turns, and audio spans from citations.
   - Exports per-objective scores to CSV.

## Main Capabilities

- Study setup and researcher ownership.
- Participant slot and run management.
- Immutable or versioned consent, survey, objective, rubric, prompt, and persona configuration.
- Consent capture with rendered consent snapshot.
- Required long-form survey collection.
- Gap map generation and persistence.
- Voice-to-voice AI interview with pause/resume.
- Interview artifact persistence: audio references, transcript turns, timing metadata, and session status.
- Run freshness and staleness enforcement.
- Technical failure recovery and partial-run scoring.
- Objective-based AI scoring with citations and flags.
- Researcher review surfaces.
- CSV export.
- Tenant isolation, retention, deletion, audit logs, and privileged admin access.
- Operational telemetry not exposed to researchers.

## Explicit Requirements

- Researchers can define study title, participant slots, consent settings/content, survey questions, scoring objectives/rubrics, freshness window, and interview length cap.
- Freshness window defaults to 2 weeks.
- Interview length cap defaults to 45 minutes.
- Interviewer persona is locked to the V1 default style.
- Participants do not have accounts and cannot self-create or reset runs.
- Participant slots can have many researcher-authorized runs over time.
- A run has exactly one completed survey attempt, one generated gap map, zero or more interview sessions, and one or more scoring runs.
- Survey questions are long-form free text only.
- Survey edits create new versions; existing runs retain their original survey version.
- Consent records capture study, slot, run, consent version, method, timestamp, and rendered accepted text.
- Gap maps are generated after survey completion, before interview, and persisted.
- Interviews must not reveal rubrics, scoring objectives, grade labels, scores, or gap map internals.
- Participant interview UI shows AI captions, record/stop control, and voice activity/waves only.
- Participant interview UI does not show participant speech captions, full transcript, rubric, score, gap map, or hidden progress.
- Stale runs preserve data, block continuation, require researcher-authorized new runs, and still score available data with stale/partial flags.
- Technical failures preserve captured data, offer retry/resume when possible, mark partial/interrupted states when needed, and still score available evidence.
- Researcher-facing failure statuses are participant-safe and do not include vendor names, stack traces, or device diagnostics.
- Engineering telemetry captures run, slot, browser/device basics, timestamps, audio state, model/API categories, latency, retry counts, and service request IDs.
- Scoring always assigns a grade for each objective plus confidence, rationale, citations, flags, and metadata.
- Contradictory survey/interview evidence defaults to interview evidence and calls out the contradiction.
- CSV export is mandatory for V1.
- Default retention is 2 years for all study artifacts.
- Researchers can delete a study earlier.
- Researchers only access studies and participant data they own or are members of.
- Authorized admin engineers can access all data for support and operations.

## Implied Requirements

- Authentication is required for researchers and admin engineers even though participant accounts are out of scope.
- Participant run links need unguessable, scoped access tokens or equivalent.
- Core service logic needs explicit state transitions for runs and interview sessions.
- Background jobs or durable workflows are needed for gap map generation, staleness checks, scoring, exports, retention, and deletion.
- AI calls need prompt/version tracking, schema validation, retry policy, and failure categorization.
- Audio storage needs access controls, signed URLs, retention policy, and citation-friendly timing metadata.
- CSV export needs deterministic column definitions and escaping for rationale/citation fields.
- Manual rescoring needs to preserve prior scoring runs and identify objective version sets.
- Admin support access needs audit logging and should avoid broad casual browsing of raw artifacts.
- The product needs clear copy that consent capture does not determine legal or institutional sufficiency.
- A simulated interview mode or provider abstraction may be useful for early development before real voice integration is stable.

## Open Questions

- Which web/app framework, database, object storage provider, authentication provider, and AI voice/model provider should V1 use?
- Should researcher accounts support study collaborators through `study_memberships` in V1, or is single-owner enough for MVP?
- What is the exact participant access mechanism: emailed links, researcher-distributed codes, or both?
- Are participant codes unique only within a study or globally non-colliding for operational convenience?
- What CSV import format is expected for participant slots?
- What grade scale shapes are allowed in V1, and how should validation work for custom labels?
- Should researchers configure objective visibility during interview, or are all active objectives always included in AI context?
- How should manual rescoring choose objective versions: latest active, selected historical versions, or both?
- What level of audio playback and transcript search is required for MVP?
- What exact retention/deletion guarantees are required for object storage, backups, logs, and exports?
- What consent language should be shipped as a default template, if any?
- What operational admin interface is required for V1 versus direct database/support tooling?

## Risks And Ambiguities

- **Voice integration reliability:** real-time audio, transcription, turn-taking, and model availability may be the highest implementation risk.
- **Evidence integrity:** citations must remain stable across rescoring and link cleanly back to raw survey, transcript, and audio artifacts.
- **Tenant isolation:** researcher data separation must be designed early because the product handles sensitive research artifacts.
- **AI output quality:** gap maps and scores need strong schemas, validation, and confidence/flag behavior to be useful.
- **Participant safety and trust:** the product must avoid evaluative language, hidden scoring exposure, and misleading consent claims.
- **Run state complexity:** stale, partial, paused, interrupted, completed, and scored states affect UX, scoring, exports, and researcher interpretation.
- **Retention and deletion:** 2-year retention plus researcher deletion touches database rows, object storage, exports, logs, telemetry, and backups.
- **Scope pressure:** full voice UI, artifact playback, citations, CSV export, and admin support are substantial for a V1.

## Non-Goals

- High-stakes assessment, clinical or psychological diagnosis, legally consequential evaluation, grading, employment decisions, or service-access decisions.
- Participant accounts or post-completion participant portal.
- Open public survey participation without assigned slots.
- Closed-ended survey question types.
- Full qualitative coding suite.
- Publication-ready analysis memos.
- Statistical significance claims.
- Researcher-selectable interviewer personas beyond the fixed V1 default.
- Full high school guardian consent workflow.
- Bulk audio/transcript export unless later prioritized.
- Legal or institutional sufficiency determination for consent.
