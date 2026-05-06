import { describe, expect, it } from "vitest";
import type { AuthProvider, AuthTokens, SessionUser } from "./auth.js";
import { buildServer } from "./server.js";
import { InMemoryStudyShellStore, type StudyShell } from "./study-shell.js";

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
