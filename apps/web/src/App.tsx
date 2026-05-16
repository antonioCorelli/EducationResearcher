import { FormEvent, useEffect, useState } from "react";

import {
  buildScopedObjectiveDraftsForSave,
  getDuplicateGradeLabelError,
  replaceObjectiveDraft,
  type ObjectiveDraft
} from "./objectiveDrafts";
import { Participant } from "./participant";
import { Researcher } from "./researcher";
import { createConsentForm, defaultConsentForm, ResearcherConsent } from "./researcher/consent";
import { ResearcherParticipantSlots } from "./researcher/participantSlots";
import { ResearcherRuns } from "./researcher/runs";
import { createEmptyObjectiveDraft, createObjectiveDraftsFromVersions, ResearcherScoring } from "./researcher/scoring";
import { createStudyShellForm, defaultStudyShellForm, ResearcherShell } from "./researcher/shell";
import { createSurveyItemsFromVersion, defaultSurveyItems, ResearcherSurvey } from "./researcher/survey";

const serviceBaseUrl = import.meta.env.VITE_SERVICE_BASE_URL ?? "http://localhost:4000";
const accessTokenStorageKey = "educationResearcher.accessToken";

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: "researcher";
}

interface AuthTokens {
  readonly accessToken: string;
  readonly idToken: string;
  readonly refreshToken?: string;
  readonly expiresIn: number;
  readonly tokenType: string;
}

export interface StudyShell {
  readonly id: string;
  readonly title: string;
  readonly defaultFreshnessDays: number;
  readonly defaultMaxInterviewMinutes: number;
  readonly activeConsentVersionId?: string;
  readonly activeSurveyVersionId?: string;
  readonly activePersonaVersionId: string;
  readonly persona: {
    readonly label: string;
    readonly stylePrompt: string;
    readonly locked: true;
  };
}

export type StudySetupTab = "shell" | "consent" | "survey" | "objectives" | "runs";

export type ConsentMethod = "checkmark" | "electronic_signature";

export interface ConsentVersion {
  readonly id: string;
  readonly studyId: string;
  readonly versionNumber: number;
  readonly consentText: string;
  readonly consentMethod: ConsentMethod;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface SurveyQuestion {
  readonly id: string;
  readonly surveyVersionId: string;
  readonly surveyGroupId?: string;
  readonly prompt: string;
  readonly required: true;
  readonly questionType: "long_text";
  readonly sortOrder: number;
  readonly createdAt: string;
}

export interface SurveyGroup {
  readonly id: string;
  readonly surveyVersionId: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly questions: readonly SurveyQuestion[];
  readonly createdAt: string;
}

export interface SurveyVersion {
  readonly id: string;
  readonly studyId: string;
  readonly versionNumber: number;
  readonly isActive: boolean;
  readonly layoutItems?: readonly SurveyLayoutItem[];
  readonly groups: readonly SurveyGroup[];
  readonly ungroupedQuestions: readonly SurveyQuestion[];
  readonly createdAt: string;
}

export interface ObjectiveGradeExample {
  readonly id: string;
  readonly objectiveVersionId: string;
  readonly gradeLabel: string;
  readonly exampleText: string;
  readonly sortOrder: number;
  readonly createdAt: string;
}

export interface ObjectiveVersion {
  readonly id: string;
  readonly studyId: string;
  readonly objectiveKey: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly description: string;
  readonly customScoringPrompt?: string;
  readonly gradeScale: readonly string[];
  readonly gradeExamples: readonly ObjectiveGradeExample[];
  readonly evidenceRequirements: string;
  readonly sortOrder: number;
  readonly isEnabled?: boolean;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface ParticipantSlot {
  readonly id: string;
  readonly studyId: string;
  readonly participantCode: string;
  readonly codeSource: "researcher_supplied" | "platform_generated";
  readonly status: "active" | "archived";
  readonly archivedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ParticipantSlotImportRejectedRow {
  readonly rowNumber: number;
  readonly participantCode?: string;
  readonly reason: "duplicate" | "invalid" | "malformed";
  readonly message: string;
}

export interface ParticipantSlotBulkSummary {
  readonly createdCount: number;
  readonly rejectedRows: ParticipantSlotImportRejectedRow[];
}

export interface Run {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly consentVersionId: string;
  readonly surveyVersionId: string;
  readonly personaVersionId: string;
  readonly objectiveVersionIds: readonly string[];
  readonly freshnessDeadlineAt: string;
  readonly maxInterviewMinutes: number;
  readonly status:
    | "created"
    | "consented"
    | "survey_in_progress"
    | "survey_completed"
    | "interview_in_progress"
    | "interview_paused"
    | "interview_completed"
    | "stale"
    | "partial"
    | "technical_interruption"
    | "scored";
  readonly currentRunForSlot: boolean;
  readonly participantAccessUrl?: string;
  readonly participantAccessTokenId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ScoreFlag =
  | "low_confidence"
  | "missing_interview_evidence"
  | "survey_interview_contradiction"
  | "stale_run"
  | "partial_run"
  | "technical_interruption";

export type EvidenceCitationSourceType = "survey_response" | "interview_turn" | "audio_span";

export interface ScoringRun {
  readonly id: string;
  readonly runId: string;
  readonly status: "completed";
  readonly trigger: "automatic" | "manual_rescore";
  readonly modelName: string;
  readonly modelVersion: string;
  readonly serviceRequestId: string;
  readonly promptVersion: string;
  readonly objectiveVersionSetHash: string;
  readonly scoredAt: string;
  readonly createdAt: string;
}

export interface ObjectiveScore {
  readonly id: string;
  readonly scoringRunId: string;
  readonly runId: string;
  readonly objectiveVersionId: string;
  readonly gradeLabel: string;
  readonly confidence: number;
  readonly rationale: string;
  readonly flags: readonly ScoreFlag[];
  readonly createdAt: string;
}

export interface EvidenceCitation {
  readonly id: string;
  readonly objectiveScoreId: string;
  readonly runId: string;
  readonly sourceType: EvidenceCitationSourceType;
  readonly sourceId: string;
  readonly quote: string;
  readonly audioStartMs?: number;
  readonly audioEndMs?: number;
  readonly createdAt: string;
}

export interface ScoreReviewObjectiveVersion {
  readonly id: string;
  readonly objectiveKey: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly sortOrder: number;
  readonly status?: "missing";
}

export interface ObjectiveScoreReview {
  readonly objectiveVersion: ScoreReviewObjectiveVersion;
  readonly score: ObjectiveScore;
  readonly citations: readonly EvidenceCitation[];
}

export interface RunScoreReview {
  readonly run: Run;
  readonly scoringRun?: ScoringRun;
  readonly scoringRuns: readonly ScoringRun[];
  readonly objectiveScores: readonly ObjectiveScoreReview[];
}

export interface ResearcherSafeRunStatus {
  readonly value: Run["status"];
  readonly label: string;
  readonly isStale: boolean;
  readonly isPartial: boolean;
  readonly isTechnicalInterruption: boolean;
  readonly isCompleted: boolean;
  readonly isScored: boolean;
}

export interface ResearcherRunArtifactSummary {
  readonly consentRecordCount: number;
  readonly surveyResponseCount: number;
  readonly gapMapCount: number;
  readonly interviewSessionCount: number;
  readonly interviewTurnCount: number;
  readonly audioAssetCount: number;
  readonly audioDurationSeconds: number;
  readonly transcriptTokenCount: number;
}

export interface ResearcherRunScoringSummary {
  readonly state: "not_started" | "completed";
  readonly scoringRunCount: number;
  readonly latestScoredAt?: string;
  readonly latestTrigger?: ScoringRun["trigger"];
}

export interface ResearcherDashboardRun {
  readonly id: string;
  readonly status: ResearcherSafeRunStatus;
  readonly freshnessDeadlineAt: string;
  readonly currentRunForSlot: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly artifactSummary: ResearcherRunArtifactSummary;
  readonly scoringSummary: ResearcherRunScoringSummary;
}

export interface ResearcherRunDashboardSlot {
  readonly participantSlot: ParticipantSlot;
  readonly currentRun?: ResearcherDashboardRun;
  readonly latestRun?: ResearcherDashboardRun;
  readonly runs: readonly ResearcherDashboardRun[];
}

export type ScoreReviewState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly scoreReviews: RunScoreReview[] }
  | { readonly status: "error"; readonly message: string };

interface ScoreCsvExport {
  readonly filename: string;
  readonly csv: string;
}

export type ResolvedEvidenceCitation =
  | {
      readonly citation: EvidenceCitation;
      readonly source: {
        readonly type: "survey_response";
        readonly surveyResponse: {
          readonly id: string;
          readonly surveyQuestionId: string;
          readonly responseText: string;
          readonly submittedAt: string;
        };
      };
    }
  | {
      readonly citation: EvidenceCitation;
      readonly source: {
        readonly type: "interview_turn";
        readonly interviewTurn: {
          readonly id: string;
          readonly speaker: "ai" | "participant";
          readonly text: string;
          readonly audioStartMs?: number;
          readonly audioEndMs?: number;
          readonly createdAt: string;
        };
      };
    }
  | {
      readonly citation: EvidenceCitation;
      readonly source: {
        readonly type: "audio_span";
        readonly audioAsset: {
          readonly id: string;
          readonly storageUri: string;
          readonly durationSeconds: number;
          readonly status: string;
          readonly createdAt: string;
        };
        readonly audioStartMs: number;
        readonly audioEndMs: number;
      };
    };

export interface RawEvidence {
  readonly run: Run;
  readonly surveyResponses: readonly {
    readonly id: string;
    readonly surveyQuestionId: string;
    readonly responseText: string;
    readonly submittedAt: string;
  }[];
  readonly interviewTurns: readonly {
    readonly id: string;
    readonly speaker: "ai" | "participant";
    readonly text: string;
    readonly audioStartMs?: number;
    readonly audioEndMs?: number;
    readonly createdAt: string;
  }[];
  readonly audioAssets: readonly {
    readonly id: string;
    readonly storageUri: string;
    readonly durationSeconds: number;
    readonly status: string;
    readonly signedUrl?: string;
    readonly signedUrlExpiresAt?: string;
    readonly createdAt: string;
  }[];
}

export type RawEvidenceState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly evidence: RawEvidence; readonly focusSourceId?: string }
  | { readonly status: "error"; readonly message: string };

export type SurveyLayoutItem =
  | {
      readonly type: "question";
      readonly sortOrder: number;
      readonly question: SurveyQuestion;
    }
  | {
      readonly type: "group";
      readonly sortOrder: number;
      readonly group: SurveyGroup;
    };

type SessionState =
  | { readonly status: "checking" }
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly user: SessionUser };

export type StudiesState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly studies: StudyShell[] }
  | { readonly status: "error"; readonly message: string };

