# V1 PRD And Data Model

Date: 2026-05-02

## 1. Product Summary

Build an online platform for education researchers running small formative studies with approximately 20-80 participants. A participant completes a long-form written survey, then completes a voice-to-voice AI interview that is informed by the survey response. Afterward, the system scores the combined survey and interview evidence against researcher-defined rating objectives.

The AI is taking the place of a typical research assistant for data collection and first-pass analysis: reading survey responses, identifying gaps, conducting a follow-up interview, preserving raw evidence, and producing structured per-participant scores with confidence and citations.

V1 is not a high-stakes testing system. It supports formative education research where the goal is to understand learner thinking, misconceptions, confidence, reasoning quality, or implementation experience.

## 2. V1 Goals

- Let researchers define a study with participant slots, consent settings, survey questions, interview defaults, and scoring objectives.
- Let participants complete a consent page, long-form survey, and voice-to-voice AI interview with minimal friction.
- Conduct an AI interview that uses the survey response and researcher-provided interviewer instructions to probe like a research assistant.
- Automatically score each participant run after the interview ends, becomes stale, or is technically interrupted.
- Preserve raw survey responses, audio, transcript, scoring outputs, and version metadata.
- Export per-objective participant scores to CSV.

## 3. Non-Goals

- High-stakes assessment, clinical or psychological diagnosis, legally consequential evaluation, grading, employment, or service-access decisions.
- Participant accounts or participant access to data after completion.
- Open-ended public survey participation without assigned participant slots.
- Closed-ended survey question types.
- Full qualitative coding suite or publication-ready analysis memos.
- Statistical significance claims.
- Researcher-selectable interviewer personas beyond the fixed v1 default.
- Full high school guardian consent workflow.

## 4. Actors

### Researcher

Creates and owns studies. Configures consent, survey questions, participant slots, freshness windows, interview length, and scoring objectives. Views raw and scored data for studies they own. Exports scoring data.

### Participant

Uses a participant link or access flow tied to an assigned slot. Provides consent, completes the survey, and participates in the AI interview. Does not create an account. Can access their survey/interview only while the run is active.

### Authorized Admin Engineer

Privileged operational role for v1. Can access all data for support, operations, debugging, and maintenance. This access should be role-limited and treated as privileged.

## 5. Core Concepts

### Study

A researcher-owned container for participant slots, survey versions, consent versions, scoring objectives, interview configuration, runs, artifacts, and exports.

### Participant Slot

A study-scoped participant identity. It may be researcher-supplied or platform-generated. It should not require name, email, or account creation.

### Run

A fresh survey/interview cycle for one participant slot. A participant slot can have many runs over time, such as pre/post administrations. A run contains exactly one completed survey attempt, zero or more interview sessions, and one or more scoring runs.

Only researchers can create or authorize new runs. Participants cannot self-reset or create new runs after completion.

### Versioned Configuration

Survey questions, consent text/settings, scoring objectives, grading scales, examples, evidence requirements, custom prompts, and interviewer persona/version must be snapshotted or versioned so existing runs are not mutated by later edits.

## 6. Researcher Study Setup

Required study configuration:

- Study title.
- Participant slots/IDs.
- Consent settings and consent content.
- Survey questions and version.
- Scoring objectives and rubrics.
- Freshness window, defaulting to 2 weeks.
- Interview length cap, defaulting to 45 minutes.
- Interviewer persona field locked to the v1 default style, with product copy indicating more personas may come later.

Optional study configuration:

- Researcher-supplied participant IDs via manual entry or CSV import.
- Platform-generated participant IDs for constrained studies where researcher IDs are not needed.
- Researcher-provided study context for the AI, if needed later.

## 7. Consent

A consent page appears before the survey starts. The researcher can customize the consent content and configure whether active checkmark consent or electronic signature is required.

Consent records must capture:

- Study ID.
- Participant slot ID.
- Run ID.
- Consent version ID.
- Consent method: checkmark or electronic signature.
- Timestamp.
- Rendered consent text/version accepted.

The platform provides consent capture and records, but v1 should not claim to determine whether consent is legally or institutionally sufficient.

## 8. Survey

