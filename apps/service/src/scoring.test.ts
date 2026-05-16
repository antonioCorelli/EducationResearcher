import { describe, expect, it } from "vitest";
import { AiProviderError, type StructuredAiProvider } from "./ai-provider.js";
import type { GapMap } from "./gap-map.js";
import { InMemoryObjectiveVersionStore, type ObjectiveVersion } from "./objectives.js";
import { InMemoryRunStore, type InterviewAudioAsset, type InterviewTurn, type Run, type SurveyResponse } from "./runs.js";
import {
  AiProviderScoringGenerator,
  InMemoryScoringStore,
  SCORING_PROMPT_VERSION,
  ScoringService,
  ScoringOutputValidationError,
  ScoringNotFoundError,
  createObjectiveVersionSetHash,
  parseScoringGeneratorOutput,
  type EvidenceCitation
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

function createCitation(overrides: Partial<EvidenceCitation> = {}): EvidenceCitation {
  return {
    id: "evidence_citation_001",
    objectiveScoreId: "objective_score_001",
    runId: run.id,
    sourceType: "survey_response",
    sourceId: "survey_response_001",
    quote: "I noticed that the example changed my reasoning.",
    createdAt: "2026-05-06T12:40:00.000Z",
    ...overrides
  };
}

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

  it("requires audio span citations to include timing", () => {
    expect(() =>
      parseScoringGeneratorOutput(
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
                  sourceType: "audio_span",
                  sourceId: "interview_audio_asset_001",
                  quote: "Audio support without timing."
                }
              ]
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

  it("uses persisted interview turns as fake scoring citations when available", async () => {
    const generator = new AiProviderScoringGenerator();

    await expect(
      generator.generate({
        run,
        surveyResponses: [surveyResponse],
        interviewTurns: [
          {
            id: "interview_turn_001",
            studyId: "study_fixture_001",
            participantSlotId: "slot_fixture_001",
            runId: "run_fixture_001",
            interviewSessionId: "interview_session_001",
            speaker: "participant",
            text: "The worked example helped me explain the pattern.",
            audioStartMs: 4200,
            audioEndMs: 9200,
            createdAt: "2026-05-06T12:30:00.000Z"
          }
        ],
        gapMap,
        objectiveVersions: [objective],
        trigger: "automatic"
      })
    ).resolves.toMatchObject({
      scores: [
        {
          citations: [
            {
              sourceType: "interview_turn",
              sourceId: "interview_turn_001",
              quote: "The worked example helped me explain the pattern.",
              audioStartMs: 4200,
              audioEndMs: 9200
            }
          ]
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

describe("evidence citation resolution", () => {
  it("resolves persisted survey response citations to stable raw evidence", async () => {
    const runStore = new InMemoryRunStore([run]);
    await runStore.submitSurvey([surveyResponse], run, "interview_completed");
    const service = new ScoringService(
      runStore,
      new InMemoryObjectiveVersionStore([objective]),
      new InMemoryScoringStore([], [], [createCitation({ sourceType: "survey_response", sourceId: surveyResponse.id })])
    );

    await expect(
      service.resolveEvidenceCitation({
        studyId: run.studyId,
        runId: run.id,
        evidenceCitationId: "evidence_citation_001"
      })
    ).resolves.toMatchObject({
      citation: {
        id: "evidence_citation_001",
        sourceType: "survey_response",
        sourceId: "survey_response_001"
      },
      source: {
        type: "survey_response",
        surveyResponse: {
          id: "survey_response_001",
          responseText: "I noticed that the example changed my reasoning."
        }
      }
    });
  });

  it("resolves interview turn and audio span citations when timing is available", async () => {
    const runStore = new InMemoryRunStore([run]);
    const interviewTurn: InterviewTurn = {
      id: "interview_turn_001",
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      interviewSessionId: "interview_session_001",
      speaker: "participant",
      text: "The worked example helped me explain the pattern.",
      audioStartMs: 4200,
      audioEndMs: 9200,
      createdAt: "2026-05-06T12:24:00.000Z"
    };
    const audioAsset: InterviewAudioAsset = {
      id: "interview_audio_asset_001",
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      interviewSessionId: "interview_session_001",
      storageUri: "s3://education-researcher-local/study_fixture_001/run_fixture_001/audio.wav",
      durationSeconds: 10,
      status: "available",
      createdAt: "2026-05-06T12:25:00.000Z"
    };
    await runStore.createInterviewSession(
      {
        id: "interview_session_001",
        studyId: run.studyId,
        participantSlotId: run.participantSlotId,
        runId: run.id,
        sessionNumber: 1,
        status: "completed",
        startedAt: "2026-05-06T12:20:00.000Z",
        endedAt: "2026-05-06T12:30:00.000Z",
        createdAt: "2026-05-06T12:20:00.000Z",
        updatedAt: "2026-05-06T12:30:00.000Z"
      },
      run,
      "interview_completed"
    );
    await runStore.saveInterviewArtifacts({
      interviewSession: {
        id: "interview_session_001",
        studyId: run.studyId,
        participantSlotId: run.participantSlotId,
        runId: run.id,
        sessionNumber: 1,
        status: "completed",
        startedAt: "2026-05-06T12:20:00.000Z",
        endedAt: "2026-05-06T12:30:00.000Z",
        createdAt: "2026-05-06T12:20:00.000Z",
        updatedAt: "2026-05-06T12:30:00.000Z"
      },
      turns: [interviewTurn],
      audioAsset
    });
    const service = new ScoringService(
      runStore,
      new InMemoryObjectiveVersionStore([objective]),
      new InMemoryScoringStore([], [], [
        createCitation({
          id: "evidence_citation_turn_001",
          sourceType: "interview_turn",
          sourceId: interviewTurn.id,
          quote: interviewTurn.text,
          audioStartMs: 4200,
          audioEndMs: 9200
        }),
        createCitation({
          id: "evidence_citation_audio_001",
          sourceType: "audio_span",
          sourceId: audioAsset.id,
          quote: "The worked example helped me explain the pattern.",
          audioStartMs: 4200,
          audioEndMs: 9200
        })
      ])
    );

    await expect(
      service.resolveEvidenceCitation({
        studyId: run.studyId,
        runId: run.id,
        evidenceCitationId: "evidence_citation_turn_001"
      })
    ).resolves.toMatchObject({
      source: {
        type: "interview_turn",
        interviewTurn: {
          id: "interview_turn_001",
          audioStartMs: 4200,
          audioEndMs: 9200
        }
      }
    });
    await expect(
      service.resolveEvidenceCitation({
        studyId: run.studyId,
        runId: run.id,
        evidenceCitationId: "evidence_citation_audio_001"
      })
    ).resolves.toMatchObject({
      source: {
        type: "audio_span",
        audioAsset: {
          id: "interview_audio_asset_001",
          storageUri: "s3://education-researcher-local/study_fixture_001/run_fixture_001/audio.wav"
        },
        audioStartMs: 4200,
        audioEndMs: 9200
      }
    });
  });

  it("reports missing citation sources without silently returning stale data", async () => {
    const service = new ScoringService(
      new InMemoryRunStore([run]),
      new InMemoryObjectiveVersionStore([objective]),
      new InMemoryScoringStore([], [], [createCitation({ sourceType: "survey_response", sourceId: "missing_response" })])
    );

    await expect(
      service.resolveEvidenceCitation({
        studyId: run.studyId,
        runId: run.id,
        evidenceCitationId: "evidence_citation_001"
      })
    ).rejects.toThrow(ScoringNotFoundError);
  });

  it("keeps older citation sources stable after later rescoring writes new citations", async () => {
    const runStore = new InMemoryRunStore([run]);
    await runStore.submitSurvey([surveyResponse], run, "interview_completed");
    const service = new ScoringService(
      runStore,
      new InMemoryObjectiveVersionStore([objective]),
      new InMemoryScoringStore([], [], [
        createCitation({
          id: "evidence_citation_original_001",
          objectiveScoreId: "objective_score_original_001",
          sourceType: "survey_response",
          sourceId: surveyResponse.id
        }),
        createCitation({
          id: "evidence_citation_rescore_001",
          objectiveScoreId: "objective_score_rescore_001",
          sourceType: "survey_response",
          sourceId: "survey_response_future_001"
        })
      ])
    );

    await expect(
      service.resolveEvidenceCitation({
        studyId: run.studyId,
        runId: run.id,
        evidenceCitationId: "evidence_citation_original_001"
      })
    ).resolves.toMatchObject({
      citation: {
        id: "evidence_citation_original_001",
        objectiveScoreId: "objective_score_original_001",
        sourceId: surveyResponse.id
      },
      source: {
        type: "survey_response",
        surveyResponse: {
          id: surveyResponse.id
        }
      }
    });
  });
});

describe("automatic scoring job", () => {
  it("scores a completed interview run, persists scores and citations, and marks the run scored", async () => {
    const runStore = new InMemoryRunStore([{ ...run, status: "created" }]);
    await runStore.submitSurvey([surveyResponse], { ...run, status: "survey_completed" }, "created");
    await runStore.saveGapMap(gapMap);
    await runStore.createInterviewSession(
      {
        id: "interview_session_001",
        studyId: run.studyId,
        participantSlotId: run.participantSlotId,
        runId: run.id,
        sessionNumber: 1,
        status: "completed",
        startedAt: "2026-05-06T12:20:00.000Z",
        endedAt: "2026-05-06T12:30:00.000Z",
        createdAt: "2026-05-06T12:20:00.000Z",
        updatedAt: "2026-05-06T12:30:00.000Z"
      },
      { ...run, status: "interview_completed" },
      "survey_completed"
    );
    await runStore.saveInterviewArtifacts({
      interviewSession: {
        id: "interview_session_001",
        studyId: run.studyId,
        participantSlotId: run.participantSlotId,
        runId: run.id,
        sessionNumber: 1,
        status: "completed",
        startedAt: "2026-05-06T12:20:00.000Z",
        endedAt: "2026-05-06T12:30:00.000Z",
        createdAt: "2026-05-06T12:20:00.000Z",
        updatedAt: "2026-05-06T12:30:00.000Z"
      },
      turns: [
        {
          id: "interview_turn_001",
          studyId: run.studyId,
          participantSlotId: run.participantSlotId,
          runId: run.id,
          interviewSessionId: "interview_session_001",
          speaker: "participant",
          text: "The worked example helped me explain the pattern.",
          audioStartMs: 4200,
          audioEndMs: 9200,
          createdAt: "2026-05-06T12:24:00.000Z"
        }
      ]
    });
    const scoringStore = new InMemoryScoringStore();
    const service = new ScoringService(
      runStore,
      new InMemoryObjectiveVersionStore([objective]),
      scoringStore,
      {
        createScoringRunId: () => "scoring_run_001",
        createObjectiveScoreId: () => "objective_score_001",
        createEvidenceCitationId: () => "evidence_citation_001",
        now: () => new Date("2026-05-06T12:40:00.000Z")
      }
    );

    const result = await service.triggerAutomaticScoring({
      run: { ...run, status: "interview_completed" },
      previousStatus: "interview_in_progress",
      triggeredAt: "2026-05-06T12:30:00.000Z"
    });

    expect(result).toMatchObject({
      scoringRun: {
        id: "scoring_run_001",
        runId: run.id,
        trigger: "automatic",
        status: "completed",
        modelName: "fake-scoring",
        promptVersion: SCORING_PROMPT_VERSION
      },
      objectiveScores: [
        {
          id: "objective_score_001",
          objectiveVersionId: "objective_version_001",
          gradeLabel: "1",
          confidence: 0.78
        }
      ],
      evidenceCitations: [
        {
          id: "evidence_citation_001",
          sourceType: "interview_turn",
          sourceId: "interview_turn_001",
          audioStartMs: 4200,
          audioEndMs: 9200
        }
      ],
      run: {
        status: "scored"
      }
    });
    expect(await runStore.getById(run.id)).toMatchObject({ status: "scored" });
    await expect(scoringStore.listScoringRunsByRun(run.id)).resolves.toHaveLength(1);
  });

  it("scores stale runs from survey evidence and emits stale and missing-interview flags", async () => {
    const staleRun: Run = { ...run, status: "stale" };
    const runStore = new InMemoryRunStore([staleRun]);
    await runStore.submitSurvey([surveyResponse], staleRun, "stale");
    const service = new ScoringService(
      runStore,
      new InMemoryObjectiveVersionStore([objective]),
      new InMemoryScoringStore(),
      {
        createScoringRunId: () => "scoring_run_stale_001",
        createObjectiveScoreId: () => "objective_score_stale_001",
        createEvidenceCitationId: () => "evidence_citation_stale_001",
        now: () => new Date("2026-05-20T12:00:00.000Z")
      }
    );

    const result = await service.scoreRun(staleRun.id, "automatic");

    expect(result.objectiveScores).toEqual([
      expect.objectContaining({
        flags: ["stale_run", "missing_interview_evidence"],
        confidence: 0.45
      })
    ]);
    expect(result.evidenceCitations).toEqual([
      expect.objectContaining({
        sourceType: "survey_response",
        sourceId: "survey_response_001"
      })
    ]);
    expect(result.run.status).toBe("scored");
  });

  it("persists mocked low-confidence, partial, technical, and contradiction flags", async () => {
    const interruptedRun: Run = { ...run, status: "technical_interruption" };
    const runStore = new InMemoryRunStore([interruptedRun]);
    const generator = {
      async generate() {
        return {
          modelName: "fake-scoring",
          modelVersion: "local-1",
          serviceRequestId: "req_scoring_contradiction",
          promptVersion: SCORING_PROMPT_VERSION,
          objectiveVersionSetHash: createObjectiveVersionSetHash([objective]),
          scores: [
            {
              objectiveVersionId: objective.id,
              gradeLabel: "2",
              confidence: 0.3,
              rationale: "Survey and interview evidence conflict, and the interview was interrupted.",
              flags: [
                "low_confidence",
                "survey_interview_contradiction",
      "partial_run",
      "technical_interruption",
      "missing_interview_evidence"
              ] as const,
              citations: []
            }
          ]
        };
      }
    };
    const service = new ScoringService(
      runStore,
      new InMemoryObjectiveVersionStore([objective]),
      new InMemoryScoringStore(),
      {
        createScoringRunId: () => "scoring_run_flags_001",
        createObjectiveScoreId: () => "objective_score_flags_001",
        now: () => new Date("2026-05-06T12:40:00.000Z")
      },
      generator
    );

    const result = await service.scoreRun(interruptedRun.id, "automatic");

    expect(result.objectiveScores[0]).toMatchObject({
      gradeLabel: "2",
      confidence: 0.3,
      flags: [
        "low_confidence",
        "survey_interview_contradiction",
        "partial_run",
        "technical_interruption",
        "missing_interview_evidence"
      ]
    });
  });
});