export type ConsentState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly activeConsentVersion?: ConsentVersion; readonly consentVersions: ConsentVersion[] }
  | { readonly status: "error"; readonly message: string };

export type SurveyState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly activeSurveyVersion?: SurveyVersion; readonly surveyVersions: SurveyVersion[] }
  | { readonly status: "error"; readonly message: string };

export type ObjectiveState =
  | { readonly status: "idle" | "loading" }
  | {
      readonly status: "ready";
      readonly activeObjectiveVersions: ObjectiveVersion[];
      readonly enabledObjectiveVersions?: ObjectiveVersion[];
      readonly objectiveVersions: ObjectiveVersion[];
    }
  | { readonly status: "error"; readonly message: string };

export type ParticipantSlotState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly participantSlots: ParticipantSlot[] }
  | { readonly status: "error"; readonly message: string };

export type RunState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly runs: Run[] }
  | { readonly status: "error"; readonly message: string };

export type RunDashboardState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly slots: ResearcherRunDashboardSlot[] }
  | { readonly status: "error"; readonly message: string };

export type SurveyDraftItem =
  | {
      readonly type: "question";
      readonly prompt: string;
    }
  | {
      readonly type: "group";
      readonly title: string;
      readonly questions: readonly string[];
    };

export interface VersionChangeSummary {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

type PendingVersionConfirmation =
  | { readonly kind: "consent"; readonly changes: readonly VersionChangeSummary[] }
  | { readonly kind: "survey"; readonly changes: readonly VersionChangeSummary[] }
  | { readonly kind: "objectives"; readonly objectiveIndex: number; readonly changes: readonly VersionChangeSummary[] };

function getCurrentPath() {
  return window.location.pathname;
}

function formatChangeValue(value: string) {
  return value || "Not set";
}

function addTextChange(changes: VersionChangeSummary[], label: string, before: string, after: string) {
  if (before !== after) {
    changes.push({ label, before: formatChangeValue(before), after: formatChangeValue(after) });
  }
}

function createSurveySnapshot(items: readonly SurveyDraftItem[]) {
  return items
    .map((item) =>
      item.type === "question"
        ? ({
            type: "question",
            prompt: item.prompt.trim()
          } as const)
        : ({
            type: "group",
            title: item.title.trim(),
            questions: item.questions.map((prompt) => prompt.trim()).filter(Boolean)
          } as const)
    )
    .filter((item) => (item.type === "question" ? item.prompt : item.title || item.questions.length > 0));
}

function createSurveyVersionSnapshot(version: SurveyVersion) {
  const layoutItems =
    version.layoutItems ??
    [
      ...version.groups.map((group) => ({ type: "group" as const, sortOrder: group.sortOrder, group })),
      ...version.ungroupedQuestions.map((question) => ({ type: "question" as const, sortOrder: question.sortOrder, question }))
    ].sort((left, right) => left.sortOrder - right.sortOrder);

  return layoutItems.map((item) =>
    item.type === "question"
      ? ({
          type: "question",
          prompt: item.question.prompt
        } as const)
      : ({
          type: "group",
          title: item.group.title,
          questions: item.group.questions
            .slice()
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((question) => question.prompt)
        } as const)
  );
}

function describeSurveyItem(item: ReturnType<typeof createSurveySnapshot>[number]) {
  return item.type === "question"
    ? `Question: ${formatChangeValue(item.prompt)}`
    : `Group: ${formatChangeValue(item.title)} (${item.questions.length} question${item.questions.length === 1 ? "" : "s"})`;
}

function getSurveyChanges(activeVersion: SurveyVersion | undefined, items: readonly SurveyDraftItem[]) {
  if (!activeVersion) {
    return [];
  }

  const beforeItems = createSurveyVersionSnapshot(activeVersion);
  const afterItems = createSurveySnapshot(items);
  const changes: VersionChangeSummary[] = [];
  const itemCount = Math.max(beforeItems.length, afterItems.length);

  for (let index = 0; index < itemCount; index += 1) {
    const beforeItem = beforeItems[index];
    const afterItem = afterItems[index];
    const label = `Item ${index + 1}`;

    if (!beforeItem && afterItem) {
      changes.push({ label, before: "Not set", after: describeSurveyItem(afterItem) });
      continue;
    }

    if (beforeItem && !afterItem) {
      changes.push({ label, before: describeSurveyItem(beforeItem), after: "Removed" });
      continue;
    }

    if (!beforeItem || !afterItem) {
      continue;
    }

    if (beforeItem.type !== afterItem.type) {
      changes.push({ label, before: describeSurveyItem(beforeItem), after: describeSurveyItem(afterItem) });
      continue;
    }

    if (beforeItem.type === "question" && afterItem.type === "question") {
      addTextChange(changes, `${label} prompt`, beforeItem.prompt, afterItem.prompt);
      continue;
    }

    if (beforeItem.type === "group" && afterItem.type === "group") {
      addTextChange(changes, `${label} title`, beforeItem.title, afterItem.title);
      const questionCount = Math.max(beforeItem.questions.length, afterItem.questions.length);

      for (let questionIndex = 0; questionIndex < questionCount; questionIndex += 1) {
        addTextChange(
          changes,
          `${label} question ${questionIndex + 1}`,
          beforeItem.questions[questionIndex] ?? "",
          afterItem.questions[questionIndex] ?? ""
        );
      }
    }
  }

  return changes;
}

function getConsentChanges(activeVersion: ConsentVersion | undefined, text: string, method: ConsentMethod) {
  if (!activeVersion) {
    return [];
  }

  const changes: VersionChangeSummary[] = [];
  addTextChange(changes, "Consent text", activeVersion.consentText, text.trim());
  addTextChange(changes, "Consent method", activeVersion.consentMethod, method);
  return changes;
}

function createObjectiveSnapshot(objectives: readonly ObjectiveDraft[]) {
  return objectives
    .map((objective) => ({
      objectiveKey: objective.objectiveKey,
      title: objective.title.trim(),
      description: objective.description.trim(),
      customScoringPrompt: objective.customScoringPrompt.trim(),
      gradeLabels: objective.gradeLabels.map((label) => label.trim()).filter(Boolean),
      gradeExamples: objective.gradeExamples
        .map((example) => ({
          gradeLabel: example.gradeLabel.trim(),
          exampleText: example.exampleText.trim()
        }))
        .filter((example) => example.gradeLabel || example.exampleText),
      evidenceRequirements: objective.evidenceRequirements.trim(),
      isEnabled: objective.isEnabled
    }))
    .filter(
      (objective) =>
        objective.title ||
        objective.description ||
        objective.gradeLabels.length > 0 ||
        objective.gradeExamples.length > 0 ||
        objective.evidenceRequirements ||
        !objective.isEnabled
    );
}

function createActiveObjectiveSnapshot(versions: readonly ObjectiveVersion[]) {
  return versions
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((version) => ({
      objectiveKey: version.objectiveKey,
      title: version.title,
      description: version.description,
      customScoringPrompt: version.customScoringPrompt ?? "",
      gradeLabels: [...version.gradeScale],
      gradeExamples: version.gradeExamples
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((example) => ({
          gradeLabel: example.gradeLabel,
          exampleText: example.exampleText
        })),
      evidenceRequirements: version.evidenceRequirements,
      isEnabled: version.isEnabled ?? true
    }));
}

function describeObjective(objective: ReturnType<typeof createObjectiveSnapshot>[number]) {
  return `${formatChangeValue(objective.title)} (${objective.gradeLabels.length} grade${objective.gradeLabels.length === 1 ? "" : "s"})`;
}

function getObjectiveChanges(activeVersions: readonly ObjectiveVersion[], drafts: readonly ObjectiveDraft[]) {
  const beforeObjectives = createActiveObjectiveSnapshot(activeVersions);
  const afterObjectives = createObjectiveSnapshot(drafts);
  const changes: VersionChangeSummary[] = [];
  const objectiveCount = Math.max(beforeObjectives.length, afterObjectives.length);

  for (let index = 0; index < objectiveCount; index += 1) {
    const beforeObjective = beforeObjectives[index];
    const afterObjective = afterObjectives[index];
    const label = `Objective ${index + 1}`;

    if (!beforeObjective && afterObjective) {
      changes.push({ label, before: "Not set", after: describeObjective(afterObjective) });
      continue;
    }

    if (beforeObjective && !afterObjective) {
      changes.push({ label, before: describeObjective(beforeObjective), after: "Removed" });
      continue;
    }

    if (!beforeObjective || !afterObjective) {
      continue;
    }

    addTextChange(changes, `${label} title`, beforeObjective.title, afterObjective.title);
    addTextChange(changes, `${label} description`, beforeObjective.description, afterObjective.description);
    addTextChange(changes, `${label} custom prompt`, beforeObjective.customScoringPrompt, afterObjective.customScoringPrompt);
    addTextChange(changes, `${label} grade labels`, beforeObjective.gradeLabels.join(", "), afterObjective.gradeLabels.join(", "));
    addTextChange(changes, `${label} evidence requirements`, beforeObjective.evidenceRequirements, afterObjective.evidenceRequirements);
    addTextChange(changes, `${label} scoring status`, beforeObjective.isEnabled ? "Enabled" : "Disabled", afterObjective.isEnabled ? "Enabled" : "Disabled");
    addTextChange(
      changes,
      `${label} grade examples`,
      beforeObjective.gradeExamples.map((example) => `${example.gradeLabel}: ${example.exampleText}`).join("\n"),
      afterObjective.gradeExamples.map((example) => `${example.gradeLabel}: ${example.exampleText}`).join("\n")
    );
  }

  return changes;
}

async function fetchSession(accessToken: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/session`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Session is not valid.");
  }

  return (await response.json()) as { user: SessionUser };
}

async function fetchStudies(accessToken: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load studies.");
  }

  return (await response.json()) as { studies: StudyShell[] };
}

async function fetchConsent(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/consent`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load consent.");
  }

