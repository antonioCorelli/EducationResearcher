import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import {
  AuthenticationError,
  createConfiguredAuthProvider,
  type AuthProvider,
  type SessionUser
} from "./auth.js";
import {
  ConsentService,
  createConfiguredConsentVersionStore,
  toSafeConsentValidationResponse,
  type ConsentVersionStore,
  type SaveConsentInput
} from "./consent.js";
import {
  ObjectiveService,
  createConfiguredObjectiveVersionStore,
  toSafeObjectiveValidationResponse,
  type ObjectiveVersionStore,
  type SaveObjectivesInput
} from "./objectives.js";
import {
  ParticipantSlotService,
  createConfiguredParticipantSlotStore,
  toSafeParticipantSlotValidationResponse,
  type GenerateParticipantSlotsInput,
  type CreateParticipantSlotInput,
  type ImportParticipantSlotsInput,
  type ParticipantSlotServiceOptions,
  type ParticipantSlotStore
} from "./participant-slots.js";
import {
  SurveyService,
  createConfiguredSurveyVersionStore,
  toSafeSurveyValidationResponse,
  type SaveSurveyInput,
  type SurveyVersionStore
} from "./survey.js";
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
  readonly consentVersionStore?: ConsentVersionStore;
  readonly corsOrigin?: string | string[];
  readonly objectiveVersionStore?: ObjectiveVersionStore;
  readonly participantSlotServiceOptions?: ParticipantSlotServiceOptions;
  readonly participantSlotStore?: ParticipantSlotStore;
  readonly studyShellStore?: StudyShellStore;
  readonly surveyVersionStore?: SurveyVersionStore;
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

function coerceSaveConsentInput(body: unknown): SaveConsentInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Consent settings are required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if ("id" in record || "versionNumber" in record || "isActive" in record || "studyId" in record) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Consent version metadata is assigned by the service."
      }
    };
  }

  return {
    consentText: record.consentText,
    consentMethod: record.consentMethod
  } as SaveConsentInput;
}

function coerceRestoreVersionNumberInput(body: unknown, label: string) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: `${label} version number is required.`
      }
    };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.versionNumber !== "number") {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: `${label} version number is required.`
      }
    };
  }

  return record.versionNumber;
}

function coerceRestoreObjectiveInput(body: unknown) {
  const versionNumber = coerceRestoreVersionNumberInput(body, "Objective");
  const record = body as Record<string, unknown>;

  if (typeof record.objectiveKey !== "string") {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Objective key is required."
      }
    };
  }

  return {
    objectiveKey: record.objectiveKey,
    versionNumber
  };
}

function coerceSaveSurveyInput(body: unknown): SaveSurveyInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Survey settings are required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if ("id" in record || "versionNumber" in record || "isActive" in record || "studyId" in record) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Survey version metadata is assigned by the service."
      }
    };
  }

  rejectSurveyMetadata(record.questions, "Survey question metadata is assigned by the service.");
  rejectSurveyMetadata(record.groups, "Survey group metadata is assigned by the service.");
  rejectSurveyMetadata(record.items, "Survey item metadata is assigned by the service.");

  return {
    items: record.items,
    groups: record.groups,
    questions: record.questions
  } as SaveSurveyInput;
}

function coerceSaveObjectivesInput(body: unknown): SaveObjectivesInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Scoring objectives are required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if ("id" in record || "versionNumber" in record || "isActive" in record || "studyId" in record) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Objective version metadata is assigned by the service."
      }
    };
  }

  rejectObjectiveMetadata(record.objectives);

  return {
    objectives: record.objectives
  } as SaveObjectivesInput;
}

function coerceCreateParticipantSlotInput(body: unknown): CreateParticipantSlotInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Participant code is required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if ("id" in record || "studyId" in record || "codeSource" in record || "status" in record || "archivedAt" in record) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Participant slot metadata is assigned by the service."
      }
    };
  }

  return {
    participantCode: record.participantCode
  } as CreateParticipantSlotInput;
}

