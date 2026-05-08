import { describe, expect, it } from "vitest";

import { getDuplicateGradeLabelError, type ObjectiveDraft } from "./objectiveDrafts";

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