V1 surveys consist only of long-form free-text questions. Expected answers are sentences to a single paragraph.

Survey structure:

- Optional visible group title.
- One or more required long-form questions under a group.
- Ungrouped questions are allowed and render directly with a free-text response box.

Survey edits create new survey versions. Existing runs retain the survey version snapshotted when the run was created. New runs use the latest active survey version.

During one run, the participant may complete the survey once. A future researcher-authorized run can present a new survey attempt to the same participant slot.

## 9. Interview

The interview is voice-to-voice AI, capped at 45 minutes by default. The participant can stop and resume while the run remains within the freshness window.

The AI should feel like a calm research interviewer, not a test or chatbot quiz. It should:

- Ask one question at a time.
- Use brief acknowledgments.
- Probe for examples.
- Clarify vague answers.
- Avoid sounding evaluative.
- Avoid revealing grades, scoring objectives, rubrics, or evaluation strategy to the participant.
- Ask follow-ups freely to understand the participant better.
- Gently steer toward high-value unresolved gaps when needed, without becoming pushy or rapid-fire.

The AI should preserve natural conversation and allow rambling when it produces useful understanding. When time is running out, it should gently transition toward unresolved high-priority topics where possible.

### Participant Interview UI

The interview UI should be sparse:

- AI question caption/transcript only.
- Record button that turns into a stop-record button.
- Visual indication that the participant voice is coming through.
- Pulsating voice wave for AI speech.
- Pulsating voice wave for participant speech.

Do not show:

- Participant speech captions.
- Rubric.
- Score.
- Hidden objective progress.
- Full transcript after completion.

After completion, show a thank-you screen and have the AI interviewer thank the participant.

## 11. Freshness And Staleness

Runs have a researcher-configurable freshness window, defaulting to 2 weeks.

The goal is to prevent participants from taking the survey, waiting too long, and then completing the interview cold. The ideal flow is same day, next day, or within a short researcher-approved window.

If a run exceeds its freshness window:

- Preserve all data captured so far.
- Mark the run stale.
- Prevent the participant from continuing that run.
- Require a researcher-authorized new run if the participant should participate again.
- Still allow scoring from available data, with stale/partial flags and lower confidence where appropriate.

## 12. Technical Failure Handling

Examples: microphone issue, AI voice unavailable, disconnect, transcription outage, model/API error.

Participant behavior:

- Show calm recovery state.
- Offer retry/resume where possible.
- Preserve everything captured so far.

Run behavior:

- If the interview cannot continue, mark it partial with a technical-interruption status.
- Score using available survey/interview data with lower confidence where appropriate.

Researcher visibility:

- Show participant-safe statuses such as `interview_partial`, `technical_interruption`, or `unable_to_complete_interview`.
- Show timestamps and amount of audio/transcript captured.
- Do not show detailed system errors, vendor names, stack traces, or device diagnostics.

Engineering telemetry:

- Run ID.
- Participant slot ID.
- Browser/device basics.
- Timestamps.
- Audio connection state.
- Model/API error categories.
- Latency.
- Retry counts.
- Service request IDs.

Telemetry is not exposed to researchers.

## 13. Scoring Objectives And Rubrics

Researchers define customizable rating objectives.

Each objective includes:

- Title.
- Description.
- Optional custom scoring prompt.
- Grade scale.
- Grade examples.
- Evidence requirements.

Grade scales may be letter-based, numeric, or researcher-defined, such as A-F or 1-4. Researchers can provide examples of high- and low-scoring work, such as A-grade and F-grade examples.

Objectives are updatable. Updates create new versions rather than overwriting scoring history.

## 14. Scoring

Scoring runs automatically after the interview ends, becomes stale, or cannot continue due to technical failure. Scoring is never shown to the participant.

Researchers can manually re-run scoring later when objectives or rubrics change. Each scoring run is versioned and retained.

The AI must always assign a grade for each objective, plus a confidence score. Low-confidence grades are visually flagged.

For each objective score, output:

- Grade.
- Confidence score.
- Short rationale.
- Cited survey evidence.
- Cited interview evidence.
- Flags, such as:
  - Low confidence.
  - Missing interview evidence.
  - Contradiction between survey and interview.
  - Stale run.
  - Partial run.
  - Technical interruption.

