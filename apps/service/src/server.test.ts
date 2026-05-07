import { describe, expect, it } from "vitest";
import type { AuthProvider, AuthTokens, SessionUser } from "./auth.js";
import { InMemoryConsentVersionStore, type ConsentVersion } from "./consent.js";
import { InMemoryObjectiveVersionStore, type ObjectiveVersion } from "./objectives.js";
import { buildServer } from "./server.js";
import { InMemoryStudyShellStore, type StudyShell } from "./study-shell.js";
import { InMemorySurveyVersionStore, type SurveyVersion } from "./survey.js";

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
      stylePrompt: "Ask calm, neutral, one-at-a-time follow-up questions.",
      locked: true
    },
    status: "active",
    createdAt,
    updatedAt: createdAt,
    ...overrides
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
          locked: true
        },
        status: "active"
      }
    });

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
