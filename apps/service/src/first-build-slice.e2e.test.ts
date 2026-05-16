import { describe, expect, it } from "vitest";
import type { AuthProvider, AuthTokens, SessionUser } from "./auth.js";
import { InMemoryConsentVersionStore } from "./consent.js";
import type { GapMapGenerationInput, GapMapGeneratorOutput } from "./gap-map.js";
import { InMemoryObjectiveVersionStore } from "./objectives.js";
import { InMemoryOperationalEventStore } from "./operational-events.js";
import { InMemoryParticipantSlotStore } from "./participant-slots.js";
import { InMemoryParticipantAccessTokenStore, InMemoryRunStore } from "./runs.js";
import type { ScoringGenerationInput, ScoringGeneratorOutput } from "./scoring.js";
import { InMemoryScoringStore } from "./scoring.js";
import { buildServer } from "./server.js";
import { InMemoryStudyShellStore } from "./study-shell.js";
import { InMemorySurveyVersionStore } from "./survey.js";
import { FakeRealtimeVoiceProvider } from "./voice-provider.js";

const researcher: SessionUser = {
  id: "user_researcher_001",
  email: "researcher@example.test",
  displayName: "Fixture Researcher",
  role: "researcher"
};

const tokens: AuthTokens = {
  accessToken: "valid-access-token",
  idToken: "valid-id-token",
  expiresIn: 3600,
  tokenType: "Bearer"
};

function createFakeAuthProvider(): AuthProvider {
  return {
    async signIn(email, password) {
      if (email !== researcher.email || password !== "correct-password") {
        throw new Error("Invalid credentials.");
      }

      return tokens;
    },
    async signOut() {
      return undefined;
    },
    async verifyAccessToken(accessToken) {
      if (accessToken !== tokens.accessToken) {
        throw new Error("Invalid token.");
      }

      return researcher;
    }
  };
}

function createFirstBuildSliceGapMapGenerator() {
  return {
    async generate(input: GapMapGenerationInput): Promise<GapMapGeneratorOutput> {
      return {
        modelName: "fake-gap-map",
        modelVersion: "local-1",
        serviceRequestId: "req_gap_map_first_build_slice",
        promptVersion: "gap-map-v1",
        alreadyAnswered: ["The participant noticed a change in thinking."],
        ambiguities: ["The reason for the change is underspecified."],
        contradictions: [],
        missingEvidence: input.objectiveVersions.map((objective) => `Need an example for ${objective.title}.`),
        recommendedProbes: ["What were the two examples you compared?"]
      };
    }
  };
}

function createFirstBuildSliceScoringGenerator() {
  return {
    async generate(input: ScoringGenerationInput): Promise<ScoringGeneratorOutput> {
      const interviewTurn = input.interviewTurns?.find((turn) => turn.speaker === "participant");

      return {
        modelName: "fake-scoring",
        modelVersion: "local-1",
        serviceRequestId: "req_scoring_first_build_slice",
        promptVersion: "scoring-v1",
        objectiveVersionSetHash: "sha256:first-build-slice-objectives",
        scores: input.objectiveVersions.map((objective) => ({
          objectiveVersionId: objective.id,
          gradeLabel: "4",
          confidence: 0.91,
          rationale: "The participant connected a claim to a concrete comparison example.",
          flags: [],
          citations: interviewTurn
            ? [
                {
                  sourceType: "interview_turn",
                  sourceId: interviewTurn.id,
                  quote: interviewTurn.text,
                  audioStartMs: interviewTurn.audioStartMs,
                  audioEndMs: interviewTurn.audioEndMs
                }
              ]
            : []
        }))
      };
    }
  };
}

function participantTokenFromAccessUrl(participantAccessUrl: string) {
  const url = new URL(participantAccessUrl);
  const token = url.pathname.split("/").at(-1);

  if (!token) {
    throw new Error("Participant access URL did not include a token.");
  }

  return decodeURIComponent(token);
}

