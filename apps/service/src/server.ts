import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import {
  AuthenticationError,
  createConfiguredAuthProvider,
  type AuthProvider,
  type SessionUser
} from "./auth.js";
import {
  StudyAuthorizationService,
  toSafeAuthorizationResponse
} from "./authorization.js";
import {
  StudyShellAuthorizationStore,
  StudyShellService,
  createConfiguredStudyShellStore,
  type CreateStudyShellInput,
  type StudyShellStore,
  type UpdateStudyShellInput,
  toSafeStudyShellValidationResponse
} from "./study-shell.js";

interface BuildServerOptions extends FastifyServerOptions {
  readonly authProvider?: AuthProvider;
  readonly corsOrigin?: string | string[];
  readonly studyShellStore?: StudyShellStore;
}

interface SignInBody {
  readonly email?: unknown;
  readonly password?: unknown;
}

interface StudyParams {
  readonly studyId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

function getBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length).trim();
}

function parseCredentials(body: SignInBody) {
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    throw new AuthenticationError("Email and password are required.");
  }

  const email = body.email.trim().toLowerCase();

  if (!email || !body.password) {
    throw new AuthenticationError("Email and password are required.");
  }

  return {
    email,
    password: body.password
  };
}

function parseStudyShellInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Study settings are required.");
  }

  const record = body as Record<string, unknown>;

  if (
    "activePersonaVersionId" in record ||
    "persona" in record ||
    "personaName" in record ||
    "personaStylePrompt" in record
  ) {
    throw new Error("Interviewer persona is locked to the V1 default and cannot be customized.");
  }

  return {
    ...("title" in record ? { title: record.title } : {}),
    ...("defaultFreshnessDays" in record ? { defaultFreshnessDays: record.defaultFreshnessDays } : {}),
    ...("defaultMaxInterviewMinutes" in record
      ? { defaultMaxInterviewMinutes: record.defaultMaxInterviewMinutes }
      : {})
  };
}

function coerceCreateStudyShellInput(body: unknown): CreateStudyShellInput {
  try {
    const input = parseStudyShellInput(body);

    if (typeof input.title !== "string") {
      throw new Error("Study title is required.");
    }

    return {
      title: input.title,
      defaultFreshnessDays: coerceOptionalInteger(input.defaultFreshnessDays, "freshness days"),
      defaultMaxInterviewMinutes: coerceOptionalInteger(input.defaultMaxInterviewMinutes, "max interview minutes")
    };
  } catch (error) {
    throw toStudyBodyError(error);
  }
}

function coerceUpdateStudyShellInput(body: unknown): UpdateStudyShellInput {
  try {
    const input = parseStudyShellInput(body);

    if ("title" in input && typeof input.title !== "string") {
      throw new Error("Study title must be text.");
    }

    return {
      ...(typeof input.title === "string" ? { title: input.title } : {}),
      defaultFreshnessDays: coerceOptionalInteger(input.defaultFreshnessDays, "freshness days"),
      defaultMaxInterviewMinutes: coerceOptionalInteger(input.defaultMaxInterviewMinutes, "max interview minutes")
    };
  } catch (error) {
    throw toStudyBodyError(error);
  }
}

function coerceOptionalInteger(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number") {
    throw new Error(`${label} must be a whole number.`);
  }

  return value;
}

function toStudyBodyError(error: unknown) {
  const message = error instanceof Error ? error.message : "Study settings are invalid.";
  return {
    statusCode: 400,
    body: {
      error: "Bad Request",
      message
    }
  };
}

export function buildServer(options: BuildServerOptions = {}) {
  const { authProvider, corsOrigin = true, studyShellStore = createConfiguredStudyShellStore(), ...fastifyOptions } = options;
  let resolvedAuthProvider = authProvider;
  const studyShellService = new StudyShellService(studyShellStore);
  const studyAuthorization = new StudyAuthorizationService(new StudyShellAuthorizationStore(studyShellStore));
  const server = Fastify({
    logger: true,
    ...fastifyOptions
  });

  void server.register(cors, {
    origin: corsOrigin
  });

  const getAuthProvider = () => {
    resolvedAuthProvider ??= createConfiguredAuthProvider();
    return resolvedAuthProvider;
  };

  const requireResearcher = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = getBearerToken(request);

    if (!token) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Researcher sign-in is required."
      });
    }

    try {
      request.user = await getAuthProvider().verifyAccessToken(token);
    } catch {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Researcher sign-in is required."
      });
    }
  };

  server.get("/health", async () => ({
    service: "education-researcher-service",
    status: "ok"
  }));

  server.post<{ Body: SignInBody }>("/auth/sign-in", async (request, reply) => {
    try {
      const credentials = parseCredentials(request.body);
      const tokens = await getAuthProvider().signIn(credentials.email, credentials.password);

      return {
        tokens
      };
    } catch {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Email or password is incorrect."
      });
    }
  });

  server.post("/auth/sign-out", { preHandler: requireResearcher }, async (request, reply) => {
    const token = getBearerToken(request);

    if (token) {
      await getAuthProvider().signOut(token);
    }

    return reply.code(204).send();
  });

  server.get("/researcher/session", { preHandler: requireResearcher }, async (request) => ({
    user: request.user
  }));

  server.get("/researcher/dashboard", { preHandler: requireResearcher }, async (request) => ({
    researcher: request.user,
    message: "Researcher workspace is ready for authenticated study setup."
  }));

  server.get("/researcher/studies", { preHandler: requireResearcher }, async (request) => ({
    studies: await studyShellService.listForResearcher(request.user!)
  }));

  server.post("/researcher/studies", { preHandler: requireResearcher }, async (request, reply) => {
    try {
      const study = await studyShellService.createStudyShell(request.user!, coerceCreateStudyShellInput(request.body));

      return reply.code(201).send({
        study
      });
    } catch (error) {
      const safeValidation = toSafeStudyShellValidationResponse(error) ?? toSafeInlineErrorResponse(error);

      if (safeValidation) {
        return reply.code(safeValidation.statusCode).send(safeValidation.body);
      }

      throw error;
    }
  });

  server.get<{ Params: StudyParams }>(
    "/researcher/studies/:studyId",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read");
        const study = await studyShellStore.getById(request.params.studyId);

        return {
          study
        };
      } catch (error) {
        const safeAuthorization = toSafeAuthorizationResponse(error);

        if (safeAuthorization) {
          return reply.code(safeAuthorization.statusCode).send(safeAuthorization.body);
        }

        throw error;
      }
    }
  );

  server.patch<{ Params: StudyParams }>(
    "/researcher/studies/:studyId",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const study = await studyShellStore.getById(request.params.studyId);

        if (!study) {
          const safeAuthorization = toSafeAuthorizationResponse(new Error());
          return reply.code(safeAuthorization?.statusCode ?? 403).send(
            safeAuthorization?.body ?? {
              error: "Forbidden",
              message: "You are not authorized to access this study resource."
            }
          );
        }

        const updatedStudy = await studyShellService.updateStudyShell(study, coerceUpdateStudyShellInput(request.body));

        return {
          study: updatedStudy
        };
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ?? toSafeStudyShellValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.get("/participant/demo", async () => ({
    participantRoute: "public",
    message: "Participant routes do not require researcher sign-in."
  }));

  return server;
}

function toSafeInlineErrorResponse(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    "body" in error &&
    typeof error.statusCode === "number"
  ) {
    return error as { statusCode: number; body: { error: string; message: string } };
  }

  return undefined;
}
