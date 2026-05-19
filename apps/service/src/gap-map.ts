import {
  StructuredOutputValidationError,
  executeStructuredAiCall,
  type AiModelMetadata,
  type AiProviderErrorCategory,
  type StructuredAiProvider
} from "./ai-provider.js";
import type { ObjectiveVersion } from "./objectives.js";
import type { Run, SurveyResponse } from "./runs.js";
import type { SurveyVersion } from "./survey.js";

export type GapMapStatus = "generated" | "failed";
export type GapMapFailureCategory = AiProviderErrorCategory;
export const GAP_MAP_PROMPT_VERSION = "gap-map-v1";

export interface GapMapContradiction {
  readonly summary: string;
  readonly priority: "high";
  readonly recommendedProbe: string;
}

export interface GapMap {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly surveyVersionId: string;
  readonly objectiveVersionIds: readonly string[];
  readonly status: GapMapStatus;
  readonly modelName: string;
  readonly modelVersion: string;
  readonly serviceRequestId: string;
  readonly promptVersion: string;
  readonly alreadyAnswered: readonly string[];
  readonly ambiguities: readonly string[];
  readonly contradictions: readonly GapMapContradiction[];
  readonly missingEvidence: readonly string[];
  readonly recommendedProbes: readonly string[];
  readonly failureCategory?: GapMapFailureCategory;
  readonly generatedAt: string;
  readonly createdAt: string;
}

export interface GapMapGenerationInput {
  readonly run: Run;
  readonly surveyVersion: SurveyVersion;
  readonly surveyResponses: readonly SurveyResponse[];
  readonly objectiveVersions: readonly ObjectiveVersion[];
  readonly interviewerGoals?: string;
}

export interface GapMapGeneratorOutput {
  readonly modelName: string;
  readonly modelVersion: string;
  readonly serviceRequestId: string;
  readonly promptVersion: string;
  readonly alreadyAnswered: readonly string[];
  readonly ambiguities: readonly string[];
  readonly contradictions: readonly GapMapContradiction[];
  readonly missingEvidence: readonly string[];
  readonly recommendedProbes: readonly string[];
}

export interface GapMapGenerator {
  generate(input: GapMapGenerationInput): Promise<unknown>;
}

export class GapMapValidationError extends StructuredOutputValidationError {
  constructor(readonly safeMessage = "Gap map output was invalid.") {
    super(safeMessage);
    this.name = "GapMapValidationError";
  }
}

export class FakeGapMapAiProvider implements StructuredAiProvider<GapMapGenerationInput> {
  async completeStructured(request: {
    readonly promptVersion: string;
    readonly input: GapMapGenerationInput;
  }) {
    const input = request.input;
    const responsesByQuestionId = new Map(
      input.surveyResponses.map((response) => [response.surveyQuestionId, response.responseText])
    );
    const questionPrompts = getSurveyQuestions(input.surveyVersion).map((question) => ({
      id: question.id,
      prompt: question.prompt,
      responseText: responsesByQuestionId.get(question.id) ?? ""
    }));
    const alreadyAnswered = questionPrompts.map(
      (question) => `Survey response to "${question.prompt}" provides initial evidence.`
    );
    const ambiguities = questionPrompts
      .filter((question) => question.responseText.length < 80)
      .map((question) => `Response to "${question.prompt}" is brief and may need elaboration.`);
    const contradictions = questionPrompts
      .filter((question) => /\b(but|however|contradict|conflict|opposite)\b/i.test(question.responseText))
      .map((question): GapMapContradiction => ({
        summary: `Response to "${question.prompt}" may contain conflicting reasoning.`,
        priority: "high",
        recommendedProbe: `You mentioned a possible tension in "${question.prompt}". Can you clarify what changed or conflicts?`
      }));
    const interviewerGoals = input.interviewerGoals?.trim();
    const missingEvidence = [
      ...(interviewerGoals ? [`Need interview evidence that helps accomplish these interviewer goals: ${interviewerGoals}`] : []),
      ...input.objectiveVersions.map(
        (objective) => `Need interview evidence for "${objective.title}": ${objective.evidenceRequirements}`
      )
    ];
    const recommendedProbes = [
      ...(interviewerGoals ? [`What details would best help the interviewer accomplish these goals: ${interviewerGoals}`] : []),
      ...contradictions.map((contradiction) => contradiction.recommendedProbe),
      ...input.objectiveVersions.map(
        (objective) => `Can you share a specific example that would help explain your ${objective.title.toLowerCase()}?`
      )
    ];

    return {
      output: {
        alreadyAnswered,
        ambiguities,
        contradictions,
        missingEvidence,
        recommendedProbes
      },
      metadata: {
        modelName: "fake-gap-map",
        modelVersion: "local-1",
        serviceRequestId: "fake-gap-map-request",
        promptVersion: request.promptVersion
      }
    };
  }
}