  return (await response.json()) as {
    activeConsentVersion?: ConsentVersion;
    consentVersions: ConsentVersion[];
  };
}

async function fetchSurvey(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/survey`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load survey.");
  }

  return (await response.json()) as {
    activeSurveyVersion?: SurveyVersion;
    surveyVersions: SurveyVersion[];
  };
}

async function fetchObjectives(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/objectives`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load objectives.");
  }

  return (await response.json()) as {
    activeObjectiveVersions: ObjectiveVersion[];
    enabledObjectiveVersions?: ObjectiveVersion[];
    objectiveVersions: ObjectiveVersion[];
  };
}

async function fetchParticipantSlots(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/participant-slots`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load participant slots.");
  }

  return (await response.json()) as {
    participantSlots: ParticipantSlot[];
  };
}

async function fetchRuns(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/runs`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load runs.");
  }

  return (await response.json()) as {
    runs: Run[];
  };
}

async function fetchRunDashboard(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/run-dashboard`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load run dashboard.");
  }

  return (await response.json()) as {
    slots: ResearcherRunDashboardSlot[];
  };
}

async function fetchScoreReviews(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/score-reviews`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Unable to load score reviews.");
  }

  return (await response.json()) as {
    scoreReviews: RunScoreReview[];
  };
}

async function fetchScoreCsvExport(accessToken: string, studyId: string): Promise<ScoreCsvExport> {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/score-export.csv`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Unable to export score CSV.");
  }

  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const filename = contentDisposition.match(/filename="([^"]+)"/)?.[1] ?? `study-${studyId}-score-export.csv`;

  return {
    filename,
    csv: await response.text()
  };
}

async function fetchResolvedEvidenceCitation(
  accessToken: string,
  studyId: string,
  runId: string,
  evidenceCitationId: string
) {
  const response = await fetch(
    `${serviceBaseUrl}/researcher/studies/${studyId}/runs/${runId}/evidence-citations/${evidenceCitationId}`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Unable to load citation evidence.");
  }

  return (await response.json()) as ResolvedEvidenceCitation;
}

async function fetchRawEvidence(accessToken: string, studyId: string, runId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/runs/${runId}/raw-evidence`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Unable to load raw evidence.");
  }

  return (await response.json()) as RawEvidence;
}

