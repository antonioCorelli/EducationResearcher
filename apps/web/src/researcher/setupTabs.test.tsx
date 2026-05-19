import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ObjectiveVersion, StudyShell, SurveyVersion } from "../App";
import { ResearcherInterview } from "./interview";
import { createEmptyObjectiveDraft, ResearcherScoring } from "./scoring";
import { ResearcherShell } from "./shell";
import { createSurveyItemsFromVersion, ResearcherSurvey } from "./survey";

const noop = () => undefined;

const fixtureStudy: StudyShell = {
  id: "study_fixture_001",
  title: "Thinking Strategies",
  description: "Explores how learners explain their reasoning.",
  defaultFreshnessDays: 14,
  interviewerGoals: "Clarify where learners got stuck and elicit concrete examples.",
  defaultMaxInterviewMinutes: 45,
  activePersonaVersionId: "persona_version_v1_default_001",
  persona: {
    label: "V1 default research interviewer",
    stylePrompt: "Prompt",
    locked: true
  }
};

const fixtureSurveyVersion: SurveyVersion = {
  id: "survey_version_002",
  studyId: fixtureStudy.id,
  versionNumber: 2,
  isActive: true,
  groups: [],
  ungroupedQuestions: [
    {
      id: "survey_question_001",
      surveyVersionId: "survey_version_002",
      prompt: "What helped you reason through the problem?",
      required: true,
      questionType: "long_text",
      sortOrder: 1,
      createdAt: "2026-05-18T12:00:00.000Z"
    }
  ],
  createdAt: "2026-05-18T12:00:00.000Z"
};

function createObjectiveVersion(patch: Partial<ObjectiveVersion>): ObjectiveVersion {
  return {
    id: "objective_version_001",
    studyId: fixtureStudy.id,
    objectiveKey: "reasoning_quality",
    versionNumber: 1,
    title: "Reasoning quality",
    description: "Measures reasoning quality.",
    gradeScale: ["1", "2", "3", "4"],
    gradeExamples: [],
    evidenceRequirements: "Use survey and interview evidence.",
    sortOrder: 1,
    isEnabled: true,
    isActive: true,
    createdAt: "2026-05-18T12:00:00.000Z",
    ...patch
  };
}

describe("researcher setup tab information", () => {
  it("shows the study persona version and setup guidance", () => {
    const markup = renderToStaticMarkup(
      <ResearcherShell
        activeStudySetupTab="shell"
        freshnessDays={14}
        isSavingStudy={false}
        selectedStudy={fixtureStudy}
        studyError=""
        studyDescription="Explores how learners explain their reasoning."
        studyTitle="Thinking Strategies"
        studyTitleFocusRequest={0}
        onFreshnessDaysChange={noop}
        onSaveStudy={noop}
        onStudyDescriptionChange={noop}
        onStudyTitleChange={noop}
      />
    );

    expect(markup).toContain("Name the study and set the freshness window");
    expect(markup).toContain("Study description");
    expect(markup).toContain("Optional: summarize the study context");
    expect(markup).toContain("Freshness days");
    expect(markup).not.toContain("Interviewer persona");
    expect(markup).not.toContain("Interview minutes");
  });

  it("shows locked interview settings in the interview information tab", () => {
    const markup = renderToStaticMarkup(
      <ResearcherInterview
        activeStudySetupTab="interview"
        interviewerGoals="Clarify where learners got stuck and elicit concrete examples."
        isSavingStudy={false}
        maxInterviewMinutes={45}
        selectedStudy={fixtureStudy}
        studyError=""
        onInterviewerGoalsChange={noop}
        onMaxInterviewMinutesChange={noop}
        onSaveStudy={noop}
      />
    );

    expect(markup).toContain("Interview information");
    expect(markup).toContain("Interview minutes");
    expect(markup).toContain("Interviewer goals");
    expect(markup).toContain("concepts to clarify");
    expect(markup).toContain("Interviewer persona");
    expect(markup).toContain("Locked Persona Version 1");
    expect(markup).toContain("V1 default research interviewer");
  });

  it("shows the survey version and explains versioned survey edits", () => {
    const markup = renderToStaticMarkup(
      <ResearcherSurvey
        activeStudySetupTab="survey"
        activeSurveyVersion={fixtureSurveyVersion}
        isPreviewingPreviousSurvey={false}
        isSavingSurvey={false}
        selectedStudy={fixtureStudy}
        selectedSurveyVersion={fixtureSurveyVersion}
        selectedSurveyVersionNumber={fixtureSurveyVersion.versionNumber}
        surveyError=""
        surveyItems={createSurveyItemsFromVersion(fixtureSurveyVersion)}
        surveyState={{ status: "ready", activeSurveyVersion: fixtureSurveyVersion, surveyVersions: [fixtureSurveyVersion] }}
        onAddGroupedQuestion={noop}
        onAddSurveyGroup={noop}
        onAddSurveyQuestion={noop}
        onMoveSurveyItem={noop}
        onRemoveGroupedQuestion={noop}
        onRemoveSurveyItem={noop}
        onSaveSurvey={noop}
        onSelectSurveyVersion={noop}
        onUpdateGroupedQuestion={noop}
        onUpdateSurveyGroupTitle={noop}
        onUpdateSurveyQuestion={noop}
      />
    );

    expect(markup).toContain("Version 2");
    expect(markup).toContain("Survey edits create a new version");
    expect(markup).toContain("existing runs keep the version they were assigned");
  });

  it("summarizes scoring objective versions and explains their downstream use", () => {
    const objectiveVersions = [
      createObjectiveVersion({ id: "objective_version_001", objectiveKey: "reasoning_quality", versionNumber: 1 }),
      createObjectiveVersion({
        id: "objective_version_002",
        objectiveKey: "evidence_quality",
        title: "Evidence quality",
        versionNumber: 2,
        sortOrder: 2
      })
    ];

    const markup = renderToStaticMarkup(
      <ResearcherScoring
        activeObjectiveVersions={objectiveVersions}
        activeStudySetupTab="objectives"
        duplicateGradeLabelError=""
        isPreviewingPreviousObjective={false}
        isSavingObjectives={false}
        objectiveDrafts={[createEmptyObjectiveDraft()]}
        objectiveError=""
        objectiveState={{
          status: "ready",
          activeObjectiveVersions: objectiveVersions,
          enabledObjectiveVersions: objectiveVersions,
          objectiveVersions
        }}
        selectedObjectiveVersionIds={{}}
        selectedStudy={fixtureStudy}
        onAddObjective={noop}
        onAddObjectiveGradeExample={noop}
        onAddObjectiveGradeLabel={noop}
        onMoveObjective={noop}
        onRemoveObjective={noop}
        onRemoveObjectiveGradeExample={noop}
        onRemoveObjectiveGradeLabel={noop}
        onSaveObjectiveVersion={noop}
        onSaveObjectives={noop}
        onSelectObjectiveVersion={noop}
        onUpdateObjective={noop}
        onUpdateObjectiveGradeExample={noop}
        onUpdateObjectiveGradeLabel={noop}
      />
    );

    expect(markup).toContain("Versions 1-2");
    expect(markup).toContain("2 enabled");
    expect(markup).toContain("used by the gap map, interview, and scoring pass");
    expect(markup).toContain("prior runs keep the versions they used");
  });
});
