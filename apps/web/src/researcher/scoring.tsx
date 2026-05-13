import type { FormEvent } from "react";

import { createObjectiveDraftFromVersion, type ObjectiveDraft } from "../objectiveDrafts";
import type { ObjectiveState, ObjectiveVersion, StudySetupTab, StudyShell } from "../App";

export function createEmptyObjectiveDraft(): ObjectiveDraft {
  return {
    title: "",
    description: "",
    customScoringPrompt: "",
    gradeLabels: ["1", "2", "3", "4"],
    gradeExamples: [],
    evidenceRequirements: "",
    isEnabled: true
  };
}

export function createObjectiveDraftsFromVersions(objectiveVersions: readonly ObjectiveVersion[]) {
  return objectiveVersions.length > 0
    ? [...objectiveVersions].sort((left, right) => left.sortOrder - right.sortOrder).map(createObjectiveDraftFromVersion)
    : [createEmptyObjectiveDraft()];
}

interface ResearcherScoringProps {
  readonly activeObjectiveVersions: readonly ObjectiveVersion[];
  readonly activeStudySetupTab: StudySetupTab;
  readonly duplicateGradeLabelError: string;
  readonly isPreviewingPreviousObjective: boolean;
  readonly isSavingObjectives: boolean;
  readonly objectiveDrafts: readonly ObjectiveDraft[];
  readonly objectiveError: string;
  readonly objectiveState: ObjectiveState;
  readonly selectedObjectiveVersionIds: Readonly<Record<string, string>>;
  readonly selectedStudy: StudyShell | undefined;
  readonly onAddObjective: () => void;
  readonly onAddObjectiveGradeExample: (objectiveIndex: number) => void;
  readonly onAddObjectiveGradeLabel: (objectiveIndex: number) => void;
  readonly onMoveObjective: (index: number, direction: -1 | 1) => void;
  readonly onRemoveObjective: (index: number) => void;
  readonly onRemoveObjectiveGradeExample: (objectiveIndex: number, exampleIndex: number) => void;
  readonly onRemoveObjectiveGradeLabel: (objectiveIndex: number, gradeIndex: number) => void;
  readonly onSaveObjectiveVersion: (objectiveIndex: number) => void;
  readonly onSaveObjectives: (event: FormEvent<HTMLFormElement>) => void;
  readonly onSelectObjectiveVersion: (objectiveIndex: number, objectiveVersion: ObjectiveVersion) => void;
  readonly onUpdateObjective: (index: number, patch: Partial<ObjectiveDraft>) => void;
  readonly onUpdateObjectiveGradeExample: (
    objectiveIndex: number,
    exampleIndex: number,
    patch: Partial<ObjectiveDraft["gradeExamples"][number]>
  ) => void;
  readonly onUpdateObjectiveGradeLabel: (objectiveIndex: number, gradeIndex: number, label: string) => void;
}

