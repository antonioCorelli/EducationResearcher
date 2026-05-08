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

export interface ObjectiveVersionDraftSource {
  readonly objectiveKey: string;
  readonly title: string;
  readonly description: string;
  readonly customScoringPrompt?: string;
  readonly gradeScale: readonly string[];
  readonly gradeExamples: readonly {
    readonly gradeLabel: string;
    readonly exampleText: string;
    readonly sortOrder: number;
  }[];
  readonly evidenceRequirements: string;
  readonly sortOrder: number;
}

export function createObjectiveDraftFromVersion(version: ObjectiveVersionDraftSource): ObjectiveDraft {
  return {
    objectiveKey: version.objectiveKey,
    title: version.title,
    description: version.description,
    customScoringPrompt: version.customScoringPrompt ?? "",
    gradeLabels: version.gradeScale,
    gradeExamples: [...version.gradeExamples]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((example) => ({
        gradeLabel: example.gradeLabel,
        exampleText: example.exampleText
      })),
    evidenceRequirements: version.evidenceRequirements
  };
}

export function replaceObjectiveDraft(
  drafts: readonly ObjectiveDraft[],
  objectiveIndex: number,
  version: ObjectiveVersionDraftSource
) {
  return drafts.map((draft, currentIndex) =>
    currentIndex === objectiveIndex ? createObjectiveDraftFromVersion(version) : draft
  );
}

export function buildScopedObjectiveDraftsForSave(
  drafts: readonly ObjectiveDraft[],
  activeVersions: readonly ObjectiveVersionDraftSource[],
  objectiveIndex: number
) {
  const targetDraft = drafts[objectiveIndex];
  const scopedDrafts = [...activeVersions]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(createObjectiveDraftFromVersion);

  if (!targetDraft) {
    return scopedDrafts;
  }

  if (!targetDraft.objectiveKey) {
    return [...scopedDrafts, targetDraft];
  }

  const matchingDraftIndex = scopedDrafts.findIndex((draft) => draft.objectiveKey === targetDraft.objectiveKey);

  if (matchingDraftIndex === -1) {
    return [...scopedDrafts, targetDraft];
  }

  return scopedDrafts.map((draft, currentIndex) => (currentIndex === matchingDraftIndex ? targetDraft : draft));
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
