# Agent Workflow

This repo is currently in planning stage. Future Codex/agent sessions should use the PRD and planning docs as product context, then inspect the actual app structure once implementation begins.

## How To Choose The Next Issue

1. Start with `docs/github-issues.md` and pick the highest-priority issue whose dependencies are complete.
2. Prefer vertical slices that create demonstrable product behavior over isolated technical layers.
3. For MVP work, prioritize in this order:
   - Foundation and security boundaries.
   - Study setup and versioned configuration.
   - Participant slots, runs, and state machine.
   - Participant consent/survey flow.
   - Interview, scoring, review, and export.
4. If multiple issues are available, choose the one that unblocks the most downstream issues.
5. If a requirement is ambiguous, check `docs/open-questions.md` and mark any assumption in the issue/PR notes.

## How To Inspect Relevant Files Before Coding

Before editing, inspect:

- `docs/v1-prd-and-data-model.md`
- `docs/prd-analysis.md`
- `docs/architecture-plan.md`
- `docs/github-issues.md`
- `docs/open-questions.md`
- Existing README, AGENTS.md, package files, app/service source, migrations, and tests if present.

Use fast searches before making changes:

- Search for existing terminology and patterns with `rg`.
- Inspect nearby files before adding new abstractions.
- Check current git status and avoid overwriting unrelated user changes.

When the app exists, align with its existing framework, route conventions, service boundaries, data access helpers, and test style.

## How To Update Docs After Implementation

After completing an issue:

- Update `docs/github-issues.md` only if scope, dependencies, or acceptance criteria changed.
- Update `docs/architecture-plan.md` when stack choices, provider boundaries, data flow, or deployment assumptions become real decisions.
- Update `docs/open-questions.md` by moving answered questions out or annotating decisions.
- Update README or operational docs with new commands, environment variables, and setup requirements.
- Preserve the PRD as source input unless the user explicitly asks to revise product requirements.

## How To Verify Work Before Opening A PR

Run the repo's documented checks. Once available, this should include:

- Formatter/linter.
- Typecheck or compile.
- Unit tests.
- Service integration tests for touched workflows.
- Frontend/component tests for touched UI.
- E2E test when the change affects a core user journey.
- Migration checks when schema changes are included.
- Authorization tests when any study, run, artifact, export, or admin access path changes.

For AI/voice work:

- Use fake providers for deterministic tests.
- Validate structured AI outputs.
- Test provider error categories.
- Verify participant UI does not expose hidden objectives, rubrics, scoring, or full transcripts.

For data/export work:

- Test tenant isolation.
- Test citation stability.
- Test CSV escaping and formula injection defenses.
- Test deletion/retention behavior where applicable.

## What Not To Do Without Confirmation

- Do not create real GitHub issues unless the user explicitly asks.
- Do not implement high-stakes assessment, diagnosis, grading, employment, or access-decision language.
- Do not add participant accounts or post-completion participant portals.
- Do not add closed-ended survey question types.
- Do not add researcher-selectable interviewer personas in V1.
- Do not expose rubrics, scores, objectives, participant captions, or full transcripts to participants.
- Do not expose vendor names, stack traces, device diagnostics, or detailed system errors to researchers or participants.
- Do not send real participant data to an AI/voice provider until provider, privacy, and data-handling decisions are confirmed.
- Do not broaden admin access without role checks and audit logging.
- Do not overwrite user changes or unrelated files.

## Issue Completion Checklist

- [ ] Dependency issues are complete or consciously mocked/stubbed.
- [ ] Relevant docs and source files were inspected.
- [ ] Implementation follows existing repo conventions.
- [ ] Acceptance criteria are satisfied.
- [ ] Tests cover happy path, failure path, and authorization where relevant.
- [ ] Docs and open questions are updated if assumptions changed.
- [ ] No hidden participant data is exposed in participant UI.
- [ ] No raw operational diagnostics are exposed to researchers.
- [ ] Git status is reviewed before final handoff.
