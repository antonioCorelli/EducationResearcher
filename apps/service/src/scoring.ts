import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";
import {
  StructuredOutputValidationError,
  executeStructuredAiCall,
  type AiModelMetadata,
  type StructuredAiProvider
} from "./ai-provider.js";
import type { GapMap } from "./gap-map.js";
import type { ObjectiveVersion, ObjectiveVersionStore } from "./objectives.js";
import {
  applyRunStatusTransition,
  type InterviewAudioAsset,
  type InterviewTurn,
  type Run,
  type RunStatus,
  type RunStore,
  type SurveyResponse
} from "./runs.js";

export const SCORING_PROMPT_VERSION = "scoring-v1";

export type ScoringTrigger = "automatic" | "manual_rescore";
export type ScoringRunStatus = "completed";
export type ScoreFlag =
  | "low_confidence"
  | "missing_interview_evidence"
  | "survey_interview_contradiction"
  | "stale_run"
  | "partial_run"
  | "technical_interruption";
export type EvidenceCitationSourceType = "survey_response" | "interview_turn" | "audio_span";

export interface ScoringEvidenceCitationOutput {
  readonly sourceType: EvidenceCitationSourceType;
  readonly sourceId: string;
  readonly quote: string;
  readonly audioStartMs?: number;
  readonly audioEndMs?: number;
}

export interface ObjectiveScoreOutput {
  readonly objectiveVersionId: string;
  readonly gradeLabel: string;
  readonly confidence: number;
  readonly rationale: string;
  readonly flags: readonly ScoreFlag[];
  readonly citations: readonly ScoringEvidenceCitationOutput[];
}

export interface ScoringGeneratorOutput {
  readonly modelName: string;
  readonly modelVersion: string;
  readonly serviceRequestId: string;
  readonly promptVersion: string;
  readonly objectiveVersionSetHash: string;
  readonly scores: readonly ObjectiveScoreOutput[];
}

export interface ScoringGenerationInput {
  readonly run: Run;
  readonly surveyResponses: readonly SurveyResponse[];
  readonly interviewTurns?: readonly InterviewTurn[];
  readonly interviewAudioAssets?: readonly InterviewAudioAsset[];
  readonly gapMap?: GapMap;
  readonly objectiveVersions: readonly ObjectiveVersion[];
  readonly trigger: ScoringTrigger;
}

export interface ScoringGenerator {
  generate(input: ScoringGenerationInput): Promise<ScoringGeneratorOutput>;
}

