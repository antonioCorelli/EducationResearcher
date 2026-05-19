import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ResearcherWorkspace, SessionUser, StudiesState, StudySetupTab, StudyShell } from "./App";
import { SurveyBuilderWorkspace } from "./researcher/surveyBuilderWorkspace";

const researcherWorkspaces: readonly { readonly id: ResearcherWorkspace; readonly label: string }[] = [
  { id: "builder", label: "Build" },
  { id: "operations", label: "Conduct" },
  { id: "analysis", label: "Analyze" }
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
  readonly interviewPanel: ReactNode;
  readonly scoringPanel: ReactNode;
  readonly operationsPanel: ReactNode;
  readonly analysisPanel: ReactNode;
  readonly dialogs: ReactNode;
  readonly isWelcomePersonalizationRequired: boolean;
  readonly onSignOut: () => void;
  readonly onConfirmWelcomeName: (displayName: string) => void;
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
  interviewPanel,
  scoringPanel,
  operationsPanel,
  analysisPanel,
  dialogs,
  isWelcomePersonalizationRequired,
  onSignOut,
  onConfirmWelcomeName,
  onResetStudyForm,
  onLoadStudyForm,
  onResearcherWorkspaceChange,
  onStudySetupTabChange
}: ResearcherProps) {
  const [welcomeName, setWelcomeName] = useState(isWelcomePersonalizationRequired ? "Researcher" : user.displayName);
  const [hasEditedWelcomeName, setHasEditedWelcomeName] = useState(false);
  const [hasStartedWelcomeReveal, setHasStartedWelcomeReveal] = useState(false);
  const [isEditingWelcomeName, setIsEditingWelcomeName] = useState(false);
  const welcomeInputRef = useRef<HTMLInputElement>(null);
  const isFirstRunWelcome = isWelcomePersonalizationRequired && !hasStartedWelcomeReveal;
  const isWorkspaceReady = !isWelcomePersonalizationRequired || hasStartedWelcomeReveal;
  const isEditingConfirmedWelcomeName = isWorkspaceReady && isEditingWelcomeName;
  const isEditingAnyWelcomeName = isFirstRunWelcome || isEditingConfirmedWelcomeName;
  const trimmedWelcomeName = welcomeName.trim();
  const canConfirmWelcomeName = trimmedWelcomeName.length > 0 && (!isFirstRunWelcome || hasEditedWelcomeName);

  useEffect(() => {
    if (!isWelcomePersonalizationRequired) {
      return;
    }

    setWelcomeName("Researcher");
    setHasEditedWelcomeName(false);
    setHasStartedWelcomeReveal(false);
    setIsEditingWelcomeName(false);
  }, [isWelcomePersonalizationRequired, user.id]);

  useEffect(() => {
    if (!isEditingAnyWelcomeName) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      welcomeInputRef.current?.focus();
      welcomeInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isEditingAnyWelcomeName]);

  useEffect(() => {
    if (isWelcomePersonalizationRequired || isEditingWelcomeName) {
      return;
    }

    setWelcomeName(user.displayName);
    setHasEditedWelcomeName(false);
  }, [isEditingWelcomeName, isWelcomePersonalizationRequired, user.displayName]);

  function startEditingWelcomeName() {
    setWelcomeName(user.displayName);
    setHasEditedWelcomeName(false);
    setIsEditingWelcomeName(true);
  }

  function cancelWelcomeNameEdit() {
    setWelcomeName(user.displayName);
    setHasEditedWelcomeName(false);
    setIsEditingWelcomeName(false);
  }

  function confirmWelcomeName() {
    const displayName = trimmedWelcomeName;

    if (!canConfirmWelcomeName || !displayName) {
      return;
    }

    if (isFirstRunWelcome) {
      setHasStartedWelcomeReveal(true);
      onConfirmWelcomeName(displayName);
      return;
    }

    setIsEditingWelcomeName(false);
    setHasEditedWelcomeName(false);

    if (displayName !== user.displayName) {
      onConfirmWelcomeName(displayName);
    }
  }

  function loadSelectedStudy(studyId: string) {
    const study = studies.find((availableStudy) => availableStudy.id === studyId);

    if (study) {
      onLoadStudyForm(study);
    }
  }

  return (
    <main className="app-shell researcher-shell">
      <section
        className={[
          "workspace-panel researcher-workspace",
          isFirstRunWelcome ? "researcher-welcome-intro" : "",
          hasStartedWelcomeReveal ? "researcher-welcome-confirmed" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        aria-labelledby="researcher-title"
      >
        <div className="researcher-welcome-stage">
          {isWorkspaceReady ? (
            <div className="topline researcher-workspace-topline">
              <p className="eyebrow">Researcher workspace</p>
              <button className="secondary-button" type="button" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          ) : null}
          <div className="researcher-welcome-heading">
            <h1 className="researcher-welcome-title" id="researcher-title">
              <span>Welcome,</span>
              {isEditingAnyWelcomeName ? (
                <input
                  aria-describedby={isFirstRunWelcome ? "welcome-name-hint" : undefined}
                  aria-label="Preferred welcome name"
                  className="researcher-welcome-name-input"
                  onChange={(event) => {
                    setWelcomeName(event.target.value);
                    setHasEditedWelcomeName(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      confirmWelcomeName();
                    }

                    if (event.key === "Escape" && isEditingConfirmedWelcomeName) {
                      event.preventDefault();
                      cancelWelcomeNameEdit();
                    }
                  }}
                  ref={welcomeInputRef}
                  value={welcomeName}
                />
              ) : (
                <button
                  aria-label="Edit welcome name"
                  className="researcher-welcome-name-button"
                  onClick={startEditingWelcomeName}
                  type="button"
                >
                  <span>{user.displayName}</span>
                </button>
              )}
            </h1>
            {isWorkspaceReady ? (
              <div className="study-list-panel">
                <label className="study-selector-label">
                  <span>Study</span>
                  <select
                    disabled={studiesState.status === "loading" || studies.length === 0}
                    onChange={(event) => loadSelectedStudy(event.target.value)}
                    value={selectedStudyId ?? ""}
                  >
                    {selectedStudyId ? null : <option value="">Select a study</option>}
                    {studies.length === 0 ? <option value="">No studies yet</option> : null}
                    {studies.map((study) => (
                      <option key={study.id} value={study.id}>
                        {study.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="secondary-button compact-button" type="button" onClick={onResetStudyForm}>
                  Create New Study
                </button>
                {studiesState.status === "loading" ? <p className="muted-copy study-list-status">Loading studies</p> : null}
                {studiesState.status === "error" ? <p className="form-error study-list-status">{studiesState.message}</p> : null}
                {studies.length === 0 && studiesState.status === "ready" ? (
                  <p className="muted-copy study-list-status">No studies yet</p>
                ) : null}
              </div>
            ) : null}
            {isFirstRunWelcome ? (
              <div className="welcome-name-confirmation">
                <p className="muted-copy" id="welcome-name-hint">
                  First name, nickname, lab handle. Whatever feels useful here.
                </p>
                <button
                  className={canConfirmWelcomeName ? "primary-button welcome-confirm-button visible" : "primary-button welcome-confirm-button"}
                  disabled={!canConfirmWelcomeName}
                  onClick={confirmWelcomeName}
                  type="button"
                >
                  Confirm
                </button>
              </div>
            ) : null}
            {isEditingConfirmedWelcomeName ? (
              <div className="welcome-name-confirmation welcome-name-edit-confirmation">
                <button
                  className="primary-button compact-button welcome-confirm-button visible"
                  disabled={!canConfirmWelcomeName}
                  onClick={confirmWelcomeName}
                  type="button"
                >
                  Confirm
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {isWorkspaceReady ? (
          <div className="researcher-workspace-content">
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
              <div className="setup-stack">
                {activeResearcherWorkspace === "builder" ? (
                  <SurveyBuilderWorkspace
                    activeStudySetupTab={activeStudySetupTab}
                    consentPanel={consentPanel}
                    interviewPanel={interviewPanel}
                    shellPanel={shellPanel}
                    surveyPanel={surveyPanel}
                    onStudySetupTabChange={onStudySetupTabChange}
                  />
                ) : null}
                {activeResearcherWorkspace === "operations" ? (
                  <>
                    <div className="workspace-heading">
                      <p className="eyebrow">Run operations</p>
                    </div>
                    {operationsPanel}
                  </>
                ) : null}
                {activeResearcherWorkspace === "analysis" ? (
                  <>
                    <div className="workspace-heading">
                      <p className="eyebrow">Analysis</p>
                      <h2>Scoring objectives and completed run review</h2>
                    </div>
                    {scoringPanel}
                    {analysisPanel}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>
      {dialogs}
    </main>
  );
}
