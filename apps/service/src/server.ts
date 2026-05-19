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
  createConfiguredGapMapGenerator,
  type GapMapGenerator
} from "./gap-map.js";
import {
  OperationalEventService,
  createConfiguredOperationalEventStore,
  parseAudioConnectionState,
  parseTechnicalFailureCategory,
  type AuditLogStore,
  type OperationalEventServiceOptions,
  type OperationalEventStore
} from "./operational-events.js";
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
  RunService,
  createConfiguredParticipantAccessTokenStore,
  createConfiguredRunStore,
  toSafeParticipantAccessResponse,
  toSafeRunValidationResponse,
  type CaptureParticipantConsentInput,
  type CreateRunsInput,
  type InterruptInterviewInput,
  type ParticipantAccessTokenStore,
  type RunServiceOptions,
  type RunStore,
  type SaveInterviewArtifactsInput,
  type SubmitParticipantSurveyInput
} from "./runs.js";
import { RunDashboardService } from "./run-dashboard.js";
import {
  ScoringService,
  createConfiguredScoringGenerator,
  createConfiguredScoringStore,
  toSafeScoringValidationResponse,
  type ScoringGenerator,
  type ScoringServiceOptions,
  type ScoringStore
} from "./scoring.js";
import {
  createConfiguredRealtimeVoiceProvider,
  type RealtimeVoiceProvider
} from "./voice-provider.js";
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
  readonly gapMapGenerator?: GapMapGenerator;
  readonly objectiveVersionStore?: ObjectiveVersionStore;
  readonly operationalEventServiceOptions?: OperationalEventServiceOptions;
  readonly operationalEventStore?: OperationalEventStore & AuditLogStore;
  readonly participantSlotServiceOptions?: ParticipantSlotServiceOptions;
  readonly participantSlotStore?: ParticipantSlotStore;
  readonly participantAccessTokenStore?: ParticipantAccessTokenStore;
  readonly runServiceOptions?: RunServiceOptions;
  readonly runStore?: RunStore;
  readonly scoringGenerator?: ScoringGenerator;
  readonly scoringServiceOptions?: ScoringServiceOptions;
  readonly scoringStore?: ScoringStore;
  readonly studyShellStore?: StudyShellStore;
  readonly surveyVersionStore?: SurveyVersionStore;
  readonly realtimeVoiceProvider?: RealtimeVoiceProvider;
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
    ...("description" in record ? { description: record.description } : {}),
    ...("interviewerGoals" in record ? { interviewerGoals: record.interviewerGoals } : {}),
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
      description: coerceOptionalText(input.description, "Study description"),
      interviewerGoals: coerceOptionalText(input.interviewerGoals, "Interviewer goals"),
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
      ...("description" in input ? { description: coerceOptionalText(input.description, "Study description") } : {}),
      ...("interviewerGoals" in input
        ? { interviewerGoals: coerceOptionalText(input.interviewerGoals, "Interviewer goals") }
        : {}),
      defaultFreshnessDays: coerceOptionalInteger(input.defaultFreshnessDays, "freshness days"),
      defaultMaxInterviewMinutes: coerceOptionalInteger(input.defaultMaxInterviewMinutes, "max interview minutes")
    };
  } catch (error) {
    throw toStudyBodyError(error);
  }
}