export function ResearcherScoring({
  activeObjectiveVersions,
  activeStudySetupTab,
  duplicateGradeLabelError,
  isPreviewingPreviousObjective,
  isSavingObjectives,
  objectiveDrafts,
  objectiveError,
  objectiveState,
  selectedObjectiveVersionIds,
  selectedStudy,
  onAddObjective,
  onAddObjectiveGradeExample,
  onAddObjectiveGradeLabel,
  onMoveObjective,
  onRemoveObjective,
  onRemoveObjectiveGradeExample,
  onRemoveObjectiveGradeLabel,
  onSaveObjectiveVersion,
  onSaveObjectives,
  onSelectObjectiveVersion,
  onUpdateObjective,
  onUpdateObjectiveGradeExample,
  onUpdateObjectiveGradeLabel
}: ResearcherScoringProps) {
  return (
    <form
      aria-labelledby="study-setup-tab-objectives"
      className="study-form study-setup-panel"
      hidden={activeStudySetupTab !== "objectives"}
      id="study-setup-panel-objectives"
      onSubmit={onSaveObjectives}
      role="tabpanel"
    >
      <div className="section-heading">
        <h2>Scoring objectives</h2>
        {activeObjectiveVersions.length > 0 ? (
          <span className="version-pill">
            {(objectiveState.status === "ready" ? objectiveState.enabledObjectiveVersions?.length : undefined) ??
              activeObjectiveVersions.filter((version) => version.isEnabled !== false).length}{" "}
            enabled
          </span>
        ) : null}
      </div>
      <div className="objective-list">
        {objectiveDrafts.map((objective, objectiveIndex) => {
          const objectiveKey = objective.objectiveKey;
          const objectiveVersions =
            objectiveState.status === "ready" && objectiveKey
              ? objectiveState.objectiveVersions.filter((version) => version.objectiveKey === objectiveKey)
              : [];
          const selectedObjectiveCardVersion =
            objectiveKey && objectiveState.status === "ready"
              ? objectiveState.objectiveVersions.find((version) => version.id === selectedObjectiveVersionIds[objectiveKey])
              : undefined;
          const isPreviewingObjectiveVersion = Boolean(selectedObjectiveCardVersion && !selectedObjectiveCardVersion.isActive);

          return (
            <div
              className={objective.isEnabled ? "objective-editor" : "objective-editor disabled-objective-editor"}
              key={`objective-${objective.objectiveKey ?? objectiveIndex}`}
            >
              <div className="survey-item-toolbar">
                <div className="objective-title-row">
                  <h3>Objective {objectiveIndex + 1}</h3>
                  {objective.isEnabled ? null : <span className="disabled-objective-pill">Disabled for scoring</span>}
                </div>
                <div className="survey-item-actions">
                  <button
                    aria-label={`${objective.isEnabled ? "Disable" : "Enable"} objective ${objectiveIndex + 1} during final scoring`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingObjectiveVersion}
                    onClick={() => onUpdateObjective(objectiveIndex, { isEnabled: !objective.isEnabled })}
                    type="button"
                  >
                    {objective.isEnabled ? "Disable scoring" : "Enable scoring"}
                  </button>
                  <button
                    aria-label={`Move objective ${objectiveIndex + 1} up`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingObjectiveVersion || objectiveIndex === 0}
                    onClick={() => onMoveObjective(objectiveIndex, -1)}
                    type="button"
                  >
                    Up
                  </button>
                  <button
                    aria-label={`Move objective ${objectiveIndex + 1} down`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingObjectiveVersion || objectiveIndex === objectiveDrafts.length - 1}
                    onClick={() => onMoveObjective(objectiveIndex, 1)}
                    type="button"
                  >
                    Down
                  </button>
                  <button
                    aria-label={`Remove objective ${objectiveIndex + 1}`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingObjectiveVersion || objectiveDrafts.length === 1}
                    onClick={() => onRemoveObjective(objectiveIndex)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
              {objective.isEnabled ? null : (
                <p className="disabled-objective-copy">
                  This objective will stay in the researcher setup, but it will be skipped during final scoring.
                </p>
              )}
              <label>
                Title
                <input
                  disabled={!selectedStudy || isPreviewingObjectiveVersion}
                  maxLength={160}
                  onChange={(event) => onUpdateObjective(objectiveIndex, { title: event.target.value })}
                  placeholder={selectedStudy ? "Reasoning quality" : "Create or select a study first"}
                  type="text"
                  value={objective.title}
                />
              </label>
              <label>
                Description
                <textarea
                  disabled={!selectedStudy || isPreviewingObjectiveVersion}
                  maxLength={2000}
                  onChange={(event) => onUpdateObjective(objectiveIndex, { description: event.target.value })}
                  placeholder="What this objective should measure"
                  value={objective.description}
                />
              </label>
              <label>
                Evidence requirements
                <textarea
                  disabled={!selectedStudy || isPreviewingObjectiveVersion}
                  maxLength={2000}
                  onChange={(event) => onUpdateObjective(objectiveIndex, { evidenceRequirements: event.target.value })}
                  placeholder="What evidence should support the score"
                  value={objective.evidenceRequirements}
                />
              </label>
              <label>
                Custom scoring prompt
                <textarea
                  disabled={!selectedStudy || isPreviewingObjectiveVersion}
                  maxLength={4000}
                  onChange={(event) => onUpdateObjective(objectiveIndex, { customScoringPrompt: event.target.value })}
                  placeholder="Optional objective-specific scoring guidance"
                  value={objective.customScoringPrompt}
                />
              </label>
              <div className="rubric-grid">
                <div className="rubric-panel">
                  <div className="section-heading">
                    <h3>Grade labels</h3>
                    <button
                      className="secondary-button compact-button"
                      disabled={!selectedStudy || isPreviewingObjectiveVersion}
                      onClick={() => onAddObjectiveGradeLabel(objectiveIndex)}
                      type="button"
                    >
                      Add label
                    </button>
                  </div>
                  <div className="grade-label-list">
                    {objective.gradeLabels.length <= 2 ? (
                      <p className="rubric-help" id={`objective-${objectiveIndex}-minimum-grade-help`}>
                        You must have at least two grades.
                      </p>
                    ) : null}
                    {objective.gradeLabels.map((gradeLabel, gradeIndex) => (
                      <div className="grade-label-row" key={`objective-${objectiveIndex}-grade-${gradeIndex}`}>
                        <input
                          aria-label={`Objective ${objectiveIndex + 1} grade label ${gradeIndex + 1}`}
                          disabled={!selectedStudy || isPreviewingObjectiveVersion}
                          maxLength={40}
                          onChange={(event) => onUpdateObjectiveGradeLabel(objectiveIndex, gradeIndex, event.target.value)}
                          type="text"
                          value={gradeLabel}
                        />
                        <button
                          aria-describedby={objective.gradeLabels.length <= 2 ? `objective-${objectiveIndex}-minimum-grade-help` : undefined}
                          aria-label={`Remove objective ${objectiveIndex + 1} grade label ${gradeIndex + 1}`}
                          className="secondary-button compact-button"
                          disabled={!selectedStudy || isPreviewingObjectiveVersion || objective.gradeLabels.length <= 2}
                          onClick={() => onRemoveObjectiveGradeLabel(objectiveIndex, gradeIndex)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rubric-panel">
                  <div className="section-heading">
                    <h3>Grade examples</h3>
                    <button
                      className="secondary-button compact-button"
                      disabled={!selectedStudy || isPreviewingObjectiveVersion}
                      onClick={() => onAddObjectiveGradeExample(objectiveIndex)}
                      type="button"
                    >
                      Add example
                    </button>
                  </div>
                  <div className="grade-example-list">
                    {objective.gradeExamples.length === 0 ? <p className="muted-copy">No examples yet</p> : null}
                    {objective.gradeExamples.map((example, exampleIndex) => (
                      <div className="grade-example-row" key={`objective-${objectiveIndex}-example-${exampleIndex}`}>
                        <select
                          aria-label={`Objective ${objectiveIndex + 1} example ${exampleIndex + 1} grade label`}
                          disabled={!selectedStudy || isPreviewingObjectiveVersion}
                          onChange={(event) =>
                            onUpdateObjectiveGradeExample(objectiveIndex, exampleIndex, {
                              gradeLabel: event.target.value
                            })
                          }
                          value={example.gradeLabel}
                        >
                          {objective.gradeLabels.filter(Boolean).map((gradeLabel) => (
                            <option key={gradeLabel} value={gradeLabel}>
                              {gradeLabel}
                            </option>
                          ))}
                        </select>
                        <textarea
                          aria-label={`Objective ${objectiveIndex + 1} example ${exampleIndex + 1} text`}
                          disabled={!selectedStudy || isPreviewingObjectiveVersion}
                          maxLength={2000}
                          onChange={(event) =>
                            onUpdateObjectiveGradeExample(objectiveIndex, exampleIndex, {
                              exampleText: event.target.value
                            })
                          }
                          placeholder="Example evidence or response for this label"
                          value={example.exampleText}
                        />
                        <button
                          aria-label={`Remove objective ${objectiveIndex + 1} example ${exampleIndex + 1}`}
                          className="secondary-button compact-button"
                          disabled={!selectedStudy || isPreviewingObjectiveVersion}
                          onClick={() => onRemoveObjectiveGradeExample(objectiveIndex, exampleIndex)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="objective-version-controls">
                {objectiveVersions.length > 0 ? (
                  <div className="version-history" aria-label={`Objective ${objectiveIndex + 1} versions`}>
                    {objectiveVersions.map((version) => (
                      <button
                        aria-label={`${version.title} version ${version.versionNumber}`}
                        className={[
                          "version-chip",
                          version.isActive ? "active-version-chip" : "",
                          version.id === selectedObjectiveVersionIds[version.objectiveKey] ? "selected-version-chip" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={version.id}
                        onClick={() => onSelectObjectiveVersion(objectiveIndex, version)}
                        type="button"
                      >
                        v{version.versionNumber}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  className={isPreviewingObjectiveVersion ? "danger-button compact-button" : "primary-button compact-button"}
                  disabled={!selectedStudy || isSavingObjectives}
                  onClick={() => onSaveObjectiveVersion(objectiveIndex)}
                  type="button"
                >
                  {isSavingObjectives
                    ? isPreviewingObjectiveVersion
                      ? "Restoring version"
                      : "Saving objective"
                    : isPreviewingObjectiveVersion
                      ? "Restore version"
                      : objectiveState.status === "ready" && objectiveState.activeObjectiveVersions.length > 0
                        ? "Create new version"
                        : "Save objective"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {objectiveState.status === "loading" ? <p className="muted-copy">Loading objectives</p> : null}
      {objectiveState.status === "error" ? <p className="form-error">{objectiveState.message}</p> : null}
      {duplicateGradeLabelError || objectiveError ? <p className="form-error">{duplicateGradeLabelError || objectiveError}</p> : null}
      <div className="survey-add-row">
        <button className="secondary-button compact-button" disabled={!selectedStudy || isPreviewingPreviousObjective} onClick={onAddObjective} type="button">
          Add objective
        </button>
      </div>
    </form>
  );
}