export interface ScoringRun {
  readonly id: string;
  readonly runId: string;
  readonly status: ScoringRunStatus;
  readonly trigger: ScoringTrigger;
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

export interface PersistedScoringRun {
  readonly scoringRun: ScoringRun;
  readonly objectiveScores: readonly ObjectiveScore[];
  readonly evidenceCitations: readonly EvidenceCitation[];
  readonly run: Run;
}

export type ResolvedEvidenceCitationSource =
  | {
      readonly type: "survey_response";
      readonly surveyResponse: SurveyResponse;
    }
  | {
      readonly type: "interview_turn";
      readonly interviewTurn: InterviewTurn;
    }
  | {
      readonly type: "audio_span";
      readonly audioAsset: InterviewAudioAsset;
      readonly audioStartMs: number;
      readonly audioEndMs: number;
    };

export interface ResolvedEvidenceCitation {
  readonly citation: EvidenceCitation;
  readonly source: ResolvedEvidenceCitationSource;
}

export interface ResearcherObjectiveScoreReview {
  readonly objectiveVersion: Pick<ObjectiveVersion, "id" | "objectiveKey" | "versionNumber" | "title" | "sortOrder"> & {
    readonly status?: "missing";
  };
  readonly score: ObjectiveScore;
  readonly citations: readonly EvidenceCitation[];
}

export interface ResearcherRunScoreReview {
  readonly run: Run;
  readonly scoringRun?: ScoringRun;
  readonly objectiveScores: readonly ResearcherObjectiveScoreReview[];
}

export interface ScoringStore {
  saveScoringRun(input: {
    readonly scoringRun: ScoringRun;
    readonly objectiveScores: readonly ObjectiveScore[];
    readonly evidenceCitations: readonly EvidenceCitation[];
  }): Promise<{
    readonly scoringRun: ScoringRun;
    readonly objectiveScores: readonly ObjectiveScore[];
    readonly evidenceCitations: readonly EvidenceCitation[];
  }>;
  listScoringRunsByRun(runId: string): Promise<ScoringRun[]>;
  listObjectiveScoresByScoringRun(scoringRunId: string): Promise<ObjectiveScore[]>;
  listEvidenceCitationsByObjectiveScore(objectiveScoreId: string): Promise<EvidenceCitation[]>;
  getEvidenceCitationByRun(runId: string, evidenceCitationId: string): Promise<EvidenceCitation | undefined>;
}

export interface ScoringServiceOptions {
  readonly now?: () => Date;
  readonly createScoringRunId?: () => string;
  readonly createObjectiveScoreId?: () => string;
  readonly createEvidenceCitationId?: () => string;
}

export interface AutomaticScoringTriggerInput {
  readonly run: Run;
  readonly previousStatus: RunStatus;
  readonly triggeredAt: string;
  readonly context?: {
    readonly staleRun?: boolean;
    readonly partialRun?: boolean;
    readonly technicalInterruption?: boolean;
  };
}

export class ScoringOutputValidationError extends StructuredOutputValidationError {
  constructor(readonly safeMessage = "Scoring output was invalid.") {
    super(safeMessage);
    this.name = "ScoringOutputValidationError";
  }
}

export class FakeScoringAiProvider implements StructuredAiProvider<ScoringGenerationInput> {
  async completeStructured(request: {
    readonly promptVersion: string;
    readonly input: ScoringGenerationInput;
  }) {
    const input = request.input;
    const firstSurveyResponse = input.surveyResponses[0];
    const firstInterviewTurn = input.interviewTurns?.[0];
    const defaultCitations: readonly ScoringEvidenceCitationOutput[] = firstInterviewTurn
      ? [
          {
            sourceType: "interview_turn",
            sourceId: firstInterviewTurn.id,
            quote: firstInterviewTurn.text.slice(0, 500),
            ...(firstInterviewTurn.audioStartMs !== undefined ? { audioStartMs: firstInterviewTurn.audioStartMs } : {}),
            ...(firstInterviewTurn.audioEndMs !== undefined ? { audioEndMs: firstInterviewTurn.audioEndMs } : {})
          }
        ]
      : firstSurveyResponse
        ? [
            {
              sourceType: "survey_response",
              sourceId: firstSurveyResponse.id,
              quote: firstSurveyResponse.responseText.slice(0, 500)
            }
          ]
        : [];

    return {
      output: {
        scores: input.objectiveVersions.map((objective) => ({
          objectiveVersionId: objective.id,
          gradeLabel: objective.gradeScale[0] ?? "unscored",
          confidence: input.run.status === "stale" || input.run.status === "partial" ? 0.45 : 0.78,
          rationale: `Initial fake score for ${objective.title} based on available survey and interview evidence.`,
          flags: createDefaultFlags(input.run.status),
          citations: defaultCitations
        }))
      },
      metadata: {
        modelName: "fake-scoring",
        modelVersion: "local-1",
        serviceRequestId: "fake-scoring-request",
        promptVersion: request.promptVersion
      }
    };
  }
}

export class AiProviderScoringGenerator implements ScoringGenerator {
  constructor(private readonly provider: StructuredAiProvider<ScoringGenerationInput> = new FakeScoringAiProvider()) {}

  async generate(input: ScoringGenerationInput) {
    return executeStructuredAiCall({
      provider: this.provider,
      request: {
        passKind: "scoring",
        promptVersion: SCORING_PROMPT_VERSION,
        input
      },
      validate: (output, metadata) => parseScoringGeneratorOutput(output, metadata, input.objectiveVersions)
    });
  }
}

export function createConfiguredScoringGenerator() {
  return new AiProviderScoringGenerator();
}

export class ScoringValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "ScoringValidationError";
  }
}

export class ScoringNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "ScoringNotFoundError";
  }
}

export class ScoringService {
  private readonly now: () => Date;
  private readonly createScoringRunId: () => string;
  private readonly createObjectiveScoreId: () => string;
  private readonly createEvidenceCitationId: () => string;

  constructor(
    private readonly runStore: Pick<
      RunStore,
      | "getById"
      | "listByStudy"
      | "listSurveyResponsesByRun"
      | "listGapMapsByRun"
      | "listInterviewTurnsByRun"
      | "listInterviewAudioAssetsByRun"
      | "updateStatus"
    >,
    private readonly objectiveVersionStore: Pick<ObjectiveVersionStore, "listByStudy">,
    private readonly scoringStore: ScoringStore,
    options: ScoringServiceOptions = {},
    private readonly scoringGenerator: ScoringGenerator = createConfiguredScoringGenerator()
  ) {
    this.now = options.now ?? (() => new Date());
    this.createScoringRunId = options.createScoringRunId ?? (() => `scoring_run_${randomUUID()}`);
    this.createObjectiveScoreId = options.createObjectiveScoreId ?? (() => `objective_score_${randomUUID()}`);
    this.createEvidenceCitationId = options.createEvidenceCitationId ?? (() => `evidence_citation_${randomUUID()}`);
  }

  async triggerAutomaticScoring(input: AutomaticScoringTriggerInput) {
    return this.scoreRun(input.run.id, "automatic");
  }