export class AiProviderGapMapGenerator implements GapMapGenerator {
  constructor(private readonly provider: StructuredAiProvider<GapMapGenerationInput> = new FakeGapMapAiProvider()) {}

  async generate(input: GapMapGenerationInput): Promise<GapMapGeneratorOutput> {
    return executeStructuredAiCall({
      provider: this.provider,
      request: {
        passKind: "gap_map",
        promptVersion: GAP_MAP_PROMPT_VERSION,
        input
      },
      validate: parseGapMapGeneratorOutput
    });
  }
}

export function createConfiguredGapMapGenerator() {
  return new AiProviderGapMapGenerator();
}

export function parseGapMapGeneratorOutput(output: unknown, metadata?: AiModelMetadata): GapMapGeneratorOutput {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new GapMapValidationError();
  }

  const record = output as Record<string, unknown>;

  return {
    modelName: metadata?.modelName ?? parseRequiredText(record.modelName, "modelName", 120),
    modelVersion: metadata?.modelVersion ?? parseRequiredText(record.modelVersion, "modelVersion", 120),
    serviceRequestId: metadata?.serviceRequestId ?? parseRequiredText(record.serviceRequestId, "serviceRequestId", 200),
    promptVersion: metadata?.promptVersion ?? parseRequiredText(record.promptVersion, "promptVersion", 120),
    alreadyAnswered: parseStringList(record.alreadyAnswered, "alreadyAnswered"),
    ambiguities: parseStringList(record.ambiguities, "ambiguities"),
    contradictions: parseContradictions(record.contradictions),
    missingEvidence: parseStringList(record.missingEvidence, "missingEvidence"),
    recommendedProbes: parseStringList(record.recommendedProbes, "recommendedProbes")
  };
}

function parseContradictions(value: unknown): readonly GapMapContradiction[] {
  if (!Array.isArray(value)) {
    throw new GapMapValidationError("Gap map contradictions must be a list.");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new GapMapValidationError("Gap map contradictions must be structured targets.");
    }

    const record = item as Record<string, unknown>;
    const priority = record.priority;

    if (priority !== "high") {
      throw new GapMapValidationError("Gap map contradictions must be high-priority interview targets.");
    }

    return {
      summary: parseRequiredText(record.summary, "contradiction summary", 1000),
      priority,
      recommendedProbe: parseRequiredText(record.recommendedProbe, "contradiction recommended probe", 1000)
    };
  });
}

function parseStringList(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new GapMapValidationError(`Gap map ${label} must be a list.`);
  }

  return value.map((item) => parseRequiredText(item, label, 2000));
}

function parseRequiredText(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== "string") {
    throw new GapMapValidationError(`Gap map ${label} must be text.`);
  }

  const text = value.trim();

  if (!text) {
    throw new GapMapValidationError(`Gap map ${label} is required.`);
  }

  if (text.length > maximumLength) {
    throw new GapMapValidationError(`Gap map ${label} must be ${maximumLength.toLocaleString("en-US")} characters or fewer.`);
  }

  return text;
}

function getSurveyQuestions(surveyVersion: SurveyVersion) {
  return surveyVersion.layoutItems.flatMap((item) => {
    if (item.type === "question") {
      return [item.question];
    }

    return item.group.questions;
  });
}