function coerceImportParticipantSlotsInput(body: unknown): ImportParticipantSlotsInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Participant slot CSV is required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if ("participantSlots" in record || "codeSource" in record || "status" in record) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Participant slot metadata is assigned by the service."
      }
    };
  }

  return {
    csv: record.csv
  };
}

function coerceGenerateParticipantSlotsInput(body: unknown): GenerateParticipantSlotsInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Generated slot count is required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if ("participantSlots" in record || "codeSource" in record || "status" in record) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Participant slot metadata is assigned by the service."
      }
    };
  }

  return {
    count: record.count
  };
}

function rejectObjectiveMetadata(value: unknown) {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;

    if (
      "id" in record ||
      "studyId" in record ||
      "versionNumber" in record ||
      "isActive" in record ||
      "createdAt" in record ||
      "sortOrder" in record ||
      "gradeScale" in record
    ) {
      throw {
        statusCode: 400,
        body: {
          error: "Bad Request",
          message: "Objective version metadata is assigned by the service."
        }
      };
    }

    rejectObjectiveExampleMetadata(record.gradeExamples);
  }
}

function rejectObjectiveExampleMetadata(value: unknown) {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;

    if ("id" in record || "objectiveVersionId" in record || "sortOrder" in record || "createdAt" in record) {
      throw {
        statusCode: 400,
        body: {
          error: "Bad Request",
          message: "Objective grade example metadata is assigned by the service."
        }
      };
    }
  }
}