async function triggerManualRescore(accessToken: string, studyId: string, runId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/runs/${runId}/rescore`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Unable to rescore run.");
  }
}

export function App() {
  const [path, setPath] = useState(getCurrentPath);
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem(accessTokenStorageKey));
  const [studiesState, setStudiesState] = useState<StudiesState>({ status: "idle" });
  const [participantSlotState, setParticipantSlotState] = useState<ParticipantSlotState>({ status: "idle" });
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const [runDashboardState, setRunDashboardState] = useState<RunDashboardState>({ status: "idle" });
  const [scoreReviewState, setScoreReviewState] = useState<ScoreReviewState>({ status: "idle" });
  const [isExportingScores, setIsExportingScores] = useState(false);
  const [consentState, setConsentState] = useState<ConsentState>({ status: "idle" });
  const [surveyState, setSurveyState] = useState<SurveyState>({ status: "idle" });
  const [objectiveState, setObjectiveState] = useState<ObjectiveState>({ status: "idle" });
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [studyTitle, setStudyTitle] = useState<string>(defaultStudyShellForm.studyTitle);
  const [freshnessDays, setFreshnessDays] = useState<number>(defaultStudyShellForm.freshnessDays);
  const [maxInterviewMinutes, setMaxInterviewMinutes] = useState<number>(defaultStudyShellForm.maxInterviewMinutes);
  const [studyError, setStudyError] = useState("");
  const [isSavingStudy, setIsSavingStudy] = useState(false);
  const [studyTitleFocusRequest, setStudyTitleFocusRequest] = useState(0);
  const [activeStudySetupTab, setActiveStudySetupTab] = useState<StudySetupTab>("shell");
  const [participantCode, setParticipantCode] = useState("");
  const [participantSlotCsv, setParticipantSlotCsv] = useState("");
  const [generatedParticipantSlotCount, setGeneratedParticipantSlotCount] = useState(10);
  const [participantSlotBulkSummary, setParticipantSlotBulkSummary] = useState<ParticipantSlotBulkSummary | null>(null);
  const [participantSlotError, setParticipantSlotError] = useState("");
  const [isSavingParticipantSlot, setIsSavingParticipantSlot] = useState(false);
  const [isImportingParticipantSlots, setIsImportingParticipantSlots] = useState(false);
  const [isGeneratingParticipantSlots, setIsGeneratingParticipantSlots] = useState(false);
  const [isArchivingParticipantSlotId, setIsArchivingParticipantSlotId] = useState<string | null>(null);
  const [selectedRunParticipantSlotIds, setSelectedRunParticipantSlotIds] = useState<readonly string[]>([]);
  const [runError, setRunError] = useState("");
  const [isCreatingRuns, setIsCreatingRuns] = useState(false);
  const [selectedEvidenceCitation, setSelectedEvidenceCitation] = useState<ResolvedEvidenceCitation | null>(null);
  const [selectedEvidenceCitationError, setSelectedEvidenceCitationError] = useState("");
  const [isLoadingEvidenceCitationId, setIsLoadingEvidenceCitationId] = useState<string | null>(null);
  const [rawEvidenceState, setRawEvidenceState] = useState<RawEvidenceState>({ status: "idle" });
  const [isLoadingRawEvidenceRunId, setIsLoadingRawEvidenceRunId] = useState<string | null>(null);
  const [isRescoringRunId, setIsRescoringRunId] = useState<string | null>(null);
  const [rescoreError, setRescoreError] = useState("");
  const [scoreExportError, setScoreExportError] = useState("");
  const [consentText, setConsentText] = useState(defaultConsentForm.consentText);
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>(defaultConsentForm.consentMethod);
  const [consentError, setConsentError] = useState("");
  const [isSavingConsent, setIsSavingConsent] = useState(false);
  const [selectedConsentVersionNumber, setSelectedConsentVersionNumber] = useState<number | null>(null);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [surveyItems, setSurveyItems] = useState<readonly SurveyDraftItem[]>(defaultSurveyItems);
  const [surveyError, setSurveyError] = useState("");
  const [isSavingSurvey, setIsSavingSurvey] = useState(false);
  const [selectedSurveyVersionNumber, setSelectedSurveyVersionNumber] = useState<number | null>(null);
  const [isRestoreSurveyDialogOpen, setIsRestoreSurveyDialogOpen] = useState(false);
  const [objectiveDrafts, setObjectiveDrafts] = useState<readonly ObjectiveDraft[]>([
    {
      title: "",
      description: "",
      customScoringPrompt: "",
      gradeLabels: ["1", "2", "3", "4"],
      gradeExamples: [],
      evidenceRequirements: "",
      isEnabled: true
    }
  ]);
  const [objectiveError, setObjectiveError] = useState("");
  const [objectiveErrorDialog, setObjectiveErrorDialog] = useState("");
  const [isSavingObjectives, setIsSavingObjectives] = useState(false);
  const [selectedObjectiveVersionIds, setSelectedObjectiveVersionIds] = useState<Record<string, string>>({});
  const [restoreObjectiveVersionId, setRestoreObjectiveVersionId] = useState<string | null>(null);
  const [isRestoreObjectiveDialogOpen, setIsRestoreObjectiveDialogOpen] = useState(false);
  const [pendingVersionConfirmation, setPendingVersionConfirmation] = useState<PendingVersionConfirmation | null>(null);

  const isParticipantRoute = path.startsWith("/participant");
  const duplicateGradeLabelError = getDuplicateGradeLabelError(objectiveDrafts);

  useEffect(() => {
    if (isParticipantRoute) {
      setSession({ status: "signed-out" });
      return;
    }

    if (!accessToken) {
      setSession({ status: "signed-out" });
      return;
    }

    fetchSession(accessToken)
      .then(({ user }) => setSession({ status: "signed-in", user }))
      .catch(() => {
        localStorage.removeItem(accessTokenStorageKey);
        setAccessToken(null);
        setSession({ status: "signed-out" });
      });
  }, [accessToken, isParticipantRoute]);

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken) {
      setStudiesState({ status: "idle" });
      return;
    }

    setStudiesState({ status: "loading" });
    fetchStudies(accessToken)
      .then(({ studies }) => {
        setStudiesState({ status: "ready", studies });
        const selectedStudy = studies.find((study) => study.id === selectedStudyId) ?? studies[0];

        if (selectedStudy) {
          loadStudyForm(selectedStudy);
        }
      })
      .catch(() => setStudiesState({ status: "error", message: "Unable to load studies." }));
  }, [accessToken, session.status]);

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken || !selectedStudyId) {
      setParticipantSlotState({ status: "idle" });
      return;
    }

    setParticipantSlotState({ status: "loading" });
    fetchParticipantSlots(accessToken, selectedStudyId)
      .then((participantSlots) => {
        setParticipantSlotState({ status: "ready", ...participantSlots });
        setParticipantSlotError("");
      })
      .catch(() => setParticipantSlotState({ status: "error", message: "Unable to load participant slots." }));
  }, [accessToken, selectedStudyId, session.status]);

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken || !selectedStudyId) {
      setRunState({ status: "idle" });
      setRunDashboardState({ status: "idle" });
      setScoreReviewState({ status: "idle" });
      return;
    }

    setRunState({ status: "loading" });
    setRunDashboardState({ status: "loading" });
    setScoreReviewState({ status: "loading" });
    fetchRuns(accessToken, selectedStudyId)
      .then((runs) => {
        setRunState({ status: "ready", ...runs });
        setRunError("");
      })
      .catch(() => setRunState({ status: "error", message: "Unable to load runs." }));
    fetchRunDashboard(accessToken, selectedStudyId)
      .then((dashboard) => setRunDashboardState({ status: "ready", ...dashboard }))
      .catch(() => setRunDashboardState({ status: "error", message: "Unable to load run dashboard." }));
    fetchScoreReviews(accessToken, selectedStudyId)
      .then((scoreReviews) => {
        setScoreReviewState({ status: "ready", ...scoreReviews });
        setSelectedEvidenceCitation(null);
        setSelectedEvidenceCitationError("");
      })
      .catch((error) =>
        setScoreReviewState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load score reviews."
        })
      );
  }, [accessToken, selectedStudyId, session.status]);

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken || !selectedStudyId) {
      setConsentState({ status: "idle" });
      return;
    }

    setConsentState({ status: "loading" });
    fetchConsent(accessToken, selectedStudyId)
      .then((consent) => {
        setConsentState({ status: "ready", ...consent });
        loadConsentForm(consent.activeConsentVersion);
      })
      .catch(() => setConsentState({ status: "error", message: "Unable to load consent." }));
  }, [accessToken, selectedStudyId, session.status]);

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken || !selectedStudyId) {
      setSurveyState({ status: "idle" });
      return;
    }

    setSurveyState({ status: "loading" });
    fetchSurvey(accessToken, selectedStudyId)
      .then((survey) => {
        setSurveyState({ status: "ready", ...survey });
        loadSurveyForm(survey.activeSurveyVersion);
      })
      .catch(() => setSurveyState({ status: "error", message: "Unable to load survey." }));
  }, [accessToken, selectedStudyId, session.status]);

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken || !selectedStudyId) {
      setObjectiveState({ status: "idle" });
      return;
    }

    setObjectiveState({ status: "loading" });
    fetchObjectives(accessToken, selectedStudyId)
      .then((objectives) => {
        setObjectiveState({ status: "ready", ...objectives });
        loadObjectiveForm(objectives.activeObjectiveVersions);
      })
      .catch(() => setObjectiveState({ status: "error", message: "Unable to load objectives." }));
  }, [accessToken, selectedStudyId, session.status]);

  function navigate(nextPath: string) {
    window.history.pushState(null, "", nextPath);
    setPath(nextPath);
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/auth/sign-in`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      });

      if (!response.ok) {
        throw new Error("Email or password is incorrect.");
      }

      const { tokens } = (await response.json()) as { tokens: AuthTokens };
      localStorage.setItem(accessTokenStorageKey, tokens.accessToken);
      setAccessToken(tokens.accessToken);
      const { user } = await fetchSession(tokens.accessToken);
      setSession({ status: "signed-in", user });
      setPassword("");
      navigate("/researcher");
    } catch {
      setAuthError("Email or password is incorrect.");
      setSession({ status: "signed-out" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    const accessToken = localStorage.getItem(accessTokenStorageKey);

    if (accessToken) {
      await fetch(`${serviceBaseUrl}/auth/sign-out`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      }).catch(() => undefined);
    }

    localStorage.removeItem(accessTokenStorageKey);
    setAccessToken(null);
    setSession({ status: "signed-out" });
    setSelectedStudyId(null);
    resetStudyForm();
    navigate("/");
  }

  function resetStudyForm() {
    const studyShellForm = createStudyShellForm(undefined);
    const consentForm = createConsentForm(undefined);

    setSelectedStudyId(null);
    setActiveStudySetupTab("shell");
    setStudyTitle(studyShellForm.studyTitle);
    setFreshnessDays(studyShellForm.freshnessDays);
    setMaxInterviewMinutes(studyShellForm.maxInterviewMinutes);
    setStudyError("");
    setParticipantCode("");
    setParticipantSlotCsv("");
    setGeneratedParticipantSlotCount(10);
    setParticipantSlotBulkSummary(null);
    setParticipantSlotError("");
    setParticipantSlotState({ status: "idle" });
    setIsArchivingParticipantSlotId(null);
    setRunState({ status: "idle" });
    setSelectedRunParticipantSlotIds([]);
    setRunError("");
    setIsCreatingRuns(false);
    setConsentText(consentForm.consentText);
    setConsentMethod(consentForm.consentMethod);
    setConsentError("");
    setConsentState({ status: "idle" });
    setSelectedConsentVersionNumber(consentForm.selectedConsentVersionNumber);
    setIsRestoreDialogOpen(false);
    setSurveyState({ status: "idle" });
    setSurveyItems(defaultSurveyItems);
    setSurveyError("");
    setSelectedSurveyVersionNumber(null);
    setIsRestoreSurveyDialogOpen(false);
    setObjectiveState({ status: "idle" });
    setObjectiveDrafts([createEmptyObjectiveDraft()]);
    setObjectiveError("");
    setObjectiveErrorDialog("");
    setSelectedObjectiveVersionIds({});
    setRestoreObjectiveVersionId(null);
    setIsRestoreObjectiveDialogOpen(false);
    setStudyTitleFocusRequest((focusRequest) => focusRequest + 1);
  }

  function loadStudyForm(study: StudyShell) {
    const studyShellForm = createStudyShellForm(study);

    setSelectedStudyId(studyShellForm.selectedStudyId);
    setStudyTitle(studyShellForm.studyTitle);
    setFreshnessDays(studyShellForm.freshnessDays);
    setMaxInterviewMinutes(studyShellForm.maxInterviewMinutes);
    setStudyError("");
    setParticipantCode("");
    setParticipantSlotCsv("");
    setParticipantSlotBulkSummary(null);
    setParticipantSlotError("");
    setIsArchivingParticipantSlotId(null);
    setSelectedRunParticipantSlotIds([]);
    setRunError("");
    setIsCreatingRuns(false);
  }

  function loadConsentForm(consentVersion: ConsentVersion | undefined) {
    const consentForm = createConsentForm(consentVersion);

    setConsentText(consentForm.consentText);
    setConsentMethod(consentForm.consentMethod);
    setConsentError("");
    setSelectedConsentVersionNumber(consentForm.selectedConsentVersionNumber);
    setIsRestoreDialogOpen(false);
  }

  function loadSurveyForm(surveyVersion: SurveyVersion | undefined) {
    setSurveyItems(createSurveyItemsFromVersion(surveyVersion));
    setSurveyError("");
    setSelectedSurveyVersionNumber(surveyVersion?.versionNumber ?? null);
    setIsRestoreSurveyDialogOpen(false);
  }

  function loadObjectiveForm(objectiveVersions: readonly ObjectiveVersion[]) {
    setObjectiveDrafts(createObjectiveDraftsFromVersions(objectiveVersions));
    setObjectiveError("");
    setObjectiveErrorDialog("");
    setSelectedObjectiveVersionIds({});
    setRestoreObjectiveVersionId(null);
    setIsRestoreObjectiveDialogOpen(false);
  }

  async function reloadStudies(token: string, nextSelectedStudyId: string) {
    const { studies } = await fetchStudies(token);
    setStudiesState({ status: "ready", studies });
    const selectedStudy = studies.find((study) => study.id === nextSelectedStudyId);

    if (selectedStudy) {
      loadStudyForm(selectedStudy);
    }
  }

  function upsertStudy(study: StudyShell) {
    setStudiesState((state) => {
      if (state.status !== "ready") {
        return { status: "ready", studies: [study] };
      }

      const existingStudyIndex = state.studies.findIndex((existingStudy) => existingStudy.id === study.id);

      if (existingStudyIndex === -1) {
        return { status: "ready", studies: [...state.studies, study] };
      }

      return {
        status: "ready",
        studies: state.studies.map((existingStudy, index) => (index === existingStudyIndex ? study : existingStudy))
      };
    });
  }

  async function handleSaveStudy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStudyError("");

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token) {
      setStudyError("Researcher sign-in is required.");
      return;
    }

    setIsSavingStudy(true);

    try {
      const response = await fetch(
        selectedStudyId ? `${serviceBaseUrl}/researcher/studies/${selectedStudyId}` : `${serviceBaseUrl}/researcher/studies`,
        {
          method: selectedStudyId ? "PATCH" : "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            title: studyTitle,
            defaultFreshnessDays: freshnessDays,
            defaultMaxInterviewMinutes: maxInterviewMinutes
          })
        }
      );
      const payload = (await response.json()) as { study?: StudyShell; message?: string };

      if (!response.ok || !payload.study) {
        throw new Error(payload.message ?? "Unable to save study.");
      }

      upsertStudy(payload.study);
      loadStudyForm(payload.study);
      await reloadStudies(token, payload.study.id);
    } catch (error) {
      setStudyError(error instanceof Error ? error.message : "Unable to save study.");
    } finally {
      setIsSavingStudy(false);
    }
  }

  async function reloadParticipantSlots(token: string, studyId: string) {
    const participantSlots = await fetchParticipantSlots(token, studyId);
    setParticipantSlotState({ status: "ready", ...participantSlots });
    const runDashboard = await fetchRunDashboard(token, studyId);
    setRunDashboardState({ status: "ready", ...runDashboard });
  }

  async function reloadRuns(token: string, studyId: string) {
    const runs = await fetchRuns(token, studyId);
    setRunState({ status: "ready", ...runs });
    const runDashboard = await fetchRunDashboard(token, studyId);
    setRunDashboardState({ status: "ready", ...runDashboard });
    const scoreReviews = await fetchScoreReviews(token, studyId);
    setScoreReviewState({ status: "ready", ...scoreReviews });
  }

  async function handleManualRescore(runId: string) {
    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setRescoreError("Select a study before rescoring a run.");
      return;
    }

    setIsRescoringRunId(runId);
    setRescoreError("");

    try {
      await triggerManualRescore(token, selectedStudyId, runId);
      await reloadRuns(token, selectedStudyId);
    } catch (error) {
      setRescoreError(error instanceof Error ? error.message : "Unable to rescore run.");
    } finally {
      setIsRescoringRunId(null);
    }
  }

  async function handleExportScores() {
    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setScoreExportError("Select a study before exporting scores.");
      return;
    }

    setIsExportingScores(true);
    setScoreExportError("");

    try {
      const exportResult = await fetchScoreCsvExport(token, selectedStudyId);
      const blob = new Blob([exportResult.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = exportResult.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setScoreExportError(error instanceof Error ? error.message : "Unable to export score CSV.");
    } finally {
      setIsExportingScores(false);
    }
  }

  async function handleSaveParticipantSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setParticipantSlotError("");
    setParticipantSlotBulkSummary(null);

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setParticipantSlotError("Select a study before adding participant slots.");
      return;
    }

    setIsSavingParticipantSlot(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/participant-slots`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          participantCode
        })
      });
      const payload = (await response.json()) as { participantSlot?: ParticipantSlot; message?: string };

      if (!response.ok || !payload.participantSlot) {
        throw new Error(payload.message ?? "Unable to add participant slot.");
      }

      setParticipantCode("");
      await reloadParticipantSlots(token, selectedStudyId);
      await reloadRuns(token, selectedStudyId);
    } catch (error) {
      setParticipantSlotError(error instanceof Error ? error.message : "Unable to add participant slot.");
    } finally {
      setIsSavingParticipantSlot(false);
    }
  }

  async function handleImportParticipantSlots(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setParticipantSlotError("");
    setParticipantSlotBulkSummary(null);

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setParticipantSlotError("Select a study before importing participant slots.");
      return;
    }

    setIsImportingParticipantSlots(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/participant-slots/import`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          csv: participantSlotCsv
        })
      });
      const payload = (await response.json()) as {
        createdParticipantSlots?: ParticipantSlot[];
        rejectedRows?: ParticipantSlotImportRejectedRow[];
        message?: string;
      };

      if (!response.ok || !payload.createdParticipantSlots || !payload.rejectedRows) {
        throw new Error(payload.message ?? "Unable to import participant slots.");
      }

      setParticipantSlotBulkSummary({
        createdCount: payload.createdParticipantSlots.length,
        rejectedRows: payload.rejectedRows
      });
      if (payload.rejectedRows.length === 0) {
        setParticipantSlotCsv("");
      }
      await reloadParticipantSlots(token, selectedStudyId);
      await reloadRuns(token, selectedStudyId);
    } catch (error) {
      setParticipantSlotError(error instanceof Error ? error.message : "Unable to import participant slots.");
    } finally {
      setIsImportingParticipantSlots(false);
    }
  }

  async function handleGenerateParticipantSlots(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setParticipantSlotError("");
    setParticipantSlotBulkSummary(null);

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setParticipantSlotError("Select a study before generating participant slots.");
      return;
    }

    setIsGeneratingParticipantSlots(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/participant-slots/generate`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          count: generatedParticipantSlotCount
        })
      });
      const payload = (await response.json()) as { createdParticipantSlots?: ParticipantSlot[]; message?: string };

      if (!response.ok || !payload.createdParticipantSlots) {
        throw new Error(payload.message ?? "Unable to generate participant slots.");
      }

      setParticipantSlotBulkSummary({
        createdCount: payload.createdParticipantSlots.length,
        rejectedRows: []
      });
      await reloadParticipantSlots(token, selectedStudyId);
      await reloadRuns(token, selectedStudyId);
    } catch (error) {
      setParticipantSlotError(error instanceof Error ? error.message : "Unable to generate participant slots.");
    } finally {
      setIsGeneratingParticipantSlots(false);
    }
  }

  async function handleArchiveParticipantSlot(participantSlot: ParticipantSlot) {
    setParticipantSlotError("");
    setParticipantSlotBulkSummary(null);

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setParticipantSlotError("Select a study before archiving participant slots.");
      return;
    }

    setIsArchivingParticipantSlotId(participantSlot.id);

    try {
      const response = await fetch(
        `${serviceBaseUrl}/researcher/studies/${selectedStudyId}/participant-slots/${participantSlot.id}/archive`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`
          }
        }
      );
      const payload = (await response.json()) as { participantSlot?: ParticipantSlot; message?: string };

      if (!response.ok || !payload.participantSlot) {
        throw new Error(payload.message ?? "Unable to archive participant slot.");
      }

      await reloadParticipantSlots(token, selectedStudyId);
      await reloadRuns(token, selectedStudyId);
    } catch (error) {
      setParticipantSlotError(error instanceof Error ? error.message : "Unable to archive participant slot.");
    } finally {
      setIsArchivingParticipantSlotId(null);
    }
  }

  async function handleCreateRuns(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunError("");

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setRunError("Select a study before creating runs.");
      return;
    }

    setIsCreatingRuns(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/runs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          participantSlotIds: selectedRunParticipantSlotIds
        })
      });
      const payload = (await response.json()) as { createdRuns?: Run[]; message?: string };

      if (!response.ok || !payload.createdRuns) {
        throw new Error(payload.message ?? "Unable to create runs.");
      }

      setSelectedRunParticipantSlotIds([]);
      await reloadRuns(token, selectedStudyId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Unable to create runs.");
    } finally {
      setIsCreatingRuns(false);
    }
  }

  async function handleOpenEvidenceCitation(runId: string, evidenceCitationId: string) {
    setSelectedEvidenceCitationError("");
    setSelectedEvidenceCitation(null);

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setSelectedEvidenceCitationError("Select a study before opening evidence.");
      return;
    }

    setIsLoadingEvidenceCitationId(evidenceCitationId);

    try {
      const resolvedCitation = await fetchResolvedEvidenceCitation(token, selectedStudyId, runId, evidenceCitationId);
      setSelectedEvidenceCitation(resolvedCitation);
      await openRawEvidence(runId, resolvedCitation.citation.sourceId);
    } catch (error) {
      setSelectedEvidenceCitationError(error instanceof Error ? error.message : "Unable to load citation evidence.");
    } finally {
      setIsLoadingEvidenceCitationId(null);
    }
  }

  async function openRawEvidence(runId: string, focusSourceId?: string) {
    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setRawEvidenceState({ status: "error", message: "Select a study before opening raw evidence." });
      return;
    }

    setIsLoadingRawEvidenceRunId(runId);
    setRawEvidenceState({ status: "loading" });

    try {
      const evidence = await fetchRawEvidence(token, selectedStudyId, runId);
      setRawEvidenceState({ status: "ready", evidence, ...(focusSourceId ? { focusSourceId } : {}) });
      window.setTimeout(() => {
        document.getElementById(focusSourceId ? `raw-evidence-${focusSourceId}` : "raw-evidence-panel")?.scrollIntoView({
          block: "nearest"
        });
      }, 0);
    } catch (error) {
      setRawEvidenceState({ status: "error", message: error instanceof Error ? error.message : "Unable to load raw evidence." });
    } finally {
      setIsLoadingRawEvidenceRunId(null);
    }
  }

  async function saveConsentVersion(skipConfirmation = false) {
    setConsentError("");

    const selectedConsentVersion =
      consentState.status === "ready"
        ? consentState.consentVersions.find((version) => version.versionNumber === selectedConsentVersionNumber)
        : undefined;

    if (selectedConsentVersion && !selectedConsentVersion.isActive) {
      setIsRestoreDialogOpen(true);
      return;
    }

    const activeConsentVersion = consentState.status === "ready" ? consentState.activeConsentVersion : undefined;
    const changes = getConsentChanges(activeConsentVersion, consentText, consentMethod);

    if (activeConsentVersion && changes.length === 0) {
      setConsentError("No consent changes to save. The active version already matches this draft.");
      return;
    }

    if (activeConsentVersion && !skipConfirmation) {
      setPendingVersionConfirmation({ kind: "consent", changes });
      return;
    }

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setConsentError("Select a study before configuring consent.");
      return;
    }

    setIsSavingConsent(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/consent`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          consentText,
          consentMethod
        })
      });
      const payload = (await response.json()) as { consentVersion?: ConsentVersion; message?: string };

      if (!response.ok || !payload.consentVersion) {
        throw new Error(payload.message ?? "Unable to save consent.");
      }

      const consent = await fetchConsent(token, selectedStudyId);
      setConsentState({ status: "ready", ...consent });
      loadConsentForm(consent.activeConsentVersion);
      await reloadStudies(token, selectedStudyId);
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : "Unable to save consent.");
    } finally {
      setIsSavingConsent(false);
    }
  }

  async function handleSaveConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveConsentVersion();
  }

  function addSurveyQuestion() {
    setSurveyItems((items) => [...items, { type: "question", prompt: "" }]);
  }

  function addSurveyGroup() {
    setSurveyItems((items) => [...items, { type: "group", title: "", questions: [""] }]);
  }

  function moveSurveyItem(index: number, direction: -1 | 1) {
    setSurveyItems((items) => {
      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex >= items.length) {
        return items;
      }

      const nextItems = [...items];
      [nextItems[index], nextItems[nextIndex]] = [nextItems[nextIndex], nextItems[index]];
      return nextItems;
    });
  }

  function updateSurveyQuestion(index: number, value: string) {
    setSurveyItems((items) =>
      items.map((item, itemIndex) => (itemIndex === index && item.type === "question" ? { ...item, prompt: value } : item))
    );
  }

  function removeSurveyItem(index: number) {
    setSurveyItems((items) => {
      const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
      return nextItems.length > 0 ? nextItems : [{ type: "question", prompt: "" }];
    });
  }

  function updateSurveyGroupTitle(index: number, title: string) {
    setSurveyItems((items) =>
      items.map((item, itemIndex) => (itemIndex === index && item.type === "group" ? { ...item, title } : item))
    );
  }

  function updateGroupedQuestion(itemIndex: number, questionIndex: number, prompt: string) {
    setSurveyItems((items) =>
      items.map((item, currentItemIndex) =>
        currentItemIndex === itemIndex && item.type === "group"
          ? {
              ...item,
              questions: item.questions.map((question, currentQuestionIndex) =>
                currentQuestionIndex === questionIndex ? prompt : question
              )
            }
          : item
      )
    );
  }

  function addGroupedQuestion(itemIndex: number) {
    setSurveyItems((items) =>
      items.map((item, currentItemIndex) =>
        currentItemIndex === itemIndex && item.type === "group"
          ? { ...item, questions: [...item.questions, ""] }
          : item
      )
    );
  }

  function removeGroupedQuestion(itemIndex: number, questionIndex: number) {
    setSurveyItems((items) =>
      items.map((item, currentItemIndex) => {
        if (currentItemIndex !== itemIndex || item.type !== "group") {
          return item;
        }

        const nextQuestions = item.questions.filter((_, currentQuestionIndex) => currentQuestionIndex !== questionIndex);

        return {
          ...item,
          questions: nextQuestions.length > 0 ? nextQuestions : [""]
        };
      })
    );
  }

  async function saveSurveyVersion(skipConfirmation = false) {
    setSurveyError("");

    const selectedSurveyVersion =
      surveyState.status === "ready"
        ? surveyState.surveyVersions.find((version) => version.versionNumber === selectedSurveyVersionNumber)
        : undefined;

    if (selectedSurveyVersion && !selectedSurveyVersion.isActive) {
      setIsRestoreSurveyDialogOpen(true);
      return;
    }

    const activeSurveyVersion = surveyState.status === "ready" ? surveyState.activeSurveyVersion : undefined;
    const changes = getSurveyChanges(activeSurveyVersion, surveyItems);

    if (activeSurveyVersion && changes.length === 0) {
      setSurveyError("No survey changes to save. The active version already matches this draft.");
      return;
    }

    if (activeSurveyVersion && !skipConfirmation) {
      setPendingVersionConfirmation({ kind: "survey", changes });
      return;
    }

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setSurveyError("Select a study before configuring the survey.");
      return;
    }

    setIsSavingSurvey(true);

    try {
      const items = createSurveySnapshot(surveyItems).map((item) =>
        item.type === "question"
          ? ({
              type: "question",
              question: {
                prompt: item.prompt
              }
            } as const)
          : ({
              type: "group",
              group: {
                title: item.title,
                questions: item.questions.map((prompt) => ({ prompt }))
              }
            } as const)
      );
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/survey`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          items
        })
      });
      const payload = (await response.json()) as { surveyVersion?: SurveyVersion; message?: string };

      if (!response.ok || !payload.surveyVersion) {
        throw new Error(payload.message ?? "Unable to save survey.");
      }

      const survey = await fetchSurvey(token, selectedStudyId);
      setSurveyState({ status: "ready", ...survey });
      loadSurveyForm(survey.activeSurveyVersion);
      await reloadStudies(token, selectedStudyId);
    } catch (error) {
      setSurveyError(error instanceof Error ? error.message : "Unable to save survey.");
    } finally {
      setIsSavingSurvey(false);
    }
  }

  async function handleSaveSurvey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveSurveyVersion();
  }

  function addObjective() {
    setObjectiveDrafts((objectives) => [...objectives, createEmptyObjectiveDraft()]);
  }

  function removeObjective(index: number) {
    setObjectiveDrafts((objectives) => {
      const nextObjectives = objectives.filter((_, objectiveIndex) => objectiveIndex !== index);
      return nextObjectives.length > 0 ? nextObjectives : [createEmptyObjectiveDraft()];
    });
  }

  function moveObjective(index: number, direction: -1 | 1) {
    setObjectiveDrafts((objectives) => {
      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex >= objectives.length) {
        return objectives;
      }

      const nextObjectives = [...objectives];
      [nextObjectives[index], nextObjectives[nextIndex]] = [nextObjectives[nextIndex], nextObjectives[index]];
      return nextObjectives;
    });
  }

  function updateObjective(index: number, patch: Partial<ObjectiveDraft>) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, objectiveIndex) => (objectiveIndex === index ? { ...objective, ...patch } : objective))
    );
  }

  function updateObjectiveGradeLabel(objectiveIndex: number, gradeIndex: number, label: string) {
    setObjectiveError("");
    setObjectiveErrorDialog("");
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? {
              ...objective,
              gradeLabels: objective.gradeLabels.map((gradeLabel, currentGradeIndex) =>
                currentGradeIndex === gradeIndex ? label : gradeLabel
              )
            }
          : objective
      )
    );
  }

  function addObjectiveGradeLabel(objectiveIndex: number) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? { ...objective, gradeLabels: [...objective.gradeLabels, ""] }
          : objective
      )
    );
  }

  function removeObjectiveGradeLabel(objectiveIndex: number, gradeIndex: number) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) => {
        if (currentObjectiveIndex !== objectiveIndex) {
          return objective;
        }

        const removedLabel = objective.gradeLabels[gradeIndex];
        const nextGradeLabels = objective.gradeLabels.filter((_, currentGradeIndex) => currentGradeIndex !== gradeIndex);

        return {
          ...objective,
          gradeLabels: nextGradeLabels.length > 0 ? nextGradeLabels : [""],
          gradeExamples: objective.gradeExamples.filter((example) => example.gradeLabel !== removedLabel)
        };
      })
    );
  }

  function addObjectiveGradeExample(objectiveIndex: number) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? {
              ...objective,
              gradeExamples: [
                ...objective.gradeExamples,
                {
                  gradeLabel: objective.gradeLabels[0] ?? "",
                  exampleText: ""
                }
              ]
            }
          : objective
      )
    );
  }

  function updateObjectiveGradeExample(
    objectiveIndex: number,
    exampleIndex: number,
    patch: Partial<ObjectiveDraft["gradeExamples"][number]>
  ) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? {
              ...objective,
              gradeExamples: objective.gradeExamples.map((example, currentExampleIndex) =>
                currentExampleIndex === exampleIndex ? { ...example, ...patch } : example
              )
            }
          : objective
      )
    );
  }

  function removeObjectiveGradeExample(objectiveIndex: number, exampleIndex: number) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? {
              ...objective,
              gradeExamples: objective.gradeExamples.filter((_, currentExampleIndex) => currentExampleIndex !== exampleIndex)
            }
          : objective
      )
    );
  }

  async function saveObjectiveVersion(objectiveIndex: number, skipConfirmation = false) {
    setObjectiveError("");
    setObjectiveErrorDialog("");
    const showObjectiveVersionError = (message: string) => {
      setObjectiveError(message);
      setObjectiveErrorDialog(message);
    };

    const objective = objectiveDrafts[objectiveIndex];
    const objectiveKey = objective?.objectiveKey;
    const selectedObjectiveVersion =
      objectiveState.status === "ready" && objectiveKey
        ? objectiveState.objectiveVersions.find(
            (version) => version.id === selectedObjectiveVersionIds[objectiveKey]
          )
        : undefined;

    if (selectedObjectiveVersion && !selectedObjectiveVersion.isActive) {
      setRestoreObjectiveVersionId(selectedObjectiveVersion.id);
      setIsRestoreObjectiveDialogOpen(true);
      return;
    }

    if (!objective) {
      showObjectiveVersionError("Select an objective before saving.");
      return;
    }

    const objectiveGradeLabelError = getDuplicateGradeLabelError([objective]);

    if (objectiveGradeLabelError) {
      showObjectiveVersionError(objectiveGradeLabelError);
      return;
    }

    const activeObjectiveVersions = objectiveState.status === "ready" ? objectiveState.activeObjectiveVersions : [];
    const scopedObjectiveDrafts = buildScopedObjectiveDraftsForSave(objectiveDrafts, activeObjectiveVersions, objectiveIndex);
    const changes = getObjectiveChanges(activeObjectiveVersions, scopedObjectiveDrafts);

    if (activeObjectiveVersions.length > 0 && changes.length === 0) {
      showObjectiveVersionError("No objective changes to save. The active version already matches this draft.");
      return;
    }

    if (activeObjectiveVersions.length > 0 && !skipConfirmation) {
      setPendingVersionConfirmation({ kind: "objectives", objectiveIndex, changes });
      return;
    }

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      showObjectiveVersionError("Select a study before configuring objectives.");
      return;
    }

    setIsSavingObjectives(true);

    try {
      const objectives = createObjectiveSnapshot(scopedObjectiveDrafts);
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/objectives`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          objectives
        })
      });
      const payload = (await response.json()) as { objectiveVersions?: ObjectiveVersion[]; message?: string };

      if (!response.ok || !payload.objectiveVersions) {
        throw new Error(payload.message ?? "Unable to save objectives.");
      }

      const objectivesPayload = await fetchObjectives(token, selectedStudyId);
      setObjectiveState({ status: "ready", ...objectivesPayload });
      loadObjectiveForm(objectivesPayload.activeObjectiveVersions);
    } catch (error) {
      showObjectiveVersionError(error instanceof Error ? error.message : "Unable to save objectives.");
    } finally {
      setIsSavingObjectives(false);
    }
  }

  async function handleSaveObjectives(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  function handleSelectConsentVersion(consentVersion: ConsentVersion) {
    setSelectedConsentVersionNumber(consentVersion.versionNumber);
    setConsentText(consentVersion.consentText);
    setConsentMethod(consentVersion.consentMethod);
    setConsentError("");
    setIsRestoreDialogOpen(false);
  }

  function handleSelectSurveyVersion(surveyVersion: SurveyVersion) {
    setSelectedSurveyVersionNumber(surveyVersion.versionNumber);
    loadSurveyForm(surveyVersion);
  }

  function handleSelectObjectiveVersion(objectiveIndex: number, objectiveVersion: ObjectiveVersion) {
    if (objectiveVersion.isActive) {
      setSelectedObjectiveVersionIds((selectedIds) => {
        const nextSelectedIds = { ...selectedIds };
        delete nextSelectedIds[objectiveVersion.objectiveKey];
        return nextSelectedIds;
      });
      setObjectiveDrafts((drafts) => replaceObjectiveDraft(drafts, objectiveIndex, objectiveVersion));
      return;
    }

    setSelectedObjectiveVersionIds((selectedIds) => ({
      ...selectedIds,
      [objectiveVersion.objectiveKey]: objectiveVersion.id
    }));
    setObjectiveDrafts((drafts) => replaceObjectiveDraft(drafts, objectiveIndex, objectiveVersion));
  }

  async function handleConfirmRestoreConsent() {
    setConsentError("");

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId || selectedConsentVersionNumber === null) {
      setConsentError("Select a previous consent version before restoring.");
      setIsRestoreDialogOpen(false);
      return;
    }

    setIsSavingConsent(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/consent/restore`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          versionNumber: selectedConsentVersionNumber
        })
      });
      const payload = (await response.json()) as { consentVersion?: ConsentVersion; message?: string };

      if (!response.ok || !payload.consentVersion) {
        throw new Error(payload.message ?? "Unable to restore consent.");
      }

      const consent = await fetchConsent(token, selectedStudyId);
      setConsentState({ status: "ready", ...consent });
      loadConsentForm(consent.activeConsentVersion);
      await reloadStudies(token, selectedStudyId);
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : "Unable to restore consent.");
    } finally {
      setIsSavingConsent(false);
      setIsRestoreDialogOpen(false);
    }
  }

  async function handleConfirmRestoreSurvey() {
    setSurveyError("");

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId || selectedSurveyVersionNumber === null) {
      setSurveyError("Select a previous survey version before restoring.");
      setIsRestoreSurveyDialogOpen(false);
      return;
    }

    setIsSavingSurvey(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/survey/restore`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          versionNumber: selectedSurveyVersionNumber
        })
      });
      const payload = (await response.json()) as { surveyVersion?: SurveyVersion; message?: string };

      if (!response.ok || !payload.surveyVersion) {
        throw new Error(payload.message ?? "Unable to restore survey.");
      }

      const survey = await fetchSurvey(token, selectedStudyId);
      setSurveyState({ status: "ready", ...survey });
      loadSurveyForm(survey.activeSurveyVersion);
      await reloadStudies(token, selectedStudyId);
    } catch (error) {
      setSurveyError(error instanceof Error ? error.message : "Unable to restore survey.");
    } finally {
      setIsSavingSurvey(false);
      setIsRestoreSurveyDialogOpen(false);
    }
  }

  async function handleConfirmRestoreObjective() {
    setObjectiveError("");

    const token = localStorage.getItem(accessTokenStorageKey);
    const selectedObjectiveVersion =
      objectiveState.status === "ready"
        ? objectiveState.objectiveVersions.find((version) => version.id === restoreObjectiveVersionId)
        : undefined;

    if (!token || !selectedStudyId || !selectedObjectiveVersion) {
      setObjectiveError("Select a previous objective version before restoring.");
      setIsRestoreObjectiveDialogOpen(false);
      return;
    }

    setIsSavingObjectives(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/objectives/restore`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          objectiveKey: selectedObjectiveVersion.objectiveKey,
          versionNumber: selectedObjectiveVersion.versionNumber
        })
      });
      const payload = (await response.json()) as { objectiveVersion?: ObjectiveVersion; message?: string };

      if (!response.ok || !payload.objectiveVersion) {
        throw new Error(payload.message ?? "Unable to restore objective.");
      }

      const objectivesPayload = await fetchObjectives(token, selectedStudyId);
      setObjectiveState({ status: "ready", ...objectivesPayload });
      loadObjectiveForm(objectivesPayload.activeObjectiveVersions);
    } catch (error) {
      setObjectiveError(error instanceof Error ? error.message : "Unable to restore objective.");
    } finally {
      setIsSavingObjectives(false);
      setRestoreObjectiveVersionId(null);
      setIsRestoreObjectiveDialogOpen(false);
    }
  }

  async function handleConfirmCreateVersion() {
    const pending = pendingVersionConfirmation;
    setPendingVersionConfirmation(null);

    if (!pending) {
      return;
    }

    if (pending.kind === "consent") {
      await saveConsentVersion(true);
      return;
    }

    if (pending.kind === "survey") {
      await saveSurveyVersion(true);
      return;
    }

    await saveObjectiveVersion(pending.objectiveIndex, true);
  }

  if (isParticipantRoute) {
    return <Participant onNavigateToResearcherSignIn={() => navigate("/")} />;
  }

  if (session.status === "checking") {
    return (
      <main className="app-shell">
        <section className="workspace-panel compact-panel" aria-live="polite">
          <p className="eyebrow">EducationResearcher</p>
          <h1>Checking session</h1>
        </section>
      </main>
    );
  }

  if (session.status === "signed-in") {
    const studies = studiesState.status === "ready" ? studiesState.studies : [];
    const selectedStudy = studies.find((study) => study.id === selectedStudyId);
    const selectedConsentVersion =
      consentState.status === "ready"
        ? consentState.consentVersions.find((version) => version.versionNumber === selectedConsentVersionNumber)
        : undefined;
    const isPreviewingPreviousConsent = Boolean(selectedConsentVersion && !selectedConsentVersion.isActive);
    const activeSurveyVersion = surveyState.status === "ready" ? surveyState.activeSurveyVersion : undefined;
    const selectedSurveyVersion =
      surveyState.status === "ready"
        ? surveyState.surveyVersions.find((version) => version.versionNumber === selectedSurveyVersionNumber)
        : undefined;
    const isPreviewingPreviousSurvey = Boolean(selectedSurveyVersion && !selectedSurveyVersion.isActive);
    const activeObjectiveVersions = objectiveState.status === "ready" ? objectiveState.activeObjectiveVersions : [];
    const selectedObjectiveVersion =
      objectiveState.status === "ready"
        ? objectiveState.objectiveVersions.find((version) => version.id === restoreObjectiveVersionId)
        : undefined;
    const isPreviewingPreviousObjective = Object.values(selectedObjectiveVersionIds).some((versionId) =>
      objectiveState.status === "ready"
        ? objectiveState.objectiveVersions.some((version) => version.id === versionId && !version.isActive)
        : false
    );
    const participantSlots = participantSlotState.status === "ready" ? participantSlotState.participantSlots : [];

    return (
      <Researcher
        activeStudySetupTab={activeStudySetupTab}
        consentPanel={
          <ResearcherConsent
            activeStudySetupTab={activeStudySetupTab}
            consentError={consentError}
            consentMethod={consentMethod}
            consentState={consentState}
            consentText={consentText}
            isPreviewingPreviousConsent={isPreviewingPreviousConsent}
            isSavingConsent={isSavingConsent}
            selectedConsentVersion={selectedConsentVersion}
            selectedConsentVersionNumber={selectedConsentVersionNumber}
            selectedStudy={selectedStudy}
            onConsentMethodChange={setConsentMethod}
            onConsentTextChange={setConsentText}
            onSaveConsent={handleSaveConsent}
            onSelectConsentVersion={handleSelectConsentVersion}
          />
        }
        dialogs={
          <>
          {pendingVersionConfirmation ? (
            <div className="dialog-backdrop" role="presentation">
              <div aria-labelledby="create-version-title" aria-modal="true" className="confirm-dialog version-diff-dialog" role="dialog">
                <h2 id="create-version-title">
                  Create new {pendingVersionConfirmation.kind === "objectives" ? "objective" : pendingVersionConfirmation.kind} version?
                </h2>
                <p>Review the changes that will be captured in the next active version.</p>
                <dl className="version-diff-list">
                  {pendingVersionConfirmation.changes.map((change) => (
                    <div className="version-diff-row" key={change.label}>
                      <dt>{change.label}</dt>
                      <dd>
                        <span className="diff-before">{change.before}</span>
                        <span className="diff-arrow" aria-hidden="true">
                          to
                        </span>
                        <span className="diff-after">{change.after}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="form-actions">
                  <button
                    className="primary-button"
                    disabled={isSavingConsent || isSavingSurvey || isSavingObjectives}
                    onClick={handleConfirmCreateVersion}
                    type="button"
                  >
                    Create new version
                  </button>
                  <button
                    className="secondary-button"
                    disabled={isSavingConsent || isSavingSurvey || isSavingObjectives}
                    onClick={() => setPendingVersionConfirmation(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {isRestoreDialogOpen && selectedConsentVersion ? (
            <div className="dialog-backdrop" role="presentation">
              <div aria-labelledby="restore-consent-title" aria-modal="true" className="confirm-dialog" role="dialog">
                <h2 id="restore-consent-title">Restore consent version {selectedConsentVersion.versionNumber}?</h2>
                <p>
                  You cannot undo this action. Versions after version {selectedConsentVersion.versionNumber} will be removed, and this version will become current.
                </p>
                <div className="form-actions">
                  <button className="danger-button" disabled={isSavingConsent} onClick={handleConfirmRestoreConsent} type="button">
                    Restore Version
                  </button>
                  <button className="secondary-button" disabled={isSavingConsent} onClick={() => setIsRestoreDialogOpen(false)} type="button">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {isRestoreSurveyDialogOpen && selectedSurveyVersion ? (
            <div className="dialog-backdrop" role="presentation">
              <div aria-labelledby="restore-survey-title" aria-modal="true" className="confirm-dialog" role="dialog">
                <h2 id="restore-survey-title">Restore survey version {selectedSurveyVersion.versionNumber}?</h2>
                <p>
                  You cannot undo this action. Versions after version {selectedSurveyVersion.versionNumber} will be removed, and this version will become current.
                </p>
                <div className="form-actions">
                  <button className="danger-button" disabled={isSavingSurvey} onClick={handleConfirmRestoreSurvey} type="button">
                    Restore Version
                  </button>
                  <button className="secondary-button" disabled={isSavingSurvey} onClick={() => setIsRestoreSurveyDialogOpen(false)} type="button">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {isRestoreObjectiveDialogOpen && selectedObjectiveVersion ? (
            <div className="dialog-backdrop" role="presentation">
              <div aria-labelledby="restore-objective-title" aria-modal="true" className="confirm-dialog" role="dialog">
                <h2 id="restore-objective-title">
                  Restore {selectedObjectiveVersion.title} version {selectedObjectiveVersion.versionNumber}?
                </h2>
                <p>
                  You cannot undo this action. Later versions of this objective will be removed, and this version will become current.
                </p>
                <div className="form-actions">
                  <button className="danger-button" disabled={isSavingObjectives} onClick={handleConfirmRestoreObjective} type="button">
                    Restore Version
                  </button>
                  <button
                    className="secondary-button"
                    disabled={isSavingObjectives}
                    onClick={() => {
                      setRestoreObjectiveVersionId(null);
                      setIsRestoreObjectiveDialogOpen(false);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {objectiveErrorDialog ? (
            <div className="dialog-backdrop" role="presentation">
              <div aria-labelledby="objective-error-title" aria-modal="true" className="confirm-dialog" role="alertdialog">
                <h2 id="objective-error-title">Objective version was not created</h2>
                <p>{objectiveErrorDialog}</p>
                <div className="form-actions">
                  <button className="primary-button" onClick={() => setObjectiveErrorDialog("")} type="button">
                    Close
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          </>
        }
        scoringPanel={
          <ResearcherScoring
            activeObjectiveVersions={activeObjectiveVersions}
            activeStudySetupTab={activeStudySetupTab}
            duplicateGradeLabelError={duplicateGradeLabelError}
            isPreviewingPreviousObjective={isPreviewingPreviousObjective}
            isSavingObjectives={isSavingObjectives}
            objectiveDrafts={objectiveDrafts}
            objectiveError={objectiveError}
            objectiveState={objectiveState}
            selectedObjectiveVersionIds={selectedObjectiveVersionIds}
            selectedStudy={selectedStudy}
            onAddObjective={addObjective}
            onAddObjectiveGradeExample={addObjectiveGradeExample}
            onAddObjectiveGradeLabel={addObjectiveGradeLabel}
            onMoveObjective={moveObjective}
            onRemoveObjective={removeObjective}
            onRemoveObjectiveGradeExample={removeObjectiveGradeExample}
            onRemoveObjectiveGradeLabel={removeObjectiveGradeLabel}
            onSaveObjectiveVersion={saveObjectiveVersion}
            onSaveObjectives={handleSaveObjectives}
            onSelectObjectiveVersion={handleSelectObjectiveVersion}
            onUpdateObjective={updateObjective}
            onUpdateObjectiveGradeExample={updateObjectiveGradeExample}
            onUpdateObjectiveGradeLabel={updateObjectiveGradeLabel}
          />
        }
        runsPanel={
          <ResearcherRuns
            activeStudySetupTab={activeStudySetupTab}
            isCreatingRuns={isCreatingRuns}
            isExportingScores={isExportingScores}
            isLoadingEvidenceCitationId={isLoadingEvidenceCitationId}
            isLoadingRawEvidenceRunId={isLoadingRawEvidenceRunId}
            participantSlots={participantSlots}
            rawEvidenceState={rawEvidenceState}
            runError={runError}
            runDashboardState={runDashboardState}
            runState={runState}
            scoreReviewState={scoreReviewState}
            selectedEvidenceCitation={selectedEvidenceCitation}
            selectedEvidenceCitationError={selectedEvidenceCitationError}
            selectedRunParticipantSlotIds={selectedRunParticipantSlotIds}
            selectedStudy={selectedStudy}
            onCreateRuns={handleCreateRuns}
            onDismissEvidenceCitation={() => {
              setSelectedEvidenceCitation(null);
              setSelectedEvidenceCitationError("");
            }}
            onDismissRawEvidence={() => setRawEvidenceState({ status: "idle" })}
            onExportScores={handleExportScores}
            onOpenEvidenceCitation={handleOpenEvidenceCitation}
            onOpenRawEvidence={openRawEvidence}
            onManualRescore={handleManualRescore}
            onSelectedRunParticipantSlotIdsChange={setSelectedRunParticipantSlotIds}
            isRescoringRunId={isRescoringRunId}
            rescoreError={rescoreError}
            scoreExportError={scoreExportError}
          />
        }
        selectedStudyId={selectedStudyId}
        shellPanel={
          <>
            <ResearcherShell
              activeStudySetupTab={activeStudySetupTab}
              freshnessDays={freshnessDays}
              isSavingStudy={isSavingStudy}
              maxInterviewMinutes={maxInterviewMinutes}
              selectedStudy={selectedStudy}
              studyError={studyError}
              studyTitleFocusRequest={studyTitleFocusRequest}
              studyTitle={studyTitle}
              onFreshnessDaysChange={setFreshnessDays}
              onMaxInterviewMinutesChange={setMaxInterviewMinutes}
              onNavigateToParticipantDemo={() => navigate('/participant/demo')}
              onSaveStudy={handleSaveStudy}
              onStudyTitleChange={setStudyTitle}
            />
            <ResearcherParticipantSlots
              activeStudySetupTab={activeStudySetupTab}
              generatedParticipantSlotCount={generatedParticipantSlotCount}
              isArchivingParticipantSlotId={isArchivingParticipantSlotId}
              isGeneratingParticipantSlots={isGeneratingParticipantSlots}
              isImportingParticipantSlots={isImportingParticipantSlots}
              isSavingParticipantSlot={isSavingParticipantSlot}
              participantCode={participantCode}
              participantSlotBulkSummary={participantSlotBulkSummary}
              participantSlotCsv={participantSlotCsv}
              participantSlotError={participantSlotError}
              participantSlotState={participantSlotState}
              selectedStudy={selectedStudy}
              onArchiveParticipantSlot={handleArchiveParticipantSlot}
              onGenerateParticipantSlots={handleGenerateParticipantSlots}
              onGeneratedParticipantSlotCountChange={setGeneratedParticipantSlotCount}
              onImportParticipantSlots={handleImportParticipantSlots}
              onParticipantCodeChange={setParticipantCode}
              onParticipantSlotCsvChange={setParticipantSlotCsv}
              onSaveParticipantSlot={handleSaveParticipantSlot}
            />
          </>
        }
        studies={studies}
        studiesState={studiesState}
        surveyPanel={
          <ResearcherSurvey
            activeStudySetupTab={activeStudySetupTab}
            activeSurveyVersion={activeSurveyVersion}
            isPreviewingPreviousSurvey={isPreviewingPreviousSurvey}
            isSavingSurvey={isSavingSurvey}
            selectedStudy={selectedStudy}
            selectedSurveyVersion={selectedSurveyVersion}
            selectedSurveyVersionNumber={selectedSurveyVersionNumber}
            surveyError={surveyError}
            surveyItems={surveyItems}
            surveyState={surveyState}
            onAddGroupedQuestion={addGroupedQuestion}
            onAddSurveyGroup={addSurveyGroup}
            onAddSurveyQuestion={addSurveyQuestion}
            onMoveSurveyItem={moveSurveyItem}
            onRemoveGroupedQuestion={removeGroupedQuestion}
            onRemoveSurveyItem={removeSurveyItem}
            onSaveSurvey={handleSaveSurvey}
            onSelectSurveyVersion={handleSelectSurveyVersion}
            onUpdateGroupedQuestion={updateGroupedQuestion}
            onUpdateSurveyGroupTitle={updateSurveyGroupTitle}
            onUpdateSurveyQuestion={updateSurveyQuestion}
          />
        }
        user={session.user}
        onLoadStudyForm={loadStudyForm}
        onResetStudyForm={resetStudyForm}
        onSignOut={handleSignOut}
        onStudySetupTabChange={setActiveStudySetupTab}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="auth-layout" aria-labelledby="signin-title">
        <div className="auth-copy">
          <p className="eyebrow">EducationResearcher</p>
          <h1 id="signin-title">Researcher sign-in</h1>
          <p>Use your researcher account to configure studies and review evidence.</p>
        </div>
        <form className="login-form" onSubmit={handleSignIn}>
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {authError ? <p className="form-error">{authError}</p> : null}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Signing in" : "Sign in"}
          </button>
          <button className="secondary-button" type="button" onClick={() => navigate("/participant/demo")}>
            Participant demo
          </button>
        </form>
      </section>
    </main>
  );
}
