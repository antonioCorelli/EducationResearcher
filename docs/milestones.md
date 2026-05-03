# Milestones

Source PRD: `docs/v1-prd-and-data-model.md`

## MVP

### Goal

Deliver the first build slice: a researcher can create a study, configure consent/survey/objectives, create participant slots and runs, a participant can consent and complete the survey/interview flow, the system can generate a gap map and score the run, and the researcher can review scores/evidence and export CSV.

### Included Issues

- [Foundation] Scaffold web app, service, and development conventions
- [Foundation] Define database schema and migration workflow
- [Foundation] Implement researcher authentication and role model
- [Foundation] Enforce study-scoped authorization helpers
- [Researcher Setup] Create and edit study shell
- [Researcher Setup] Configure versioned consent
- [Researcher Setup] Configure versioned long-form survey
- [Researcher Setup] Configure versioned scoring objectives and rubrics
- [Participant Runs] Create participant slots manually
- [Participant Runs] Import and generate participant slots
- [Participant Runs] Create researcher-authorized runs
- [Participant Runs] Generate secure participant run access links
- [Participant Runs] Implement run state machine
- [Participant Flow] Capture participant consent record
- [Participant Flow] Render and submit long-form survey
- [Participant Flow] Add participant completion and blocked-state screens
- [AI Orchestration] Generate and persist survey gap map
- [AI Orchestration] Define fixed V1 interviewer persona prompt version
- [AI Orchestration] Build AI provider abstraction and structured output validation
- [Interview] Implement interview session lifecycle
- [Interview] Build sparse participant voice UI
- [Interview] Integrate realtime voice interview provider
- [Interview] Persist transcript turns and audio asset metadata
- [Interview] Handle technical failures and retry/resume
- [Run Freshness] Enforce freshness window and stale scoring trigger
- [Scoring] Implement automatic scoring job
- [Scoring] Persist citations and resolve evidence sources
- [Scoring] Build researcher score review view
- [Scoring] Build raw evidence drilldown
- [Researcher Review] Build run status dashboard
- [Exports] Generate CSV export for scores
- [Operations] Record operational telemetry
- [Operations] Add audit logging for sensitive actions
- [Quality] Add end-to-end first build slice test
- [Docs] Document implementation decisions and operating assumptions

### Done Means

- A deterministic local or staging demo can run the full first build slice.
- Sensitive researcher data is study-scoped and protected by service authorization.
- Participant access works without accounts and is scoped to authorized runs.
- Configuration used by runs is versioned or immutable by reference.
- Gap maps, transcripts/audio metadata, scoring runs, citations, and CSV exports are persisted.
- Stale and technical interruption paths preserve captured data and still trigger scoring.
- The core flow has automated tests using fake AI/voice adapters.
- Docs describe local setup, commands, provider assumptions, and remaining open questions.

### Risks

- Realtime voice integration may take longer than the rest of MVP.
- Evidence citations may need iteration if provider transcript timing is inconsistent.
- Tenant isolation and audit logging must be present before real research data is used.
- CSV export format may need product/researcher validation.
- The MVP issue list is intentionally complete; delivery may require a simulated voice provider before real voice is production-ready.

## Beta/Polish

### Goal

Harden V1 for real pilot studies by improving rescoring, retention/deletion, support operations, and admin workflows.

### Included Issues

- [Scoring] Add manual rescoring
- [Operations] Implement retention and researcher deletion
- [Operations] Build privileged admin support view

### Done Means

- Researchers can manually re-run scoring without overwriting history.
- Researcher-initiated deletion and 2-year retention behavior are implemented or clearly documented where infrastructure limits apply.
- Admin engineers can investigate operational failures with role-limited, audited access.
- Support workflows avoid exposing raw diagnostics or casual browsing of raw artifacts.

### Risks

- Retention/deletion semantics may depend on hosting, object storage, backups, and logging providers.
- Manual rescoring needs a product decision about objective version selection.
- Admin support views increase security and audit requirements.

## Post-MVP

### Goal

Add useful secondary export fidelity and defer nonessential capabilities until after the core research workflow is validated.

### Included Issues

- [Exports] Add optional JSON export

### Done Means

- Researchers can export full-fidelity structured study results as JSON.
- JSON schema is versioned and documented.
- Raw audio is referenced through controlled access rather than embedded.

### Risks

- JSON export may create downstream compatibility expectations.
- Full-fidelity exports may raise additional privacy and retention questions.