  async listScoreReviewsForStudy(studyId: string): Promise<{ readonly scoreReviews: readonly ResearcherRunScoreReview[] }> {
    const runs = (await this.runStore.listByStudy(studyId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const objectiveVersions = await this.objectiveVersionStore.listByStudy(studyId);
    const objectiveVersionsById = new Map(objectiveVersions.map((objectiveVersion) => [objectiveVersion.id, objectiveVersion]));
    const scoreReviews = await Promise.all(
      runs.map(async (run): Promise<ResearcherRunScoreReview> => {
        const scoringRun = (await this.scoringStore.listScoringRunsByRun(run.id))[0];

        if (!scoringRun) {
          return {
            run,
            objectiveScores: []
          };
        }

        const objectiveScores = await this.scoringStore.listObjectiveScoresByScoringRun(scoringRun.id);
        const objectiveScoreReviews = await Promise.all(
          objectiveScores.map(async (score) => {
            const objectiveVersion = objectiveVersionsById.get(score.objectiveVersionId);

            return {
              objectiveVersion: objectiveVersion
                ? {
                    id: objectiveVersion.id,
                    objectiveKey: objectiveVersion.objectiveKey,
                    versionNumber: objectiveVersion.versionNumber,
                    title: objectiveVersion.title,
                    sortOrder: objectiveVersion.sortOrder
                  }
                : {
                    id: score.objectiveVersionId,
                    objectiveKey: score.objectiveVersionId,
                    versionNumber: 0,
                    title: "Archived objective",
                    sortOrder: Number.MAX_SAFE_INTEGER,
                    status: "missing" as const
                  },
              score,
              citations: await this.scoringStore.listEvidenceCitationsByObjectiveScore(score.id)
            };
          })
        );

        return {
          run,
          scoringRun,
          objectiveScores: objectiveScoreReviews.sort(
            (left, right) => left.objectiveVersion.sortOrder - right.objectiveVersion.sortOrder
          )
        };
      })
    );

    return {
      scoreReviews
    };
  }

  async resolveEvidenceCitation(input: {
    readonly studyId: string;
    readonly runId: string;
    readonly evidenceCitationId: string;
  }): Promise<ResolvedEvidenceCitation> {
    const run = await this.runStore.getById(input.runId);

    if (!run || run.studyId !== input.studyId) {
      throw new ScoringNotFoundError("Evidence citation was not found.");
    }

    const citation = await this.scoringStore.getEvidenceCitationByRun(input.runId, input.evidenceCitationId);

    if (!citation) {
      throw new ScoringNotFoundError("Evidence citation was not found.");
    }

    if (citation.sourceType === "survey_response") {
      const surveyResponse = (await this.runStore.listSurveyResponsesByRun(citation.runId)).find(
        (response) => response.id === citation.sourceId
      );

      if (!surveyResponse) {
        throw new ScoringNotFoundError("Citation source was not found.");
      }

      return {
        citation,
        source: {
          type: "survey_response",
          surveyResponse
        }
      };
    }

    if (citation.sourceType === "interview_turn") {
      const interviewTurn = (await this.runStore.listInterviewTurnsByRun(citation.runId)).find(
        (turn) => turn.id === citation.sourceId
      );

      if (!interviewTurn) {
        throw new ScoringNotFoundError("Citation source was not found.");
      }

      return {
        citation,
        source: {
          type: "interview_turn",
          interviewTurn
        }
      };
    }

    const audioAsset = (await this.runStore.listInterviewAudioAssetsByRun(citation.runId)).find(
      (asset) => asset.id === citation.sourceId
    );

    if (!audioAsset || citation.audioStartMs === undefined || citation.audioEndMs === undefined) {
      throw new ScoringNotFoundError("Citation source was not found.");
    }

    return {
      citation,
      source: {
        type: "audio_span",
        audioAsset,
        audioStartMs: citation.audioStartMs,
        audioEndMs: citation.audioEndMs
      }
    };
  }

  async scoreRun(runId: string, trigger: ScoringTrigger): Promise<PersistedScoringRun> {
    const run = await this.runStore.getById(runId);

    if (!run) {
      throw new ScoringValidationError("Run was not found.");
    }

    if (!SCOREABLE_RUN_STATUSES.includes(run.status as ScoreableRunStatus)) {
      throw new ScoringValidationError("Run is not ready for scoring.");
    }

    const existingScoringRuns = await this.scoringStore.listScoringRunsByRun(run.id);

    if (trigger === "automatic" && existingScoringRuns.some((scoringRun) => scoringRun.trigger === "automatic")) {
      const scoredRun = run.status === "scored" ? run : applyRunStatusTransition(run, "scored", this.now());
      return {
        scoringRun: existingScoringRuns[0],
        objectiveScores: [],
        evidenceCitations: [],
        run: scoredRun
      };
    }

    const objectiveVersions = await this.getObjectiveVersionsForRun(run);
    const surveyResponses = await this.runStore.listSurveyResponsesByRun(run.id);
    const gapMap = (await this.runStore.listGapMapsByRun(run.id)).find((candidate) => candidate.status === "generated");
    const interviewTurns = await this.runStore.listInterviewTurnsByRun(run.id);
    const interviewAudioAssets = await this.runStore.listInterviewAudioAssetsByRun(run.id);
    const generated = await this.scoringGenerator.generate({
      run,
      surveyResponses,
      interviewTurns,
      interviewAudioAssets,
      ...(gapMap ? { gapMap } : {}),
      objectiveVersions,
      trigger
    });
    const scoredAt = this.now().toISOString();
    const scoringRun: ScoringRun = {
      id: this.createScoringRunId(),
      runId: run.id,
      status: "completed",
      trigger,
      modelName: generated.modelName,
      modelVersion: generated.modelVersion,
      serviceRequestId: generated.serviceRequestId,
      promptVersion: generated.promptVersion,
      objectiveVersionSetHash: generated.objectiveVersionSetHash,
      scoredAt,
      createdAt: scoredAt
    };
    const objectiveScores: ObjectiveScore[] = [];
    const evidenceCitations: EvidenceCitation[] = [];

    for (const score of generated.scores) {
      const objectiveScore: ObjectiveScore = {
        id: this.createObjectiveScoreId(),
        scoringRunId: scoringRun.id,
        runId: run.id,
        objectiveVersionId: score.objectiveVersionId,
        gradeLabel: score.gradeLabel,
        confidence: score.confidence,
        rationale: score.rationale,
        flags: score.flags,
        createdAt: scoredAt
      };

      objectiveScores.push(objectiveScore);

      for (const citation of score.citations) {
        evidenceCitations.push({
          id: this.createEvidenceCitationId(),
          objectiveScoreId: objectiveScore.id,
          runId: run.id,
          sourceType: citation.sourceType,
          sourceId: citation.sourceId,
          quote: citation.quote,
          ...(citation.audioStartMs !== undefined ? { audioStartMs: citation.audioStartMs } : {}),
          ...(citation.audioEndMs !== undefined ? { audioEndMs: citation.audioEndMs } : {}),
          createdAt: scoredAt
        });
      }
    }

    const persistedScoring = await this.scoringStore.saveScoringRun({
      scoringRun,
      objectiveScores,
      evidenceCitations
    });
    const scoredRun = applyRunStatusTransition(run, "scored", this.now());
    const persistedRun = scoredRun === run ? run : await this.runStore.updateStatus(scoredRun, run.status);

    return {
      ...persistedScoring,
      run: persistedRun
    };
  }

  private async getObjectiveVersionsForRun(run: Run) {
    const allVersions = await this.objectiveVersionStore.listByStudy(run.studyId);
    const versions =
      run.objectiveVersionIds.length > 0
        ? allVersions
        : allVersions.filter((version) => version.isActive && version.isEnabled !== false);
    const versionsById = new Map(versions.map((version) => [version.id, version]));
    const runObjectiveIds = run.objectiveVersionIds.length > 0 ? run.objectiveVersionIds : versions.map((version) => version.id);
    const objectiveVersions = runObjectiveIds.map((objectiveVersionId) => versionsById.get(objectiveVersionId));

    if (objectiveVersions.some((version) => !version)) {
      throw new ScoringValidationError("Run references an objective version that is not available for scoring.");
    }

    if (objectiveVersions.length === 0) {
      throw new ScoringValidationError("At least one objective version is required for scoring.");
    }

    return (objectiveVersions as ObjectiveVersion[]).sort((left, right) => left.sortOrder - right.sortOrder);
  }
}

export function parseScoringGeneratorOutput(
  output: unknown,
  metadata: AiModelMetadata,
  objectiveVersions: readonly ObjectiveVersion[]
): ScoringGeneratorOutput {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new ScoringOutputValidationError();
  }

  const record = output as Record<string, unknown>;

  if (!Array.isArray(record.scores)) {
    throw new ScoringOutputValidationError("Scoring output must include a score list.");
  }

  const objectivesById = new Map(objectiveVersions.map((objective) => [objective.id, objective]));
  const seenObjectiveIds = new Set<string>();
  const scores = record.scores.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ScoringOutputValidationError(`Score ${index + 1} must be structured.`);
    }

