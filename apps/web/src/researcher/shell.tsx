import { useEffect, useRef, type FormEvent } from "react";

import type { StudyShell, StudySetupTab } from "../App";

export const defaultStudyShellForm = {
  studyTitle: "",
  freshnessDays: 14,
  maxInterviewMinutes: 45
} as const;

const defaultPersonaStylePrompt =
  "You are the fixed V1 interviewer for formative education research studies.\n\n" +
  "Act like a calm, warm, neutral, curious, and non-evaluative research interviewer. Preserve natural conversation, acknowledge briefly, ask one question at a time, and invite concrete examples or clarification when an answer is vague.\n\n" +
  "Use the participant's survey responses, the gap map, and the study objectives only to choose high-value follow-up questions. Steer gently toward unresolved gaps, ambiguities, contradictions, and missing evidence without making the participant feel tested or graded.\n\n" +
  "Do not reveal scoring objectives, rubrics, grades, scores, confidence, hidden progress, or gap map internals. Do not tell the participant how they are performing or imply that the interview is an assessment.\n\n" +
  "Keep questions participant-safe and focused on the study topic. If the participant seems uncomfortable, give them room to pause or stop.";

export function createStudyShellForm(study: StudyShell | undefined) {
  return {
    selectedStudyId: study?.id ?? null,
    studyTitle: study?.title ?? defaultStudyShellForm.studyTitle,
    freshnessDays: study?.defaultFreshnessDays ?? defaultStudyShellForm.freshnessDays,
    maxInterviewMinutes: study?.defaultMaxInterviewMinutes ?? defaultStudyShellForm.maxInterviewMinutes
  };
}

interface ResearcherShellProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly freshnessDays: number;
  readonly isSavingStudy: boolean;
  readonly maxInterviewMinutes: number;
  readonly selectedStudy: StudyShell | undefined;
  readonly studyError: string;
  readonly studyTitleFocusRequest: number;
  readonly studyTitle: string;
  readonly onFreshnessDaysChange: (freshnessDays: number) => void;
  readonly onMaxInterviewMinutesChange: (maxInterviewMinutes: number) => void;
  readonly onSaveStudy: (event: FormEvent<HTMLFormElement>) => void;
  readonly onStudyTitleChange: (title: string) => void;
}

export function ResearcherShell({
  activeStudySetupTab,
  freshnessDays,
  isSavingStudy,
  maxInterviewMinutes,
  selectedStudy,
  studyError,
  studyTitleFocusRequest,
  studyTitle,
  onFreshnessDaysChange,
  onMaxInterviewMinutesChange,
  onSaveStudy,
  onStudyTitleChange
}: ResearcherShellProps) {
  const studyTitleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeStudySetupTab === "shell") {
      studyTitleInputRef.current?.focus();
    }
  }, [activeStudySetupTab, studyTitleFocusRequest]);

  return (
    <form
      aria-labelledby="study-setup-tab-shell"
      className="study-form study-setup-panel"
      hidden={activeStudySetupTab !== "shell"}
      id="study-setup-panel-shell"
      onSubmit={onSaveStudy}
      role="tabpanel"
    >
      <label>
        Study title
        <input
          autoFocus
          ref={studyTitleInputRef}
          maxLength={160}
          name="study-title"
          onChange={(event) => onStudyTitleChange(event.target.value)}
          required
          type="text"
          value={studyTitle}
        />
      </label>
      <div className="settings-grid">
        <label>
          Freshness days
          <input
            max={365}
            min={1}
            name="freshness-days"
            onChange={(event) => onFreshnessDaysChange(event.target.valueAsNumber)}
            required
            type="number"
            value={freshnessDays}
          />
        </label>
        <label>
          Interview minutes
          <input
            max={180}
            min={1}
            name="max-interview-minutes"
            onChange={(event) => onMaxInterviewMinutesChange(event.target.valueAsNumber)}
            required
            type="number"
            value={maxInterviewMinutes}
          />
        </label>
      </div>
      <label>
        Interviewer persona
        <textarea readOnly value={selectedStudy?.persona.stylePrompt ?? defaultPersonaStylePrompt} />
      </label>
      <div className="locked-row">
        <span>{selectedStudy?.persona.label ?? "V1 default research interviewer"}</span>
        <strong>Locked</strong>
      </div>
      {studyError ? <p className="form-error">{studyError}</p> : null}
      <div className="form-actions">
        <button className="primary-button" disabled={isSavingStudy} type="submit">
          {isSavingStudy ? "Saving" : selectedStudy ? "Save changes" : "Create study"}
        </button>
      </div>
    </form>
  );
}
