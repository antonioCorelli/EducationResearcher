import { describe, expect, it } from "vitest";
import type { AuthProvider, AuthTokens, SessionUser } from "./auth.js";
import { InMemoryConsentVersionStore, type ConsentVersion } from "./consent.js";
import { InMemoryObjectiveVersionStore, type ObjectiveVersion } from "./objectives.js";
import { InMemoryOperationalEventStore } from "./operational-events.js";
import { InMemoryParticipantSlotStore } from "./participant-slots.js";
import {
  InMemoryParticipantAccessTokenStore,
  InMemoryRunStore,
  createParticipantAccessTokenForTest,
  hashParticipantAccessTokenForTest,
  type ParticipantAccessToken,
  type Run
} from "./runs.js";
import { buildServer } from "./server.js";
import { InMemoryStudyShellStore, V1_DEFAULT_PERSONA_STYLE_PROMPT, type StudyShell } from "./study-shell.js";
import { InMemorySurveyVersionStore, type SurveyVersion } from "./survey.js";
import type { RealtimeVoiceProvider } from "./voice-provider.js";

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

const otherResearcher: SessionUser = {
  id: "user_researcher_002",
  email: "other-researcher@example.test",
  displayName: "Other Researcher",
  role: "researcher"
};

const otherTokens: AuthTokens = {
  accessToken: "other-valid-access-token",
  idToken: "other-valid-id-token",
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
      if (accessToken === tokens.accessToken) {
        return researcher;
      }

      if (accessToken === otherTokens.accessToken) {
        return otherResearcher;
      }

      throw new Error("Invalid token.");
    }
  };
}

function createFixtureStudy(overrides: Partial<StudyShell> = {}): StudyShell {
  const createdAt = "2026-05-06T12:00:00.000Z";

  return {
    id: "study_fixture_001",
    ownerUserId: researcher.id,
    title: "Fixture Study",
    defaultFreshnessDays: 14,
    defaultMaxInterviewMinutes: 45,
    activeConsentVersionId: undefined,
    activeSurveyVersionId: undefined,
    activePersonaVersionId: "persona_version_v1_default_001",
    persona: {
      id: "persona_version_v1_default_001",
      name: "v1_default",
      label: "V1 default research interviewer",
      stylePrompt: V1_DEFAULT_PERSONA_STYLE_PROMPT,
      locked: true
    },
    status: "active",
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

function createFixtureRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_fixture_001",
    studyId: "study_fixture_001",
    participantSlotId: "slot_fixture_001",
    consentVersionId: "consent_version_active",
    surveyVersionId: "survey_version_active",
    personaVersionId: "persona_version_v1_default_001",
    objectiveVersionIds: ["objective_version_001"],
    freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
    maxInterviewMinutes: 45,
    status: "created",
    currentRunForSlot: true,
    createdAt: "2026-05-06T12:00:00.000Z",
    updatedAt: "2026-05-06T12:00:00.000Z",
    ...overrides
  };
}

function createFixtureParticipantAccessToken(
  overrides: Partial<ParticipantAccessToken> & Pick<ParticipantAccessToken, "tokenHash" | "tokenId">
): ParticipantAccessToken {
  const { tokenHash, tokenId, ...optionalOverrides } = overrides;

  return {
    id: `participant_access_token_${tokenId}`,
    tokenHash,
    tokenId,
    studyId: "study_fixture_001",
    participantSlotId: "slot_fixture_001",
    runId: "run_fixture_001",
    status: "active",
    createdAt: "2026-05-06T12:00:00.000Z",
    updatedAt: "2026-05-06T12:00:00.000Z",
    ...optionalOverrides
  };
}

function createFixtureSurveyVersion(): SurveyVersion {
  return {
    id: "survey_version_active",
    studyId: "study_fixture_001",
    versionNumber: 1,
    isActive: true,
    createdAt: "2026-05-06T12:00:00.000Z",
    layoutItems: [
      {
        type: "question",
        sortOrder: 1,
        question: {
          id: "survey_question_001",
          surveyVersionId: "survey_version_active",
          prompt: "What did you notice first?",
          required: true,
          questionType: "long_text",
          sortOrder: 1,
          createdAt: "2026-05-06T12:00:00.000Z"
        }
      }
    ],
    groups: [],
    ungroupedQuestions: [
      {
        id: "survey_question_001",
        surveyVersionId: "survey_version_active",
        prompt: "What did you notice first?",
        required: true,
        questionType: "long_text",
        sortOrder: 1,
        createdAt: "2026-05-06T12:00:00.000Z"
      }
    ]
  };
}

function createFixtureObjectiveVersion(): ObjectiveVersion {
  return {
    id: "objective_version_001",
    studyId: "study_fixture_001",
    objectiveKey: "reasoning_quality",
    versionNumber: 1,
    title: "Reasoning Quality",
    description: "Explains reasoning clearly.",
    gradeScale: ["1", "2"],
    gradeExamples: [],
    evidenceRequirements: "Use survey and interview evidence.",
    sortOrder: 1,
    isEnabled: true,
    isActive: true,
    createdAt: "2026-05-06T12:00:00.000Z"
  };
}

describe("health route", () => {
  it("returns service health status", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "education-researcher-service",
      status: "ok"
    });

    await server.close();
  });
});

describe("researcher auth routes", () => {
  it("signs in researchers with email and password", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: {
        email: "Researcher@Example.Test",
        password: "correct-password"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      tokens
    });

    await server.close();
  });

  it("rejects invalid researcher credentials", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: {
        email: "researcher@example.test",
        password: "wrong-password"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Unauthorized",
      message: "Email or password is incorrect."
    });

    await server.close();
  });

  it("blocks unauthenticated access to researcher routes", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "GET",
      url: "/researcher/session"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Unauthorized",
      message: "Researcher sign-in is required."
    });

    await server.close();
  });

  it("allows authenticated researchers to access researcher routes", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "GET",
      url: "/researcher/session",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: researcher
    });

    await server.close();
  });

  it("signs out authenticated researchers", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "POST",
      url: "/auth/sign-out",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(204);

    await server.close();
  });
});

