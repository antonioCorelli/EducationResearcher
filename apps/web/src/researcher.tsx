import type { ReactNode } from "react";

import type { SessionUser, StudiesState, StudySetupTab, StudyShell } from "./App";

const studySetupTabs: readonly { readonly id: StudySetupTab; readonly label?: string }[] = [
  { id: "shell", label: "New Study" },
  { id: "consent", label: "Consent information" },
  { id: "survey", label: "Survey information" },
  { id: "objectives", label: "Scoring objectives" }
];

interface ResearcherProps {
  readonly user: SessionUser;
  readonly studiesState: StudiesState;
  readonly studies: readonly StudyShell[];
  readonly selectedStudyId: string | null;
  readonly activeStudySetupTab: StudySetupTab;
  readonly shellPanel: ReactNode;
  readonly consentPanel: ReactNode;
  readonly surveyPanel: ReactNode;
  readonly scoringPanel: ReactNode;
  readonly dialogs: ReactNode;
  readonly onSignOut: () => void;
  readonly onResetStudyForm: () => void;
  readonly onLoadStudyForm: (study: StudyShell) => void;
  readonly onStudySetupTabChange: (tab: StudySetupTab) => void;
}

export function Researcher({
  user,
  studiesState,
  studies,
  selectedStudyId,
  activeStudySetupTab,
  shellPanel,
  consentPanel,
  surveyPanel,
  scoringPanel,
  dialogs,
  onSignOut,
  onResetStudyForm,
  onLoadStudyForm,
  onStudySetupTabChange
}: ResearcherProps) {
  const selectedStudy = studies.find((study) => study.id === selectedStudyId);
  const shellTabLabel = selectedStudy ? ("Study: " + selectedStudy.title).slice(0, 15) : "New Study";
  console.log(shellTabLabel);

  return (
    <main className="app-shell researcher-shell">
      <section className="workspace-panel researcher-workspace" aria-labelledby="researcher-title">
        <div className="topline">
          <p className="eyebrow">Researcher workspace</p>
          <button className="secondary-button" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
        <h1 id="researcher-title">Welcome, {user.displayName}</h1>
        <div className="study-workspace">
          <div className="study-list-panel">
            <div className="section-heading">
              <h2>Studies</h2>
              <button className="secondary-button compact-button" type="button" onClick={onResetStudyForm}>
                Create New Study
              </button>
            </div>
            {studiesState.status === "loading" ? <p className="muted-copy">Loading studies</p> : null}
            {studiesState.status === "error" ? <p className="form-error">{studiesState.message}</p> : null}
            {studies.length === 0 && studiesState.status === "ready" ? <p className="muted-copy">No studies yet</p> : null}
            <div className="study-list" aria-label="Studies">
              {studies.map((study) => (
                <button
                  className={study.id === selectedStudyId ? "study-row selected-study-row" : "study-row"}
                  key={study.id}
                  type="button"
                  onClick={() => onLoadStudyForm(study)}
                >
                  <span>{study.title}</span>
                  <small>
                    {study.defaultFreshnessDays} days - {study.defaultMaxInterviewMinutes} min
                  </small>
                </button>
              ))}
            </div>
          </div>
          <div className="setup-stack">
            <div className="study-setup-tabs" aria-label="Study setup sections" role="tablist">
              {studySetupTabs.map((tab) => (
                <button
                  aria-controls={`study-setup-panel-${tab.id}`}
                  aria-selected={activeStudySetupTab === tab.id}
                  className={activeStudySetupTab === tab.id ? "setup-tab active-setup-tab" : "setup-tab"}
                  id={`study-setup-tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => onStudySetupTabChange(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tab.id == "shell" ? shellTabLabel ?? tab.label : tab.label}
                </button>
              ))}
            </div>
            {shellPanel}
            {consentPanel}
            {surveyPanel}
            {scoringPanel}
          </div>
        </div>
      </section>
      {dialogs}
    </main>
  );
}
