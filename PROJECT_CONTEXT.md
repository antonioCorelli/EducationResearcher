# Project Context

This project is an online platform for education researchers running small formative studies with roughly 20-80 participants. The core workflow is:

1. A researcher creates a study with participant slots, consent content, free-text survey questions, interview settings, and scoring objectives.
2. A participant consents, completes one long-form written survey attempt, and moves directly into a voice-to-voice AI interview.
3. The system uses the survey response, scoring objectives, and a generated gap map to guide the interview.
4. After the interview ends, becomes stale, or is interrupted, the system scores the combined evidence against researcher-defined objectives.
5. Researchers review raw artifacts, per-objective scores, confidence, rationale, citations, flags, and CSV exports.

The AI is meant to act like a research assistant for data collection and first-pass analysis. It should preserve raw evidence, probe survey gaps, capture transcript/audio, and produce structured scoring outputs. V1 is for formative education research, not high-stakes assessment or consequential decisions.

## Product Boundaries

V1 supports:

- Researcher-owned studies.
- Study-scoped participant slots with researcher-supplied or platform-generated participant codes.
- Consent capture before the survey.
- Long-form free-text surveys only.
- Generated and persisted pre-interview gap maps.
- Voice-to-voice AI interviews informed by survey responses, gap maps, and objectives.
- Automatic scoring after completion, staleness, or technical interruption.
- Manual rescoring when objectives or rubrics change.
- Raw evidence retention, scoring metadata, evidence citations, and CSV export.

V1 does not support:

- High-stakes testing, clinical/psychological diagnosis, grading, employment, legal, or service-access decisions.
- Participant accounts or post-completion participant portals.
- Open public survey participation without assigned slots.
- Closed-ended survey question types.
- A full qualitative coding suite, publication-ready analysis memos, or statistical significance claims.
- Researcher-selectable interviewer personas beyond the fixed V1 default.
- Full high school guardian consent workflows.

## Actors And Access

- **Researcher**: owns studies, configures study artifacts, creates participant slots/runs, views raw and scored study data, and exports results. Researcher access must be scoped to owned studies or study memberships.
- **Participant**: uses an assigned run link or access flow, consents, completes the survey, and participates in the interview. Participants do not create accounts and can only access their survey/interview while the run is active.
- **Authorized admin engineer**: privileged operational role with V1 access to all data for support and maintenance. Treat this access as role-limited and sensitive.

## Core Domain Concepts

- **Study**: researcher-owned container for participant slots, consent versions, survey versions, objectives, interview configuration, runs, artifacts, and exports.
- **Participant slot**: study-scoped participant identity. It should not require a name, email, or account.
- **Run**: one fresh survey/interview cycle for a participant slot. A slot may have many runs over time, such as pre/post administrations. A run contains exactly one completed survey attempt, one generated gap map, zero or more interview sessions, and one or more scoring runs.
- **Versioned configuration**: survey questions, consent content/settings, scoring objectives, grading scales, examples, prompts, evidence requirements, and interviewer persona/version must be snapshotted or referenced immutably so existing runs are not changed by later edits.

Only researchers can create or authorize new runs. Participants cannot self-reset or create new runs after completion.

## Study Setup Requirements

Required configuration:

- Study title.
- Participant slots/IDs.
- Consent content and consent method.
- Survey questions and survey version.
- Scoring objectives and rubrics.
- Freshness window, defaulting to 2 weeks.
- Interview length cap, defaulting to 45 minutes.
- Interviewer persona locked to the V1 default style.

Optional configuration:

- Researcher-supplied participant IDs by manual entry or CSV import.
- Platform-generated participant IDs.
- Researcher-provided study context for AI behavior if added later.

## Consent

Consent appears before the survey. Researchers can customize consent content and choose active checkmark consent or electronic signature.

Consent records must capture study, participant slot, run, consent version, method, timestamp, and the rendered consent text/version accepted. The platform captures records but should not claim to determine legal or institutional sufficiency.

## Survey

V1 surveys are required long-form free-text questions, usually answered in sentences to a paragraph. Optional visible groups are allowed; ungrouped questions render directly.

Survey edits create new survey versions. Existing runs retain the survey version active when the run was created. During one run, a participant may complete the survey once.

## Gap Map

After survey completion and before the interview, the system generates and persists a gap map. The participant should continue automatically into the interview without researcher approval.

Gap maps should identify:

- What the survey already answers.
- Ambiguous areas.
- Contradictions.
- Missing evidence relative to scoring objectives.
- Recommended interview probes.

Contradictions should become priority interview targets.

## Interview

The interview is voice-to-voice AI, capped at 45 minutes by default. Participants may stop and resume while the run remains inside the freshness window.

The interviewer should feel like a calm research interviewer, not a test or quiz. It should ask one question at a time, acknowledge briefly, probe for examples, clarify vague answers, preserve natural conversation, and steer gently toward high-value unresolved gaps.

The interviewer must not reveal grades, scoring objectives, rubrics, hidden progress, or gap map details to participants.

The participant interview UI should be sparse:

- AI question caption/transcript only.
- Record/stop-record control.
- Participant voice input indication.
- AI and participant voice waves.
- Thank-you screen after completion.

Do not show participant speech captions, rubric, score, gap map, hidden objective progress, or the full transcript to participants.

