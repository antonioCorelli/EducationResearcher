import { describe, expect, it } from "vitest";
import { AiProviderError, type StructuredAiProvider } from "./ai-provider.js";
import type { GapMap } from "./gap-map.js";
import type { ObjectiveVersion } from "./objectives.js";
import type { Run, SurveyResponse } from "./runs.js";
import {
  AiProviderScoringGenerator,
  SCORING_PROMPT_VERSION,
  ScoringOutputValidationError,
  createObjectiveVersionSetHash,
  parseScoringGeneratorOutput
} from "./scoring.js";

const run: Run = {
  id: "run_fixture_001",
  studyId: "study_fixture_001",
  participantSlotId: "slot_fixture_001",
  consentVersionId: "consent_version_001",
  surveyVersionId: "survey_version_001",
  personaVersionId: "persona_version_v1_default_001",
  objectiveVersionIds: ["objective_version_001"],
  freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
  maxInterviewMinutes: 45,
  status: "interview_completed",
  currentRunForSlot: true,
  createdAt: "2026-05-06T12:00:00.000Z",
  updatedAt: "2026-05-06T12:00:00.000Z"
};

const objective: ObjectiveVersion = {
  id: "objective_version_001",
  studyId: "study_fixture_001",
  objectiveKey: "reasoning_quality",
  versionNumber: 1,
  title: "Reasoning Quality",
  description: "Reasoning.",
  gradeScale: ["1", "2", "3", "4"],
  gradeExamples: [],
  evidenceRequirements: "Use evidence.",
  sortOrder: 1,
  isEnabled: true,
  isActive: true,
  createdAt: "2026-05-06T12:00:00.000Z"
};

const surveyResponse: SurveyResponse = {
  id: "survey_response_001",
  studyId: "study_fixture_001",
  participantSlotId: "slot_fixture_001",
  runId: "run_fixture_001",
  surveyVersionId: "survey_version_001",
  surveyQuestionId: "survey_question_001",
  responseText: "I noticed that the example changed my reasoning.",
  submittedAt: "2026-05-06T12:10:00.000Z",
  createdAt: "2026-05-06T12:10:00.000Z"
};

const gapMap: GapMap = {
  id: "gap_map_001",
  studyId: "study_fixture_001",
  participantSlotId: "slot_fixture_001",
  runId: "run_fixture_001",
  surveyVersionId: "survey_version_001",
  objectiveVersionIds: ["objective_version_001"],
  status: "generated",
  modelName: "fake-gap-map",
  modelVersion: "local-1",
  serviceRequestId: "req_gap_map",
  promptVersion: "gap-map-v1",
  alreadyAnswered: [],
  ambiguities: [],
  contradictions: [],
  missingEvidence: [],
  recommendedProbes: [],
  generatedAt: "2026-05-06T12:20:00.000Z",
  createdAt: "2026-05-06T12:20:00.000Z"
};

const metadata = {
  modelName: "fake-scoring",
  modelVersion: "local-1",
  serviceRequestId: "req_scoring_001",
  promptVersion: SCORING_PROMPT_VERSION
};

describe("scoring structured output validation", () => {
  it("accepts one validated score per objective with metadata ready for persistence", () => {
    const output = parseScoringGeneratorOutput(
      {
        scores: [
          {
            objectiveVersionId: "objective_version_001",
            gradeLabel: "3",
            confidence: 0.82,
            rationale: "The participant connected a claim to evidence.",
            flags: [],
            citations: [
              {
                sourceType: "survey_response",
                sourceId: "survey_response_001",
                quote: "I noticed that the example changed my reasoning."
              }
            ]
          }
        ]
      },
      metadata,
      [objective]
    );

    expect(output).toMatchObject({
      modelName: "fake-scoring",
      modelVersion: "local-1",
      serviceRequestId: "req_scoring_001",
      promptVersion: SCORING_PROMPT_VERSION,
      objectiveVersionSetHash: createObjectiveVersionSetHash([objective]),
      scores: [
        {
          objectiveVersionId: "objective_version_001",
          gradeLabel: "3",
          confidence: 0.82
        }
      ]
    });
  });

  it("rejects malformed scores before persistence", () => {
    expect(() =>
      parseScoringGeneratorOutput(
        {
          scores: [
            {
              objectiveVersionId: "objective_version_001",
              gradeLabel: "not-on-scale",
              confidence: 1.4,
              rationale: "Bad.",
              flags: [],
              citations: []
            }
          ]
        },
        metadata,
        [objective]
      )
    ).toThrow(ScoringOutputValidationError);
  });
});

describe("AI provider scoring generator", () => {
  it("calls scoring through the provider abstraction", async () => {
    const generator = new AiProviderScoringGenerator();

    await expect(
      generator.generate({
        run,
        surveyResponses: [surveyResponse],
        gapMap,
        objectiveVersions: [objective],
        trigger: "automatic"
      })
    ).resolves.toMatchObject({
      modelName: "fake-scoring",
      modelVersion: "local-1",
      serviceRequestId: "fake-scoring-request",
      promptVersion: SCORING_PROMPT_VERSION,
      scores: [
        {
          objectiveVersionId: "objective_version_001",
          gradeLabel: "1"
        }
      ]
    });
  });

  it("retries retryable scoring provider errors", async () => {
    let attempts = 0;
    const provider: StructuredAiProvider = {
      async completeStructured() {
        attempts += 1;

        if (attempts === 1) {
          throw new AiProviderError({ safeCategory: "rate_limited", serviceRequestId: "req_retry_001" });
        }

        return {
          output: {
            scores: [
              {
                objectiveVersionId: "objective_version_001",
                gradeLabel: "2",
                confidence: 0.7,
                rationale: "Recovered after retry.",
                flags: [],
                citations: []
              }
            ]
          },
          metadata
        };
      }
    };
    const generator = new AiProviderScoringGenerator(provider);

    await expect(
      generator.generate({
        run,
        surveyResponses: [surveyResponse],
        gapMap,
        objectiveVersions: [objective],
        trigger: "automatic"
      })
    ).resolves.toMatchObject({
      scores: [
        {
          gradeLabel: "2"
        }
      ]
    });
    expect(attempts).toBe(2);
  });

  it("surfaces non-retryable scoring provider errors as safe categories", async () => {
    const provider: StructuredAiProvider = {
      async completeStructured() {
        throw new AiProviderError({ safeCategory: "invalid_request", serviceRequestId: "req_bad_001" });
      }
    };
    const generator = new AiProviderScoringGenerator(provider);

    await expect(
      generator.generate({
        run,
        surveyResponses: [surveyResponse],
        gapMap,
        objectiveVersions: [objective],
        trigger: "automatic"
      })
    ).rejects.toMatchObject({
      safeCategory: "invalid_request",
      retryable: false,
      serviceRequestId: "req_bad_001"
    });
  });
});