If survey and interview evidence contradict each other, the grading policy defaults to the interview evidence and explicitly calls out the contradiction. If no interview occurred, the contradiction should remain flagged and should reduce confidence.

Researchers must be able to drill into raw transcript/audio from citations.

## 15. Exports

CSV export is mandatory for v1.

CSV should include:

- Participant ID.
- Run ID.
- Run date.
- Survey version.
- Interview status.
- Stale flag.
- Partial flag.
- Objective version.
- Grade.
- Confidence.
- Rationale.
- Evidence citation IDs.
- Scoring run metadata.

JSON export is useful for full fidelity but secondary to CSV.

Audio/transcript downloads can be per participant in v1. Bulk audio/transcript export can be deferred if needed.

## 16. Permissions And Data Access

Researchers:

- Can access, delete, and modify only research they own.
- Cannot access other researchers' studies or participant data.

Participants:

- Can access their personal survey and interview only while the run is being conducted.
- Do not have post-completion portal access in v1.

Authorized admin engineers:

- Can access all data in v1 for support and operations.
- Access should be role-limited and treated as privileged.
- Product should avoid casual browsing workflows for raw audio/transcripts where possible.

## 17. Retention

Default retention is 2 years for all study artifacts.

Retained artifacts include:

- Survey responses.
- Interview audio.
- Interview transcripts.
- Consent records.
- Survey versions.
- Objective/rubric versions.
- Prompts.
- Grade examples.
- Scores.
- Evidence excerpts/citations.
- Model/scoring metadata.
- Audit logs.
- Operational telemetry.

Researchers can delete a study earlier.

## 18. Suggested Data Model

This is a logical model, not a final physical schema.

### users

- id
- email
- display_name
- role
- created_at

### studies

- id
- owner_user_id
- title
- default_freshness_days
- default_max_interview_minutes
- active_survey_version_id
- active_consent_version_id
- active_persona_version_id
- created_at
- updated_at
- deleted_at

### study_memberships

- id
- study_id
- user_id
- role
- created_at

### participant_slots

- id
- study_id
- participant_code
- code_source: researcher_supplied | platform_generated
- status
- created_at
- archived_at

### consent_versions

- id
- study_id
- version_number
- consent_text
- consent_method: checkmark | electronic_signature
- is_active
- created_at

### survey_versions

- id
- study_id
- version_number
- is_active
- created_at

### survey_groups

- id
- survey_version_id
- title
- sort_order

### survey_questions

- id
- survey_version_id
- survey_group_id
- prompt
- required
- sort_order

### objective_versions

- id
- study_id
- objective_key
- version_number
- title
- description
- custom_scoring_prompt
- evidence_requirements
- is_active
- created_at

### objective_grade_examples

- id
- objective_version_id
- grade_label
- example_text
- sort_order

### interviewer_persona_versions

- id
- name
- version_number
- style_prompt
- is_default
- created_at

### runs

- id
- study_id
- participant_slot_id
- survey_version_id
- consent_version_id
- persona_version_id
- freshness_deadline_at
- max_interview_minutes
- status: created | consented | survey_in_progress | survey_completed | interview_in_progress | interview_paused | interview_completed | stale | partial | technical_interruption | scored
- created_at
- survey_completed_at
- interview_started_at
- interview_completed_at
- stale_at
- current_run_for_slot

### consent_records

- id
- run_id
- consent_version_id
- accepted_at
- consent_method
- signature_text
- rendered_consent_snapshot

### survey_responses

- id
- run_id
- survey_question_id
- response_text
- submitted_at

### interview_sessions

- id
- run_id
- session_number
- status: active | paused | completed | interrupted
- started_at
- ended_at
- audio_duration_seconds
- transcript_token_count

### interview_turns

- id
- interview_session_id
- speaker: ai | participant
- text
- audio_start_ms
- audio_end_ms
- created_at

### interview_audio_assets

- id
- run_id
- interview_session_id
- storage_uri
- duration_seconds
- created_at

### scoring_runs

- id
- run_id
- status
- trigger: automatic | manual_rescore
- model_name
- model_version
- objective_version_set_hash
- scored_at