    const score = item as Record<string, unknown>;
    const objectiveVersionId = parseRequiredText(score.objectiveVersionId, `Score ${index + 1} objective`, 200);
    const objective = objectivesById.get(objectiveVersionId);

    if (!objective) {
      throw new ScoringOutputValidationError("Scoring output referenced an unknown objective.");
    }

    if (seenObjectiveIds.has(objectiveVersionId)) {
      throw new ScoringOutputValidationError("Scoring output included a duplicate objective score.");
    }

    seenObjectiveIds.add(objectiveVersionId);

    const gradeLabel = parseRequiredText(score.gradeLabel, `Score ${index + 1} grade`, 120);

    if (!objective.gradeScale.includes(gradeLabel)) {
      throw new ScoringOutputValidationError("Scoring output grade must come from the objective grade scale.");
    }

    return {
      objectiveVersionId,
      gradeLabel,
      confidence: parseConfidence(score.confidence),
      rationale: parseRequiredText(score.rationale, `Score ${index + 1} rationale`, 2000),
      flags: parseScoreFlags(score.flags),
      citations: parseCitations(score.citations)
    };
  });

  if (seenObjectiveIds.size !== objectiveVersions.length) {
    throw new ScoringOutputValidationError("Scoring output must include exactly one score for each objective.");
  }

  return {
    modelName: metadata.modelName,
    modelVersion: metadata.modelVersion,
    serviceRequestId: metadata.serviceRequestId,
    promptVersion: metadata.promptVersion,
    objectiveVersionSetHash: createObjectiveVersionSetHash(objectiveVersions),
    scores
  };
}