function coerceOptionalText(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be text.`);
  }

  return value;
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

function coerceCreateRunsInput(body: unknown): CreateRunsInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Select at least one participant slot."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if (
    "id" in record ||
    "studyId" in record ||
    "status" in record ||
    "currentRunForSlot" in record ||
    "freshnessDeadlineAt" in record ||
    "maxInterviewMinutes" in record ||
    "consentVersionId" in record ||
    "surveyVersionId" in record ||
    "personaVersionId" in record ||
    "objectiveVersionIds" in record
  ) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Run metadata is assigned by the service."
      }
    };
  }

  return {
    participantSlotIds: record.participantSlotIds
  };
}

function coerceCaptureParticipantConsentInput(body: unknown): CaptureParticipantConsentInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Consent acceptance is required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if (
    "id" in record ||
    "studyId" in record ||
    "participantSlotId" in record ||
    "runId" in record ||
    "consentVersionId" in record ||
    "consentMethod" in record ||
    "renderedConsentSnapshot" in record ||
    "acceptedAt" in record ||
    "createdAt" in record
  ) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Consent record metadata is assigned by the service."
      }
    };
  }

  return {
    accepted: record.accepted,
    signatureText: record.signatureText
  };
}

function coerceSubmitParticipantSurveyInput(body: unknown): SubmitParticipantSurveyInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Survey responses are required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if (
    "id" in record ||
    "studyId" in record ||
    "participantSlotId" in record ||
    "runId" in record ||
    "surveyVersionId" in record ||
    "submittedAt" in record ||
    "createdAt" in record
  ) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Survey response metadata is assigned by the service."
      }
    };
  }

  rejectSurveyResponseMetadata(record.responses);

  return {
    responses: record.responses
  };
}

function coerceInterruptInterviewInput(body: unknown): InterruptInterviewInput {
  if (body === undefined) {
    return {};
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Interview interruption details are invalid."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if (
    "id" in record ||
    "studyId" in record ||
    "participantSlotId" in record ||
    "runId" in record ||
    "sessionNumber" in record ||
    "status" in record ||
    "startedAt" in record ||
    "endedAt" in record ||
    "createdAt" in record ||
    "updatedAt" in record
  ) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Interview session metadata is assigned by the service."
      }
    };
  }

  return {
    safeStatus: record.safeStatus
  };
}

function coerceTechnicalFailureInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Technical failure details are required."
      }
    };
  }

  const record = body as Record<string, unknown>;
  const serviceRequestId =
    typeof record.serviceRequestId === "string" && record.serviceRequestId.trim()
      ? record.serviceRequestId.trim()
      : undefined;

  if (!serviceRequestId) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Service request ID is required."
      }
    };
  }

  return {
    serviceRequestId,
    technicalFailureCategory: parseTechnicalFailureCategory(record.technicalFailureCategory),
    audioConnectionState: parseAudioConnectionState(record.audioConnectionState ?? "failed"),
    retryCount: coerceOptionalNonNegativeInteger(record.retryCount, "retry count") ?? 0,
    latencyMs: coerceOptionalNonNegativeInteger(record.latencyMs, "latency")
  };
}

function coerceSaveInterviewArtifactsInput(body: unknown): SaveInterviewArtifactsInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Interview artifacts are required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if (
    "id" in record ||
    "studyId" in record ||
    "participantSlotId" in record ||
    "runId" in record ||
    "interviewSessionId" in record ||
    "createdAt" in record ||
    "updatedAt" in record ||
    "audioDurationSeconds" in record
  ) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Interview artifact metadata is assigned by the service."
      }
    };
  }

  rejectInterviewTurnMetadata(record.turns);
  rejectInterviewAudioAssetMetadata(record.audioAsset);

  return {
    turns: record.turns,
    audioAsset: record.audioAsset,
    transcriptTokenCount: record.transcriptTokenCount
  };
}

function coerceAudioConnectionStateInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Audio connection state is required."
      }
    };
  }

  const record = body as Record<string, unknown>;

  if (
    "id" in record ||
    "studyId" in record ||
    "runId" in record ||
    "participantSlotId" in record ||
    "eventType" in record ||
    "createdAt" in record
  ) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Operational event metadata is assigned by the service."
      }
    };
  }

  const serviceRequestId =
    typeof record.serviceRequestId === "string" && record.serviceRequestId.trim()
      ? record.serviceRequestId.trim()
      : undefined;

  if (!serviceRequestId) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Service request ID is required."
      }
    };
  }

  return {
    serviceRequestId,
    audioConnectionState: parseAudioConnectionState(record.audioConnectionState),
    retryCount: coerceOptionalNonNegativeInteger(record.retryCount, "retry count"),
    latencyMs: coerceOptionalNonNegativeInteger(record.latencyMs, "latency"),
    technicalFailureCategory:
      record.technicalFailureCategory !== undefined ? parseTechnicalFailureCategory(record.technicalFailureCategory) : undefined
  };
}

function rejectInterviewTurnMetadata(value: unknown) {
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
      "participantSlotId" in record ||
      "runId" in record ||
      "interviewSessionId" in record ||
      "createdAt" in record
    ) {
      throw {
        statusCode: 400,
        body: {
          error: "Bad Request",
          message: "Interview artifact metadata is assigned by the service."
        }
      };
    }
  }
}

function rejectInterviewAudioAssetMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const record = value as Record<string, unknown>;

  if (
    "id" in record ||
    "studyId" in record ||
    "participantSlotId" in record ||
    "runId" in record ||
    "interviewSessionId" in record ||
    "createdAt" in record
  ) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: "Interview artifact metadata is assigned by the service."
      }
    };
  }
}

function rejectSurveyResponseMetadata(value: unknown) {
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
      "participantSlotId" in record ||
      "runId" in record ||
      "surveyVersionId" in record ||
      "submittedAt" in record ||
      "createdAt" in record
    ) {
      throw {
        statusCode: 400,
        body: {
          error: "Bad Request",
          message: "Survey response metadata is assigned by the service."
        }
      };
    }
  }
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

function coerceOptionalNonNegativeInteger(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw {
      statusCode: 400,
      body: {
        error: "Bad Request",
        message: `${label} must be a non-negative whole number.`
      }
    };
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
    gapMapGenerator = createConfiguredGapMapGenerator(),
    objectiveVersionStore = createConfiguredObjectiveVersionStore(),
    operationalEventServiceOptions,
    operationalEventStore = createConfiguredOperationalEventStore(),
    participantAccessTokenStore = createConfiguredParticipantAccessTokenStore(),
    participantSlotServiceOptions,
    participantSlotStore = createConfiguredParticipantSlotStore(),
    runServiceOptions,
    runStore = createConfiguredRunStore(),
    scoringGenerator = createConfiguredScoringGenerator(),
    scoringServiceOptions,
    scoringStore = createConfiguredScoringStore(),
    studyShellStore = createConfiguredStudyShellStore(),
    surveyVersionStore = createConfiguredSurveyVersionStore(),
    realtimeVoiceProvider = createConfiguredRealtimeVoiceProvider(),
    ...fastifyOptions
  } = options;
  let resolvedAuthProvider = authProvider;
  const studyShellService = new StudyShellService(studyShellStore);
  const consentService = new ConsentService(consentVersionStore, studyShellStore);
  const objectiveService = new ObjectiveService(objectiveVersionStore);
  const operationalEventService = new OperationalEventService(operationalEventStore, operationalEventServiceOptions);
  const participantSlotService = new ParticipantSlotService(participantSlotStore, participantSlotServiceOptions);
  const scoringService = new ScoringService(
    runStore,
    objectiveVersionStore,
    scoringStore,
    scoringServiceOptions,
    scoringGenerator
  );
  const runDashboardService = new RunDashboardService(participantSlotStore, runStore, scoringStore);
  const runService = new RunService(
    runStore,
    participantAccessTokenStore,
    participantSlotStore,
    objectiveVersionStore,
    consentVersionStore,
    surveyVersionStore,
    {
      ...runServiceOptions,
      automaticScoringTrigger: runServiceOptions?.automaticScoringTrigger ?? scoringService
    },
    gapMapGenerator
  );
  const surveyService = new SurveyService(surveyVersionStore, studyShellStore);
  const studyAuthorization = new StudyAuthorizationService(
    new StudyShellAuthorizationStore(studyShellStore, operationalEventStore)
  );
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
      await studyAuthorization.recordStudyAction(request.user!, study.id, "study", study.id, "create", {
        defaultFreshnessDays: study.defaultFreshnessDays,
        defaultMaxInterviewMinutes: study.defaultMaxInterviewMinutes
      });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
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
        await studyAuthorization.recordSensitiveAction(access, "study", updatedStudy.id, "update", {
          defaultFreshnessDays: updatedStudy.defaultFreshnessDays,
          defaultMaxInterviewMinutes: updatedStudy.defaultMaxInterviewMinutes
        });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
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
        await studyAuthorization.recordSensitiveAction(access, "consent_version", consentVersion.id, "create", {
          versionNumber: consentVersion.versionNumber,
          consentMethod: consentVersion.consentMethod
        });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
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
        await studyAuthorization.recordSensitiveAction(access, "consent_version", consentVersion.id, "restore", {
          versionNumber: consentVersion.versionNumber,
          consentMethod: consentVersion.consentMethod
        });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const participantSlot = await participantSlotService.createParticipantSlot(
          request.params.studyId,
          coerceCreateParticipantSlotInput(request.body)
        );
        await studyAuthorization.recordSensitiveAction(access, "participant_slot", participantSlot.id, "create", {
          codeSource: participantSlot.codeSource
        });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const result = await participantSlotService.importParticipantSlots(
          request.params.studyId,
          coerceImportParticipantSlotsInput(request.body)
        );
        await studyAuthorization.recordSensitiveAction(access, "study", request.params.studyId, "create", {
          entityBatchType: "participant_slot",
          createdCount: result.createdParticipantSlots.length,
          rejectedCount: result.rejectedRows.length,
          codeSource: "researcher_supplied"
        });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const result = await participantSlotService.generateParticipantSlots(
          request.params.studyId,
          coerceGenerateParticipantSlotsInput(request.body)
        );
        await studyAuthorization.recordSensitiveAction(access, "study", request.params.studyId, "create", {
          entityBatchType: "participant_slot",
          createdCount: result.createdParticipantSlots.length,
          codeSource: "platform_generated"
        });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const participantSlot = await participantSlotService.archiveParticipantSlot(
          request.params.studyId,
          request.params.participantSlotId
        );
        await studyAuthorization.recordSensitiveAction(access, "participant_slot", participantSlot.id, "archive", {
          status: participantSlot.status
        });

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
    "/researcher/studies/:studyId/runs",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read");

        return runService.listForStudy(request.params.studyId);
      } catch (error) {
        const safeAuthorization = toSafeAuthorizationResponse(error);

        if (safeAuthorization) {
          return reply.code(safeAuthorization.statusCode).send(safeAuthorization.body);
        }

        throw error;
      }
    }
  );

  server.get<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/run-dashboard",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read");

        return runDashboardService.listForStudy(request.params.studyId);
      } catch (error) {
        const safeAuthorization = toSafeAuthorizationResponse(error);

        if (safeAuthorization) {
          return reply.code(safeAuthorization.statusCode).send(safeAuthorization.body);
        }

        throw error;
      }
    }
  );

  server.get<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/score-reviews",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read_raw_artifact");
        await studyAuthorization.recordSensitiveRead(access, "study", request.params.studyId, {
          rawArtifactView: "score_reviews"
        });

        return await scoringService.listScoreReviewsForStudy(request.params.studyId);
      } catch (error) {
        const safeResponse = toSafeAuthorizationResponse(error) ?? toSafeScoringValidationResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.get<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/score-export.csv",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read_raw_artifact");
        const participantSlots = await participantSlotStore.listByStudy(request.params.studyId);
        const exportResult = await scoringService.generateScoreCsvExport(request.params.studyId, participantSlots);

        await studyAuthorization.recordSensitiveAction(access, "study", request.params.studyId, "export", {
          rawArtifactView: "score_csv_export",
          rowCount: exportResult.rowCount
        });

        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="${exportResult.filename}"`)
          .send(exportResult.csv);
      } catch (error) {
        const safeResponse = toSafeAuthorizationResponse(error) ?? toSafeScoringValidationResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.get<{ Params: StudyParams & { runId: string } }>(
    "/researcher/studies/:studyId/runs/:runId/raw-evidence",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read_raw_artifact");
        const rawEvidence = await scoringService.getRawEvidenceForRun({
          studyId: request.params.studyId,
          runId: request.params.runId
        });
        await studyAuthorization.recordSensitiveRead(access, "run", request.params.runId, {
          rawArtifactView: "run_raw_evidence",
          surveyResponseCount: rawEvidence.surveyResponses.length,
          interviewTurnCount: rawEvidence.interviewTurns.length,
          audioAssetCount: rawEvidence.audioAssets.length
        });

        return rawEvidence;
      } catch (error) {
        const safeResponse = toSafeAuthorizationResponse(error) ?? toSafeScoringValidationResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: StudyParams & { runId: string } }>(
    "/researcher/studies/:studyId/runs/:runId/rescore",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
        const result = await scoringService.triggerManualRescore({
          studyId: request.params.studyId,
          runId: request.params.runId
        });
        await studyAuthorization.recordSensitiveAction(access, "scoring_run", result.scoringRun.id, "manual_rescore", {
          runId: request.params.runId,
          objectiveScoreCount: result.objectiveScores.length,
          evidenceCitationCount: result.evidenceCitations.length,
          serviceRequestId: result.scoringRun.serviceRequestId,
          objectiveVersionSetHash: result.scoringRun.objectiveVersionSetHash
        });

        return reply.code(201).send(result);
      } catch (error) {
        const safeResponse = toSafeAuthorizationResponse(error) ?? toSafeScoringValidationResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: StudyParams }>(
    "/researcher/studies/:studyId/runs",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
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

        const result = await runService.createRuns(study, coerceCreateRunsInput(request.body));
        await studyAuthorization.recordSensitiveAction(access, "study", request.params.studyId, "create", {
          entityBatchType: "run",
          runCount: result.createdRuns.length,
          participantSlotIds: result.createdRuns.map((run) => run.participantSlotId)
        });

        return reply.code(201).send(result);
      } catch (error) {
        const safeResponse =
          toSafeAuthorizationResponse(error) ?? toSafeRunValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.get<{ Params: StudyParams & { runId: string; evidenceCitationId: string } }>(
    "/researcher/studies/:studyId/runs/:runId/evidence-citations/:evidenceCitationId",
    { preHandler: requireResearcher },
    async (request, reply) => {
      try {
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "read_raw_artifact");
        const resolvedCitation = await scoringService.resolveEvidenceCitation({
          studyId: request.params.studyId,
          runId: request.params.runId,
          evidenceCitationId: request.params.evidenceCitationId
        });
        await studyAuthorization.recordSensitiveRead(access, "evidence_citation", request.params.evidenceCitationId, {
          rawArtifactView: "citation_resolution",
          runId: request.params.runId,
          sourceType: resolvedCitation.citation.sourceType,
          sourceId: resolvedCitation.citation.sourceId
        });

        return resolvedCitation;
      } catch (error) {
        const safeResponse = toSafeAuthorizationResponse(error) ?? toSafeScoringValidationResponse(error);

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
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
        await studyAuthorization.recordSensitiveAction(access, "survey_version", surveyVersion.id, "create", {
          versionNumber: surveyVersion.versionNumber,
          questionCount: surveyVersion.layoutItems.filter((item) => item.type === "question").length,
          groupCount: surveyVersion.groups.length
        });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
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
        await studyAuthorization.recordSensitiveAction(access, "survey_version", surveyVersion.id, "restore", {
          versionNumber: surveyVersion.versionNumber,
          questionCount: surveyVersion.layoutItems.filter((item) => item.type === "question").length,
          groupCount: surveyVersion.groups.length
        });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
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
        await studyAuthorization.recordSensitiveAction(access, "study", request.params.studyId, "create", {
          entityBatchType: "objective_version",
          objectiveVersionCount: objectiveVersions.length,
          objectiveKeys: objectiveVersions.map((objectiveVersion) => objectiveVersion.objectiveKey)
        });

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
        const access = await studyAuthorization.requireStudyAccess(request.user!, request.params.studyId, "write");
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
        await studyAuthorization.recordSensitiveAction(access, "objective_version", objectiveVersion.id, "restore", {
          objectiveKey: objectiveVersion.objectiveKey,
          versionNumber: objectiveVersion.versionNumber
        });

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

  server.get<{ Params: { accessToken: string } }>("/participant/runs/:accessToken", async (request, reply) => {
    try {
      return await runService.validateParticipantAccess(request.params.accessToken);
    } catch (error) {
      const safeResponse = toSafeParticipantAccessResponse(error);

      if (safeResponse) {
        return reply.code(safeResponse.statusCode).send(safeResponse.body);
      }

      throw error;
    }
  });

  server.post<{ Params: { accessToken: string } }>("/participant/runs/:accessToken/consent", async (request, reply) => {
    try {
      const result = await runService.captureParticipantConsent(
        request.params.accessToken,
        coerceCaptureParticipantConsentInput(request.body)
      );

      return reply.code(201).send(result);
    } catch (error) {
      const safeResponse =
        toSafeParticipantAccessResponse(error) ?? toSafeRunValidationResponse(error) ?? toSafeInlineErrorResponse(error);

      if (safeResponse) {
        return reply.code(safeResponse.statusCode).send(safeResponse.body);
      }

      throw error;
    }
  });

  server.post<{ Params: { accessToken: string } }>("/participant/runs/:accessToken/survey", async (request, reply) => {
    try {
      const result = await runService.submitParticipantSurvey(
        request.params.accessToken,
        coerceSubmitParticipantSurveyInput(request.body)
      );

      return reply.code(201).send(result);
    } catch (error) {
      const safeResponse =
        toSafeParticipantAccessResponse(error) ?? toSafeRunValidationResponse(error) ?? toSafeInlineErrorResponse(error);

      if (safeResponse) {
        return reply.code(safeResponse.statusCode).send(safeResponse.body);
      }

      throw error;
    }
  });

  server.post<{ Params: { accessToken: string } }>("/participant/runs/:accessToken/interview/start", async (request, reply) => {
    try {
      const result = await runService.startParticipantInterview(request.params.accessToken);

      return reply.code(201).send(result);
    } catch (error) {
      const safeResponse =
        toSafeParticipantAccessResponse(error) ?? toSafeRunValidationResponse(error) ?? toSafeInlineErrorResponse(error);

      if (safeResponse) {
        return reply.code(safeResponse.statusCode).send(safeResponse.body);
      }

      throw error;
    }
  });

  server.post<{ Params: { accessToken: string } }>(
    "/participant/runs/:accessToken/interview/realtime-session",
    async (request, reply) => {
      try {
        const result = await runService.createParticipantRealtimeVoiceSession(
          request.params.accessToken,
          realtimeVoiceProvider
        );

        await operationalEventService.recordRealtimeSessionCreated({
          studyId: result.run.studyId,
          runId: result.run.id,
          participantSlotId: result.run.participantSlotId,
          serviceRequestId: result.realtimeSession.serviceRequestId,
          provider: result.realtimeSession.provider,
          modelName: result.realtimeSession.model
        });

        return reply.code(201).send(result);
      } catch (error) {
        const safeResponse =
          toSafeParticipantAccessResponse(error) ?? toSafeRunValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        return reply.code(502).send({
          error: "Bad Gateway",
          message: "Unable to prepare the voice interview."
        });
      }
    }
  );

  server.post<{ Params: { accessToken: string } }>(
    "/participant/runs/:accessToken/interview/connection-state",
    async (request, reply) => {
      try {
        const input = coerceAudioConnectionStateInput(request.body);
        const result = await runService.validateParticipantAccess(request.params.accessToken);

        await operationalEventService.recordAudioConnectionState({
          studyId: result.run.studyId,
          runId: result.run.id,
          participantSlotId: result.run.participantSlotId,
          serviceRequestId: input.serviceRequestId,
          audioConnectionState: input.audioConnectionState,
          retryCount: input.retryCount,
          latencyMs: input.latencyMs
        });

        if (input.technicalFailureCategory) {
          await operationalEventService.recordTechnicalFailure({
            studyId: result.run.studyId,
            runId: result.run.id,
            participantSlotId: result.run.participantSlotId,
            serviceRequestId: input.serviceRequestId,
            technicalFailureCategory: input.technicalFailureCategory,
            audioConnectionState: input.audioConnectionState,
            retryCount: input.retryCount ?? 0,
            latencyMs: input.latencyMs
          });
        }

        return reply.code(204).send();
      } catch (error) {
        const safeResponse =
          toSafeParticipantAccessResponse(error) ?? toSafeRunValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: { accessToken: string } }>(
    "/participant/runs/:accessToken/interview/artifacts",
    async (request, reply) => {
      try {
        const result = await runService.saveParticipantInterviewArtifacts(
          request.params.accessToken,
          coerceSaveInterviewArtifactsInput(request.body)
        );

        return reply.code(201).send(result);
      } catch (error) {
        const safeResponse =
          toSafeParticipantAccessResponse(error) ?? toSafeRunValidationResponse(error) ?? toSafeInlineErrorResponse(error);

        if (safeResponse) {
          return reply.code(safeResponse.statusCode).send(safeResponse.body);
        }

        throw error;
      }
    }
  );

  server.post<{ Params: { accessToken: string } }>("/participant/runs/:accessToken/interview/pause", async (request, reply) => {
    try {
      return await runService.pauseParticipantInterview(request.params.accessToken);
    } catch (error) {
      const safeResponse =
        toSafeParticipantAccessResponse(error) ?? toSafeRunValidationResponse(error) ?? toSafeInlineErrorResponse(error);

      if (safeResponse) {
        return reply.code(safeResponse.statusCode).send(safeResponse.body);
      }

      throw error;
    }
  });

  server.post<{ Params: { accessToken: string } }>("/participant/runs/:accessToken/interview/resume", async (request, reply) => {
    try {
      const result = await runService.resumeParticipantInterview(request.params.accessToken);

      return reply.code(201).send(result);
    } catch (error) {
      const safeResponse =
        toSafeParticipantAccessResponse(error) ?? toSafeRunValidationResponse(error) ?? toSafeInlineErrorResponse(error);

      if (safeResponse) {
        return reply.code(safeResponse.statusCode).send(safeResponse.body);
      }

      throw error;
    }
  });

  server.post<{ Params: { accessToken: string } }>("/participant/runs/:accessToken/interview/complete", async (request, reply) => {
    try {
      return await runService.completeParticipantInterview(request.params.accessToken);
    } catch (error) {
      const safeResponse =
        toSafeParticipantAccessResponse(error) ??
        toSafeRunValidationResponse(error) ??
        toSafeScoringValidationResponse(error) ??
        toSafeInlineErrorResponse(error);

      if (safeResponse) {
        return reply.code(safeResponse.statusCode).send(safeResponse.body);
      }

      throw error;
    }
  });

  server.post<{ Params: { accessToken: string } }>("/participant/runs/:accessToken/interview/interrupt", async (request, reply) => {
    try {
      const result = await runService.interruptParticipantInterview(
        request.params.accessToken,
        coerceInterruptInterviewInput(request.body)
      );

      if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
        const record = request.body as Record<string, unknown>;

        if (record.technicalFailureCategory !== undefined) {
          const failureInput = coerceTechnicalFailureInput(request.body);

          await operationalEventService.recordTechnicalFailure({
            studyId: result.run.studyId,
            runId: result.run.id,
            participantSlotId: result.run.participantSlotId,
            serviceRequestId: failureInput.serviceRequestId,
            technicalFailureCategory: failureInput.technicalFailureCategory,
            audioConnectionState: failureInput.audioConnectionState,
            retryCount: failureInput.retryCount,
            latencyMs: failureInput.latencyMs
          });
        }
      }

      return result;
    } catch (error) {
      const safeResponse =
        toSafeParticipantAccessResponse(error) ??
        toSafeRunValidationResponse(error) ??
        toSafeScoringValidationResponse(error) ??
        toSafeInlineErrorResponse(error);

      if (safeResponse) {
        return reply.code(safeResponse.statusCode).send(safeResponse.body);
      }

      throw error;
    }
  });

  server.post("/participant/runs", async (_request, reply) =>
    reply.code(403).send({
      error: "Forbidden",
      message: "Participants cannot create or reset runs."
    })
  );

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
