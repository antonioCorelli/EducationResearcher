import { useEffect, useRef, type FormEvent } from "react";

import type { StudyShell, StudySetupTab } from "../App";

export const defaultStudyShellForm = {
  studyTitle: "",
  studyDescription: "",
  interviewerInstructions: "",
  freshnessDays: 14,
  maxInterviewMinutes: 45,
  allowWrittenInterviewResponses: true
} as const;

export const defaultPersonaStylePrompt =
  "You are the fixed V1 interviewer for formative education research studies.\n\n" +
  "Act like a calm, warm, neutral, curious, and non-evaluative research interviewer. Preserve natural conversation, acknowledge briefly, ask one question at a time, and invite concrete examples or clarification when an answer is vague.\n\n" +
  "Use the participant's survey responses and the researcher's interviewer instructions to choose high-value follow-up questions. Steer gently toward clarification, concrete examples, and details that matter for the study without making the participant feel tested or graded.\n\n" +
  "Do not reveal scoring objectives, rubrics, grades, scores, confidence, hidden progress, or any evaluation strategy. Do not tell the participant how they are performing or imply that the interview is an assessment.\n\n" +
  "Keep questions participant-safe and focused on the study topic. If the participant seems uncomfortable, give them room to pause or stop.";

export const defaultPersonaVersionLabel = "Persona Version 1";

export function createStudyShellForm(study: StudyShell | undefined) {
  return {
    selectedStudyId: study?.id ?? null,
    studyTitle: study?.title ?? defaultStudyShellForm.studyTitle,
    studyDescription: study?.description ?? defaultStudyShellForm.studyDescription,
    interviewerInstructions: study?.interviewerInstructions ?? defaultStudyShellForm.interviewerInstructions,
    freshnessDays: study?.defaultFreshnessDays ?? defaultStudyShellForm.freshnessDays,
    maxInterviewMinutes: study?.defaultMaxInterviewMinutes ?? defaultStudyShellForm.maxInterviewMinutes,
    allowWrittenInterviewResponses:
      study?.allowWrittenInterviewResponses ?? defaultStudyShellForm.allowWrittenInterviewResponses
  };
}

interface ResearcherShellProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly freshnessDays: number;
  readonly isSavingStudy: boolean;
  readonly selectedStudy: StudyShell | undefined;
  readonly studyError: string;
  readonly studyDescription: string;
  readonly studyTitleFocusRequest: number;
  readonly studyTitle: string;
  readonly onFreshnessDaysChange: (freshnessDays: number) => void;
  readonly onSaveStudy: (event: FormEvent<HTMLFormElement>) => void;
  readonly onStudyDescriptionChange: (description: string) => void;
  readonly onStudyTitleChange: (title: string) => void;
}

export function ResearcherShell({
  activeStudySetupTab,
  freshnessDays,
  isSavingStudy,
  selectedStudy,
  studyError,
  studyDescription,
  studyTitleFocusRequest,
  studyTitle,
  onFreshnessDaysChange,
  onSaveStudy,
  onStudyDescriptionChange,
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
      <div className="section-heading">
        <h2>Study</h2>
      </div>
      <p className="muted-copy">Name the study and set the freshness window for participant runs.</p>
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
      <label>
        Study description
        <textarea
          maxLength={2000}
          name="study-description"
          onChange={(event) => onStudyDescriptionChange(event.target.value)}
          placeholder="Optional: summarize the study context, participant group, or research focus"
          value={studyDescription}
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

export function getPersonaVersionLabel(activePersonaVersionId: string) {
  const versionMatch = activePersonaVersionId.match(/(?:^|_)v(\d+)(?:_|$)/i);

  return versionMatch ? `Persona Version ${versionMatch[1]}` : "Persona Version";
}