export function createObjectiveVersionSetHash(objectiveVersions: readonly ObjectiveVersion[]) {
  const objectiveVersionIds = objectiveVersions.map((objective) => objective.id).sort();
  return `sha256:${createHash("sha256").update(JSON.stringify(objectiveVersionIds)).digest("hex")}`;
}

function createDefaultFlags(status: Run["status"]): readonly ScoreFlag[] {
  if (status === "stale") {
    return ["stale_run", "missing_interview_evidence"];
  }

  if (status === "partial") {
    return ["partial_run", "missing_interview_evidence"];
  }

  if (status === "technical_interruption") {
    return ["technical_interruption", "missing_interview_evidence"];
  }

  return [];
}

function parseConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ScoringOutputValidationError("Scoring confidence must be a number from 0 through 1.");
  }

  return value;
}

function parseScoreFlags(value: unknown): readonly ScoreFlag[] {
  if (!Array.isArray(value)) {
    throw new ScoringOutputValidationError("Scoring flags must be a list.");
  }

  return value.map((item) => {
    if (!SCORE_FLAGS.includes(item as ScoreFlag)) {
      throw new ScoringOutputValidationError("Scoring output included an unknown flag.");
    }

    return item as ScoreFlag;
  });
}

function parseCitations(value: unknown): readonly ScoringEvidenceCitationOutput[] {
  if (!Array.isArray(value)) {
    throw new ScoringOutputValidationError("Scoring citations must be a list.");
  }

  if (value.length > 20) {
    throw new ScoringOutputValidationError("Use 20 or fewer scoring citations per objective.");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ScoringOutputValidationError(`Citation ${index + 1} must be structured.`);
    }

    const citation = item as Record<string, unknown>;
    const sourceType = citation.sourceType;

    if (!EVIDENCE_CITATION_SOURCE_TYPES.includes(sourceType as EvidenceCitationSourceType)) {
      throw new ScoringOutputValidationError("Scoring citation source type is invalid.");
    }

    const audioSpan = parseOptionalAudioSpan(citation);

    if (sourceType === "audio_span" && (audioSpan.audioStartMs === undefined || audioSpan.audioEndMs === undefined)) {
      throw new ScoringOutputValidationError("Audio span citations must include audio timing.");
    }

    return {
      sourceType: sourceType as EvidenceCitationSourceType,
      sourceId: parseRequiredText(citation.sourceId, `Citation ${index + 1} source`, 200),
      quote: parseRequiredText(citation.quote, `Citation ${index + 1} quote`, 1000),
      ...audioSpan
    };
  });
}

function parseOptionalAudioSpan(citation: Record<string, unknown>) {
  const audioStartMs = parseOptionalNonNegativeNumber(citation.audioStartMs, "audioStartMs");
  const audioEndMs = parseOptionalNonNegativeNumber(citation.audioEndMs, "audioEndMs");

  if (audioStartMs !== undefined && audioEndMs !== undefined && audioEndMs < audioStartMs) {
    throw new ScoringOutputValidationError("Citation audio end must be after audio start.");
  }

  return {
    ...(audioStartMs !== undefined ? { audioStartMs } : {}),
    ...(audioEndMs !== undefined ? { audioEndMs } : {})
  };
}

function parseOptionalNonNegativeNumber(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ScoringOutputValidationError(`Citation ${label} must be a non-negative number.`);
  }

  return value;
}