describe("end-to-end first build slice", () => {
  it("covers researcher setup, participant completion, fake AI/voice scoring, review, and CSV export", async () => {
    // Keep the scenario values aligned with packages/data-schema/src/fixtures.ts so the
    // HTTP E2E path exercises the same first-build-slice baseline as local database seeds.
    const authProvider = createFakeAuthProvider();
    const studyStore = new InMemoryStudyShellStore();
    const consentStore = new InMemoryConsentVersionStore();
    const surveyStore = new InMemorySurveyVersionStore();
    const objectiveStore = new InMemoryObjectiveVersionStore();
    const participantSlotStore = new InMemoryParticipantSlotStore();
    const participantAccessTokenStore = new InMemoryParticipantAccessTokenStore();
    const runStore = new InMemoryRunStore();
    const scoringStore = new InMemoryScoringStore();
    const operationalStore = new InMemoryOperationalEventStore();
    let surveyResponseSequence = 0;
    let interviewTurnSequence = 0;
    const now = () => new Date("2026-05-04T12:00:00.000Z");
    const server = buildServer({
      authProvider,
      logger: false,
      consentVersionStore: consentStore,
      gapMapGenerator: createFirstBuildSliceGapMapGenerator(),
      objectiveVersionStore: objectiveStore,
      operationalEventStore: operationalStore,
      participantAccessTokenStore,
      participantSlotServiceOptions: {
        createParticipantSlotId: () => "slot_fixture_001",
        now
      },
      participantSlotStore,
      realtimeVoiceProvider: new FakeRealtimeVoiceProvider(),
      runServiceOptions: {
        createConsentRecordId: () => "consent_record_001",
        createGapMapId: () => "gap_map_001",
        createInterviewAudioAssetId: () => "interview_audio_asset_001",
        createInterviewSessionId: () => "interview_session_001",
        createInterviewTurnId: () => `interview_turn_00${++interviewTurnSequence}`,
        createParticipantAccessTokenId: () => "token_fixture_001",
        createRunId: () => "run_fixture_001",
        createSurveyResponseId: () => `survey_response_00${++surveyResponseSequence}`,
        now,
        participantAccessBaseUrl: "http://127.0.0.1:5173",
        participantAccessTokenSecret: "first-build-slice-test-secret"
      },
      runStore,
      scoringGenerator: createFirstBuildSliceScoringGenerator(),
      scoringServiceOptions: {
        createEvidenceCitationId: () => "evidence_citation_001",
        createObjectiveScoreId: () => "objective_score_001",
        createScoringRunId: () => "scoring_run_001",
        now
      },
      scoringStore,
      studyShellStore: studyStore,
      surveyVersionStore: surveyStore
    });
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };

    const studyResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies",
      headers,
      payload: {
        title: "Fixture Formative Study",
        defaultFreshnessDays: 14,
        defaultMaxInterviewMinutes: 45
      }
    });
    expect(studyResponse.statusCode).toBe(201);
    const studyId = studyResponse.json().study.id as string;

    const consentResponse = await server.inject({
      method: "PUT",
      url: `/researcher/studies/${studyId}/consent`,
      headers,
      payload: {
        consentText: "Fixture consent text for local development only.",
        consentMethod: "checkmark"
      }
    });
    expect(consentResponse.statusCode).toBe(201);

    const surveyResponse = await server.inject({
      method: "PUT",
      url: `/researcher/studies/${studyId}/survey`,
      headers,
      payload: {
        items: [
          {
            type: "group",
            group: {
              title: "Learning Reflection",
              questions: [
                {
                  prompt: "Describe a moment when the lesson changed your thinking."
                }
              ]
            }
          }
        ]
      }
    });
    expect(surveyResponse.statusCode).toBe(201);
    const surveyQuestionId = surveyResponse.json().surveyVersion.layoutItems[0].group.questions[0].id as string;

    const objectivesResponse = await server.inject({
      method: "PUT",
      url: `/researcher/studies/${studyId}/objectives`,
      headers,
      payload: {
        objectives: [
          {
            title: "Reasoning Quality",
            description: "Assesses how clearly the participant explains their reasoning.",
            customScoringPrompt: "Prioritize evidence of explanation and examples.",
            gradeLabels: ["1", "2", "3", "4"],
            gradeExamples: [
              {
                gradeLabel: "4",
                exampleText: "Gives a specific claim, example, and explanation."
              }
            ],
            evidenceRequirements: "Cite at least one survey response or interview turn."
          }
        ]
      }
    });
    expect(objectivesResponse.statusCode).toBe(201);

    const participantSlotResponse = await server.inject({
      method: "POST",
      url: `/researcher/studies/${studyId}/participant-slots`,
      headers,
      payload: {
        participantCode: "P001"
      }
    });
    expect(participantSlotResponse.statusCode).toBe(201);

    const runResponse = await server.inject({
      method: "POST",
      url: `/researcher/studies/${studyId}/runs`,
      headers,
      payload: {
        participantSlotIds: ["slot_fixture_001"]
      }
    });
    expect(runResponse.statusCode).toBe(201);
    expect(runResponse.json()).toMatchObject({
      createdRuns: [
        {
          id: "run_fixture_001",
          participantSlotId: "slot_fixture_001",
          status: "created",
          participantAccessTokenId: "token_fixture_001"
        }
      ]
    });
    const participantToken = participantTokenFromAccessUrl(runResponse.json().createdRuns[0].participantAccessUrl);

    const participantAccessResponse = await server.inject({
      method: "GET",
      url: `/participant/runs/${participantToken}`
    });
    expect(participantAccessResponse.statusCode).toBe(200);
    expect(participantAccessResponse.json()).toMatchObject({
      run: {
        id: "run_fixture_001",
        status: "created"
      },
      consentVersion: {
        consentText: "Fixture consent text for local development only.",
        consentMethod: "checkmark"
      }
    });

    const participantConsentResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${participantToken}/consent`,
      payload: {
        accepted: true
      }
    });
    expect(participantConsentResponse.statusCode).toBe(201);
    expect(participantConsentResponse.json()).toMatchObject({
      consentRecord: {
        id: "consent_record_001",
        renderedConsentSnapshot: "Fixture consent text for local development only."
      },
      run: {
        status: "consented"
      }
    });

    const participantSurveyResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${participantToken}/survey`,
      payload: {
        responses: [
          {
            surveyQuestionId,
            responseText: "I changed my mind after comparing two examples."
          }
        ]
      }
    });
    expect(participantSurveyResponse.statusCode).toBe(201);
    expect(participantSurveyResponse.json()).toMatchObject({
      gapMap: {
        id: "gap_map_001",
        modelName: "fake-gap-map",
        recommendedProbes: ["What were the two examples you compared?"]
      },
      run: {
        status: "survey_completed"
      },
      surveyResponses: [
        {
          id: "survey_response_001",
          responseText: "I changed my mind after comparing two examples."
        }
      ]
    });

    const interviewStartResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${participantToken}/interview/start`
    });
    expect(interviewStartResponse.statusCode).toBe(201);
    expect(interviewStartResponse.json()).toMatchObject({
      interviewSession: {
        id: "interview_session_001",
        status: "active"
      },
      run: {
        status: "interview_in_progress"
      }
    });

    const realtimeSessionResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${participantToken}/interview/realtime-session`
    });
    expect(realtimeSessionResponse.statusCode).toBe(201);
    expect(realtimeSessionResponse.json()).toMatchObject({
      realtimeSession: {
        provider: "fake",
        model: "fake-realtime-voice",
        serviceRequestId: "fake-realtime-request"
      }
    });

    const interviewArtifactsResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${participantToken}/interview/artifacts`,
      payload: {
        turns: [
          {
            speaker: "ai",
            text: "What were the two examples you compared?",
            audioStartMs: 0,
            audioEndMs: 1800
          },
          {
            speaker: "participant",
            text: "The second example made the pattern much clearer.",
            audioStartMs: 2000,
            audioEndMs: 7200
          }
        ],
        audioAsset: {
          storageUri: "s3://education-researcher-local-fixtures/study_formative_001/run_fixture_001/audio.wav",
          durationSeconds: 7.2,
          mimeType: "audio/wav",
          byteSize: 2048
        },
        transcriptTokenCount: 17
      }
    });
    expect(interviewArtifactsResponse.statusCode).toBe(201);
    expect(interviewArtifactsResponse.json()).toMatchObject({
      audioAsset: {
        id: "interview_audio_asset_001",
        status: "available"
      },
      turns: [
        {
          id: "interview_turn_001",
          speaker: "ai"
        },
        {
          id: "interview_turn_002",
          speaker: "participant",
          text: "The second example made the pattern much clearer."
        }
      ]
    });

    const interviewCompleteResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${participantToken}/interview/complete`
    });
    expect(interviewCompleteResponse.statusCode).toBe(200);
    expect((await runStore.getById("run_fixture_001"))?.status).toBe("scored");

    const dashboardResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/run-dashboard`,
      headers
    });
    expect(dashboardResponse.statusCode).toBe(200);
    expect(dashboardResponse.json()).toMatchObject({
      slots: [
        {
          participantSlot: {
            id: "slot_fixture_001",
            participantCode: "P001"
          },
          currentRun: {
            id: "run_fixture_001",
            status: {
              value: "scored",
              isScored: true
            },
            artifactSummary: {
              consentRecordCount: 1,
              surveyResponseCount: 1,
              gapMapCount: 1,
              interviewSessionCount: 1,
              interviewTurnCount: 2,
              audioAssetCount: 1,
              transcriptTokenCount: 17
            },
            scoringSummary: {
              state: "completed",
              scoringRunCount: 1,
              latestTrigger: "automatic"
            }
          }
        }
      ]
    });

    const scoreReviewResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/score-reviews`,
      headers
    });
    expect(scoreReviewResponse.statusCode).toBe(200);
    expect(scoreReviewResponse.json()).toMatchObject({
      scoreReviews: [
        {
          run: {
            id: "run_fixture_001",
            status: "scored"
          },
          scoringRun: {
            id: "scoring_run_001",
            trigger: "automatic",
            modelName: "fake-scoring",
            serviceRequestId: "req_scoring_first_build_slice"
          },
          objectiveScores: [
            {
              objectiveVersion: {
                title: "Reasoning Quality"
              },
              score: {
                id: "objective_score_001",
                gradeLabel: "4",
                confidence: 0.91,
                rationale: "The participant connected a claim to a concrete comparison example."
              },
              citations: [
                {
                  id: "evidence_citation_001",
                  sourceType: "interview_turn",
                  sourceId: "interview_turn_002"
                }
              ]
            }
          ]
        }
      ]
    });

    const rawEvidenceResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/runs/run_fixture_001/raw-evidence`,
      headers
    });
    expect(rawEvidenceResponse.statusCode).toBe(200);
    expect(rawEvidenceResponse.json()).toMatchObject({
      surveyResponses: [
        {
          id: "survey_response_001"
        }
      ],
      interviewTurns: [
        {
          id: "interview_turn_001"
        },
        {
          id: "interview_turn_002"
        }
      ],
      audioAssets: [
        {
          id: "interview_audio_asset_001",
          signedUrl: expect.stringContaining("https://signed-audio.local/education-researcher")
        }
      ]
    });

    const resolvedCitationResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/runs/run_fixture_001/evidence-citations/evidence_citation_001`,
      headers
    });
    expect(resolvedCitationResponse.statusCode).toBe(200);
    expect(resolvedCitationResponse.json()).toMatchObject({
      citation: {
        id: "evidence_citation_001",
        quote: "The second example made the pattern much clearer."
      },
      source: {
        type: "interview_turn",
        interviewTurn: {
          id: "interview_turn_002"
        }
      }
    });

    const csvExportResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/score-export.csv`,
      headers
    });
    const csv = csvExportResponse.body;
    expect(csvExportResponse.statusCode).toBe(200);
    expect(csvExportResponse.headers["content-type"]).toContain("text/csv");
    expect(csv).toContain(
      "participant_id,participant_slot_id,run_id,run_date,survey_version_id,interview_status"
    );
    expect(csv).toContain("P001,slot_fixture_001,run_fixture_001");
    expect(csv).toContain(",interview_completed,false,false,false,");
    expect(csv).toContain(",Reasoning Quality,4,0.91,");
    expect(csv).toContain("evidence_citation_001,scoring_run_001,automatic,fake-scoring,local-1");

    await server.close();
  });
});
