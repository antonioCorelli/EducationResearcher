import type { FormEvent } from "react";

import type { StudySetupTab, StudyShell } from "../App";
import { defaultPersonaStylePrompt, defaultPersonaVersionLabel, getPersonaVersionLabel } from "./shell";

interface ResearcherInterviewProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly interviewerGoals: string;
  readonly isSavingStudy: boolean;
  readonly maxInterviewMinutes: number;
  readonly selectedStudy: StudyShell | undefined;
  readonly studyError: string;
  readonly onInterviewerGoalsChange: (interviewerGoals: string) => void;
  readonly onMaxInterviewMinutesChange: (maxInterviewMinutes: number) => void;
  readonly onSaveStudy: (event: FormEvent<HTMLFormElement>) => void;
}

export function ResearcherInterview({
  activeStudySetupTab,
  interviewerGoals,
  isSavingStudy,
  maxInterviewMinutes,
  selectedStudy,
  studyError,
  onInterviewerGoalsChange,
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
        <h2>Interview information</h2>
        <span className="version-pill">Locked {personaVersionLabel}</span>
      </div>
      <p className="muted-copy">
        Configure the time limit and researcher-defined goals that help the interviewer focus each conversation. The
        interviewer persona stays locked to the V1 formative research style so participants get a consistent,
        non-evaluative interview.
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
        Interviewer goals
        <textarea
          aria-describedby="interviewer-goals-hint"
          disabled={!selectedStudy}
          maxLength={4000}
          name="interviewer-goals"
          onChange={(event) => onInterviewerGoalsChange(event.target.value)}
          placeholder={selectedStudy ? "Clarify where learners got stuck, elicit concrete examples, and confirm the reasoning behind key choices." : "Create or select a study first"}
          value={interviewerGoals}
        />
      </label>
      <p className="muted-copy field-hint" id="interviewer-goals-hint">
        Describe what the interviewer needs to learn or accomplish by the end of the conversation. Focus on concepts to
        clarify, experiences to elicit, evidence to confirm, and follow-ups that matter for this study; keep it
        participant-safe and outcome-focused, not a script.
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
