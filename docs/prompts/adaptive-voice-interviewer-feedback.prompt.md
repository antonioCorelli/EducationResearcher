# Feature Request: Make the Voice Interviewer Adaptive, Non-Repetitive, and Participant-Led

Repository: `antonioCorelli/EducationResearcher`

## Objective

Improve Voxaria's voice-to-voice interview behavior based on participant feedback. The interviewer currently probes too
persistently, revisits exhausted examples, and can sound like a tutoring or assessment system waiting for a correct
answer. It should instead behave like a curious, respectful research interviewer seeking sufficient understanding.

The primary behavioral principle is:

> Seek sufficient understanding, not exhaustive answers. Once Voxaria has enough evidence to characterize a
> participant's view—or once a line of questioning stops producing useful information—it should acknowledge the
> response and move on.

Implement this as a focused behavior change. Preserve the existing voice architecture, participant controls, data
persistence, provider abstraction, and safety boundaries unless a small supporting change is necessary to make the
behavior reliable.

## Required Repository Context

Before changing code:

1. Read `AGENTS.md`, `PROJECT_CONTEXT.md`, and `SHARED_LANGUAGE.md`.
2. Read the voice-specific guidance in `docs/agent-workflow.md`.
3. Inspect the current implementation and tests, especially:
   - `apps/service/src/voice-provider.ts`
   - `apps/service/src/voice-provider.test.ts`
   - `apps/service/src/runs.ts`
   - `apps/web/src/participant.tsx`
   - `apps/web/src/participant.test.tsx`
4. Confirm the current realtime prompt version and how survey responses and prior interview turns reach the model.
5. Identify the smallest safe implementation path before editing.

The current implementation already:

- Sends written survey evidence and prior interview history to the realtime model.
- Requires one question at a time and short spoken responses.
- Supports natural voice, push-to-talk, and typing.
- Supports both the standard and newer realtime voice experiences.
- Hides objectives, rubrics, scores, and full transcripts from participants.

Do not reimplement these capabilities.

## Participant Feedback to Address

### 1. Limit probing on one topic

Voxaria asks substantially similar questions several times, even after enough evidence has been collected.

Required behavior:

- Ask no more than four interviewer questions on one topic or line of inquiry.
- Spend no more than approximately three minutes on one topic, whichever limit is reached first.
- Move on earlier when the participant's position is already sufficiently clear.
- Do not request additional examples merely to make the interview longer.

If the existing architecture cannot enforce the time boundary precisely without a disproportionate rewrite, make the
question-count and stopping rules explicit and testable, implement the smallest reasonable time-aware behavior, and
document the remaining limitation honestly. Do not claim that a prompt-only suggestion is a deterministic timer.

### 2. Stop exhausted lines of questioning

Required behavior after responses such as "I don't know," "I don't remember," "I'm not sure," or "I can't think of an
example":

1. The interviewer may rephrase or approach the question differently once.
2. If the participant still cannot answer, acknowledge it without judgment.
3. Stop pursuing that example.
4. Move to a different question, example, or topic.

The second attempt must not simply repeat the same demand with slightly different wording.

### 3. Avoid implying that a correct answer exists

The interview is for eliciting a participant's existing thinking, not teaching, correcting, grading, or coaching them
toward target vocabulary.

Required behavior:

- Use curiosity and clarification rather than correction.
- Treat uncertainty and incomplete knowledge as valid research data.
- Do not imply that the previous response was inadequate or wrong.
- Do not keep asking until a participant produces an expected concept or phrase.
- Do not introduce a conclusion and ask the participant to agree with it.
- Preserve the existing prohibition against exposing objectives, rubrics, grades, or evaluation strategy.

### 4. Use written survey responses without demanding repetition

When a written response is already clear:

- Briefly summarize the interviewer's interpretation.
- Ask whether the interpretation is accurate or whether the participant wants to clarify or add anything.
- Do not require the participant to restate the entire survey answer.

When clarification is still needed:

- Refer neutrally to the participant's own example.
- Ask what the example means to the participant.
- Do not tell the participant what the example supposedly proves.

Preferred pattern:

> In your survey, you said [brief faithful summary]. I interpreted that as [tentative interpretation]. Am I understanding
> you correctly, or is there anything you would change or add?

Non-leading clarification pattern:

