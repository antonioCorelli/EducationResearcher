import { describe, expect, it } from "vitest";

import {
  buildScopedObjectiveDraftsForSave,
  getDuplicateGradeLabelError,
  replaceObjectiveDraft,
  type ObjectiveDraft,
  type ObjectiveVersionDraftSource
} from "./objectiveDrafts";

function createDraft(gradeLabels: readonly string[]): ObjectiveDraft {
  return {
    title: "Research objective",
    description: "Measure the learner response.",
    customScoringPrompt: "",
    gradeLabels,
    gradeExamples: [],
    evidenceRequirements: "Use transcript evidence."
  };
}

describe("objective draft grade labels", () => {
  it("rejects assigning a grade label that already exists", () => {
    expect(getDuplicateGradeLabelError([createDraft(["1", "2", "2"])])).toBe(
      'Objective 1 grade labels must be unique. "2" is already used.'
    );
  });

  it("treats whitespace and case variants as duplicate grade labels", () => {
    expect(getDuplicateGradeLabelError([createDraft(["Emerging", " developing ", "emerging"])])).toBe(
      'Objective 1 grade labels must be unique. "emerging" is already used.'
    );
  });

  it("allows unique grade labels", () => {
    expect(getDuplicateGradeLabelError([createDraft(["1", "2", "3", "4"])])).toBe("");
  });
});

describe("objective draft version scoping", () => {
  const activeVersions: readonly ObjectiveVersionDraftSource[] = [
    {
      objectiveKey: "objective_one",
      title: "Objective One",
      description: "Active first objective.",
      gradeScale: ["1", "2"],
      gradeExamples: [],
      evidenceRequirements: "First evidence.",
      sortOrder: 1
    },
    {
      objectiveKey: "objective_two",
      title: "Objective Two",
      description: "Active second objective.",
      gradeScale: ["1", "2"],
      gradeExamples: [],
      evidenceRequirements: "Second evidence.",
      sortOrder: 2
    }
  ];

  it("builds a save payload that versions only the selected objective draft", () => {
    const drafts: readonly ObjectiveDraft[] = [
      {
        ...createDraft(["low", "high"]),
        objectiveKey: "objective_one",
        title: "Objective One",
        description: "Unsaved first objective change."
      },
      {
        ...createDraft(["low", "high"]),
        objectiveKey: "objective_two",
        title: "Objective Two",
        description: "Selected second objective change."
      }
    ];

    expect(buildScopedObjectiveDraftsForSave(drafts, activeVersions, 1)).toMatchObject([
      {
        objectiveKey: "objective_one",
        description: "Active first objective."
      },
      {
        objectiveKey: "objective_two",
        description: "Selected second objective change."
      }
    ]);
  });

  it("switches a version into only the selected objective draft", () => {
    const drafts: readonly ObjectiveDraft[] = [
      { ...createDraft(["1", "2"]), objectiveKey: "objective_one", description: "Keep this draft." },
      { ...createDraft(["1", "2"]), objectiveKey: "objective_two", description: "Replace this draft." }
    ];

    expect(replaceObjectiveDraft(drafts, 1, activeVersions[1])).toMatchObject([
      {
        objectiveKey: "objective_one",
        description: "Keep this draft."
      },
      {
        objectiveKey: "objective_two",
        description: "Active second objective."
      }
    ]);
  });
});
