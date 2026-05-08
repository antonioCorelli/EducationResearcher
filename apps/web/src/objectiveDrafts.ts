export interface ObjectiveDraft {
  readonly objectiveKey?: string;
  readonly title: string;
  readonly description: string;
  readonly customScoringPrompt: string;
  readonly gradeLabels: readonly string[];
  readonly gradeExamples: readonly {
    readonly gradeLabel: string;
    readonly exampleText: string;
  }[];
  readonly evidenceRequirements: string;
}

export function getDuplicateGradeLabelError(objectives: readonly ObjectiveDraft[]) {
  for (const [objectiveIndex, objective] of objectives.entries()) {
    const seenLabels = new Set<string>();

    for (const label of objective.gradeLabels) {
      const normalizedLabel = label.trim().toLowerCase();

      if (!normalizedLabel) {
        continue;
      }

      if (seenLabels.has(normalizedLabel)) {
        return `Objective ${objectiveIndex + 1} grade labels must be unique. "${label.trim()}" is already used.`;
      }

      seenLabels.add(normalizedLabel);
    }
  }

  return "";
}