describe("participant routes", () => {
  it("keeps participant routes public", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "GET",
      url: "/participant/demo"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      participantRoute: "public",
      message: "Participant routes do not require researcher sign-in."
    });

    await server.close();
  });

  it("denies participant self-created run resets", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "POST",
      url: "/participant/runs",
      payload: {
        participantSlotId: "slot_fixture_001"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "Forbidden",
      message: "Participants cannot create or reset runs."
    });

    await server.close();
  });

  it("validates secure participant run access tokens for active fresh runs", async () => {
    const rawToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_valid",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_valid",
          tokenHash: hashParticipantAccessTokenForTest(rawToken)
        })
      ]),
      consentVersionStore: new InMemoryConsentVersionStore([
        {
          id: "consent_version_active",
          studyId: "study_fixture_001",
          versionNumber: 1,
          consentText: "Please review and accept this study consent.",
          consentMethod: "checkmark",
          isActive: true,
          createdAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        now: () => new Date("2026-05-06T12:00:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore: new InMemoryRunStore([createFixtureRun()])
    });
    const response = await server.inject({
      method: "GET",
      url: `/participant/runs/${rawToken}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      run: {
        id: "run_fixture_001",
        studyId: "study_fixture_001",
        participantSlotId: "slot_fixture_001",
        status: "created",
        freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
        maxInterviewMinutes: 45
      },
      consentVersion: {
        id: "consent_version_active",
        studyId: "study_fixture_001",
        versionNumber: 1,
        consentText: "Please review and accept this study consent.",
        consentMethod: "checkmark",
        isActive: true,
        createdAt: "2026-05-06T12:00:00.000Z"
      }
    });

    await server.close();
  });

  it("captures checkmark consent with the server-rendered version snapshot and transitions the run", async () => {
    const rawToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_checkmark",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const runStore = new InMemoryRunStore([createFixtureRun()]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_checkmark",
          tokenHash: hashParticipantAccessTokenForTest(rawToken)
        })
      ]),
      consentVersionStore: new InMemoryConsentVersionStore([
        {
          id: "consent_version_active",
          studyId: "study_fixture_001",
          versionNumber: 1,
          consentText: "Original consent snapshot.",
          consentMethod: "checkmark",
          isActive: true,
          createdAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        createConsentRecordId: () => "consent_record_checkmark_001",
        now: () => new Date("2026-05-06T12:05:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore
    });
    const response = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/consent`,
      payload: {
        accepted: true,
        renderedConsentSnapshot: "Client-tampered consent text"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Bad Request",
      message: "Consent record metadata is assigned by the service."
    });

    const acceptedResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/consent`,
      payload: {
        accepted: true
      }
    });

    expect(acceptedResponse.statusCode).toBe(201);
    expect(acceptedResponse.json()).toMatchObject({
      consentRecord: {
        id: "consent_record_checkmark_001",
        studyId: "study_fixture_001",
        participantSlotId: "slot_fixture_001",
        runId: "run_fixture_001",
        consentVersionId: "consent_version_active",
        consentMethod: "checkmark",
        renderedConsentSnapshot: "Original consent snapshot.",
        acceptedAt: "2026-05-06T12:05:00.000Z",
        createdAt: "2026-05-06T12:05:00.000Z"
      },
      run: {
        id: "run_fixture_001",
        status: "consented",
        updatedAt: "2026-05-06T12:05:00.000Z"
      }
    });
    expect((await runStore.getById("run_fixture_001"))?.status).toBe("consented");
    expect(await runStore.listConsentRecordsByRun("run_fixture_001")).toEqual([
      expect.objectContaining({
        id: "consent_record_checkmark_001",
        renderedConsentSnapshot: "Original consent snapshot."
      })
    ]);

    await server.close();
  });

  it("captures electronic signature consent text when configured", async () => {
    const rawToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_signature",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_signature",
          tokenHash: hashParticipantAccessTokenForTest(rawToken)
        })
      ]),
      consentVersionStore: new InMemoryConsentVersionStore([
        {
          id: "consent_version_active",
          studyId: "study_fixture_001",
          versionNumber: 2,
          consentText: "Signature consent snapshot.",
          consentMethod: "electronic_signature",
          isActive: true,
          createdAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        createConsentRecordId: () => "consent_record_signature_001",
        now: () => new Date("2026-05-06T12:06:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore: new InMemoryRunStore([createFixtureRun()])
    });
    const missingSignature = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/consent`,
      payload: {
        signatureText: " "
      }
    });
    const acceptedResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/consent`,
      payload: {
        signatureText: "  Taylor Participant  "
      }
    });

    expect(missingSignature.statusCode).toBe(400);
    expect(missingSignature.json()).toEqual({
      error: "Bad Request",
      message: "Signature text is required."
    });
    expect(acceptedResponse.statusCode).toBe(201);
    expect(acceptedResponse.json()).toMatchObject({
      consentRecord: {
        id: "consent_record_signature_001",
        consentMethod: "electronic_signature",
        signatureText: "Taylor Participant",
        renderedConsentSnapshot: "Signature consent snapshot."
      },
      run: {
        status: "consented"
      }
    });

    await server.close();
  });

  it("renders and submits a run's snapshotted long-form survey exactly once", async () => {
    const rawToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_survey",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "consented" })]);
    const surveyVersion: SurveyVersion = {
      id: "survey_version_active",
      studyId: "study_fixture_001",
      versionNumber: 1,
      isActive: false,
      createdAt: "2026-05-06T12:00:00.000Z",
      layoutItems: [
        {
          type: "question",
          sortOrder: 1,
          question: {
            id: "survey_question_ungrouped",
            surveyVersionId: "survey_version_active",
            prompt: "What did you notice first?",
            required: true,
            questionType: "long_text",
            sortOrder: 1,
            createdAt: "2026-05-06T12:00:00.000Z"
          }
        },
        {
          type: "group",
          sortOrder: 2,
          group: {
            id: "survey_group_reasoning",
            surveyVersionId: "survey_version_active",
            title: "Reasoning",
            sortOrder: 2,
            createdAt: "2026-05-06T12:00:00.000Z",
            questions: [
              {
                id: "survey_question_grouped",
                surveyVersionId: "survey_version_active",
                surveyGroupId: "survey_group_reasoning",
                prompt: "What evidence supports your answer?",
                required: true,
                questionType: "long_text",
                sortOrder: 1,
                createdAt: "2026-05-06T12:00:00.000Z"
              }
            ]
          }
        }
      ],
      groups: [
        {
          id: "survey_group_reasoning",
          surveyVersionId: "survey_version_active",
          title: "Reasoning",
          sortOrder: 2,
          createdAt: "2026-05-06T12:00:00.000Z",
          questions: [
            {
              id: "survey_question_grouped",
              surveyVersionId: "survey_version_active",
              surveyGroupId: "survey_group_reasoning",
              prompt: "What evidence supports your answer?",
              required: true,
              questionType: "long_text",
              sortOrder: 1,
              createdAt: "2026-05-06T12:00:00.000Z"
            }
          ]
        }
      ],
      ungroupedQuestions: [
        {
          id: "survey_question_ungrouped",
          surveyVersionId: "survey_version_active",
          prompt: "What did you notice first?",
          required: true,
          questionType: "long_text",
          sortOrder: 1,
          createdAt: "2026-05-06T12:00:00.000Z"
        }
      ]
    };
    let surveyResponseSequence = 0;
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_survey",
          tokenHash: hashParticipantAccessTokenForTest(rawToken)
        })
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        createSurveyResponseId: () => `survey_response_fixture_${++surveyResponseSequence}`,
        now: () => new Date("2026-05-06T12:20:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore,
      surveyVersionStore: new InMemorySurveyVersionStore([surveyVersion])
    });
    const renderResponse = await server.inject({
      method: "GET",
      url: `/participant/runs/${rawToken}`
    });
    const missingRequiredResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/survey`,
      payload: {
        responses: [
          {
            surveyQuestionId: "survey_question_ungrouped",
            responseText: "I noticed the diagram first."
          }
        ]
      }
    });
    const metadataResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/survey`,
      payload: {
        responses: [
          {
            id: "client_response_id",
            surveyQuestionId: "survey_question_ungrouped",
            responseText: "I noticed the diagram first."
          }
        ]
      }
    });
    const submitResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/survey`,
      payload: {
        responses: [
          {
            surveyQuestionId: "survey_question_ungrouped",
            responseText: "  I noticed the diagram first.  "
          },
          {
            surveyQuestionId: "survey_question_grouped",
            responseText: "The example and the labels supported my answer."
          }
        ]
      }
    });
    const duplicateResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/survey`,
      payload: {
        responses: [
          {
            surveyQuestionId: "survey_question_ungrouped",
            responseText: "Another answer."
          },
          {
            surveyQuestionId: "survey_question_grouped",
            responseText: "Another grouped answer."
          }
        ]
      }
    });

    expect(renderResponse.statusCode).toBe(200);
    expect(renderResponse.json()).toMatchObject({
      run: {
        id: "run_fixture_001",
        status: "consented"
      },
      surveyVersion: {
        id: "survey_version_active",
        isActive: false,
        layoutItems: [
          {
            type: "question",
            question: {
              id: "survey_question_ungrouped",
              prompt: "What did you notice first?"
            }
          },
          {
            type: "group",
            group: {
              title: "Reasoning",
              questions: [
                {
                  id: "survey_question_grouped",
                  prompt: "What evidence supports your answer?"
                }
              ]
            }
          }
        ]
      }
    });
    expect(missingRequiredResponse.statusCode).toBe(400);
    expect(missingRequiredResponse.json()).toEqual({
      error: "Bad Request",
      message: "All required survey questions must be answered."
    });
    expect(metadataResponse.statusCode).toBe(400);
    expect(metadataResponse.json()).toEqual({
      error: "Bad Request",
      message: "Survey response metadata is assigned by the service."
    });
    expect(submitResponse.statusCode).toBe(201);
    expect(submitResponse.json()).toMatchObject({
      surveyResponses: [
        {
          runId: "run_fixture_001",
          surveyQuestionId: "survey_question_ungrouped",
          responseText: "I noticed the diagram first.",
          submittedAt: "2026-05-06T12:20:00.000Z"
        },
        {
          runId: "run_fixture_001",
          surveyQuestionId: "survey_question_grouped",
          responseText: "The example and the labels supported my answer.",
          submittedAt: "2026-05-06T12:20:00.000Z"
        }
      ],
      run: {
        id: "run_fixture_001",
        status: "survey_completed",
        updatedAt: "2026-05-06T12:20:00.000Z"
      }
    });
    expect((await runStore.getById("run_fixture_001"))?.status).toBe("survey_completed");
    expect(await runStore.listSurveyResponsesByRun("run_fixture_001")).toHaveLength(2);
    expect(duplicateResponse.statusCode).toBe(403);
    expect(duplicateResponse.json()).toEqual({
      error: "Forbidden",
      message: "Survey cannot be submitted for this run."
    });

    await server.close();
  });

  it("blocks stale participant survey submission", async () => {
    const rawToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_stale_survey",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_stale_survey",
          tokenHash: hashParticipantAccessTokenForTest(rawToken)
        })
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        now: () => new Date("2026-05-21T12:00:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore: new InMemoryRunStore([
        createFixtureRun({
          status: "consented",
          freshnessDeadlineAt: "2026-05-20T12:00:00.000Z"
        })
      ]),
      surveyVersionStore: new InMemorySurveyVersionStore([])
    });
    const response = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/survey`,
      payload: {
        responses: []
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "Forbidden",
      message: "This participant link is not available."
    });

    await server.close();
  });

  it("blocks consent submission for unauthorized, stale, and already-started runs", async () => {
    const validToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_valid",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const staleToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_stale",
      runId: "run_stale_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const consentedToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_consented",
      runId: "run_consented_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_valid",
          tokenHash: hashParticipantAccessTokenForTest(validToken)
        }),
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_stale",
          tokenHash: hashParticipantAccessTokenForTest(staleToken),
          runId: "run_stale_001"
        }),
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_consented",
          tokenHash: hashParticipantAccessTokenForTest(consentedToken),
          runId: "run_consented_001"
        })
      ]),
      consentVersionStore: new InMemoryConsentVersionStore([
        {
          id: "consent_version_active",
          studyId: "study_fixture_001",
          versionNumber: 1,
          consentText: "Consent snapshot.",
          consentMethod: "checkmark",
          isActive: true,
          createdAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        now: () => new Date("2026-05-21T12:00:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore: new InMemoryRunStore([
        createFixtureRun({
          freshnessDeadlineAt: "2026-05-22T12:00:00.000Z"
        }),
        createFixtureRun({
          id: "run_stale_001",
          freshnessDeadlineAt: "2026-05-20T12:00:00.000Z"
        }),
        createFixtureRun({
          id: "run_consented_001",
          status: "consented",
          freshnessDeadlineAt: "2026-05-22T12:00:00.000Z"
        })
      ])
    });
    const invalidTokenResponse = await server.inject({
      method: "POST",
      url: "/participant/runs/not-a-token/consent",
      payload: {
        accepted: true
      }
    });
    const staleResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${staleToken}/consent`,
      payload: {
        accepted: true
      }
    });
    const alreadyStartedResponse = await server.inject({
      method: "POST",
      url: `/participant/runs/${consentedToken}/consent`,
      payload: {
        accepted: true
      }
    });

    expect(invalidTokenResponse.statusCode).toBe(403);
    expect(staleResponse.statusCode).toBe(403);
    expect(alreadyStartedResponse.statusCode).toBe(403);
    expect(alreadyStartedResponse.json()).toEqual({
      error: "Forbidden",
      message: "Consent cannot be submitted for this run."
    });

    await server.close();
  });

  it("blocks invalid, cross-run, expired active, and archived-slot participant access safely", async () => {
    const validToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_valid",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const crossRunToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_cross",
      runId: "run_other_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const staleToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_stale",
      runId: "run_stale_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const archivedSlotToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_archived",
      runId: "run_archived_slot_001",
      participantSlotId: "slot_archived_001",
      secret: "test-participant-secret"
    });
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_valid",
          tokenHash: hashParticipantAccessTokenForTest(validToken)
        }),
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_cross",
          tokenHash: hashParticipantAccessTokenForTest(validToken),
          runId: "run_fixture_001"
        }),
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_stale",
          tokenHash: hashParticipantAccessTokenForTest(staleToken),
          runId: "run_stale_001"
        }),
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_archived",
          tokenHash: hashParticipantAccessTokenForTest(archivedSlotToken),
          participantSlotId: "slot_archived_001",
          runId: "run_archived_slot_001"
        })
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        },
        {
          id: "slot_archived_001",
          studyId: "study_fixture_001",
          participantCode: "P002",
          codeSource: "researcher_supplied",
          status: "archived",
          archivedAt: "2026-05-06T12:01:00.000Z",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:01:00.000Z"
        }
      ]),
      runServiceOptions: {
        now: () => new Date("2026-05-21T12:00:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore: new InMemoryRunStore([
        createFixtureRun(),
        createFixtureRun({
          id: "run_stale_001",
          freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
          status: "created"
        }),
        createFixtureRun({
          id: "run_archived_slot_001",
          participantSlotId: "slot_archived_001"
        })
      ])
    });
    const attempts = await Promise.all(
      ["not-a-token", crossRunToken, staleToken, archivedSlotToken].map((accessToken) =>
        server.inject({
          method: "GET",
          url: `/participant/runs/${accessToken}`
        })
      )
    );

    for (const response of attempts) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: "Forbidden",
        message: "This participant link is not available."
      });
    }

    await server.close();
  });

  it("returns participant-safe run status for completion and blocked-state screens", async () => {
    const statuses = [
      "interview_completed",
      "stale",
      "technical_interruption",
      "partial",
      "scored"
    ] as const;
    const participantAccessTokenStore = new InMemoryParticipantAccessTokenStore(
      statuses.map((status) => {
        const rawToken = createParticipantAccessTokenForTest({
          tokenId: `token_fixture_${status}`,
          runId: `run_${status}`,
          participantSlotId: "slot_fixture_001",
          secret: "test-participant-secret"
        });

        return createFixtureParticipantAccessToken({
          tokenId: `token_fixture_${status}`,
          tokenHash: hashParticipantAccessTokenForTest(rawToken),
          runId: `run_${status}`
        });
      })
    );
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore,
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        now: () => new Date("2026-05-21T12:00:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore: new InMemoryRunStore(
        statuses.map((status) =>
          createFixtureRun({
            id: `run_${status}`,
            status,
            freshnessDeadlineAt: "2026-05-20T12:00:00.000Z"
          })
        )
      )
    });

    for (const status of statuses) {
      const rawToken = createParticipantAccessTokenForTest({
        tokenId: `token_fixture_${status}`,
        runId: `run_${status}`,
        participantSlotId: "slot_fixture_001",
        secret: "test-participant-secret"
      });
      const response = await server.inject({
        method: "GET",
        url: `/participant/runs/${rawToken}`
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        run: {
          id: `run_${status}`,
          studyId: "study_fixture_001",
          participantSlotId: "slot_fixture_001",
          status,
          freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
          maxInterviewMinutes: 45
        }
      });
    }

    await server.close();
  });
});

describe("researcher study shell routes", () => {
  it("creates a study shell with required defaults and locked V1 persona", async () => {
    const store = new InMemoryStudyShellStore();
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false, studyShellStore: store });
    const response = await server.inject({
      method: "POST",
      url: "/researcher/studies",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        title: "  New Formative Study  "
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      study: {
        ownerUserId: researcher.id,
        title: "New Formative Study",
        defaultFreshnessDays: 14,
        defaultMaxInterviewMinutes: 45,
        activePersonaVersionId: "persona_version_v1_default_001",
        persona: {
          name: "v1_default",
          stylePrompt: V1_DEFAULT_PERSONA_STYLE_PROMPT,
          locked: true
        },
        status: "active"
      }
    });
    expect(response.json().study.persona.stylePrompt).toContain("calm, warm, neutral, curious, and non-evaluative");
    expect(response.json().study.persona.stylePrompt).toContain(
      "Do not reveal scoring objectives, rubrics, grades, scores"
    );

    const studies = await store.listByOwner(researcher.id);
    expect(studies).toHaveLength(1);

    await server.close();
  });

  it("edits title, freshness days, and max interview minutes", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false, studyShellStore: store });
    const response = await server.inject({
      method: "PATCH",
      url: "/researcher/studies/study_fixture_001",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        title: "Updated Study",
        defaultFreshnessDays: 21,
        defaultMaxInterviewMinutes: 30
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      study: {
        id: "study_fixture_001",
        title: "Updated Study",
        defaultFreshnessDays: 21,
        defaultMaxInterviewMinutes: 30,
        activePersonaVersionId: "persona_version_v1_default_001",
        persona: {
          locked: true
        }
      }
    });

    await server.close();
  });

  it("validates required title and numeric study settings", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const missingTitle = await server.inject({
      method: "POST",
      url: "/researcher/studies",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        title: " "
      }
    });
    const invalidFreshness = await server.inject({
      method: "POST",
      url: "/researcher/studies",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        title: "New Study",
        defaultFreshnessDays: 0
      }
    });

    expect(missingTitle.statusCode).toBe(400);
    expect(missingTitle.json()).toEqual({
      error: "Bad Request",
      message: "Study title is required."
    });
    expect(invalidFreshness.statusCode).toBe(400);
    expect(invalidFreshness.json()).toEqual({
      error: "Bad Request",
      message: "freshness days must be a whole number from 1 to 365."
    });

    await server.close();
  });

  it("rejects attempts to customize the locked persona", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "POST",
      url: "/researcher/studies",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        title: "New Study",
        activePersonaVersionId: "custom_persona"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Bad Request",
      message: "Interviewer persona is locked to the V1 default and cannot be customized."
    });

    await server.close();
  });

  it("denies cross-researcher study reads and writes", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false, studyShellStore: store });
    const readResponse = await server.inject({
      method: "GET",
      url: "/researcher/studies/study_fixture_001",
      headers: {
        authorization: `Bearer ${otherTokens.accessToken}`
      }
    });
    const writeResponse = await server.inject({
      method: "PATCH",
      url: "/researcher/studies/study_fixture_001",
      headers: {
        authorization: `Bearer ${otherTokens.accessToken}`
      },
      payload: {
        title: "Cross Tenant Edit"
      }
    });

    expect(readResponse.statusCode).toBe(403);
    expect(writeResponse.statusCode).toBe(403);
    expect(writeResponse.json()).toEqual({
      error: "Forbidden",
      message: "You are not authorized to access this study resource."
    });

    await server.close();
  });
});

describe("researcher participant slot routes", () => {
  it("creates researcher-supplied participant slots and lists slot metadata", async () => {
    const studyStore = new InMemoryStudyShellStore([createFixtureStudy()]);
    const participantSlotStore = new InMemoryParticipantSlotStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantSlotStore,
      studyShellStore: studyStore
    });
    const createResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        participantCode: "  P001  "
      }
    });
    const listResponse = await server.inject({
      method: "GET",
      url: "/researcher/studies/study_fixture_001/participant-slots",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      participantSlot: {
        studyId: "study_fixture_001",
        participantCode: "P001",
        codeSource: "researcher_supplied",
        status: "active"
      }
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      participantSlots: [
        {
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active"
        }
      ]
    });

    await server.close();
  });

  it("rejects duplicate participant codes within a study and allows the same code in another study", async () => {
    const studyStore = new InMemoryStudyShellStore([
      createFixtureStudy(),
      createFixtureStudy({
        id: "study_fixture_002",
        ownerUserId: researcher.id,
        title: "Second Fixture Study"
      })
    ]);
    const participantSlotStore = new InMemoryParticipantSlotStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantSlotStore,
      studyShellStore: studyStore
    });
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };

    const firstResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots",
      headers,
      payload: {
        participantCode: "P001"
      }
    });
    const duplicateResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots",
      headers,
      payload: {
        participantCode: "p001"
      }
    });
    const otherStudyResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_002/participant-slots",
      headers,
      payload: {
        participantCode: "P001"
      }
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(duplicateResponse.statusCode).toBe(400);
    expect(duplicateResponse.json()).toEqual({
      error: "Bad Request",
      message: "Participant code already exists for this study."
    });
    expect(otherStudyResponse.statusCode).toBe(201);

    await server.close();
  });

  it("imports participant codes from CSV and reports duplicate and invalid rows", async () => {
    const studyStore = new InMemoryStudyShellStore([createFixtureStudy()]);
    const participantSlotStore = new InMemoryParticipantSlotStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantSlotStore,
      studyShellStore: studyStore
    });
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };

    const existingResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots",
      headers,
      payload: {
        participantCode: "P001"
      }
    });
    const importResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots/import",
      headers,
      payload: {
        csv: ["participantCode", "P002", "p002", "P001", "", "too,many,columns", '"P003'].join("\n")
      }
    });
    const listResponse = await server.inject({
      method: "GET",
      url: "/researcher/studies/study_fixture_001/participant-slots",
      headers
    });

    expect(existingResponse.statusCode).toBe(201);
    expect(importResponse.statusCode).toBe(201);
    expect(importResponse.json()).toMatchObject({
      createdParticipantSlots: [
        {
          studyId: "study_fixture_001",
          participantCode: "P002",
          codeSource: "researcher_supplied",
          status: "active"
        }
      ],
      rejectedRows: [
        {
          rowNumber: 3,
          participantCode: "p002",
          reason: "duplicate",
          message: "Participant code is duplicated in this import."
        },
        {
          rowNumber: 4,
          participantCode: "P001",
          reason: "duplicate",
          message: "Participant code already exists for this study."
        },
        {
          rowNumber: 6,
          reason: "invalid",
          message: "CSV rows must contain exactly one participant code."
        },
        {
          rowNumber: 7,
          reason: "malformed",
          message: "CSV row is malformed."
        }
      ]
    });
    expect(listResponse.json()).toMatchObject({
      participantSlots: [
        {
          participantCode: "P001"
        },
        {
          participantCode: "P002"
        }
      ]
    });

    await server.close();
  });

  it("rejects malformed participant slot import payloads", async () => {
    const studyStore = new InMemoryStudyShellStore([createFixtureStudy()]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      studyShellStore: studyStore
    });
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };
    const emptyCsvResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots/import",
      headers,
      payload: {
        csv: "participantCode\n"
      }
    });
    const metadataResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots/import",
      headers,
      payload: {
        csv: "P001",
        codeSource: "platform_generated"
      }
    });

    expect(emptyCsvResponse.statusCode).toBe(400);
    expect(emptyCsvResponse.json()).toEqual({
      error: "Bad Request",
      message: "Participant slot CSV must include at least one participant code."
    });
    expect(metadataResponse.statusCode).toBe(400);
    expect(metadataResponse.json()).toEqual({
      error: "Bad Request",
      message: "Participant slot metadata is assigned by the service."
    });

    await server.close();
  });

  it("generates unique platform participant codes and retries generated code collisions", async () => {
    const studyStore = new InMemoryStudyShellStore([createFixtureStudy()]);
    const participantSlotStore = new InMemoryParticipantSlotStore();
    const generatedCodes = ["P001", "P002", "P002", "P003"];
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantSlotServiceOptions: {
        createGeneratedParticipantCode: () => generatedCodes.shift() ?? "P999"
      },
      participantSlotStore,
      studyShellStore: studyStore
    });
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };

    const existingResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots",
      headers,
      payload: {
        participantCode: "P001"
      }
    });
    const generateResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots/generate",
      headers,
      payload: {
        count: 2
      }
    });

    expect(existingResponse.statusCode).toBe(201);
    expect(generateResponse.statusCode).toBe(201);
    expect(generateResponse.json()).toMatchObject({
      createdParticipantSlots: [
        {
          participantCode: "P002",
          codeSource: "platform_generated",
          status: "active"
        },
        {
          participantCode: "P003",
          codeSource: "platform_generated",
          status: "active"
        }
      ]
    });

    await server.close();
  });

  it("validates generated participant slot counts and tenant access", async () => {
    const studyStore = new InMemoryStudyShellStore([createFixtureStudy()]);
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false, studyShellStore: studyStore });
    const invalidCountResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots/generate",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        count: 0
      }
    });
    const crossTenantResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots/generate",
      headers: {
        authorization: `Bearer ${otherTokens.accessToken}`
      },
      payload: {
        count: 1
      }
    });

    expect(invalidCountResponse.statusCode).toBe(400);
    expect(invalidCountResponse.json()).toEqual({
      error: "Bad Request",
      message: "Generated slot count must be between 1 and 200."
    });
    expect(crossTenantResponse.statusCode).toBe(403);

    await server.close();
  });

  it("archives a participant slot and blocks cross-tenant slot management", async () => {
    const studyStore = new InMemoryStudyShellStore([createFixtureStudy()]);
    const participantSlotStore = new InMemoryParticipantSlotStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantSlotStore,
      studyShellStore: studyStore
    });
    const createResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        participantCode: "P002"
      }
    });
    const participantSlotId = createResponse.json().participantSlot.id as string;
    const archiveResponse = await server.inject({
      method: "POST",
      url: `/researcher/studies/study_fixture_001/participant-slots/${participantSlotId}/archive`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });
    const crossTenantResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/participant-slots",
      headers: {
        authorization: `Bearer ${otherTokens.accessToken}`
      },
      payload: {
        participantCode: "P003"
      }
    });

    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json()).toMatchObject({
      participantSlot: {
        id: participantSlotId,
        participantCode: "P002",
        status: "archived"
      }
    });
    expect(archiveResponse.json().participantSlot.archivedAt).toEqual(expect.any(String));
    expect(crossTenantResponse.statusCode).toBe(403);

    await server.close();
  });
});

describe("researcher run routes", () => {
  const configuredStudy = createFixtureStudy({
    activeConsentVersionId: "consent_version_active",
    activeSurveyVersionId: "survey_version_active"
  });
  const activeParticipantSlots = [
    {
      id: "slot_fixture_001",
      studyId: "study_fixture_001",
      participantCode: "P001",
      codeSource: "researcher_supplied" as const,
      status: "active" as const,
      createdAt: "2026-05-06T12:00:00.000Z",
      updatedAt: "2026-05-06T12:00:00.000Z"
    },
    {
      id: "slot_fixture_002",
      studyId: "study_fixture_001",
      participantCode: "P002",
      codeSource: "researcher_supplied" as const,
      status: "active" as const,
      createdAt: "2026-05-06T12:00:00.000Z",
      updatedAt: "2026-05-06T12:00:00.000Z"
    }
  ];
  const activeObjectives: ObjectiveVersion[] = [
    {
      id: "objective_version_001",
      studyId: "study_fixture_001",
      objectiveKey: "reasoning_quality",
      versionNumber: 1,
      title: "Reasoning Quality",
      description: "Reasoning.",
      gradeScale: ["1", "2"],
      gradeExamples: [],
      evidenceRequirements: "Use evidence.",
      sortOrder: 2,
      isEnabled: true,
      isActive: true,
      createdAt: "2026-05-06T12:00:00.000Z"
    },
    {
      id: "objective_version_002",
      studyId: "study_fixture_001",
      objectiveKey: "evidence_quality",
      versionNumber: 1,
      title: "Evidence Quality",
      description: "Evidence.",
      gradeScale: ["1", "2"],
      gradeExamples: [],
      evidenceRequirements: "Use evidence.",
      sortOrder: 1,
      isEnabled: true,
      isActive: true,
      createdAt: "2026-05-06T12:01:00.000Z"
    },
    {
      id: "objective_version_disabled",
      studyId: "study_fixture_001",
      objectiveKey: "disabled_quality",
      versionNumber: 1,
      title: "Disabled Quality",
      description: "Disabled.",
      gradeScale: ["1", "2"],
      gradeExamples: [],
      evidenceRequirements: "Use evidence.",
      sortOrder: 3,
      isEnabled: false,
      isActive: true,
      createdAt: "2026-05-06T12:02:00.000Z"
    }
  ];

  it("creates researcher-authorized runs for one or more slots with immutable active configuration references", async () => {
    const studyStore = new InMemoryStudyShellStore([configuredStudy]);
    const participantSlotStore = new InMemoryParticipantSlotStore(activeParticipantSlots);
    const participantAccessTokenStore = new InMemoryParticipantAccessTokenStore();
    const objectiveVersionStore = new InMemoryObjectiveVersionStore(activeObjectives);
    const runStore = new InMemoryRunStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore,
      participantAccessTokenStore,
      participantSlotStore,
      runServiceOptions: {
        createParticipantAccessTokenId: (() => {
          const ids = ["token_fixture_001", "token_fixture_002"];
          return () => ids.shift() ?? "token_fixture_extra";
        })(),
        createRunId: (() => {
          const ids = ["run_fixture_001", "run_fixture_002"];
          return () => ids.shift() ?? "run_fixture_extra";
        })(),
        now: () => new Date("2026-05-06T12:00:00.000Z"),
        participantAccessBaseUrl: "https://research.test",
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore,
      studyShellStore: studyStore
    });
    const response = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/runs",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        participantSlotIds: ["slot_fixture_001", "slot_fixture_002"]
      }
    });
    const listResponse = await server.inject({
      method: "GET",
      url: "/researcher/studies/study_fixture_001/runs",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      createdRuns: [
        {
          id: "run_fixture_001",
          studyId: "study_fixture_001",
          participantSlotId: "slot_fixture_001",
          consentVersionId: "consent_version_active",
          surveyVersionId: "survey_version_active",
          personaVersionId: "persona_version_v1_default_001",
          objectiveVersionIds: ["objective_version_002", "objective_version_001"],
          freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
          maxInterviewMinutes: 45,
          status: "created",
          currentRunForSlot: true,
          participantAccessUrl:
            "https://research.test/participant/runs/pat_token_fixture_001_epXi-T5kxq9Bkpc0Bogcpb_ARuv_2NUsMGPERxn2Z9A",
          participantAccessTokenId: "token_fixture_001"
        },
        {
          id: "run_fixture_002",
          participantSlotId: "slot_fixture_002",
          currentRunForSlot: true,
          participantAccessUrl:
            "https://research.test/participant/runs/pat_token_fixture_002_s6UomeebGhb6-4YMNQ89epBK9Cdw0muhIOS4SKFVl44"
        }
      ]
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().runs).toHaveLength(2);
    expect(listResponse.json().runs[0].participantAccessUrl).toContain("/participant/runs/pat_");
    expect(await participantAccessTokenStore.listByRun("run_fixture_001")).toEqual([
      expect.objectContaining({
        tokenId: "token_fixture_001",
        runId: "run_fixture_001",
        participantSlotId: "slot_fixture_001",
        status: "active"
      })
    ]);

    await server.close();
  });

  it("sets only the newest run as current for a slot while preserving prior runs", async () => {
    const studyStore = new InMemoryStudyShellStore([configuredStudy]);
    const participantSlotStore = new InMemoryParticipantSlotStore([activeParticipantSlots[0]!]);
    const objectiveVersionStore = new InMemoryObjectiveVersionStore(activeObjectives);
    const existingRun: Run = {
      id: "run_existing_001",
      studyId: "study_fixture_001",
      participantSlotId: "slot_fixture_001",
      consentVersionId: "consent_version_old",
      surveyVersionId: "survey_version_old",
      personaVersionId: "persona_version_v1_default_001",
      objectiveVersionIds: ["objective_version_old"],
      freshnessDeadlineAt: "2026-05-12T12:00:00.000Z",
      maxInterviewMinutes: 45,
      status: "scored",
      currentRunForSlot: true,
      createdAt: "2026-05-01T12:00:00.000Z",
      updatedAt: "2026-05-01T13:00:00.000Z"
    };
    const runStore = new InMemoryRunStore([existingRun]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore,
      participantSlotStore,
      runServiceOptions: {
        createRunId: () => "run_new_001",
        now: () => new Date("2026-05-06T12:00:00.000Z")
      },
      runStore,
      studyShellStore: studyStore
    });
    const response = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/runs",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        participantSlotIds: ["slot_fixture_001"]
      }
    });
    const runs = await runStore.listByParticipantSlot("slot_fixture_001");

    expect(response.statusCode).toBe(201);
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "run_existing_001", currentRunForSlot: false }),
        expect.objectContaining({ id: "run_new_001", currentRunForSlot: true })
      ])
    );

    await server.close();
  });

  it("validates run prerequisites, researcher authorization, slot state, and service-owned metadata", async () => {
    const missingConfigStudy = createFixtureStudy({
      id: "study_missing_config",
      activeConsentVersionId: undefined,
      activeSurveyVersionId: undefined
    });
    const studyStore = new InMemoryStudyShellStore([missingConfigStudy, configuredStudy]);
    const participantSlotStore = new InMemoryParticipantSlotStore([
      activeParticipantSlots[0]!,
      {
        id: "slot_missing_config",
        studyId: "study_missing_config",
        participantCode: "PX01",
        codeSource: "researcher_supplied" as const,
        status: "active" as const,
        createdAt: "2026-05-06T12:00:00.000Z",
        updatedAt: "2026-05-06T12:00:00.000Z"
      },
      {
        ...activeParticipantSlots[1]!,
        status: "archived" as const,
        archivedAt: "2026-05-06T12:05:00.000Z"
      }
    ]);
    const objectiveVersionStore = new InMemoryObjectiveVersionStore(activeObjectives);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore,
      participantSlotStore,
      runStore: new InMemoryRunStore(),
      studyShellStore: studyStore
    });
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };
    const missingSelection = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/runs",
      headers,
      payload: {
        participantSlotIds: []
      }
    });
    const metadataAttempt = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/runs",
      headers,
      payload: {
        participantSlotIds: ["slot_fixture_001"],
        status: "created"
      }
    });
    const missingConfig = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_missing_config/runs",
      headers,
      payload: {
        participantSlotIds: ["slot_missing_config"]
      }
    });
    const archivedSlot = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/runs",
      headers,
      payload: {
        participantSlotIds: ["slot_fixture_002"]
      }
    });
    const crossTenant = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/runs",
      headers: {
        authorization: `Bearer ${otherTokens.accessToken}`
      },
      payload: {
        participantSlotIds: ["slot_fixture_001"]
      }
    });

    expect(missingSelection.statusCode).toBe(400);
    expect(missingSelection.json()).toEqual({
      error: "Bad Request",
      message: "Select at least one participant slot."
    });
    expect(metadataAttempt.statusCode).toBe(400);
    expect(metadataAttempt.json()).toEqual({
      error: "Bad Request",
      message: "Run metadata is assigned by the service."
    });
    expect(missingConfig.statusCode).toBe(400);
    expect(missingConfig.json()).toEqual({
      error: "Bad Request",
      message: "Active consent is required before creating runs."
    });
    expect(archivedSlot.statusCode).toBe(400);
    expect(archivedSlot.json()).toEqual({
      error: "Bad Request",
      message: "Runs can only be created for active participant slots."
    });
    expect(crossTenant.statusCode).toBe(403);

    await server.close();
  });
});

describe("researcher consent routes", () => {
  it("allows browser preflight for consent saves", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "OPTIONS",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PUT"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");

    await server.close();
  });

  it("creates initial consent content and marks it active for the study", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const consentStore = new InMemoryConsentVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      consentVersionStore: consentStore,
      logger: false,
      studyShellStore: store
    });
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        consentText: "Participants may choose whether to continue.",
        consentMethod: "checkmark"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      consentVersion: {
        studyId: "study_fixture_001",
        versionNumber: 1,
        consentText: "Participants may choose whether to continue.",
        consentMethod: "checkmark",
        isActive: true
      }
    });

    const study = await store.getById("study_fixture_001");
    expect(study?.activeConsentVersionId).toBe(response.json().consentVersion.id);

    await server.close();
  });

  it("creates a new active version when active consent is edited", async () => {
    const initialConsent: ConsentVersion = {
      id: "consent_version_001",
      studyId: "study_fixture_001",
      versionNumber: 1,
      consentText: "Original consent text.",
      consentMethod: "checkmark",
      isActive: true,
      createdAt: "2026-05-06T12:00:00.000Z"
    };
    const store = new InMemoryStudyShellStore([
      createFixtureStudy({
        activeConsentVersionId: initialConsent.id
      })
    ]);
    const consentStore = new InMemoryConsentVersionStore([initialConsent]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      consentVersionStore: consentStore,
      logger: false,
      studyShellStore: store
    });
    const runConsentVersionId = initialConsent.id;
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        consentText: "Updated consent text.",
        consentMethod: "electronic_signature"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      consentVersion: {
        studyId: "study_fixture_001",
        versionNumber: 2,
        consentText: "Updated consent text.",
        consentMethod: "electronic_signature",
        isActive: true
      }
    });
    expect(runConsentVersionId).toBe("consent_version_001");

    const versions = await consentStore.listByStudy("study_fixture_001");
    expect(versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "consent_version_001", isActive: false, versionNumber: 1 }),
        expect.objectContaining({ consentText: "Updated consent text.", isActive: true, versionNumber: 2 })
      ])
    );

    await server.close();
  });

  it("rejects an unchanged active consent save", async () => {
    const initialConsent: ConsentVersion = {
      id: "consent_version_001",
      studyId: "study_fixture_001",
      versionNumber: 1,
      consentText: "Original consent text.",
      consentMethod: "checkmark",
      isActive: true,
      createdAt: "2026-05-06T12:00:00.000Z"
    };
    const store = new InMemoryStudyShellStore([
      createFixtureStudy({
        activeConsentVersionId: initialConsent.id
      })
    ]);
    const consentStore = new InMemoryConsentVersionStore([initialConsent]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      consentVersionStore: consentStore,
      logger: false,
      studyShellStore: store
    });
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        consentText: " Original consent text. ",
        consentMethod: "checkmark"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: "Consent is unchanged from the active version."
    });
    expect(await consentStore.listByStudy("study_fixture_001")).toHaveLength(1);

    await server.close();
  });

  it("restores a previous consent version and removes later versions", async () => {
    const consentVersions: ConsentVersion[] = [
      {
        id: "consent_version_001",
        studyId: "study_fixture_001",
        versionNumber: 1,
        consentText: "Original consent text.",
        consentMethod: "checkmark",
        isActive: false,
        createdAt: "2026-05-06T12:00:00.000Z"
      },
      {
        id: "consent_version_002",
        studyId: "study_fixture_001",
        versionNumber: 2,
        consentText: "Middle consent text.",
        consentMethod: "electronic_signature",
        isActive: false,
        createdAt: "2026-05-06T12:05:00.000Z"
      },
      {
        id: "consent_version_003",
        studyId: "study_fixture_001",
        versionNumber: 3,
        consentText: "Current consent text.",
        consentMethod: "checkmark",
        isActive: true,
        createdAt: "2026-05-06T12:10:00.000Z"
      }
    ];
    const store = new InMemoryStudyShellStore([
      createFixtureStudy({
        activeConsentVersionId: "consent_version_003"
      })
    ]);
    const consentStore = new InMemoryConsentVersionStore(consentVersions);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      consentVersionStore: consentStore,
      logger: false,
      studyShellStore: store
    });
    const response = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/consent/restore",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        versionNumber: 1
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      consentVersion: {
        id: "consent_version_001",
        versionNumber: 1,
        consentText: "Original consent text.",
        consentMethod: "checkmark",
        isActive: true
      }
    });

    const versions = await consentStore.listByStudy("study_fixture_001");
    expect(versions).toEqual([expect.objectContaining({ id: "consent_version_001", isActive: true })]);
    expect((await store.getById("study_fixture_001"))?.activeConsentVersionId).toBe("consent_version_001");

    await server.close();
  });

  it("creates two consent versions, restores the first, and preserves its content", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const consentStore = new InMemoryConsentVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      consentVersionStore: consentStore,
      logger: false,
      studyShellStore: store
    });

    const firstResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        consentText: "First consent text with all original terms.",
        consentMethod: "checkmark"
      }
    });
    const secondResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        consentText: "Second consent text.",
        consentMethod: "electronic_signature"
      }
    });
    const restoreResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/consent/restore",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        versionNumber: 1
      }
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json()).toMatchObject({
      consentVersion: {
        id: firstResponse.json().consentVersion.id,
        versionNumber: 1,
        consentText: "First consent text with all original terms.",
        consentMethod: "checkmark",
        isActive: true
      }
    });
    expect(await consentStore.listByStudy("study_fixture_001")).toEqual([
      expect.objectContaining({
        id: firstResponse.json().consentVersion.id,
        consentText: "First consent text with all original terms.",
        isActive: true
      })
    ]);

    await server.close();
  });

  it("validates restore version input and tenant access", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const consentStore = new InMemoryConsentVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      consentVersionStore: consentStore,
      logger: false,
      studyShellStore: store
    });
    const invalidInput = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/consent/restore",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        versionNumber: "1"
      }
    });
    const missingVersion = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/consent/restore",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        versionNumber: 9
      }
    });
    const crossTenant = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/consent/restore",
      headers: {
        authorization: `Bearer ${otherTokens.accessToken}`
      },
      payload: {
        versionNumber: 1
      }
    });

    expect(invalidInput.statusCode).toBe(400);
    expect(invalidInput.json()).toEqual({
      error: "Bad Request",
      message: "Consent version number is required."
    });
    expect(missingVersion.statusCode).toBe(400);
    expect(missingVersion.json()).toEqual({
      error: "Bad Request",
      message: "Consent version was not found."
    });
    expect(crossTenant.statusCode).toBe(403);

    await server.close();
  });

  it("lists consent versions for an authorized researcher", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const consentStore = new InMemoryConsentVersionStore([
      {
        id: "consent_version_001",
        studyId: "study_fixture_001",
        versionNumber: 1,
        consentText: "Consent text.",
        consentMethod: "checkmark",
        isActive: true,
        createdAt: "2026-05-06T12:00:00.000Z"
      }
    ]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      consentVersionStore: consentStore,
      logger: false,
      studyShellStore: store
    });
    const response = await server.inject({
      method: "GET",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      activeConsentVersion: {
        id: "consent_version_001",
        versionNumber: 1
      },
      consentVersions: [
        {
          id: "consent_version_001",
          versionNumber: 1
        }
      ]
    });

    await server.close();
  });

  it("validates consent text, method, service-owned metadata, and tenant access", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false, studyShellStore: store });
    const invalidMethod = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        consentText: "Valid text.",
        consentMethod: "wet_signature"
      }
    });
    const metadataAttempt = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        consentText: "Valid text.",
        consentMethod: "checkmark",
        versionNumber: 99
      }
    });
    const crossTenant = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/consent",
      headers: {
        authorization: `Bearer ${otherTokens.accessToken}`
      },
      payload: {
        consentText: "Valid text.",
        consentMethod: "checkmark"
      }
    });

    expect(invalidMethod.statusCode).toBe(400);
    expect(invalidMethod.json()).toEqual({
      error: "Bad Request",
      message: "Consent method must be checkmark or electronic signature."
    });
    expect(metadataAttempt.statusCode).toBe(400);
    expect(metadataAttempt.json()).toEqual({
      error: "Bad Request",
      message: "Consent version metadata is assigned by the service."
    });
    expect(crossTenant.statusCode).toBe(403);

    await server.close();
  });
});

describe("researcher survey routes", () => {
  it("allows browser preflight for survey saves", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "OPTIONS",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PUT"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");

    await server.close();
  });

  it("creates grouped and ungrouped long-form survey questions", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const surveyStore = new InMemorySurveyVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      studyShellStore: store,
      surveyVersionStore: surveyStore
    });
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        questions: [{ prompt: "  What do you already know about fractions?  " }],
        groups: [
          {
            title: "Reflection",
            questions: [{ prompt: "Describe a moment when your thinking changed." }]
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      surveyVersion: {
        studyId: "study_fixture_001",
        versionNumber: 1,
        isActive: true,
        ungroupedQuestions: [
          {
            prompt: "What do you already know about fractions?",
            required: true,
            questionType: "long_text",
            sortOrder: 1
          }
        ],
        groups: [
          {
            title: "Reflection",
            sortOrder: 2,
            questions: [
              {
                prompt: "Describe a moment when your thinking changed.",
                required: true,
                questionType: "long_text",
                sortOrder: 1
              }
            ]
          }
        ]
      }
    });

    const study = await store.getById("study_fixture_001");
    expect(study?.activeSurveyVersionId).toBe(response.json().surveyVersion.id);

    await server.close();
  });

  it("preserves interleaved question, group, question survey layout", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const surveyStore = new InMemorySurveyVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      studyShellStore: store,
      surveyVersionStore: surveyStore
    });
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        items: [
          {
            type: "question",
            question: {
              prompt: "First standalone question."
            }
          },
          {
            type: "group",
            group: {
              title: "Middle group",
              questions: [
                {
                  prompt: "Grouped question."
                }
              ]
            }
          },
          {
            type: "question",
            question: {
              prompt: "Second standalone question."
            }
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      surveyVersion: {
        layoutItems: [
          {
            type: "question",
            sortOrder: 1,
            question: {
              prompt: "First standalone question.",
              sortOrder: 1
            }
          },
          {
            type: "group",
            sortOrder: 2,
            group: {
              title: "Middle group",
              sortOrder: 2,
              questions: [
                {
                  prompt: "Grouped question.",
                  sortOrder: 1
                }
              ]
            }
          },
          {
            type: "question",
            sortOrder: 3,
            question: {
              prompt: "Second standalone question.",
              sortOrder: 3
            }
          }
        ]
      }
    });

    await server.close();
  });

  it("creates a new active survey version without mutating an existing run reference", async () => {
    const initialQuestion = {
      id: "survey_question_001",
      surveyVersionId: "survey_version_001",
      prompt: "Original question.",
      required: true,
      questionType: "long_text",
      sortOrder: 1,
      createdAt: "2026-05-06T12:00:00.000Z"
    } as const;
    const initialSurvey: SurveyVersion = {
      id: "survey_version_001",
      studyId: "study_fixture_001",
      versionNumber: 1,
      isActive: true,
      layoutItems: [
        {
          type: "question",
          sortOrder: 1,
          question: initialQuestion
        }
      ],
      groups: [],
      ungroupedQuestions: [initialQuestion],
      createdAt: "2026-05-06T12:00:00.000Z"
    };
    const store = new InMemoryStudyShellStore([
      createFixtureStudy({
        activeSurveyVersionId: initialSurvey.id
      })
    ]);
    const surveyStore = new InMemorySurveyVersionStore([initialSurvey]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      studyShellStore: store,
      surveyVersionStore: surveyStore
    });
    const runSurveyVersionId = initialSurvey.id;
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        questions: [{ prompt: "Updated ungrouped question." }]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      surveyVersion: {
        studyId: "study_fixture_001",
        versionNumber: 2,
        isActive: true,
        ungroupedQuestions: [
          {
            prompt: "Updated ungrouped question."
          }
        ]
      }
    });
    expect(runSurveyVersionId).toBe("survey_version_001");

    const versions = await surveyStore.listByStudy("study_fixture_001");
    expect(versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "survey_version_001", isActive: false, versionNumber: 1 }),
        expect.objectContaining({ isActive: true, versionNumber: 2 })
      ])
    );
    expect((await store.getById("study_fixture_001"))?.activeSurveyVersionId).toBe(response.json().surveyVersion.id);

    await server.close();
  });

  it("rejects an unchanged active survey save", async () => {
    const initialQuestion = {
      id: "survey_question_001",
      surveyVersionId: "survey_version_001",
      prompt: "Original question.",
      required: true,
      questionType: "long_text",
      sortOrder: 1,
      createdAt: "2026-05-06T12:00:00.000Z"
    } as const;
    const initialSurvey: SurveyVersion = {
      id: "survey_version_001",
      studyId: "study_fixture_001",
      versionNumber: 1,
      isActive: true,
      layoutItems: [
        {
          type: "question",
          sortOrder: 1,
          question: initialQuestion
        }
      ],
      groups: [],
      ungroupedQuestions: [initialQuestion],
      createdAt: "2026-05-06T12:00:00.000Z"
    };
    const store = new InMemoryStudyShellStore([
      createFixtureStudy({
        activeSurveyVersionId: initialSurvey.id
      })
    ]);
    const surveyStore = new InMemorySurveyVersionStore([initialSurvey]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      studyShellStore: store,
      surveyVersionStore: surveyStore
    });
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        items: [
          {
            type: "question",
            question: {
              prompt: " Original question. "
            }
          }
        ]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: "Survey is unchanged from the active version."
    });
    expect(await surveyStore.listByStudy("study_fixture_001")).toHaveLength(1);

    await server.close();
  });

  it("creates two survey versions, restores the first, and preserves its layout integrity", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const surveyStore = new InMemorySurveyVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      studyShellStore: store,
      surveyVersionStore: surveyStore
    });

    const firstResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        items: [
          {
            type: "question",
            question: {
              prompt: "First standalone prompt."
            }
          },
          {
            type: "group",
            group: {
              title: "First group",
              questions: [{ prompt: "First grouped prompt." }]
            }
          }
        ]
      }
    });
    const secondResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        questions: [{ prompt: "Second version prompt." }]
      }
    });
    const restoreResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/survey/restore",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        versionNumber: 1
      }
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json()).toMatchObject({
      surveyVersion: {
        id: firstResponse.json().surveyVersion.id,
        versionNumber: 1,
        isActive: true,
        layoutItems: [
          {
            type: "question",
            sortOrder: 1,
            question: {
              prompt: "First standalone prompt."
            }
          },
          {
            type: "group",
            sortOrder: 2,
            group: {
              title: "First group",
              questions: [
                {
                  prompt: "First grouped prompt."
                }
              ]
            }
          }
        ]
      }
    });
    expect(await surveyStore.listByStudy("study_fixture_001")).toEqual([
      expect.objectContaining({
        id: firstResponse.json().surveyVersion.id,
        isActive: true,
        layoutItems: expect.arrayContaining([
          expect.objectContaining({
            type: "group",
            group: expect.objectContaining({ title: "First group" })
          })
        ])
      })
    ]);
    expect((await store.getById("study_fixture_001"))?.activeSurveyVersionId).toBe(firstResponse.json().surveyVersion.id);

    await server.close();
  });

  it("lists survey versions for an authorized researcher", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const fixtureQuestion = {
      id: "survey_question_001",
      surveyVersionId: "survey_version_001",
      prompt: "Question text.",
      required: true,
      questionType: "long_text",
      sortOrder: 1,
      createdAt: "2026-05-06T12:00:00.000Z"
    } as const;
    const surveyStore = new InMemorySurveyVersionStore([
      {
        id: "survey_version_001",
        studyId: "study_fixture_001",
        versionNumber: 1,
        isActive: true,
        layoutItems: [
          {
            type: "question",
            sortOrder: 1,
            question: fixtureQuestion
          }
        ],
        groups: [],
        ungroupedQuestions: [fixtureQuestion],
        createdAt: "2026-05-06T12:00:00.000Z"
      }
    ]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      studyShellStore: store,
      surveyVersionStore: surveyStore
    });
    const response = await server.inject({
      method: "GET",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      activeSurveyVersion: {
        id: "survey_version_001",
        versionNumber: 1,
        ungroupedQuestions: [
          {
            prompt: "Question text."
          }
        ]
      },
      surveyVersions: [
        {
          id: "survey_version_001",
          versionNumber: 1
        }
      ]
    });

    await server.close();
  });

  it("validates required questions, long-form type, service-owned metadata, and tenant access", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false, studyShellStore: store });
    const missingQuestion = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        questions: []
      }
    });
    const invalidType = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        questions: [{ prompt: "Question text.", questionType: "multiple_choice" }]
      }
    });
    const metadataAttempt = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        questions: [{ id: "survey_question_client", prompt: "Question text." }]
      }
    });
    const crossTenant = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/survey",
      headers: {
        authorization: `Bearer ${otherTokens.accessToken}`
      },
      payload: {
        questions: [{ prompt: "Question text." }]
      }
    });

    expect(missingQuestion.statusCode).toBe(400);
    expect(missingQuestion.json()).toEqual({
      error: "Bad Request",
      message: "Add at least one required long-form question."
    });
    expect(invalidType.statusCode).toBe(400);
    expect(invalidType.json()).toEqual({
      error: "Bad Request",
      message: "Survey questions must be long-form text only."
    });
    expect(metadataAttempt.statusCode).toBe(400);
    expect(metadataAttempt.json()).toEqual({
      error: "Bad Request",
      message: "Survey question metadata is assigned by the service."
    });
    expect(crossTenant.statusCode).toBe(403);

    await server.close();
  });
});

describe("researcher objective routes", () => {
  it("allows browser preflight for objective saves", async () => {
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false });
    const response = await server.inject({
      method: "OPTIONS",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PUT"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");

    await server.close();
  });

  it("creates one or more active scoring objectives with rubrics and ordering", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const objectiveStore = new InMemoryObjectiveVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore: objectiveStore,
      studyShellStore: store
    });
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            title: "  Reasoning quality  ",
            description: "Explains the reason behind a claim.",
            customScoringPrompt: "Prioritize concrete examples.",
            gradeLabels: ["1", "2", "3", "4"],
            gradeExamples: [
              {
                gradeLabel: "4",
                exampleText: "Specific claim with supporting evidence."
              }
            ],
            evidenceRequirements: "Cite survey or interview evidence."
          },
          {
            title: "Confidence",
            description: "Describes certainty and uncertainty.",
            gradeLabels: ["low", "medium", "high"],
            evidenceRequirements: "Use the participant's own words."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      objectiveVersions: [
        {
          studyId: "study_fixture_001",
          versionNumber: 1,
          title: "Reasoning quality",
          description: "Explains the reason behind a claim.",
          customScoringPrompt: "Prioritize concrete examples.",
          gradeScale: ["1", "2", "3", "4"],
          gradeExamples: [
            {
              gradeLabel: "4",
              exampleText: "Specific claim with supporting evidence.",
              sortOrder: 1
            }
          ],
          evidenceRequirements: "Cite survey or interview evidence.",
          sortOrder: 1,
          isActive: true
        },
        {
          title: "Confidence",
          gradeScale: ["low", "medium", "high"],
          sortOrder: 2,
          isActive: true
        }
      ]
    });

    const listResponse = await server.inject({
      method: "GET",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().activeObjectiveVersions).toHaveLength(2);

    await server.close();
  });

  it("rejects unchanged active scoring objective saves", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const objectiveStore = new InMemoryObjectiveVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore: objectiveStore,
      studyShellStore: store
    });
    const objectiveInput = {
      title: "Reasoning quality",
      description: "Explains the reason behind a claim.",
      customScoringPrompt: "Prioritize concrete examples.",
      gradeLabels: ["1", "2", "3", "4"],
      gradeExamples: [
        {
          gradeLabel: "4",
          exampleText: "Specific claim with supporting evidence."
        }
      ],
      evidenceRequirements: "Cite survey or interview evidence."
    };
    const createResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [objectiveInput]
      }
    });
    const activeObjective = createResponse.json().objectiveVersions[0];
    const duplicateResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            objectiveKey: activeObjective.objectiveKey,
            ...objectiveInput
          }
        ]
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(duplicateResponse.statusCode).toBe(400);
    expect(duplicateResponse.json()).toMatchObject({
      message: "Scoring objectives are unchanged from the active versions."
    });
    expect(await objectiveStore.listByStudy("study_fixture_001")).toHaveLength(1);

    await server.close();
  });

  it("creates new objective versions while preserving prior scoring references", async () => {
    const initialObjective: ObjectiveVersion = {
      id: "objective_version_001",
      studyId: "study_fixture_001",
      objectiveKey: "reasoning_quality",
      versionNumber: 1,
      title: "Reasoning Quality",
      description: "Original description.",
      gradeScale: ["1", "2", "3", "4"],
      gradeExamples: [],
      evidenceRequirements: "Original evidence requirement.",
      sortOrder: 1,
      isActive: true,
      createdAt: "2026-05-06T12:00:00.000Z"
    };
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const objectiveStore = new InMemoryObjectiveVersionStore([initialObjective]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore: objectiveStore,
      studyShellStore: store
    });
    const scoringObjectiveVersionId = initialObjective.id;
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            objectiveKey: "reasoning_quality",
            title: "Reasoning Quality",
            description: "Updated description.",
            gradeLabels: ["emerging", "developing", "strong"],
            evidenceRequirements: "Updated evidence requirement."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      objectiveVersions: [
        {
          objectiveKey: "reasoning_quality",
          versionNumber: 2,
          title: "Reasoning Quality",
          description: "Updated description.",
          gradeScale: ["emerging", "developing", "strong"],
          isActive: true
        }
      ]
    });
    expect(scoringObjectiveVersionId).toBe("objective_version_001");

    const versions = await objectiveStore.listByStudy("study_fixture_001");
    expect(versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "objective_version_001", objectiveKey: "reasoning_quality", isActive: false }),
        expect.objectContaining({ objectiveKey: "reasoning_quality", versionNumber: 2, isActive: true })
      ])
    );

    await server.close();
  });

  it("persists disabled objectives while excluding them from scoring-ready objectives", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const objectiveStore = new InMemoryObjectiveVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore: objectiveStore,
      studyShellStore: store
    });
    const createResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            title: "Reasoning Quality",
            description: "Score this objective.",
            gradeLabels: ["1", "2"],
            evidenceRequirements: "Reasoning evidence.",
            isEnabled: true
          },
          {
            title: "Evidence Quality",
            description: "Keep this rubric, but skip scoring.",
            gradeLabels: ["1", "2"],
            evidenceRequirements: "Evidence evidence.",
            isEnabled: false
          }
        ]
      }
    });
    const listResponse = await server.inject({
      method: "GET",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().objectiveVersions).toEqual([
      expect.objectContaining({ title: "Reasoning Quality", isEnabled: true }),
      expect.objectContaining({ title: "Evidence Quality", isEnabled: false })
    ]);
    expect(listResponse.json()).toMatchObject({
      activeObjectiveVersions: [
        expect.objectContaining({ title: "Reasoning Quality", isEnabled: true }),
        expect.objectContaining({ title: "Evidence Quality", isEnabled: false })
      ],
      enabledObjectiveVersions: [expect.objectContaining({ title: "Reasoning Quality", isEnabled: true })]
    });

    await server.close();
  });

  it("keeps an existing objective disabled when a second objective is created", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const objectiveStore = new InMemoryObjectiveVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore: objectiveStore,
      studyShellStore: store
    });
    const firstResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            title: "Reasoning Quality",
            description: "Keep this rubric, but skip scoring.",
            gradeLabels: ["1", "2"],
            evidenceRequirements: "Reasoning evidence.",
            isEnabled: false
          }
        ]
      }
    });
    const disabledObjective = firstResponse.json().objectiveVersions[0] as ObjectiveVersion;
    const secondResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            objectiveKey: disabledObjective.objectiveKey,
            title: "Reasoning Quality",
            description: "Keep this rubric, but skip scoring.",
            gradeLabels: ["1", "2"],
            evidenceRequirements: "Reasoning evidence.",
            isEnabled: false
          },
          {
            title: "Evidence Quality",
            description: "Score this second objective.",
            gradeLabels: ["1", "2"],
            evidenceRequirements: "Evidence evidence."
          }
        ]
      }
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect(secondResponse.json()).toMatchObject({
      objectiveVersions: [
        {
          id: disabledObjective.id,
          objectiveKey: disabledObjective.objectiveKey,
          title: "Reasoning Quality",
          isEnabled: false,
          isActive: true
        },
        {
          title: "Evidence Quality",
          isEnabled: true,
          isActive: true
        }
      ]
    });

    const listResponse = await server.inject({
      method: "GET",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(listResponse.json()).toMatchObject({
      activeObjectiveVersions: [
        expect.objectContaining({ title: "Reasoning Quality", isEnabled: false }),
        expect.objectContaining({ title: "Evidence Quality", isEnabled: true })
      ],
      enabledObjectiveVersions: [expect.objectContaining({ title: "Evidence Quality", isEnabled: true })]
    });

    await server.close();
  });

  it("creates a new version only for the changed objective", async () => {
    const firstObjective: ObjectiveVersion = {
      id: "objective_version_001",
      studyId: "study_fixture_001",
      objectiveKey: "reasoning_quality",
      versionNumber: 1,
      title: "Reasoning Quality",
      description: "Original reasoning description.",
      gradeScale: ["1", "2"],
      gradeExamples: [],
      evidenceRequirements: "Reasoning evidence.",
      sortOrder: 1,
      isActive: true,
      createdAt: "2026-05-06T12:00:00.000Z"
    };
    const secondObjective: ObjectiveVersion = {
      id: "objective_version_002",
      studyId: "study_fixture_001",
      objectiveKey: "evidence_quality",
      versionNumber: 1,
      title: "Evidence Quality",
      description: "Original evidence description.",
      gradeScale: ["1", "2"],
      gradeExamples: [],
      evidenceRequirements: "Evidence evidence.",
      sortOrder: 2,
      isActive: true,
      createdAt: "2026-05-06T12:01:00.000Z"
    };
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const objectiveStore = new InMemoryObjectiveVersionStore([firstObjective, secondObjective]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore: objectiveStore,
      studyShellStore: store
    });
    const response = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            objectiveKey: "reasoning_quality",
            title: "Reasoning Quality",
            description: "Original reasoning description.",
            gradeLabels: ["1", "2"],
            evidenceRequirements: "Reasoning evidence."
          },
          {
            objectiveKey: "evidence_quality",
            title: "Evidence Quality",
            description: "Updated evidence description.",
            gradeLabels: ["1", "2"],
            evidenceRequirements: "Evidence evidence."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().objectiveVersions).toEqual([
      expect.objectContaining({ id: "objective_version_001", objectiveKey: "reasoning_quality", versionNumber: 1 }),
      expect.objectContaining({ objectiveKey: "evidence_quality", versionNumber: 2 })
    ]);

    const versions = await objectiveStore.listByStudy("study_fixture_001");
    expect(versions.filter((version) => version.objectiveKey === "reasoning_quality")).toEqual([
      expect.objectContaining({ id: "objective_version_001", versionNumber: 1, isActive: true })
    ]);
    expect(versions.filter((version) => version.objectiveKey === "evidence_quality")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "objective_version_002", versionNumber: 1, isActive: false }),
        expect.objectContaining({ objectiveKey: "evidence_quality", versionNumber: 2, isActive: true })
      ])
    );

    await server.close();
  });

  it("creates two objective versions, restores the first, and preserves its rubric integrity", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const objectiveStore = new InMemoryObjectiveVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore: objectiveStore,
      studyShellStore: store
    });

    const firstResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            title: "Reasoning Quality",
            description: "Original description.",
            customScoringPrompt: "Original scoring prompt.",
            gradeLabels: ["emerging", "secure"],
            gradeExamples: [{ gradeLabel: "secure", exampleText: "Original strong example." }],
            evidenceRequirements: "Original evidence requirement."
          }
        ]
      }
    });
    const objectiveKey = firstResponse.json().objectiveVersions[0].objectiveKey;
    const secondResponse = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            objectiveKey,
            title: "Reasoning Quality",
            description: "Updated description.",
            gradeLabels: ["1", "2", "3"],
            evidenceRequirements: "Updated evidence requirement."
          }
        ]
      }
    });
    const restoreResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/objectives/restore",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectiveKey,
        versionNumber: 1
      }
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json()).toMatchObject({
      objectiveVersion: {
        id: firstResponse.json().objectiveVersions[0].id,
        objectiveKey,
        versionNumber: 1,
        description: "Original description.",
        customScoringPrompt: "Original scoring prompt.",
        gradeScale: ["emerging", "secure"],
        gradeExamples: [
          {
            gradeLabel: "secure",
            exampleText: "Original strong example."
          }
        ],
        evidenceRequirements: "Original evidence requirement.",
        isActive: true
      }
    });

    const versions = await objectiveStore.listByStudy("study_fixture_001");
    expect(versions.filter((version) => version.objectiveKey === objectiveKey)).toEqual([
      expect.objectContaining({
        id: firstResponse.json().objectiveVersions[0].id,
        gradeScale: ["emerging", "secure"],
        evidenceRequirements: "Original evidence requirement.",
        isActive: true
      })
    ]);

    await server.close();
  });

  it("restores only the selected objective version and preserves other objective histories", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const objectiveStore = new InMemoryObjectiveVersionStore([
      {
        id: "objective_version_001",
        studyId: "study_fixture_001",
        objectiveKey: "reasoning_quality",
        versionNumber: 1,
        title: "Reasoning Quality",
        description: "Reasoning v1.",
        gradeScale: ["1", "2"],
        gradeExamples: [],
        evidenceRequirements: "Reasoning evidence.",
        sortOrder: 1,
        isActive: false,
        createdAt: "2026-05-06T12:00:00.000Z"
      },
      {
        id: "objective_version_002",
        studyId: "study_fixture_001",
        objectiveKey: "reasoning_quality",
        versionNumber: 2,
        title: "Reasoning Quality",
        description: "Reasoning v2.",
        gradeScale: ["1", "2"],
        gradeExamples: [],
        evidenceRequirements: "Reasoning evidence.",
        sortOrder: 1,
        isActive: true,
        createdAt: "2026-05-06T12:01:00.000Z"
      },
      {
        id: "objective_version_003",
        studyId: "study_fixture_001",
        objectiveKey: "evidence_quality",
        versionNumber: 1,
        title: "Evidence Quality",
        description: "Evidence v1.",
        gradeScale: ["1", "2"],
        gradeExamples: [],
        evidenceRequirements: "Evidence evidence.",
        sortOrder: 2,
        isActive: false,
        createdAt: "2026-05-06T12:02:00.000Z"
      },
      {
        id: "objective_version_004",
        studyId: "study_fixture_001",
        objectiveKey: "evidence_quality",
        versionNumber: 2,
        title: "Evidence Quality",
        description: "Evidence v2.",
        gradeScale: ["1", "2"],
        gradeExamples: [],
        evidenceRequirements: "Evidence evidence.",
        sortOrder: 2,
        isActive: true,
        createdAt: "2026-05-06T12:03:00.000Z"
      }
    ]);
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      objectiveVersionStore: objectiveStore,
      studyShellStore: store
    });
    const restoreResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies/study_fixture_001/objectives/restore",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectiveKey: "evidence_quality",
        versionNumber: 1
      }
    });

    expect(restoreResponse.statusCode).toBe(200);

    const versions = await objectiveStore.listByStudy("study_fixture_001");
    expect(versions.filter((version) => version.objectiveKey === "reasoning_quality")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "objective_version_001", versionNumber: 1, isActive: false }),
        expect.objectContaining({ id: "objective_version_002", versionNumber: 2, isActive: true })
      ])
    );
    expect(versions.filter((version) => version.objectiveKey === "evidence_quality")).toEqual([
      expect.objectContaining({ id: "objective_version_003", versionNumber: 1, isActive: true })
    ]);

    await server.close();
  });

  it("validates objective rubrics, service-owned metadata, and tenant access", async () => {
    const store = new InMemoryStudyShellStore([createFixtureStudy()]);
    const server = buildServer({ authProvider: createFakeAuthProvider(), logger: false, studyShellStore: store });
    const missingObjective = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: []
      }
    });
    const invalidExample = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            title: "Reasoning",
            description: "Valid description.",
            gradeLabels: ["1", "2"],
            gradeExamples: [{ gradeLabel: "3", exampleText: "Not in the scale." }],
            evidenceRequirements: "Valid requirement."
          }
        ]
      }
    });
    const metadataAttempt = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            id: "objective_version_client",
            title: "Reasoning",
            description: "Valid description.",
            gradeLabels: ["1", "2"],
            evidenceRequirements: "Valid requirement."
          }
        ]
      }
    });
    const crossTenant = await server.inject({
      method: "PUT",
      url: "/researcher/studies/study_fixture_001/objectives",
      headers: {
        authorization: `Bearer ${otherTokens.accessToken}`
      },
      payload: {
        objectives: [
          {
            title: "Reasoning",
            description: "Valid description.",
            gradeLabels: ["1", "2"],
            evidenceRequirements: "Valid requirement."
          }
        ]
      }
    });

    expect(missingObjective.statusCode).toBe(400);
    expect(missingObjective.json()).toEqual({
      error: "Bad Request",
      message: "Add at least one scoring objective."
    });
    expect(invalidExample.statusCode).toBe(400);
    expect(invalidExample.json()).toEqual({
      error: "Bad Request",
      message: "Objective 1 grade examples must use configured labels."
    });
    expect(metadataAttempt.statusCode).toBe(400);
    expect(metadataAttempt.json()).toEqual({
      error: "Bad Request",
      message: "Objective version metadata is assigned by the service."
    });
    expect(crossTenant.statusCode).toBe(403);

    await server.close();
  });
});

describe("participant interview routes", () => {
  it("exposes the interview session lifecycle through participant access tokens", async () => {
    const rawToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_interview",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "survey_completed" })]);
    let sessionSequence = 0;
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_interview",
          tokenHash: hashParticipantAccessTokenForTest(rawToken)
        })
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        createInterviewSessionId: () => `interview_session_route_00${++sessionSequence}`,
        now: () => new Date("2026-05-06T12:30:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore
    });

    const started = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/start`
    });
    const paused = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/pause`
    });
    const resumed = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/resume`
    });
    const completed = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/complete`
    });

    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({
      interviewSession: {
        id: "interview_session_route_001",
        sessionNumber: 1,
        status: "active"
      },
      run: {
        status: "interview_in_progress"
      }
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toMatchObject({
      interviewSession: {
        id: "interview_session_route_001",
        status: "paused",
        endedAt: "2026-05-06T12:30:00.000Z"
      },
      run: {
        status: "interview_paused"
      }
    });
    expect(resumed.statusCode).toBe(201);
    expect(resumed.json()).toMatchObject({
      interviewSession: {
        id: "interview_session_route_002",
        sessionNumber: 2,
        status: "active"
      },
      run: {
        status: "interview_in_progress"
      }
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      interviewSession: {
        id: "interview_session_route_002",
        status: "completed"
      },
      run: {
        status: "interview_completed"
      }
    });
    expect(await runStore.listInterviewSessionsByRun("run_fixture_001")).toEqual([
      expect.objectContaining({ id: "interview_session_route_002", status: "completed" }),
      expect.objectContaining({ id: "interview_session_route_001", status: "paused" })
    ]);

    await server.close();
  });

  it("creates realtime voice sessions with prompt context and records safe connection telemetry", async () => {
    const rawToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_realtime",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const run = createFixtureRun({ status: "survey_completed" });
    const runStore = new InMemoryRunStore([run]);
    const surveyVersion = createFixtureSurveyVersion();
    const objectiveVersion = createFixtureObjectiveVersion();
    const operationalEventStore = new InMemoryOperationalEventStore();
    const capturedInstructions: string[] = [];
    const realtimeVoiceProvider: RealtimeVoiceProvider = {
      async createSession(request) {
        capturedInstructions.push(request.instructions);

        return {
          provider: "fake",
          model: "fake-realtime",
          voice: "fake-voice",
          clientSecret: "client-secret",
          realtimeUrl: "https://api.openai.com/v1/realtime/calls",
          serviceRequestId: "req_realtime_fixture_001",
          promptVersion: request.promptVersion
        };
      }
    };

    await runStore.submitSurvey(
      [
        {
          id: "survey_response_001",
          studyId: run.studyId,
          participantSlotId: run.participantSlotId,
          runId: run.id,
          surveyVersionId: run.surveyVersionId,
          surveyQuestionId: "survey_question_001",
          responseText: "I noticed that the worked example changed how I justified the answer.",
          submittedAt: "2026-05-06T12:10:00.000Z",
          createdAt: "2026-05-06T12:10:00.000Z"
        }
      ],
      run,
      "survey_completed"
    );
    await runStore.saveGapMap({
      id: "gap_map_realtime_001",
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      surveyVersionId: run.surveyVersionId,
      objectiveVersionIds: run.objectiveVersionIds,
      status: "generated",
      modelName: "fake-gap-map",
      modelVersion: "local-1",
      serviceRequestId: "req_gap_map_realtime_001",
      promptVersion: "gap-map-v1",
      alreadyAnswered: ["The survey gives initial evidence."],
      ambiguities: ["The causal explanation needs clarification."],
      contradictions: [],
      missingEvidence: ["Need a concrete example for reasoning quality."],
      recommendedProbes: ["Could you share a concrete example?"],
      generatedAt: "2026-05-06T12:11:00.000Z",
      createdAt: "2026-05-06T12:11:00.000Z"
    });

    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_realtime",
          tokenHash: hashParticipantAccessTokenForTest(rawToken)
        })
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      objectiveVersionStore: new InMemoryObjectiveVersionStore([objectiveVersion]),
      operationalEventStore,
      operationalEventServiceOptions: {
        createOperationalEventId: () => `operational_event_${Date.now()}`
      },
      realtimeVoiceProvider,
      runServiceOptions: {
        createInterviewSessionId: () => "interview_session_route_realtime_001",
        now: () => new Date("2026-05-06T12:30:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore,
      surveyVersionStore: new InMemorySurveyVersionStore([surveyVersion])
    });

    const started = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/start`
    });
    const realtimeSession = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/realtime-session`
    });
    const connectionState = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/connection-state`,
      payload: {
        serviceRequestId: "req_realtime_fixture_001",
        audioConnectionState: "connected"
      }
    });

    expect(started.statusCode).toBe(201);
    expect(realtimeSession.statusCode).toBe(201);
    expect(realtimeSession.json()).toMatchObject({
      realtimeSession: {
        provider: "fake",
        model: "fake-realtime",
        clientSecret: "client-secret",
        serviceRequestId: "req_realtime_fixture_001",
        promptVersion: "realtime-interview-v1"
      },
      interviewSession: {
        id: "interview_session_route_realtime_001"
      }
    });
    expect(capturedInstructions[0]).toContain("I noticed that the worked example changed");
    expect(capturedInstructions[0]).toContain("Reasoning Quality");
    expect(capturedInstructions[0]).toContain("Could you share a concrete example?");
    expect(capturedInstructions[0]).toContain("Remaining interview time: 2700 seconds");
    expect(capturedInstructions[0]).toContain("Run state: interview_in_progress");
    expect(capturedInstructions[0]).toContain("Do not reveal scoring objectives");
    expect(connectionState.statusCode).toBe(204);
    expect(await operationalEventStore.listByRun("run_fixture_001")).toEqual([
      expect.objectContaining({
        eventType: "realtime_session_created",
        audioConnectionState: "session_requested",
        provider: "fake"
      }),
      expect.objectContaining({
        eventType: "audio_connection_state_changed",
        audioConnectionState: "connected"
      })
    ]);

    await server.close();
  });

  it("persists participant interview transcript turns and audio metadata through the service route", async () => {
    const rawToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_artifacts",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "survey_completed" })]);
    let turnSequence = 0;
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_artifacts",
          tokenHash: hashParticipantAccessTokenForTest(rawToken)
        })
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        createInterviewAudioAssetId: () => "interview_audio_asset_route_001",
        createInterviewSessionId: () => "interview_session_route_artifacts_001",
        createInterviewTurnId: () => `interview_turn_route_00${++turnSequence}`,
        now: () => new Date("2026-05-06T12:30:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore
    });

    const started = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/start`
    });
    const rejectedMetadata = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/artifacts`,
      payload: {
        turns: [
          {
            id: "client_supplied_id",
            speaker: "participant",
            text: "Client metadata should be rejected."
          }
        ]
      }
    });
    const savedArtifacts = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/artifacts`,
      payload: {
        turns: [
          {
            speaker: "ai",
            text: "What made that comparison stand out?",
            audioStartMs: 0,
            audioEndMs: 2100
          },
          {
            speaker: "participant",
            text: "It helped me explain why the second strategy worked.",
            audioStartMs: 2200,
            audioEndMs: 7400
          }
        ],
        audioAsset: {
          storageUri: "s3://education-researcher-local/study_fixture_001/run_fixture_001/audio/session.wav",
          durationSeconds: 7.4
        },
        transcriptTokenCount: 18
      }
    });

    expect(started.statusCode).toBe(201);
    expect(rejectedMetadata.statusCode).toBe(400);
    expect(rejectedMetadata.json()).toEqual({
      error: "Bad Request",
      message: "Interview artifact metadata is assigned by the service."
    });
    expect(savedArtifacts.statusCode).toBe(201);
    expect(savedArtifacts.json()).toMatchObject({
      interviewSession: {
        id: "interview_session_route_artifacts_001",
        audioDurationSeconds: 7.4,
        transcriptTokenCount: 18
      },
      turns: [
        {
          id: "interview_turn_route_001",
          speaker: "ai",
          text: "What made that comparison stand out?"
        },
        {
          id: "interview_turn_route_002",
          speaker: "participant",
          text: "It helped me explain why the second strategy worked."
        }
      ],
      audioAsset: {
        id: "interview_audio_asset_route_001",
        storageUri: "s3://education-researcher-local/study_fixture_001/run_fixture_001/audio/session.wav",
        durationSeconds: 7.4,
        status: "available"
      }
    });
    expect(await runStore.listInterviewTurnsByRun("run_fixture_001")).toHaveLength(2);
    expect(await runStore.listInterviewAudioAssetsByRun("run_fixture_001")).toHaveLength(1);

    await server.close();
  });

  it("accepts only participant-safe interruption status values", async () => {
    const rawToken = createParticipantAccessTokenForTest({
      tokenId: "token_fixture_interruption",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      secret: "test-participant-secret"
    });
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      participantAccessTokenStore: new InMemoryParticipantAccessTokenStore([
        createFixtureParticipantAccessToken({
          tokenId: "token_fixture_interruption",
          tokenHash: hashParticipantAccessTokenForTest(rawToken)
        })
      ]),
      participantSlotStore: new InMemoryParticipantSlotStore([
        {
          id: "slot_fixture_001",
          studyId: "study_fixture_001",
          participantCode: "P001",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      runServiceOptions: {
        createInterviewSessionId: () => "interview_session_route_interrupted_001",
        now: () => new Date("2026-05-06T12:30:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      },
      runStore: new InMemoryRunStore([createFixtureRun({ status: "interview_in_progress" })])
    });

    const unsafeStatus = await server.inject({
      method: "POST",
      url: `/participant/runs/${rawToken}/interview/interrupt`,
      payload: {
        safeStatus: "openai_realtime_error",
        status: "interrupted"
      }
    });

    expect(unsafeStatus.statusCode).toBe(400);
    expect(unsafeStatus.json()).toEqual({
      error: "Bad Request",
      message: "Interview session metadata is assigned by the service."
    });

    await server.close();
  });
});

describe("researcher create survey end-to-end workflows", () => {
  it("saves a complete created survey with consent, interleaved grouped questions, and a full grading system", async () => {
    const studyStore = new InMemoryStudyShellStore();
    const consentStore = new InMemoryConsentVersionStore();
    const surveyStore = new InMemorySurveyVersionStore();
    const objectiveStore = new InMemoryObjectiveVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      studyShellStore: studyStore,
      consentVersionStore: consentStore,
      surveyVersionStore: surveyStore,
      objectiveVersionStore: objectiveStore
    });
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };
    const longConsentText = [
      "Consent & Assent: participants may stop at any time.",
      "We will preserve punctuation and symbols: !@#$%^&*()_+-=[]{}|;':\",./<>?`~.",
      "Special text stays intact: café, naïve, 中文, emoji-like marker 🙂, math ≤ ≥ ≠, and quotes “yes”.",
      "Repeated disclosure: ".repeat(40),
      "End of consent."
    ].join("\n");

    const studyResponse = await server.inject({
      method: "POST",
      url: "/researcher/studies",
      headers,
      payload: {
        title: "  Mixed Methods Reflection Survey  ",
        defaultFreshnessDays: 30,
        defaultMaxInterviewMinutes: 60
      }
    });
    expect(studyResponse.statusCode).toBe(201);
    const studyId = studyResponse.json().study.id as string;

    const consentResponse = await server.inject({
      method: "PUT",
      url: `/researcher/studies/${studyId}/consent`,
      headers,
      payload: {
        consentText: longConsentText,
        consentMethod: "electronic_signature"
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
            type: "question",
            question: {
              prompt: "What did you notice first?"
            }
          },
          {
            type: "group",
            group: {
              title: "Evidence and reasoning",
              questions: [
                {
                  prompt: "What evidence supports your answer?"
                },
                {
                  prompt: "What is another possible explanation?"
                }
              ]
            }
          },
          {
            type: "question",
            question: {
              prompt: "What would you want to investigate next?"
            }
          },
          {
            type: "group",
            group: {
              title: "Confidence check",
              questions: [
                {
                  prompt: "How confident are you in your response?"
                }
              ]
            }
          }
        ]
      }
    });
    expect(surveyResponse.statusCode).toBe(201);

    const objectivesResponse = await server.inject({
      method: "PUT",
      url: `/researcher/studies/${studyId}/objectives`,
      headers,
      payload: {
        objectives: [
          {
            title: "Reasoning quality",
            description: "Scores whether the learner explains claims with relevant evidence.",
            customScoringPrompt: "Reward specific references to the learner's survey responses.",
            gradeLabels: ["1", "2", "3", "4"],
            gradeExamples: [
              {
                gradeLabel: "1",
                exampleText: "Makes a claim without evidence."
              },
              {
                gradeLabel: "4",
                exampleText: "Connects a precise claim to multiple pieces of evidence."
              }
            ],
            evidenceRequirements: "Use survey answers and follow-up interview evidence."
          },
          {
            title: "Reflection depth",
            description: "Scores whether the learner identifies uncertainty and next steps.",
            gradeLabels: ["emerging", "developing", "proficient", "advanced"],
            gradeExamples: [
              {
                gradeLabel: "advanced",
                exampleText: "Names uncertainty, why it matters, and a concrete next investigation."
              }
            ],
            evidenceRequirements: "Cite the confidence check and investigation prompt."
          }
        ]
      }
    });
    expect(objectivesResponse.statusCode).toBe(201);

    const savedStudyResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}`,
      headers
    });
    const savedConsentResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/consent`,
      headers
    });
    const savedSurveyResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/survey`,
      headers
    });
    const savedObjectivesResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/objectives`,
      headers
    });

    expect(savedStudyResponse.statusCode).toBe(200);
    expect(savedConsentResponse.statusCode).toBe(200);
    expect(savedSurveyResponse.statusCode).toBe(200);
    expect(savedObjectivesResponse.statusCode).toBe(200);
    expect(savedStudyResponse.json()).toMatchObject({
      study: {
        id: studyId,
        title: "Mixed Methods Reflection Survey",
        defaultFreshnessDays: 30,
        defaultMaxInterviewMinutes: 60,
        activeConsentVersionId: consentResponse.json().consentVersion.id,
        activeSurveyVersionId: surveyResponse.json().surveyVersion.id
      }
    });
    expect(savedConsentResponse.json()).toMatchObject({
      activeConsentVersion: {
        consentText: longConsentText,
        consentMethod: "electronic_signature",
        isActive: true,
        versionNumber: 1
      },
      consentVersions: [
        {
          consentText: longConsentText,
          consentMethod: "electronic_signature",
          isActive: true,
          versionNumber: 1
        }
      ]
    });
    expect(savedSurveyResponse.json()).toMatchObject({
      activeSurveyVersion: {
        layoutItems: [
          {
            type: "question",
            sortOrder: 1,
            question: {
              prompt: "What did you notice first?",
              questionType: "long_text",
              required: true,
              sortOrder: 1
            }
          },
          {
            type: "group",
            sortOrder: 2,
            group: {
              title: "Evidence and reasoning",
              sortOrder: 2,
              questions: [
                {
                  prompt: "What evidence supports your answer?",
                  questionType: "long_text",
                  required: true,
                  sortOrder: 1
                },
                {
                  prompt: "What is another possible explanation?",
                  questionType: "long_text",
                  required: true,
                  sortOrder: 2
                }
              ]
            }
          },
          {
            type: "question",
            sortOrder: 3,
            question: {
              prompt: "What would you want to investigate next?",
              questionType: "long_text",
              required: true,
              sortOrder: 3
            }
          },
          {
            type: "group",
            sortOrder: 4,
            group: {
              title: "Confidence check",
              sortOrder: 4,
              questions: [
                {
                  prompt: "How confident are you in your response?",
                  questionType: "long_text",
                  required: true,
                  sortOrder: 1
                }
              ]
            }
          }
        ],
        ungroupedQuestions: [
          {
            prompt: "What did you notice first?",
            sortOrder: 1
          },
          {
            prompt: "What would you want to investigate next?",
            sortOrder: 3
          }
        ],
        groups: [
          {
            title: "Evidence and reasoning",
            sortOrder: 2
          },
          {
            title: "Confidence check",
            sortOrder: 4
          }
        ]
      }
    });
    expect(savedObjectivesResponse.json()).toMatchObject({
      activeObjectiveVersions: [
        {
          title: "Reasoning quality",
          description: "Scores whether the learner explains claims with relevant evidence.",
          customScoringPrompt: "Reward specific references to the learner's survey responses.",
          gradeScale: ["1", "2", "3", "4"],
          gradeExamples: [
            {
              gradeLabel: "1",
              exampleText: "Makes a claim without evidence.",
              sortOrder: 1
            },
            {
              gradeLabel: "4",
              exampleText: "Connects a precise claim to multiple pieces of evidence.",
              sortOrder: 2
            }
          ],
          evidenceRequirements: "Use survey answers and follow-up interview evidence.",
          sortOrder: 1,
          isActive: true
        },
        {
          title: "Reflection depth",
          description: "Scores whether the learner identifies uncertainty and next steps.",
          gradeScale: ["emerging", "developing", "proficient", "advanced"],
          gradeExamples: [
            {
              gradeLabel: "advanced",
              exampleText: "Names uncertainty, why it matters, and a concrete next investigation.",
              sortOrder: 1
            }
          ],
          evidenceRequirements: "Cite the confidence check and investigation prompt.",
          sortOrder: 2,
          isActive: true
        }
      ]
    });

    expect(await consentStore.listByStudy(studyId)).toHaveLength(1);
    expect(await surveyStore.listByStudy(studyId)).toHaveLength(1);
    expect(await objectiveStore.listByStudy(studyId)).toHaveLength(2);

    await server.close();
  });

  it("saves a created survey shell that is just a title", async () => {
    const studyStore = new InMemoryStudyShellStore();
    const consentStore = new InMemoryConsentVersionStore();
    const surveyStore = new InMemorySurveyVersionStore();
    const objectiveStore = new InMemoryObjectiveVersionStore();
    const server = buildServer({
      authProvider: createFakeAuthProvider(),
      logger: false,
      studyShellStore: studyStore,
      consentVersionStore: consentStore,
      surveyVersionStore: surveyStore,
      objectiveVersionStore: objectiveStore
    });
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };
    const response = await server.inject({
      method: "POST",
      url: "/researcher/studies",
      headers,
      payload: {
        title: "  Title Only Survey  "
      }
    });

    expect(response.statusCode).toBe(201);
    const studyId = response.json().study.id as string;
    const savedStudyResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}`,
      headers
    });
    const savedConsentResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/consent`,
      headers
    });
    const savedSurveyResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/survey`,
      headers
    });
    const savedObjectivesResponse = await server.inject({
      method: "GET",
      url: `/researcher/studies/${studyId}/objectives`,
      headers
    });

    expect(savedStudyResponse.statusCode).toBe(200);
    expect(savedConsentResponse.statusCode).toBe(200);
    expect(savedSurveyResponse.statusCode).toBe(200);
    expect(savedObjectivesResponse.statusCode).toBe(200);
    const savedTitleOnlyStudy = savedStudyResponse.json().study;

    expect(savedTitleOnlyStudy).toMatchObject({
      id: studyId,
      ownerUserId: researcher.id,
      title: "Title Only Survey",
      defaultFreshnessDays: 14,
      defaultMaxInterviewMinutes: 45,
      activePersonaVersionId: "persona_version_v1_default_001",
      status: "active"
    });
    expect(savedTitleOnlyStudy.activeConsentVersionId).toBeUndefined();
    expect(savedTitleOnlyStudy.activeSurveyVersionId).toBeUndefined();
    expect(savedConsentResponse.json()).toEqual({
      activeConsentVersion: undefined,
      consentVersions: []
    });
    expect(savedSurveyResponse.json()).toEqual({
      activeSurveyVersion: undefined,
      surveyVersions: []
    });
    expect(savedObjectivesResponse.json()).toEqual({
      activeObjectiveVersions: [],
      enabledObjectiveVersions: [],
      objectiveVersions: []
    });
    const titleOnlyStoredStudies = await studyStore.listByOwner(researcher.id);
    expect(titleOnlyStoredStudies).toEqual([
      expect.objectContaining({
        id: studyId,
        title: "Title Only Survey"
      })
    ]);
    expect(titleOnlyStoredStudies[0]?.activeConsentVersionId).toBeUndefined();
    expect(titleOnlyStoredStudies[0]?.activeSurveyVersionId).toBeUndefined();
    expect(await consentStore.listByStudy(studyId)).toHaveLength(0);
    expect(await surveyStore.listByStudy(studyId)).toHaveLength(0);
    expect(await objectiveStore.listByStudy(studyId)).toHaveLength(0);

    await server.close();
  });
});
