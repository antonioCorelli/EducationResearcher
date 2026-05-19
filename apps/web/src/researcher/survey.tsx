import type { FormEvent } from "react";

import type { StudySetupTab, StudyShell, SurveyDraftItem, SurveyLayoutItem, SurveyState, SurveyVersion } from "../App";

export const defaultSurveyItems: readonly SurveyDraftItem[] = [{ type: "question", prompt: "" }];

export function createSurveyItemsFromVersion(surveyVersion: SurveyVersion | undefined) {
  const layoutItems =
    surveyVersion?.layoutItems ??
    [
      ...(surveyVersion?.ungroupedQuestions.map(
        (question): SurveyLayoutItem => ({
          type: "question",
          sortOrder: question.sortOrder,
          question
        })
      ) ?? []),
      ...(surveyVersion?.groups.map(
        (group): SurveyLayoutItem => ({
          type: "group",
          sortOrder: group.sortOrder,
          group
        })
      ) ?? [])
    ].sort((left, right) => left.sortOrder - right.sortOrder);

  return layoutItems.length > 0
    ? layoutItems.map((item): SurveyDraftItem =>
        item.type === "question"
          ? {
              type: "question",
              prompt: item.question.prompt
            }
          : {
              type: "group",
              title: item.group.title,
              questions: item.group.questions.length > 0 ? item.group.questions.map((question) => question.prompt) : [""]
            }
      )
    : defaultSurveyItems;
}

interface ResearcherSurveyProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly activeSurveyVersion: SurveyVersion | undefined;
  readonly isPreviewingPreviousSurvey: boolean;
  readonly isSavingSurvey: boolean;
  readonly selectedStudy: StudyShell | undefined;
  readonly selectedSurveyVersion: SurveyVersion | undefined;
  readonly selectedSurveyVersionNumber: number | null;
  readonly surveyError: string;
  readonly surveyItems: readonly SurveyDraftItem[];
  readonly surveyState: SurveyState;
  readonly onAddGroupedQuestion: (itemIndex: number) => void;
  readonly onAddSurveyGroup: () => void;
  readonly onAddSurveyQuestion: () => void;
  readonly onMoveSurveyItem: (index: number, direction: -1 | 1) => void;
  readonly onRemoveGroupedQuestion: (itemIndex: number, questionIndex: number) => void;
  readonly onRemoveSurveyItem: (index: number) => void;
  readonly onSaveSurvey: (event: FormEvent<HTMLFormElement>) => void;
  readonly onSelectSurveyVersion: (surveyVersion: SurveyVersion) => void;
  readonly onUpdateGroupedQuestion: (itemIndex: number, questionIndex: number, prompt: string) => void;
  readonly onUpdateSurveyGroupTitle: (index: number, title: string) => void;
  readonly onUpdateSurveyQuestion: (index: number, value: string) => void;
}

