import type { FormEvent } from "react";

import type { StudySetupTab, StudyShell } from "../App";
import { defaultPersonaStylePrompt, defaultPersonaVersionLabel, getPersonaVersionLabel } from "./shell";

interface ResearcherInterviewProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly interviewerInstructions: string;
  readonly isSavingStudy: boolean;
  readonly maxInterviewMinutes: number;
  readonly selectedStudy: StudyShell | undefined;
  readonly studyError: string;
  readonly onInterviewerInstructionsChange: (interviewerInstructions: string) => void;
  readonly onMaxInterviewMinutesChange: (maxInterviewMinutes: number) => void;
  readonly onSaveStudy: (event: FormEvent<HTMLFormElement>) => void;
}

export function ResearcherInterview({
  activeStudySetupTab,
  interviewerInstructions,
  isSavingStudy,
  maxInterviewMinutes,
  selectedStudy,
  studyError,
  onInterviewerInstructionsChange,
  onMaxInterviewMinutesChange,
  onSaveStudy
}: ResearcherInterviewProps) {
  const personaVersionLabel = selectedStudy ? getPersonaVersionLabel(selectedStudy.activePersonaVersionId) : defaultPersonaVersionLabel;

  return (
    <form
      aria-labelledby="study-setup-tab-interview"
      className="study-form study-setup-panel"
      hidden={activeStudySetupTab !== "interview"}
      id="study-setup-panel-interview"
      onSubmit={onSaveStudy}
      role="tabpanel"
    >
      <div className="section-heading">
        <h2>Interview</h2>
        <span className="version-pill">Locked {personaVersionLabel}</span>
      </div>
      <p className="muted-copy">
        Configure the time limit and study-specific instructions that are passed directly into the interviewer. The
        interviewer persona stays locked to the V1 formative research style so participants get a consistent,
        non-evaluative conversation.
      </p>
      <label>
        Interview minutes
        <input
          disabled={!selectedStudy}
          max={180}
          min={1}
          name="max-interview-minutes"
          onChange={(event) => onMaxInterviewMinutesChange(event.target.valueAsNumber)}
          required={Boolean(selectedStudy)}
          type="number"
          value={maxInterviewMinutes}
        />
      </label>
      <label>
        Interviewer instructions
        <textarea
          aria-describedby="interviewer-instructions-hint"
          disabled={!selectedStudy}
          maxLength={4000}
          name="interviewer-instructions"
          onChange={(event) => onInterviewerInstructionsChange(event.target.value)}
          placeholder={selectedStudy ? "Clarify where learners got stuck, elicit concrete examples, and follow up on reasoning behind key choices." : "Create or select a study first"}
          value={interviewerInstructions}
        />
      </label>
      <p className="muted-copy field-hint" id="interviewer-instructions-hint">
        These instructions are passed to the interviewer as study context for planning follow-up questions. Focus on
        concepts to clarify, experiences to elicit, and participant-safe follow-ups that matter for this study; do not
        write a rigid script.
      </p>
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
        <button className="primary-button" disabled={!selectedStudy || isSavingStudy} type="submit">
          {isSavingStudy ? "Saving" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