function parseRequiredText(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== "string") {
    throw new ScoringOutputValidationError(`${label} must be text.`);
  }

  const text = value.trim();

  if (!text) {
    throw new ScoringOutputValidationError(`${label} is required.`);
  }

  if (text.length > maximumLength) {
    throw new ScoringOutputValidationError(`${label} must be ${maximumLength.toLocaleString("en-US")} characters or fewer.`);
  }

  return text;
}

const SCORE_FLAGS = [
  "low_confidence",
  "missing_interview_evidence",
  "survey_interview_contradiction",
  "stale_run",
  "partial_run",
  "technical_interruption"
] as const satisfies readonly ScoreFlag[];

const EVIDENCE_CITATION_SOURCE_TYPES = [
  "survey_response",
  "interview_turn",
  "audio_span"
] as const satisfies readonly EvidenceCitationSourceType[];

type ScoreableRunStatus = "interview_completed" | "stale" | "partial" | "technical_interruption" | "scored";

const SCOREABLE_RUN_STATUSES = [
  "interview_completed",
  "stale",
  "partial",
  "technical_interruption",
  "scored"
] as const satisfies readonly ScoreableRunStatus[];

interface ScoringRunItem {
  readonly entity: "scoring_run";
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly id: string;
  readonly runId: string;
  readonly status: ScoringRunStatus;
  readonly trigger: ScoringTrigger;
  readonly modelName: string;
  readonly modelVersion: string;
  readonly serviceRequestId: string;
  readonly promptVersion: string;
  readonly objectiveVersionSetHash: string;
  readonly scoredAt: string;
  readonly createdAt: string;
}

interface ObjectiveScoreItem {
  readonly entity: "objective_score";
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly gsi2pk: string;
  readonly gsi2sk: string;
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

interface EvidenceCitationItem {
  readonly entity: "evidence_citation";
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
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

export class InMemoryScoringStore implements ScoringStore {
  private readonly scoringRuns = new Map<string, ScoringRun>();
  private readonly objectiveScores = new Map<string, ObjectiveScore>();
  private readonly evidenceCitations = new Map<string, EvidenceCitation>();

  constructor(
    initialScoringRuns: readonly ScoringRun[] = [],
    initialObjectiveScores: readonly ObjectiveScore[] = [],
    initialEvidenceCitations: readonly EvidenceCitation[] = []
  ) {
    for (const scoringRun of initialScoringRuns) {
      this.scoringRuns.set(scoringRun.id, scoringRun);
    }

    for (const objectiveScore of initialObjectiveScores) {
      this.objectiveScores.set(objectiveScore.id, objectiveScore);
    }

    for (const evidenceCitation of initialEvidenceCitations) {
      this.evidenceCitations.set(evidenceCitation.id, evidenceCitation);
    }
  }

  async saveScoringRun(input: {
    readonly scoringRun: ScoringRun;
    readonly objectiveScores: readonly ObjectiveScore[];
    readonly evidenceCitations: readonly EvidenceCitation[];
  }) {
    if (this.scoringRuns.has(input.scoringRun.id)) {
      throw new ScoringValidationError("Scoring run already exists.");
    }

    this.scoringRuns.set(input.scoringRun.id, input.scoringRun);

    for (const objectiveScore of input.objectiveScores) {
      this.objectiveScores.set(objectiveScore.id, objectiveScore);
    }

    for (const evidenceCitation of input.evidenceCitations) {
      this.evidenceCitations.set(evidenceCitation.id, evidenceCitation);
    }

    return input;
  }

  async listScoringRunsByRun(runId: string) {
    return [...this.scoringRuns.values()]
      .filter((scoringRun) => scoringRun.runId === runId)
      .sort((left, right) => right.scoredAt.localeCompare(left.scoredAt));
  }

  async getEvidenceCitationByRun(runId: string, evidenceCitationId: string) {
    return [...this.evidenceCitations.values()].find(
      (citation) => citation.runId === runId && citation.id === evidenceCitationId
    );
  }

  async listObjectiveScoresByScoringRun(scoringRunId: string) {
    return [...this.objectiveScores.values()]
      .filter((objectiveScore) => objectiveScore.scoringRunId === scoringRunId)
      .sort((left, right) => left.objectiveVersionId.localeCompare(right.objectiveVersionId));
  }

  async listEvidenceCitationsByObjectiveScore(objectiveScoreId: string) {
    return [...this.evidenceCitations.values()]
      .filter((citation) => citation.objectiveScoreId === objectiveScoreId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
}

export interface DynamoDbScoringStoreOptions {
  readonly tableName?: string;
  readonly environment?: string;
  readonly region?: string;
  readonly endpoint?: string;
}

export class DynamoDbScoringStore implements ScoringStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbScoringStoreOptions = {}) {
    const region = options.region ?? process.env.AWS_REGION ?? "us-east-1";
    const client = new DynamoDBClient({
      region,
      ...(options.endpoint || process.env.DYNAMODB_ENDPOINT
        ? {
            endpoint: options.endpoint ?? process.env.DYNAMODB_ENDPOINT,
            credentials: {
              accessKeyId: "local",
              secretAccessKey: "local"
            }
          }
        : {})
    });