## Freshness, Staleness, And Failure

Runs have a freshness window, defaulting to 2 weeks, to keep survey and interview evidence close in time.

When a run becomes stale:

- Preserve captured data.
- Mark the run stale.
- Prevent participant continuation.
- Require a researcher-authorized new run to participate again.
- Still allow scoring from available evidence with stale/partial flags and lower confidence where appropriate.

For technical failures, preserve captured data, show a calm participant-safe recovery state, allow retry/resume where possible, and score available evidence if the interview cannot continue. Researcher-facing statuses should be participant-safe, such as `interview_partial`, `technical_interruption`, or `unable_to_complete_interview`. Do not expose vendor names, stack traces, device diagnostics, or detailed system errors to researchers.

Engineering telemetry may include run ID, slot ID, browser/device basics, timestamps, audio connection state, model/API error categories, latency, retry count, and service request IDs. Telemetry is not exposed to researchers.

## Scoring

Researchers define customizable rating objectives with title, description, optional custom scoring prompt, grade scale, grade examples, and evidence requirements. Objective updates create new versions.

Scoring runs automatically after interview completion, staleness, or technical interruption. Researchers can manually re-run scoring later. Each scoring run is versioned and retained.

For every objective, scoring must produce:

- Grade.
- Confidence score.
- Short rationale.
- Cited survey evidence.
- Cited interview evidence.
- Flags for low confidence, missing interview evidence, survey/interview contradiction, stale run, partial run, or technical interruption.

Scoring is never shown to participants. The system should always assign a grade for each objective. If survey and interview evidence contradict, default to interview evidence and explicitly flag the contradiction. If no interview occurred, reduce confidence and keep relevant contradiction/missing-evidence flags.

Researchers must be able to drill into raw transcript/audio from citations.

## Exports And Retention

CSV export is mandatory for V1. Include participant ID, run ID/date, survey version, interview status, stale/partial flags, objective version, grade, confidence, rationale, evidence citation IDs, and scoring metadata.

JSON export and bulk audio/transcript export are secondary. Per-participant audio/transcript download is acceptable for V1.

Default retention is 2 years for study artifacts, including survey responses, interview audio/transcripts, gap maps, consent records, versioned configs, prompts, grade examples, scores, evidence citations, model metadata, audit logs, and operational telemetry. Researchers can delete a study earlier.

## Logical Data Model Anchors

The PRD proposes a logical model, not a final physical schema. Important entities include:

- Identity and access: `users`, `study_memberships`.
- Study setup: `studies`, `participant_slots`, `consent_versions`, `survey_versions`, `survey_groups`, `survey_questions`, `objective_versions`, `objective_grade_examples`, `interviewer_persona_versions`.
- Run artifacts: `runs`, `consent_records`, `survey_responses`, `gap_maps`, `interview_sessions`, `interview_turns`, `interview_audio_assets`.
- Scoring and evidence: `scoring_runs`, `objective_scores`, `evidence_citations`.
- Operations and accountability: `operational_events`, `audit_logs`.

Design around immutable version references for run-time configuration and separate raw artifacts from scoring outputs so rescoring never mutates original evidence.

## Run State Model

Happy path:

```text
created -> consented -> survey_in_progress -> survey_completed -> interview_in_progress -> interview_completed -> scored
```

Pause/resume:

```text
interview_in_progress -> interview_paused -> interview_in_progress
```

Stale path:

```text
survey_completed | interview_paused | interview_in_progress -> stale -> scored
```

Technical failure path:

```text
interview_in_progress -> technical_interruption -> scored
```

Partial path:

```text
survey_completed | interview_paused | technical_interruption -> partial -> scored
```

Exact state names can evolve, but the implementation must distinguish stale, partial, completed, and technical interruption because they affect scoring confidence and researcher interpretation.

## AI Passes

- **Gap map pass**: input survey version/responses, active objectives, and study configuration; output answered areas, ambiguities, contradictions, missing evidence, and recommended probes.
- **Interview pass**: input survey responses, gap map, objective versions, V1 persona, remaining time, and run state; output natural follow-up conversation without revealing hidden scoring information.
- **Scoring pass**: input survey responses, gap map, transcript, audio-linked transcript metadata, objectives, grade scales, examples, prompts, evidence requirements, run state, and flags; output grades, confidence, rationale, citations, and flags.

## First Build Slice

A practical first implementation slice is:

1. Researcher creates a study.
2. Researcher defines consent, survey questions, participant slots, and scoring objectives.
3. Researcher creates runs for participant slots.
4. Participant consents and completes the survey.
5. System generates and stores the gap map.
6. Participant completes a simulated or real voice interview.
7. System stores transcript and audio references.
8. System runs automatic scoring.
9. Researcher views scores with confidence, rationale, evidence, and flags.
10. Researcher exports CSV.

## Implementation Principles

- Build tenant isolation early. Every researcher query should be scoped by ownership or membership.
- Keep participant identity minimal and study-scoped.
- Persist gap maps, scoring runs, citations, and model metadata as auditable artifacts.
- Snapshot or immutably version every configuration object used by a run.
- Keep scoring outputs separate from raw evidence.
- Avoid exposing sensitive diagnostics to participants or researchers.
- Treat raw audio, transcripts, survey responses, consent records, and telemetry as sensitive data.