### objective_scores

- id
- scoring_run_id
- objective_version_id
- grade_label
- confidence
- rationale
- flags_json

### evidence_citations

- id
- objective_score_id
- source_type: survey_response | interview_turn | audio_span
- source_id
- quote
- audio_start_ms
- audio_end_ms

### operational_events

- id
- run_id
- participant_slot_id
- event_type
- browser_device_json
- audio_connection_state
- model_api_error_category
- latency_ms
- retry_count
- service_request_id
- created_at

### audit_logs

- id
- actor_user_id
- actor_role
- study_id
- entity_type
- entity_id
- action
- metadata_json
- created_at

## 19. Run State Machine

Primary happy path:

```text
created
  -> consented
  -> survey_in_progress
  -> survey_completed
  -> interview_in_progress
  -> interview_completed
  -> scored
```

Pause/resume path:

```text
interview_in_progress
  -> interview_paused
  -> interview_in_progress
```

Stale path:

```text
survey_completed | interview_paused | interview_in_progress
  -> stale
  -> scored
```

Technical failure path:

```text
interview_in_progress
  -> technical_interruption
  -> scored
```

Partial completion path:

```text
survey_completed | interview_paused | technical_interruption
  -> partial
  -> scored
```

The exact state names can be refined during implementation, but the model must distinguish stale, partial, completed, and technical interruption because they affect scoring confidence and researcher interpretation.

## 20. AI Behavior

### Interview Pass

Input:

- Survey responses.
- Interviewer instructions.
- Fixed v1 interviewer persona.
- Remaining time and run state.

Behavior:

- Simulate a calm, warm, neutral, curious research assistant.
- Prioritize useful clarification and concrete examples.
- Ask natural follow-ups.
- Allow participant rambling when useful.
- Gently steer toward high-value study topics.
- Do not reveal scoring objectives, grade labels, or evaluation strategy.

### Scoring Pass

Input:

- Survey responses.
- Transcript.
- Audio-linked transcript metadata.
- Objective versions, grade scale, examples, custom prompts, evidence requirements.
- Run state and flags.

Output:

- One grade per objective.
- Confidence per objective.
- Rationale.
- Survey citations.
- Interview citations.
- Flags.

Policy:

- Always score.
- Flag low confidence.
- Interview evidence overrides survey evidence on contradiction.
- If interview is missing or partial, lower confidence and flag missing evidence where relevant.

## 21. V1 UX Surface

### Researcher

- Create/edit study.
- Configure consent.
- Create survey questions with optional visible groups.
- Create participant slots.
- Create new runs in bulk.
- Configure scoring objectives/rubrics.
- View participant run statuses.
- View per-objective scores and evidence.
- View raw survey responses, transcript, and audio.
- Export CSV.

### Participant

- Open assigned run link.
- Consent.
- Complete long-form survey.
- Continue automatically into interview.
- Pause/resume while valid.
- See sparse voice UI.
- See thank-you completion screen.

### Admin Engineer

- View operational telemetry.
- Access privileged data for support/operations.
- Investigate technical failures without exposing raw diagnostic details to researchers.

## 22. Implementation Notes

- Snapshot all configuration used by a run or store immutable version references.
- Treat scoring runs and citations as auditable artifacts, not ephemeral model outputs.
- Keep participant identity study-scoped and minimal.
- Build tenant isolation early: every researcher query should be scoped by study ownership or membership.
- Use storage policies that can enforce 2-year retention and researcher-initiated deletion.
- Store enough model metadata to compare future scoring runs and persona changes.
- Keep scoring outputs separate from raw artifacts so rescoring does not mutate original evidence.

## 23. First Build Slice

A practical first implementation slice:

1. Researcher creates a study.
2. Researcher defines consent, survey questions, participant slots, and one or more scoring objectives.
3. Researcher creates runs for participant slots.
4. Participant consents and completes survey.
5. Participant completes simulated or real voice interview.
6. System stores transcript/audio references.
7. System runs automatic scoring.
8. Researcher views per-objective participant score with confidence, rationale, evidence, and flags.
9. Researcher exports CSV.