    this.documentClient = DynamoDBDocumentClient.from(client);
    this.tableName = options.tableName ?? getEvidenceScoringTableName(options.environment);
  }

  async saveScoringRun(input: {
    readonly scoringRun: ScoringRun;
    readonly objectiveScores: readonly ObjectiveScore[];
    readonly evidenceCitations: readonly EvidenceCitation[];
  }) {
    const transactItems = [
      {
        Put: {
          TableName: this.tableName,
          Item: toScoringRunItem(input.scoringRun),
          ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
        }
      },
      ...input.objectiveScores.map((score) => ({
        Put: {
          TableName: this.tableName,
          Item: toObjectiveScoreItem(score),
          ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
        }
      })),
      ...input.evidenceCitations.map((citation) => ({
        Put: {
          TableName: this.tableName,
          Item: toEvidenceCitationItem(citation),
          ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
        }
      }))
    ];

    if (transactItems.length <= 100) {
      await this.documentClient.send(
        new TransactWriteCommand({
          TransactItems: transactItems
        })
      );
    } else {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: toScoringRunItem(input.scoringRun),
          ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
        })
      );

      for (const objectiveScore of input.objectiveScores) {
        await this.documentClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: toObjectiveScoreItem(objectiveScore),
            ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
          })
        );
      }

      for (const citation of input.evidenceCitations) {
        await this.documentClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: toEvidenceCitationItem(citation),
            ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
          })
        );
      }
    }

    return input;
  }

  async listScoringRunsByRun(runId: string) {
    const response = await this.queryOrEmpty({
      IndexName: "byRunScoring",
      KeyConditionExpression: "gsi1pk = :run",
      ExpressionAttributeValues: {
        ":run": `RUN#${runId}`
      }
    });

    return (response.Items ?? [])
      .filter((item) => item.entity === "scoring_run")
      .map((item) => toScoringRun(item as ScoringRunItem))
      .sort((left, right) => right.scoredAt.localeCompare(left.scoredAt));
  }

  async getEvidenceCitationByRun(runId: string, evidenceCitationId: string) {
    const response = await this.queryOrEmpty({
      IndexName: "byRunScoring",
      KeyConditionExpression: "gsi1pk = :run",
      FilterExpression: "#entity = :entity AND id = :id",
      ExpressionAttributeNames: {
        "#entity": "entity"
      },
      ExpressionAttributeValues: {
        ":run": `RUN#${runId}`,
        ":entity": "evidence_citation",
        ":id": evidenceCitationId
      }
    });
    const item = response.Items?.find((candidate) => candidate.entity === "evidence_citation");

    return item ? toEvidenceCitation(item as EvidenceCitationItem) : undefined;
  }

  async listObjectiveScoresByScoringRun(scoringRunId: string) {
    const response = await this.queryOrEmpty({
      KeyConditionExpression: "pk = :scoringRun AND begins_with(sk, :scorePrefix)",
      ExpressionAttributeValues: {
        ":scoringRun": `SCORING_RUN#${scoringRunId}`,
        ":scorePrefix": "OBJECTIVE_SCORE#"
      }
    });

    return (response.Items ?? [])
      .filter((item) => item.entity === "objective_score")
      .map((item) => toObjectiveScore(item as ObjectiveScoreItem))
      .sort((left, right) => left.objectiveVersionId.localeCompare(right.objectiveVersionId));
  }

  async listEvidenceCitationsByObjectiveScore(objectiveScoreId: string) {
    const response = await this.queryOrEmpty({
      KeyConditionExpression: "pk = :objectiveScore AND begins_with(sk, :citationPrefix)",
      ExpressionAttributeValues: {
        ":objectiveScore": `OBJECTIVE_SCORE#${objectiveScoreId}`,
        ":citationPrefix": "CITATION#"
      }
    });

    return (response.Items ?? [])
      .filter((item) => item.entity === "evidence_citation")
      .map((item) => toEvidenceCitation(item as EvidenceCitationItem))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async queryOrEmpty(input: Omit<ConstructorParameters<typeof QueryCommand>[0], "TableName">) {
    try {
      return await this.documentClient.send(
        new QueryCommand({
          TableName: this.tableName,
          ...input
        })
      );
    } catch (error) {
      if (isDynamoResourceNotFound(error)) {
        return {
          Items: []
        };
      }

      throw error;
    }
  }
}

export function createConfiguredScoringStore() {
  return new DynamoDbScoringStore();
}

function getEvidenceScoringTableName(environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local") {
  return `education-researcher-${environment}-evidence-scoring`;
}

