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
      operationsPanel={<div>OPERATIONS PANEL</div>}
      scoringPanel={<div>SCORING PANEL</div>}
      selectedStudyId="study_fixture_001"
      shellPanel={<div>SHELL PANEL</div>}
      studies={[
        {
          id: "study_fixture_001",
          title: "Thinking Strategies",
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
      onLoadStudyForm={noop}
      onResearcherWorkspaceChange={noop}
      onResetStudyForm={noop}
      onSignOut={noop}
      onStudySetupTabChange={noop}
    />
  );
}

describe("Researcher", () => {
  it("shows only the survey builder panels in the builder workspace", () => {
    const markup = renderResearcher("builder");

    expect(markup).toContain("Study materials");
    expect(markup).toContain("SHELL PANEL");
    expect(markup).toContain("CONSENT PANEL");
    expect(markup).toContain("SURVEY PANEL");
    expect(markup).toContain("SCORING PANEL");
    expect(markup).not.toContain("OPERATIONS PANEL");
    expect(markup).not.toContain("ANALYSIS PANEL");
  });

  it("shows only run operations when that workspace is active", () => {
    const markup = renderResearcher("operations");

    expect(markup).toContain("Participants");
    expect(markup).toContain("OPERATIONS PANEL");
    expect(markup).not.toContain("SHELL PANEL");
    expect(markup).not.toContain("ANALYSIS PANEL");
  });

  it("shows only completed run analysis when that workspace is active", () => {
    const markup = renderResearcher("analysis");

    expect(markup).toContain("Completed run review");
    expect(markup).toContain("ANALYSIS PANEL");
    expect(markup).not.toContain("SHELL PANEL");
    expect(markup).not.toContain("OPERATIONS PANEL");
  });
});
