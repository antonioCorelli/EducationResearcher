import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ResearcherWorkspace } from "./App";
import { Researcher } from "./researcher";

const noop = () => undefined;

function renderResearcher(activeResearcherWorkspace: ResearcherWorkspace) {
  return renderToStaticMarkup(
    <Researcher
      activeResearcherWorkspace={activeResearcherWorkspace}
      activeStudySetupTab="shell"
      analysisPanel={<div>ANALYSIS PANEL</div>}
      consentPanel={<div>CONSENT PANEL</div>}
      dialogs={null}
      interviewPanel={<div>INTERVIEW PANEL</div>}
      isWelcomePersonalizationRequired={false}
      operationsPanel={<div>OPERATIONS PANEL</div>}
      scoringPanel={<div>SCORING PANEL</div>}
      selectedStudyId="study_fixture_001"
      shellPanel={<div>SHELL PANEL</div>}
      studies={[
        {
          id: "study_fixture_001",
          title: "Thinking Strategies",
          description: "Explores how learners explain their reasoning.",
          defaultFreshnessDays: 14,
          defaultMaxInterviewMinutes: 45,
          activePersonaVersionId: "persona_version_v1_default_001",
          persona: {
            label: "V1 default research interviewer",
            stylePrompt: "Prompt",
            locked: true
          }
        }
      ]}
      studiesState={{ status: "ready", studies: [] }}
      surveyPanel={<div>SURVEY PANEL</div>}
      user={{ id: "user_fixture_001", email: "researcher@example.test", displayName: "Researcher", role: "researcher" }}
      onConfirmWelcomeName={noop}
      onLoadStudyForm={noop}
      onResearcherWorkspaceChange={noop}
      onResetStudyForm={noop}
      onSignOut={noop}
      onStudySetupTabChange={noop}
    />
  );
}

describe("Researcher", () => {
  it("shows only the centered welcome name prompt before the first workspace reveal", () => {
    const markup = renderToStaticMarkup(
      <Researcher
        activeResearcherWorkspace="builder"
        activeStudySetupTab="shell"
        analysisPanel={<div>ANALYSIS PANEL</div>}
        consentPanel={<div>CONSENT PANEL</div>}
        dialogs={null}
        interviewPanel={<div>INTERVIEW PANEL</div>}
        isWelcomePersonalizationRequired={true}
        operationsPanel={<div>OPERATIONS PANEL</div>}
        scoringPanel={<div>SCORING PANEL</div>}
        selectedStudyId="study_fixture_001"
        shellPanel={<div>SHELL PANEL</div>}
        studies={[]}
        studiesState={{ status: "ready", studies: [] }}
        surveyPanel={<div>SURVEY PANEL</div>}
        user={{ id: "user_fixture_001", email: "researcher@example.test", displayName: "Researcher", role: "researcher" }}
        onConfirmWelcomeName={noop}
        onLoadStudyForm={noop}
        onResearcherWorkspaceChange={noop}
        onResetStudyForm={noop}
        onSignOut={noop}
        onStudySetupTabChange={noop}
      />
    );

    expect(markup).toContain("Welcome,");
    expect(markup).toContain("value=\"Researcher\"");
    expect(markup).toContain("First name, nickname, lab handle");
    expect(markup).not.toContain("Researcher workspace");
    expect(markup).not.toContain("Survey Builder");
    expect(markup).not.toContain("Studies");
    expect(markup).not.toContain("SHELL PANEL");
  });

  it("shows only the survey builder panels in the builder workspace", () => {
    const markup = renderResearcher("builder");

    expect(markup).toContain("study-list-panel");
    expect(markup).toContain("<select");
    expect(markup).toContain("Survey builder");
    expect(markup).toContain("SHELL PANEL");
    expect(markup).toContain("CONSENT PANEL");
    expect(markup).toContain("SURVEY PANEL");
    expect(markup).toContain("INTERVIEW PANEL");
    expect(markup).not.toContain("SCORING PANEL");
    expect(markup).not.toContain("Scoring objectives</button>");
    expect(markup).not.toContain("study-row");
    expect(markup).not.toContain("OPERATIONS PANEL");
    expect(markup).not.toContain("ANALYSIS PANEL");
  });

  it("places the study selector in the welcome heading before the workspace tabs", () => {
    const markup = renderResearcher("builder");

    expect(markup.indexOf("researcher-welcome-heading")).toBeLessThan(markup.indexOf("study-list-panel"));
    expect(markup.indexOf("study-list-panel")).toBeLessThan(markup.indexOf("researcher-workspace-nav"));
    expect(markup.indexOf("researcher-workspace-nav")).toBeLessThan(markup.indexOf("study-workspace"));
  });

  it("renders the confirmed welcome name as editable text", () => {
    const markup = renderResearcher("builder");

    expect(markup).toContain("researcher-welcome-name-button");
    expect(markup).toContain("aria-label=\"Edit welcome name\"");
    expect(markup).toContain("<span>Researcher</span>");
    expect(markup).not.toContain("welcome-name-edit-confirmation");
  });

  it("shows only run operations when that workspace is active", () => {
    const markup = renderResearcher("operations");

    expect(markup).toContain("Run operations");
    expect(markup).toContain("OPERATIONS PANEL");
    expect(markup).not.toContain("SHELL PANEL");
    expect(markup).not.toContain("ANALYSIS PANEL");
  });

  it("shows only completed run analysis when that workspace is active", () => {
    const markup = renderResearcher("analysis");

    expect(markup).toContain("Scoring objectives and completed run review");
    expect(markup).toContain("SCORING PANEL");
    expect(markup).toContain("ANALYSIS PANEL");
    expect(markup).not.toContain("SHELL PANEL");
    expect(markup).not.toContain("OPERATIONS PANEL");
  });
});