function isDynamoResourceNotFound(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "ResourceNotFoundException" || error.message.includes("Requested resource not found"))
  );
}

function toScoringRunItem(scoringRun: ScoringRun): ScoringRunItem {
  return {
    entity: "scoring_run",
    pk: `RUN#${scoringRun.runId}`,
    sk: `SCORING_RUN#${scoringRun.scoredAt}#${scoringRun.id}`,
    gsi1pk: `RUN#${scoringRun.runId}`,
    gsi1sk: `SCORING_RUN#${scoringRun.scoredAt}#${scoringRun.id}`,
    id: scoringRun.id,
    runId: scoringRun.runId,
    status: scoringRun.status,
    trigger: scoringRun.trigger,
    modelName: scoringRun.modelName,
    modelVersion: scoringRun.modelVersion,
    serviceRequestId: scoringRun.serviceRequestId,
    promptVersion: scoringRun.promptVersion,
    objectiveVersionSetHash: scoringRun.objectiveVersionSetHash,
    scoredAt: scoringRun.scoredAt,
    createdAt: scoringRun.createdAt
  };
}

function toScoringRun(item: ScoringRunItem): ScoringRun {
  return {
    id: item.id,
    runId: item.runId,
    status: item.status,
    trigger: item.trigger,
    modelName: item.modelName,
    modelVersion: item.modelVersion,
    serviceRequestId: item.serviceRequestId,
    promptVersion: item.promptVersion,
    objectiveVersionSetHash: item.objectiveVersionSetHash,
    scoredAt: item.scoredAt,
    createdAt: item.createdAt
  };
}

function toObjectiveScoreItem(score: ObjectiveScore): ObjectiveScoreItem {
  return {
    entity: "objective_score",
    pk: `SCORING_RUN#${score.scoringRunId}`,
    sk: `OBJECTIVE_SCORE#${score.objectiveVersionId}`,
    gsi1pk: `RUN#${score.runId}`,
    gsi1sk: `OBJECTIVE_SCORE#${score.createdAt}#${score.id}`,
    gsi2pk: `OBJECTIVE_VERSION#${score.objectiveVersionId}`,
    gsi2sk: `SCORE#${score.createdAt}#${score.id}`,
    id: score.id,
    scoringRunId: score.scoringRunId,
    runId: score.runId,
    objectiveVersionId: score.objectiveVersionId,
    gradeLabel: score.gradeLabel,
    confidence: score.confidence,
    rationale: score.rationale,
    flags: score.flags,
    createdAt: score.createdAt
  };
}

function toObjectiveScore(item: ObjectiveScoreItem): ObjectiveScore {
  return {
    id: item.id,
    scoringRunId: item.scoringRunId,
    runId: item.runId,
    objectiveVersionId: item.objectiveVersionId,
    gradeLabel: item.gradeLabel,
    confidence: item.confidence,
    rationale: item.rationale,
    flags: item.flags,
    createdAt: item.createdAt
  };
}

function toEvidenceCitationItem(citation: EvidenceCitation): EvidenceCitationItem {
  return {
    entity: "evidence_citation",
    pk: `OBJECTIVE_SCORE#${citation.objectiveScoreId}`,
    sk: `CITATION#${citation.sourceType}#${citation.id}`,
    gsi1pk: `RUN#${citation.runId}`,
    gsi1sk: `CITATION#${citation.createdAt}#${citation.id}`,
    gsi3pk: `CITATION_TARGET#${citation.sourceType}#${citation.sourceId}`,
    gsi3sk: `OBJECTIVE_SCORE#${citation.objectiveScoreId}#CITATION#${citation.id}`,
    id: citation.id,
    objectiveScoreId: citation.objectiveScoreId,
    runId: citation.runId,
    sourceType: citation.sourceType,
    sourceId: citation.sourceId,
    quote: citation.quote,
    ...(citation.audioStartMs !== undefined ? { audioStartMs: citation.audioStartMs } : {}),
    ...(citation.audioEndMs !== undefined ? { audioEndMs: citation.audioEndMs } : {}),
    createdAt: citation.createdAt
  };
}

function toEvidenceCitation(item: EvidenceCitationItem): EvidenceCitation {
  return {
    id: item.id,
    objectiveScoreId: item.objectiveScoreId,
    runId: item.runId,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    quote: item.quote,
    ...(item.audioStartMs !== undefined ? { audioStartMs: item.audioStartMs } : {}),
    ...(item.audioEndMs !== undefined ? { audioEndMs: item.audioEndMs } : {}),
    createdAt: item.createdAt
  };
}

export function toSafeScoringValidationResponse(error: unknown) {
  if (error instanceof ScoringValidationError || error instanceof ScoringNotFoundError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.statusCode === 404 ? "Not Found" : "Bad Request",
        message: error.safeMessage
      }
    };
  }

  return undefined;
}
