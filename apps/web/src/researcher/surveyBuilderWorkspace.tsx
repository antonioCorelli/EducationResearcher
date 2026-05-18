import type { ReactNode } from "react";

import type { StudySetupTab, StudyShell } from "../App";

const studySetupTabs: readonly { readonly id: StudySetupTab; readonly label?: string }[] = [
  { id: "shell", label: "New Study" },
  { id: "consent", label: "Consent information" },
  { id: "survey", label: "Survey information" },
  { id: "objectives", label: "Scoring objectives" }
];

interface SurveyBuilderWorkspaceProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly selectedStudy: StudyShell | undefined;
  readonly shellPanel: ReactNode;
  readonly consentPanel: ReactNode;
  readonly surveyPanel: ReactNode;
  readonly scoringPanel: ReactNode;
  readonly onStudySetupTabChange: (tab: StudySetupTab) => void;
}

export function SurveyBuilderWorkspace({
  activeStudySetupTab,
  selectedStudy,
  shellPanel,
  consentPanel,
  surveyPanel,
  scoringPanel,
  onStudySetupTabChange
}: SurveyBuilderWorkspaceProps) {
  const shellTabLabel = selectedStudy ? ("Study: " + selectedStudy.title).slice(0, 15) : "New Study";

  return (
    <>
      <div className="workspace-heading">
        <p className="eyebrow">Survey builder</p>
        <h2>Study materials</h2>
      </div>
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
            {tab.id === "shell" ? shellTabLabel : tab.label}
          </button>
        ))}
      </div>
      {shellPanel}
      {consentPanel}
      {surveyPanel}
      {scoringPanel}
    </>
  );
}
