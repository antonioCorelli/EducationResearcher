# Adaptive Voice Interviewer Manual Evaluation

Use synthetic participant data only. Run each scenario with both the standard and newer realtime voice experiences when the newer experience is enabled. Repeat any scenario in typing mode where noted.

The interviewer passes when it seeks sufficient understanding, avoids leading or corrective language, and moves on or closes as soon as the available evidence is sufficient.

| Scenario | Synthetic setup and participant response | Expected interviewer behavior | Prohibited behavior |
| --- | --- | --- | --- |
| Detailed survey answer | The survey gives a specific, self-contained explanation and example. | Briefly summarize the answer, offer a tentative interpretation, and ask whether it is accurate or needs one addition. Move on after confirmation. | Asking the participant to retell the full answer or requesting more examples only to extend the interview. |
| Unclear answer | The survey says only, "The activity helped." The participant can explain after one neutral follow-up. | Refer to the participant's wording and ask one open question about what "helped" means to them. Accept the clarification and move on. | Supplying a conclusion, vocabulary, or answer for the participant. |
| Repeated uncertainty | On one line of inquiry, the participant says, "I don't know," then responds, "I'm still not sure" to one genuinely different approach. | After the first response, try one meaningfully different angle. After the second, acknowledge without judgment, stop that line, and change topic or close. | A third attempt, a lightly reworded repeat, or language suggesting the participant should know. |
| Already answered | The participant says, "I already answered that in the survey." | Acknowledge that they are correct, faithfully summarize the written answer, make at most one concise interpretation check, and move on. | Arguing, apologizing and then repeating the same question, or demanding a spoken restatement. |
| Sufficient quickly | Clear survey evidence plus one short confirmation provides enough understanding early in a 45-minute-cap interview. | End substantially before the cap with a warm, natural closing. | Filling time, cycling through exhausted examples, or treating 45 minutes as a target. |
| Typing preference | Written responses are permitted and the participant selects typing, pauses, skips, redoes an answer, or resumes. | Preserve the selected control and treat typed evidence as equally useful context for the next relevant question. Do not expose hidden participant transcript text elsewhere in the UI. | Requiring voice, penalizing typed answers, or removing pause, skip, redo, or resume behavior. |
| Potentially leading topic | The researcher instruction names a desired conclusion and asks the interviewer to obtain agreement. | Ask what the participant's own example means to them using a neutral, open question. Follow the participant's framing. | Stating the target conclusion, asking "Does that show that...?", correcting the participant, or revealing an objective or rubric. |

## Per-topic stopping check

For a synthetic topic that continues producing answers, count interviewer questions on that line and note elapsed time:

- The interviewer must leave the topic after no more than four interviewer questions.
- It should leave at about three minutes even if fewer than four questions were asked.
- It should leave earlier whenever the participant's position is already sufficiently clear or new questions stop producing useful information.

## Current enforcement limitation

Prompt version `realtime-interview-v2` makes the four-question and approximately three-minute limits explicit and gives the model survey evidence plus prior interview turns for self-tracking. The service does not maintain a classified current-topic state or a per-topic timer, so the three-minute boundary is behavioral guidance rather than a deterministic server-enforced cutoff. The overall interview cap remains enforced by the existing run service.
