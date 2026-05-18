import type { ReactNode } from "react";

import type { ResearcherWorkspace, SessionUser, StudiesState, StudySetupTab, StudyShell } from "./App";
import { SurveyBuilderWorkspace } from "./researcher/surveyBuilderWorkspace";

const researcherWorkspaces: readonly { readonly id: ResearcherWorkspace; readonly label: string }[] = [
  { id: "builder", label: "Survey Builder" },
  { id: "operations", label: "Run Operations" },
  { id: "analysis", label: "Analysis" }
];

interface ResearcherProps {
  readonly user: SessionUser;
  readonly studiesState: StudiesState;
  readonly studies: readonly StudyShell[];
  readonly selectedStudyId: string | null;
  readonly activeResearcherWorkspace: ResearcherWorkspace;
  readonly activeStudySetupTab: StudySetupTab;
  readonly shellPanel: ReactNode;
  readonly consentPanel: ReactNode;
  readonly surveyPanel: ReactNode;
  readonly scoringPanel: ReactNode;
  readonly operationsPanel: ReactNode;
  readonly analysisPanel: ReactNode;
  readonly dialogs: ReactNode;
  readonly onSignOut: () => void;
  readonly onResetStudyForm: () => void;
  readonly onLoadStudyForm: (study: StudyShell) => void;
  readonly onResearcherWorkspaceChange: (workspace: ResearcherWorkspace) => void;
  readonly onStudySetupTabChange: (tab: StudySetupTab) => void;
}

export function Researcher({
  user,
  studiesState,
  studies,
  selectedStudyId,
  activeResearcherWorkspace,
  activeStudySetupTab,
  shellPanel,
  consentPanel,
  surveyPanel,
  scoringPanel,
  operationsPanel,
  analysisPanel,
  dialogs,
  onSignOut,
  onResetStudyForm,
  onLoadStudyForm,
  onResearcherWorkspaceChange,
  onStudySetupTabChange
}: ResearcherProps) {
  const selectedStudy = studies.find((study) => study.id === selectedStudyId);

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
        <nav className="researcher-workspace-nav" aria-label="Researcher workspaces">
          {researcherWorkspaces.map((workspace) => (
            <button
              aria-current={activeResearcherWorkspace === workspace.id ? "page" : undefined}
              className={
                activeResearcherWorkspace === workspace.id
                  ? "workspace-nav-button active-workspace-nav-button"
                  : "workspace-nav-button"
              }
              key={workspace.id}
              onClick={() => onResearcherWorkspaceChange(workspace.id)}
              type="button"
            >
              {workspace.label}
            </button>
          ))}
        </nav>
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
            {activeResearcherWorkspace === "builder" ? (
              <SurveyBuilderWorkspace
                activeStudySetupTab={activeStudySetupTab}
                consentPanel={consentPanel}
                scoringPanel={scoringPanel}
                selectedStudy={selectedStudy}
                shellPanel={shellPanel}
                surveyPanel={surveyPanel}
                onStudySetupTabChange={onStudySetupTabChange}
              />
            ) : null}
            {activeResearcherWorkspace === "operations" ? (
              <>
                <div className="workspace-heading">
                  <p className="eyebrow">Run operations</p>
                  <h2>Participants and active runs</h2>
                </div>
                {operationsPanel}
              </>
            ) : null}
            {activeResearcherWorkspace === "analysis" ? (
              <>
                <div className="workspace-heading">
                  <p className="eyebrow">Analysis</p>
                  <h2>Completed run review</h2>
                </div>
                {analysisPanel}
              </>
            ) : null}
          </div>
        </div>
      </section>
      {dialogs}
    </main>
  );
}
