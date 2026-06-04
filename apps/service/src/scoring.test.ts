import { describe, expect, it } from "vitest";
import { AiProviderError, type StructuredAiProvider } from "./ai-provider.js";
import { InMemoryObjectiveVersionStore, type ObjectiveVersion } from "./objectives.js";
import { InMemoryRunStore, type InterviewAudioAsset, type InterviewTurn, type Run, type SurveyResponse } from "./runs.js";
import {
  AiProviderScoringGenerator,
  FakeScoringAiProvider,
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

describe("score CSV export", () => {
  it("exports one row per objective score with safe CSV escaping and scoring metadata", async () => {
    const secondObjective: ObjectiveVersion = {
      ...objective,
      id: "objective_version_002",
      objectiveKey: "reflection_depth",
      versionNumber: 2,
      title: "@Reflection, Depth",
      sortOrder: 2
    };
    const scoredRun: Run = {
      ...run,
      status: "scored",
      objectiveVersionIds: [objective.id, secondObjective.id],
      participantSlotId: "slot_formula_001"
    };
    const scoringRun = {
      id: "scoring_run_export_001",
      runId: scoredRun.id,
      status: "completed" as const,
      trigger: "automatic" as const,
      modelName: "fake-scoring",
      modelVersion: "local-1",
      serviceRequestId: "req_export_001",
      promptVersion: SCORING_PROMPT_VERSION,
      objectiveVersionSetHash: "sha256:export",
      scoredAt: "2026-05-06T12:40:00.000Z",
      createdAt: "2026-05-06T12:40:00.000Z"
    };
    const service = new ScoringService(
      new InMemoryRunStore([scoredRun]),
      new InMemoryObjectiveVersionStore([objective, secondObjective]),
      new InMemoryScoringStore(
        [scoringRun],
        [
          {
            id: "objective_score_export_001",
            scoringRunId: scoringRun.id,
            runId: scoredRun.id,
            objectiveVersionId: objective.id,
            gradeLabel: "3",
            confidence: 0.82,
            rationale: '=SUM(1,1)\nThe participant said "clear", with detail.',
            flags: ["missing_interview_evidence"],
            createdAt: "2026-05-06T12:40:00.000Z"
          },
          {
            id: "objective_score_export_002",
            scoringRunId: scoringRun.id,
            runId: scoredRun.id,
            objectiveVersionId: secondObjective.id,
            gradeLabel: "+advanced",
            confidence: 0.41,
            rationale: "Interview was missing, so confidence is lower.",
            flags: ["low_confidence", "partial_run", "missing_interview_evidence"],
            createdAt: "2026-05-06T12:41:00.000Z"
          }
        ],
        [
          createCitation({
            id: "evidence_citation_export_001",
            objectiveScoreId: "objective_score_export_001",
            runId: scoredRun.id
          }),
          createCitation({
            id: "evidence_citation_export_002",
            objectiveScoreId: "objective_score_export_001",
            runId: scoredRun.id,
            quote: "Second citation"
          })
        ]
      )
    );

    const result = await service.generateScoreCsvExport(scoredRun.studyId, [
      {
        id: "slot_formula_001",
        participantCode: '=P001, "Alpha"\nLine'
      }
    ]);

    expect(result).toMatchObject({
      filename: "study-study_fixture_001-score-export.csv",
      rowCount: 2
    });
    expect(result.csv.split("\r\n")).toMatchInlineSnapshot(`
      [
        "participant_id,participant_slot_id,run_id,run_date,survey_version_id,interview_status,stale_flag,partial_flag,technical_interruption_flag,objective_version_id,objective_key,objective_version_number,objective_title,grade,confidence,rationale,score_flags,evidence_citation_ids,scoring_run_id,scoring_trigger,scoring_model_name,scoring_model_version,scoring_service_request_id,scoring_prompt_version,objective_version_set_hash,scored_at",
        ""'=P001, ""Alpha""
      Line",slot_formula_001,run_fixture_001,2026-05-06T12:00:00.000Z,survey_version_001,interview_completed,false,false,false,objective_version_001,reasoning_quality,1,Reasoning Quality,3,0.82,"'=SUM(1,1)
      The participant said ""clear"", with detail.",missing_interview_evidence,evidence_citation_export_001;evidence_citation_export_002,scoring_run_export_001,automatic,fake-scoring,local-1,req_export_001,scoring-v1,sha256:export,2026-05-06T12:40:00.000Z",
        ""'=P001, ""Alpha""
      Line",slot_formula_001,run_fixture_001,2026-05-06T12:00:00.000Z,survey_version_001,partial,false,true,false,objective_version_002,reflection_depth,2,"'@Reflection, Depth",'+advanced,0.41,"Interview was missing, so confidence is lower.",low_confidence;partial_run;missing_interview_evidence,,scoring_run_export_001,automatic,fake-scoring,local-1,req_export_001,scoring-v1,sha256:export,2026-05-06T12:40:00.000Z",
        "",
      ]
    `);
  });
});

describe("automatic scoring job", () => {
  it("prefers participant transcript turns when local fake scoring creates citations", async () => {
    const provider = new FakeScoringAiProvider();
    const response = await provider.completeStructured({
      promptVersion: SCORING_PROMPT_VERSION,
      input: {
        run,
        surveyResponses: [surveyResponse],
        objectiveVersions: [objective],
        trigger: "automatic",
        interviewAudioAssets: [],
        interviewTurns: [
          {
            id: "interview_turn_ai_001",
            studyId: run.studyId,
            participantSlotId: run.participantSlotId,
            runId: run.id,
            interviewSessionId: "interview_session_001",
            speaker: "ai",
            text: "Could you say more?",
            createdAt: "2026-05-06T12:24:00.000Z"
          },
          {
            id: "interview_turn_participant_001",
            studyId: run.studyId,
            participantSlotId: run.participantSlotId,
            runId: run.id,
            interviewSessionId: "interview_session_001",
            speaker: "participant",
            text: "The worked example helped me explain the pattern.",
            createdAt: "2026-05-06T12:25:00.000Z"
          }
        ]
      }
    });

    expect(response.output).toMatchObject({
      scores: [
        {
          citations: [
            {
              sourceType: "interview_turn",
              sourceId: "interview_turn_participant_001",
              quote: "The worked example helped me explain the pattern."
            }
          ]
        }
      ]
    });
  });

  it("scores a completed interview run, persists scores and citations, and marks the run scored", async () => {
    const runStore = new InMemoryRunStore([{ ...run, status: "created" }]);
    await runStore.submitSurvey([surveyResponse], { ...run, status: "survey_completed" }, "created");
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

  it("manual rescoring uses latest active objective versions while preserving prior scoring runs", async () => {
    const scoredRun: Run = { ...run, status: "scored", objectiveVersionIds: ["objective_version_001"] };
    const revisedObjective: ObjectiveVersion = {
      ...objective,
      id: "objective_version_002",
      versionNumber: 2,
      title: "Revised Reasoning Quality",
      gradeScale: ["A", "B"],
      createdAt: "2026-05-07T12:00:00.000Z"
    };
    const scoringStore = new InMemoryScoringStore([
      {
        id: "scoring_run_original_001",
        runId: scoredRun.id,
        status: "completed",
        trigger: "automatic",
        modelName: "fake-scoring",
        modelVersion: "local-1",
        serviceRequestId: "req_original",
        promptVersion: SCORING_PROMPT_VERSION,
        objectiveVersionSetHash: createObjectiveVersionSetHash([objective]),
        scoredAt: "2026-05-06T12:40:00.000Z",
        createdAt: "2026-05-06T12:40:00.000Z"
      }
    ]);
    const service = new ScoringService(
      new InMemoryRunStore([scoredRun]),
      new InMemoryObjectiveVersionStore([{ ...objective, isActive: false }, revisedObjective]),
      scoringStore,
      {
        createScoringRunId: () => "scoring_run_rescore_001",
        createObjectiveScoreId: () => "objective_score_rescore_001",
        now: () => new Date("2026-05-07T12:45:00.000Z")
      }
    );

    const result = await service.triggerManualRescore({
      studyId: scoredRun.studyId,
      runId: scoredRun.id
    });

    expect(result.scoringRun).toMatchObject({
      id: "scoring_run_rescore_001",
      trigger: "manual_rescore",
      objectiveVersionSetHash: createObjectiveVersionSetHash([revisedObjective])
    });
    expect(result.objectiveScores).toEqual([
      expect.objectContaining({
        objectiveVersionId: "objective_version_002",
        gradeLabel: "A"
      })
    ]);
    await expect(scoringStore.listScoringRunsByRun(scoredRun.id)).resolves.toEqual([
      expect.objectContaining({ id: "scoring_run_rescore_001", trigger: "manual_rescore" }),
      expect.objectContaining({ id: "scoring_run_original_001", trigger: "automatic" })
    ]);
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