> You mentioned [participant's example] in your survey. Can you explain what that example shows to you about [topic]?

Avoid:

> You mentioned [example]. Does that show that [target conclusion]?

### 5. Handle "I already answered this" respectfully

When a participant says they already answered something:

1. Acknowledge that they are correct.
2. Faithfully summarize the relevant written or previously spoken answer.
3. Make at most one concise clarification or interpretation check.
4. Move on unless the participant voluntarily adds new information.

Never argue with the participant or immediately ask the same question again.

### 6. Make interview length evidence-responsive

The maximum interview duration is a cap, not a target.

Required behavior:

- End earlier when written responses and interview clarifications already provide sufficient understanding.
- Continue only while follow-ups are producing genuinely new information.
- Prefer a shorter, sufficient interview over a longer repetitive interview.
- Close warmly and naturally when useful lines of inquiry are complete.
- Do not attempt to fill an assumed 20-, 30-, or 45-minute duration.

### 7. Preserve participant choice and comfort

- Keep typing available when the study permits written interview responses.
- Preserve natural voice and push-to-talk options.
- Preserve pause, skip, redo, and resume behavior.
- Do not make voice the only valid way to provide useful research data.
- Do not expose participant transcript text in interfaces where it is currently intentionally hidden.

## Implementation Guidance

- Start with the versioned realtime interview instructions and the existing survey/history context.
- Bump the realtime interview prompt version when behavior changes.
- Use general terms such as "topic" or "line of inquiry" in shared behavior unless the study configuration explicitly
  supplies a domain-specific term such as "NOS tenet."
- Keep researcher-provided interviewer instructions subordinate to participant safety and the stopping/non-leading rules.
- Do not add hidden scoring objectives or rubric content to the realtime prompt.
- Do not add a new dependency for trivial prompt or policy logic.
- Do not hardcode the example subject matter from this request into production behavior.
- If prompt instructions alone are not sufficient for a requirement, add only the smallest explicit state or helper
  needed. Do not introduce a generalized workflow engine as part of this feature.

## Acceptance Criteria

- [ ] The realtime interviewer is explicitly instructed to seek sufficient understanding rather than exhaustive answers.
- [ ] The interviewer has a clear per-topic stopping budget of four questions or approximately three minutes and may
      move on sooner.
- [ ] After two consecutive inability/uncertainty responses on the same line of inquiry, the interviewer must stop that
      line and move on.
- [ ] "I already answered this" receives acknowledgment, a faithful summary, and at most one clarification attempt.
- [ ] Clear survey answers are summarized or checked for interpretation rather than requested again in full.
- [ ] Survey examples are revisited with neutral, open questions rather than leading conclusions.
- [ ] The interview can end substantially earlier than its maximum duration when sufficient evidence has been collected.
- [ ] Existing typing, natural voice, push-to-talk, pause, skip, redo, and resume behavior remains available according to
      current study settings.
- [ ] Participant-facing behavior still does not reveal objectives, rubrics, grades, hidden progress, evaluation
      strategy, vendor diagnostics, or full transcripts.
- [ ] Both standard and newer realtime voice experiences receive the updated interviewer behavior.
- [ ] The prompt/version metadata identifies the new behavior version.
- [ ] Existing tests remain green and focused regression tests cover the new rules.

## Required Test Coverage

Use test-driven development where practical.

At minimum, add or update deterministic tests for:

1. Prompt construction includes the sufficient-understanding principle and per-topic stopping limits.
2. Prompt construction includes the one-rephrase-only rule for uncertainty or inability responses.
3. Prompt construction includes the "already answered" acknowledgment and single-clarification rule.
4. Prompt construction distinguishes neutral survey-grounded questions from leading questions.
5. Prompt construction says the maximum interview duration is a cap, not a target.
6. Researcher instructions cannot override non-leading, participant-safe, or hidden-evaluation boundaries.
7. Prior interview turns and survey answers remain present as context.
8. The prompt version is updated consistently at session creation call sites and in tests.
9. Existing response-mode controls and participant-safe UI behavior do not regress.

Use fake providers for automated tests. Do not send real participant feedback, survey responses, transcripts, or audio to
OpenAI during tests.

Because automated unit tests cannot prove conversational quality, also create a concise manual evaluation matrix using
synthetic examples for:

- A detailed survey response that only needs confirmation.
- An unclear response that benefits from one follow-up.
- Two consecutive "I don't know" responses.
- "I already answered that in the survey."
- A participant who provides enough information quickly.
- A participant who prefers typing.
- A potentially leading topic where the interviewer must not supply the target conclusion.

For each scenario, state the expected interviewer behavior and prohibited behavior. Do not include real participant data.

## Out of Scope

- Changing the realtime model or voice selection.
- Adding CloudWatch logging or production infrastructure.
- Redesigning the complete participant interview UI.
- Changing scoring objectives, rubrics, or score generation.
- Adding researcher-selectable interviewer personas.
- Building a generic qualitative coding system.
- Uploading the human-to-human reference interviews into production prompts.
- Deploying to AWS.

## Validation

Run the repository's relevant focused tests, then the broader checks supported by `package.json`, including:

```text
npm test
npm run lint
npm run typecheck
npm run build
```

Report any command that cannot be run. Review the final diff for unrelated changes.

## Deliverables

1. Updated, versioned realtime interviewer behavior.
2. Focused automated regression tests.
3. A synthetic manual evaluation matrix for conversational-quality review.
4. Any concise documentation needed to explain the new stopping and non-leading rules.
5. A final response describing:
   - What changed.
   - What was tested.
   - Assumptions and remaining limitations.
   - A text-only local demo path for trying the updated interview.
