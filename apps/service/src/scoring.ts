import { createHash } from "node:crypto";
import {
  StructuredOutputValidationError,
  executeStructuredAiCall,
  type AiModelMetadata,
  type StructuredAiProvider
} from "./ai-provider.js";
import type { GapMap } from "./gap-map.js";
import type { ObjectiveVersion } from "./objectives.js";
import type { InterviewAudioAsset, InterviewTurn, Run, SurveyResponse } from "./runs.js";

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
  readonly gapMap: GapMap;
  readonly objectiveVersions: readonly ObjectiveVersion[];
  readonly trigger: ScoringTrigger;
}

export interface ScoringGenerator {
  generate(input: ScoringGenerationInput): Promise<ScoringGeneratorOutput>;
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

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ScoringOutputValidationError(`Citation ${index + 1} must be structured.`);
    }

    const citation = item as Record<string, unknown>;
    const sourceType = citation.sourceType;

    if (!EVIDENCE_CITATION_SOURCE_TYPES.includes(sourceType as EvidenceCitationSourceType)) {
      throw new ScoringOutputValidationError("Scoring citation source type is invalid.");
    }

    return {
      sourceType: sourceType as EvidenceCitationSourceType,
      sourceId: parseRequiredText(citation.sourceId, `Citation ${index + 1} source`, 200),
      quote: parseRequiredText(citation.quote, `Citation ${index + 1} quote`, 1000),
      ...parseOptionalAudioSpan(citation)
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