function rejectSurveyMetadata(value: unknown, metadataMessage: string) {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;

    if (
      "id" in record ||
      "surveyVersionId" in record ||
      "surveyGroupId" in record ||
      "required" in record ||
      "sortOrder" in record ||
      "createdAt" in record
    ) {
      throw {
        statusCode: 400,
        body: {
          error: "Bad Request",
          message: metadataMessage
        }
      };
    }

    if ("questionType" in record && record.questionType !== "long_text") {
      throw {
        statusCode: 400,
        body: {
          error: "Bad Request",
          message: "Survey questions must be long-form text only."
        }
      };
    }

    rejectSurveyMetadata(record.question ? [record.question] : undefined, "Survey question metadata is assigned by the service.");
    rejectSurveyMetadata(record.group ? [record.group] : undefined, "Survey group metadata is assigned by the service.");
    rejectSurveyMetadata(record.questions, "Survey question metadata is assigned by the service.");
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
  const {
    authProvider,
    consentVersionStore = createConfiguredConsentVersionStore(),
    corsOrigin = true,
    objectiveVersionStore = createConfiguredObjectiveVersionStore(),
    participantSlotServiceOptions,
    participantSlotStore = createConfiguredParticipantSlotStore(),
    studyShellStore = createConfiguredStudyShellStore(),
    surveyVersionStore = createConfiguredSurveyVersionStore(),
    ...fastifyOptions
  } = options;
  let resolvedAuthProvider = authProvider;
  const studyShellService = new StudyShellService(studyShellStore);
  const consentService = new ConsentService(consentVersionStore, studyShellStore);
  const objectiveService = new ObjectiveService(objectiveVersionStore);
  const participantSlotService = new ParticipantSlotService(participantSlotStore, participantSlotServiceOptions);
  const surveyService = new SurveyService(surveyVersionStore, studyShellStore);
  const studyAuthorization = new StudyAuthorizationService(new StudyShellAuthorizationStore(studyShellStore));
  const server = Fastify({
    logger: true,
    ...fastifyOptions
  });

  void server.register(cors, {
    methods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
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

  server.get<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/consent",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read");

        return consentService.listForStudy(request.params.studyId);
      } catch (error) {
        const safeAuthorization = toSafeAuthorizationResponse(error);

        if (safeAuthorization) {
          return reply.code(safeAuthorization.statusCode).send(safeAuthorization.body);
        }

        throw error;
      }
    }
  );

  server.put<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/consent",
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

        const consentVersion = await consentService.saveConsent(study, coerceSaveConsentInput(request.body));

        return reply.code(201).send({
          consentVersion
        });
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ?? toSafeConsentValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/consent/restore",
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

        const consentVersion = await consentService.restoreConsentVersion(
          study,
          coerceRestoreVersionNumberInput(request.body, "Consent")
        );

        return {
          consentVersion
        };
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ?? toSafeConsentValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.get<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/participant-slots",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read");

        return participantSlotService.listForStudy(request.params.studyId);
      } catch (error) {
        const safeAuthorization = toSafeAuthorizationResponse(error);

        if (safeAuthorization) {
          return reply.code(safeAuthorization.statusCode).send(safeAuthorization.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/participant-slots",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const participantSlot = await participantSlotService.createParticipantSlot(
          request.params.studyId,
          coerceCreateParticipantSlotInput(request.body)
        );

        return reply.code(201).send({
          participantSlot
        });
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ??
          toSafeParticipantSlotValidationResponse(error) ??
          toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/participant-slots/import",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const result = await participantSlotService.importParticipantSlots(
          request.params.studyId,
          coerceImportParticipantSlotsInput(request.body)
        );

        return reply.code(201).send(result);
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ??
          toSafeParticipantSlotValidationResponse(error) ??
          toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/participant-slots/generate",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const result = await participantSlotService.generateParticipantSlots(
          request.params.studyId,
          coerceGenerateParticipantSlotsInput(request.body)
        );

        return reply.code(201).send(result);
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ??
          toSafeParticipantSlotValidationResponse(error) ??
          toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: StudyParams & { participantSlotId: string } }>(
    "/researcher/studies/:studyId/participant-slots/:participantSlotId/archive",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const participantSlot = await participantSlotService.archiveParticipantSlot(
          request.params.studyId,
          request.params.participantSlotId
        );

        return {
          participantSlot
        };
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ??
          toSafeParticipantSlotValidationResponse(error) ??
          toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.get<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/survey",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read");

        return surveyService.listForStudy(request.params.studyId);
      } catch (error) {
        const safeAuthorization = toSafeAuthorizationResponse(error);

        if (safeAuthorization) {
          return reply.code(safeAuthorization.statusCode).send(safeAuthorization.body);
        }

        throw error;
      }
    }
  );

  server.put<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/survey",
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

        const surveyVersion = await surveyService.saveSurvey(study, coerceSaveSurveyInput(request.body));

        return reply.code(201).send({
          surveyVersion
        });
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ?? toSafeSurveyValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/survey/restore",
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

        const surveyVersion = await surveyService.restoreSurveyVersion(
          study,
          coerceRestoreVersionNumberInput(request.body, "Survey")
        );

        return {
          surveyVersion
        };
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ?? toSafeSurveyValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.get<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/objectives",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read");

        return objectiveService.listForStudy(request.params.studyId);
      } catch (error) {
        const safeAuthorization = toSafeAuthorizationResponse(error);

        if (safeAuthorization) {
          return reply.code(safeAuthorization.statusCode).send(safeAuthorization.body);
        }

        throw error;
      }
    }
  );

  server.put<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/objectives",
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

        const objectiveVersions = await objectiveService.saveObjectives(
          request.params.studyId,
          coerceSaveObjectivesInput(request.body)
        );

        return reply.code(201).send({
          objectiveVersions
        });
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ?? toSafeObjectiveValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/objectives/restore",
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

        const restoreInput = coerceRestoreObjectiveInput(request.body);
        const objectiveVersion = await objectiveService.restoreObjectiveVersion(
          request.params.studyId,
          restoreInput.objectiveKey,
          restoreInput.versionNumber
        );

        return {
          objectiveVersion
        };
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ?? toSafeObjectiveValidationResponse(error) ?? toSafeInlineErrorResponse(error);

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