export function ResearcherSurvey({
  activeStudySetupTab,
  activeSurveyVersion,
  isPreviewingPreviousSurvey,
  isSavingSurvey,
  selectedStudy,
  selectedSurveyVersion,
  selectedSurveyVersionNumber,
  surveyError,
  surveyItems,
  surveyState,
  onAddGroupedQuestion,
  onAddSurveyGroup,
  onAddSurveyQuestion,
  onMoveSurveyItem,
  onRemoveGroupedQuestion,
  onRemoveSurveyItem,
  onSaveSurvey,
  onSelectSurveyVersion,
  onUpdateGroupedQuestion,
  onUpdateSurveyGroupTitle,
  onUpdateSurveyQuestion
}: ResearcherSurveyProps) {
  return (
    <form
      aria-labelledby="study-setup-tab-survey"
      className="study-form study-setup-panel"
      hidden={activeStudySetupTab !== "survey"}
      id="study-setup-panel-survey"
      onSubmit={onSaveSurvey}
      role="tabpanel"
    >
      <div className="section-heading">
        <h2>Survey</h2>
        {selectedSurveyVersion ? (
          <span className={isPreviewingPreviousSurvey ? "version-pill preview-version-pill" : "version-pill"}>
            Version {selectedSurveyVersion.versionNumber}
          </span>
        ) : activeSurveyVersion ? (
          <span className="version-pill">Version {activeSurveyVersion.versionNumber}</span>
        ) : null}
      </div>
      <p className="muted-copy">
        Configure required long-form prompts for participant survey responses. Survey edits create a new version, and
        existing runs keep the version they were assigned.
      </p>
      <div className="survey-item-list">
        {surveyItems.map((item, itemIndex) =>
          item.type === "question" ? (
            <div className="survey-item-editor" key={`survey-question-${itemIndex}`}>
              <div className="survey-item-toolbar">
                <h3>Question {itemIndex + 1}</h3>
                <div className="survey-item-actions">
                  <button
                    aria-label={`Move question ${itemIndex + 1} up`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingPreviousSurvey || itemIndex === 0}
                    onClick={() => onMoveSurveyItem(itemIndex, -1)}
                    type="button"
                  >
                    Up
                  </button>
                  <button
                    aria-label={`Move question ${itemIndex + 1} down`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingPreviousSurvey || itemIndex === surveyItems.length - 1}
                    onClick={() => onMoveSurveyItem(itemIndex, 1)}
                    type="button"
                  >
                    Down
                  </button>
                  <button
                    aria-label={`Remove question ${itemIndex + 1}`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingPreviousSurvey || surveyItems.length === 1}
                    onClick={() => onRemoveSurveyItem(itemIndex)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <label>
                Prompt
                <textarea
                  disabled={!selectedStudy || isPreviewingPreviousSurvey}
                  maxLength={1000}
                  onChange={(event) => onUpdateSurveyQuestion(itemIndex, event.target.value)}
                  placeholder={selectedStudy ? "Ask for a sentence-to-paragraph response" : "Create or select a study first"}
                  value={item.prompt}
                />
              </label>
            </div>
          ) : (
            <div className="survey-item-editor survey-group-editor" key={`survey-group-${itemIndex}`}>
              <div className="survey-item-toolbar">
                <h3>Group {itemIndex + 1}</h3>
                <div className="survey-item-actions">
                  <button
                    aria-label={`Move group ${itemIndex + 1} up`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingPreviousSurvey || itemIndex === 0}
                    onClick={() => onMoveSurveyItem(itemIndex, -1)}
                    type="button"
                  >
                    Up
                  </button>
                  <button
                    aria-label={`Move group ${itemIndex + 1} down`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingPreviousSurvey || itemIndex === surveyItems.length - 1}
                    onClick={() => onMoveSurveyItem(itemIndex, 1)}
                    type="button"
                  >
                    Down
                  </button>
                  <button
                    aria-label={`Remove group ${itemIndex + 1}`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingPreviousSurvey}
                    onClick={() => onRemoveSurveyItem(itemIndex)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <label>
                Group title
                <input
                  disabled={!selectedStudy || isPreviewingPreviousSurvey}
                  maxLength={240}
                  onChange={(event) => onUpdateSurveyGroupTitle(itemIndex, event.target.value)}
                  placeholder="Visible group title"
                  type="text"
                  value={item.title}
                />
              </label>
              {item.questions.map((prompt, questionIndex) => (
                <div className="question-row" key={`group-${itemIndex}-question-${questionIndex}`}>
                  <label>
                    Group question {questionIndex + 1}
                    <textarea
                      disabled={!selectedStudy || isPreviewingPreviousSurvey}
                      maxLength={1000}
                      onChange={(event) => onUpdateGroupedQuestion(itemIndex, questionIndex, event.target.value)}
                      placeholder="Ask for a long-form response"
                      value={prompt}
                    />
                  </label>
                  <button
                    aria-label={`Remove group ${itemIndex + 1} question ${questionIndex + 1}`}
                    className="secondary-button compact-button"
                    disabled={!selectedStudy || isPreviewingPreviousSurvey || item.questions.length === 1}
                    onClick={() => onRemoveGroupedQuestion(itemIndex, questionIndex)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="secondary-button compact-button"
                disabled={!selectedStudy || isPreviewingPreviousSurvey}
                onClick={() => onAddGroupedQuestion(itemIndex)}
                type="button"
              >
                Add group question
              </button>
            </div>
          )
        )}
      </div>
      <div className="survey-add-row">
        <button className="secondary-button compact-button" disabled={!selectedStudy || isPreviewingPreviousSurvey} onClick={onAddSurveyQuestion} type="button">
          Add question
        </button>
        <button className="secondary-button compact-button" disabled={!selectedStudy || isPreviewingPreviousSurvey} onClick={onAddSurveyGroup} type="button">
          Add group
        </button>
      </div>
      {surveyState.status === "loading" ? <p className="muted-copy">Loading survey</p> : null}
      {surveyState.status === "error" ? <p className="form-error">{surveyState.message}</p> : null}
      {surveyState.status === "ready" && surveyState.surveyVersions.length > 0 ? (
        <div className="version-history" aria-label="Survey versions">
          {surveyState.surveyVersions.map((version) => (
            <button
              className={[
                "version-chip",
                version.isActive ? "active-version-chip" : "",
                version.versionNumber === selectedSurveyVersionNumber ? "selected-version-chip" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              key={version.id}
              onClick={() => onSelectSurveyVersion(version)}
              type="button"
            >
              v{version.versionNumber}
            </button>
          ))}
        </div>
      ) : null}
      {surveyError ? <p className="form-error">{surveyError}</p> : null}
      <div className="form-actions">
        <button className={isPreviewingPreviousSurvey ? "danger-button" : "primary-button"} disabled={!selectedStudy || isSavingSurvey} type="submit">
          {isSavingSurvey
            ? isPreviewingPreviousSurvey
              ? "Restoring version"
              : "Saving survey"
            : isPreviewingPreviousSurvey
              ? "Restore selected version"
              : surveyState.status === "ready" && surveyState.activeSurveyVersion
                ? "Create new version"
                : "Save survey"}
        </button>
      </div>
    </form>
  );
}
