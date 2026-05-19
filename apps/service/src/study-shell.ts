import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { SessionUser } from "./auth.js";
import {
  AuditLogUnavailableError,
  type AuditLogWrite,
  type StudyAccessRecord,
  type StudyAuthorizationStore
} from "./authorization.js";
import type { AuditLogStore } from "./operational-events.js";

export const DEFAULT_FRESHNESS_DAYS = 14;
export const DEFAULT_MAX_INTERVIEW_MINUTES = 45;
export const V1_DEFAULT_PERSONA_STYLE_PROMPT = [
  "You are the fixed V1 interviewer for formative education research studies.",
  "Act like a calm, warm, neutral, curious, and non-evaluative research interviewer. Preserve natural conversation, acknowledge briefly, ask one question at a time, and invite concrete examples or clarification when an answer is vague.",
  "Use the participant's survey responses, the gap map, and the study objectives only to choose high-value follow-up questions. Steer gently toward unresolved gaps, ambiguities, contradictions, and missing evidence without making the participant feel tested or graded.",
  "Do not reveal scoring objectives, rubrics, grades, scores, confidence, hidden progress, or gap map internals. Do not tell the participant how they are performing or imply that the interview is an assessment.",
  "Keep questions participant-safe and focused on the study topic. If the participant seems uncomfortable, give them room to pause or stop."
].join("\n\n");
export const V1_DEFAULT_PERSONA = {
  id: "persona_version_v1_default_001",
  name: "v1_default",
  label: "V1 default research interviewer",
  stylePrompt: V1_DEFAULT_PERSONA_STYLE_PROMPT
} as const;

export interface StudyShell {
  readonly id: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly description?: string;
  readonly defaultFreshnessDays: number;
  readonly defaultMaxInterviewMinutes: number;
  readonly activeConsentVersionId?: string;
  readonly activeSurveyVersionId?: string;
  readonly activePersonaVersionId: string;
  readonly persona: {
    readonly id: string;
    readonly name: string;
    readonly label: string;
    readonly stylePrompt: string;
    readonly locked: true;
  };
  readonly status: "active";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateStudyShellInput {
  readonly title: string;
  readonly description?: string;
  readonly defaultFreshnessDays?: number;
  readonly defaultMaxInterviewMinutes?: number;
}

export interface UpdateStudyShellInput {
  readonly title?: string;
  readonly description?: string;
  readonly defaultFreshnessDays?: number;
  readonly defaultMaxInterviewMinutes?: number;
}

export interface StudyShellStore {
  listByOwner(ownerUserId: string): Promise<StudyShell[]>;
  getById(studyId: string): Promise<StudyShell | undefined>;
  create(study: StudyShell): Promise<StudyShell>;
  update(study: StudyShell): Promise<StudyShell>;
}

interface StudyShellItem {
  readonly entity: "study";
  readonly pk: string;
  readonly sk: "PROFILE";
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly id: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly description?: string;
  readonly defaultFreshnessDays: number;
  readonly defaultMaxInterviewMinutes: number;
  readonly activeConsentVersionId?: string;
  readonly activeSurveyVersionId?: string;
  readonly activePersonaVersionId: string;
  readonly status: "active";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class StudyShellValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "StudyShellValidationError";
  }
}

export interface StudyShellServiceOptions {
  readonly now?: () => Date;
  readonly createStudyId?: () => string;
}

export class StudyShellService {
  private readonly now: () => Date;
  private readonly createStudyId: () => string;

  constructor(
    private readonly store: StudyShellStore,
    options: StudyShellServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createStudyId = options.createStudyId ?? (() => `study_${crypto.randomUUID()}`);
  }

  async listForResearcher(actor: SessionUser) {
    return this.store.listByOwner(actor.id);
  }

  async createStudyShell(actor: SessionUser, input: CreateStudyShellInput) {
    const now = this.now().toISOString();
    const study: StudyShell = {
      id: this.createStudyId(),
      ownerUserId: actor.id,
      title: parseTitle(input.title),
      description: parseOptionalDescription(input.description),
      defaultFreshnessDays: parseIntegerSetting(
        input.defaultFreshnessDays,
        "freshness days",
        DEFAULT_FRESHNESS_DAYS,
        1,
        365
      ),
      defaultMaxInterviewMinutes: parseIntegerSetting(
        input.defaultMaxInterviewMinutes,
        "max interview minutes",
        DEFAULT_MAX_INTERVIEW_MINUTES,
        1,
        180
      ),
      activePersonaVersionId: V1_DEFAULT_PERSONA.id,
      persona: toLockedPersona(),
      status: "active",
      createdAt: now,
      updatedAt: now
    };

    return this.store.create(study);
  }

  async updateStudyShell(study: StudyShell, input: UpdateStudyShellInput) {
    const updatedStudy: StudyShell = {
      ...study,
      title: input.title === undefined ? study.title : parseTitle(input.title),
      description: input.description === undefined ? study.description : parseOptionalDescription(input.description),
      defaultFreshnessDays:
        input.defaultFreshnessDays === undefined
          ? study.defaultFreshnessDays
          : parseIntegerSetting(input.defaultFreshnessDays, "freshness days", undefined, 1, 365),
      defaultMaxInterviewMinutes:
        input.defaultMaxInterviewMinutes === undefined
          ? study.defaultMaxInterviewMinutes
          : parseIntegerSetting(input.defaultMaxInterviewMinutes, "max interview minutes", undefined, 1, 180),
      activePersonaVersionId: study.activePersonaVersionId,
      persona: study.persona,
      updatedAt: this.now().toISOString()
    };

    return this.store.update(updatedStudy);
  }
}

export class InMemoryStudyShellStore implements StudyShellStore {
  private readonly studies = new Map<string, StudyShell>();

  constructor(initialStudies: readonly StudyShell[] = []) {
    for (const study of initialStudies) {
      this.studies.set(study.id, study);
    }
  }

  async listByOwner(ownerUserId: string) {
    return [...this.studies.values()]
      .filter((study) => study.ownerUserId === ownerUserId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getById(studyId: string) {
    return this.studies.get(studyId);
  }

  async create(study: StudyShell) {
    this.studies.set(study.id, study);
    return study;
  }

  async update(study: StudyShell) {
    this.studies.set(study.id, study);
    return study;
  }
}

export interface DynamoDbStudyShellStoreOptions {
  readonly tableName?: string;
  readonly environment?: string;
  readonly region?: string;
  readonly endpoint?: string;
}

export class DynamoDbStudyShellStore implements StudyShellStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbStudyShellStoreOptions = {}) {
    const region = options.region ?? process.env.AWS_REGION ?? "us-east-1";
    const client = new DynamoDBClient({
      region,
      ...(options.endpoint || process.env.DYNAMODB_ENDPOINT
        ? {
            endpoint: options.endpoint ?? process.env.DYNAMODB_ENDPOINT,
            credentials: {
              accessKeyId: "local",
              secretAccessKey: "local"
            }
          }
        : {})
    });

    this.documentClient = DynamoDBDocumentClient.from(client);
    this.tableName = options.tableName ?? getStudySetupTableName(options.environment);
  }

  async listByOwner(ownerUserId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "byOwner",
        KeyConditionExpression: "gsi1pk = :owner",
        ExpressionAttributeValues: {
          ":owner": `OWNER#${ownerUserId}`
        }
      })
    );

    return (response.Items ?? []).map((item) => toStudyShell(item as StudyShellItem));
  }

  async getById(studyId: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `STUDY#${studyId}`,
          sk: "PROFILE"
        }
      })
    );

    return response.Item ? toStudyShell(response.Item as StudyShellItem) : undefined;
  }

  async create(study: StudyShell) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toStudyShellItem(study),
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );

    return study;
  }

  async update(study: StudyShell) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toStudyShellItem(study),
        ConditionExpression: "attribute_exists(pk)"
      })
    );

    return study;
  }
}

export function createConfiguredStudyShellStore() {
  const storeMode = process.env.STUDY_SHELL_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbStudyShellStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemoryStudyShellStore();
  }

  return new DynamoDbStudyShellStore();
}

export function toStudyShellAccessRecord(study: StudyShell) {
  return {
    id: study.id,
    ownerUserId: study.ownerUserId
  };
}

export class StudyShellAuthorizationStore implements StudyAuthorizationStore {
  constructor(
    private readonly studyShellStore: Pick<StudyShellStore, "getById">,
    private readonly auditLogStore?: AuditLogStore
  ) {}

  async getStudyAccess(studyId: string): Promise<StudyAccessRecord | undefined> {
    const study = await this.studyShellStore.getById(studyId);
    return study ? toStudyShellAccessRecord(study) : undefined;
  }

  async getStudyIdForParticipantSlot() {
    return undefined;
  }

  async getStudyIdForRun() {
    return undefined;
  }

  async getRunIdForRawArtifact() {
    return undefined;
  }

  async getRunIdForScoringRun() {
    return undefined;
  }

  async getScoringRunIdForObjectiveScore() {
    return undefined;
  }

  async getRunIdForEvidenceCitation() {
    return undefined;
  }

  async writeAuditLog(entry: AuditLogWrite) {
    if (!this.auditLogStore) {
      throw new AuditLogUnavailableError();
    }

    await this.auditLogStore.writeAuditLog(entry);
  }
}

export function toSafeStudyShellValidationResponse(error: unknown) {
  if (error instanceof StudyShellValidationError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: "Bad Request",
        message: error.safeMessage
      }
    };
  }

  return undefined;
}

function parseTitle(value: string) {
  if (typeof value !== "string") {
    throw new StudyShellValidationError("Study title is required.");
  }

  const title = value.trim();

  if (!title) {
    throw new StudyShellValidationError("Study title is required.");
  }

  if (title.length > 160) {
    throw new StudyShellValidationError("Study title must be 160 characters or fewer.");
  }

  return title;
}

function parseOptionalDescription(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new StudyShellValidationError("Study description must be text.");
  }

  const description = value.trim();

  if (!description) {
    return undefined;
  }

  if (description.length > 2000) {
    throw new StudyShellValidationError("Study description must be 2000 characters or fewer.");
  }

  return description;
}

function parseIntegerSetting(
  value: number | undefined,
  label: string,
  defaultValue: number | undefined,
  minimum: number,
  maximum: number
) {
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new StudyShellValidationError(`${label} is required.`);
    }

    return defaultValue;
  }

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new StudyShellValidationError(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  }

  return value;
}

function toLockedPersona(): StudyShell["persona"] {
  return {
    ...V1_DEFAULT_PERSONA,
    locked: true
  };
}

function getStudySetupTableName(environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local") {
  return `education-researcher-${environment}-study-setup`;
}

function toStudyShellItem(study: StudyShell): StudyShellItem {
  return {
    entity: "study",
    pk: `STUDY#${study.id}`,
    sk: "PROFILE",
    gsi1pk: `OWNER#${study.ownerUserId}`,
    gsi1sk: `STUDY#${study.createdAt}#${study.id}`,
    id: study.id,
    ownerUserId: study.ownerUserId,
    title: study.title,
    ...(study.description ? { description: study.description } : {}),
    defaultFreshnessDays: study.defaultFreshnessDays,
    defaultMaxInterviewMinutes: study.defaultMaxInterviewMinutes,
    ...(study.activeConsentVersionId ? { activeConsentVersionId: study.activeConsentVersionId } : {}),
    ...(study.activeSurveyVersionId ? { activeSurveyVersionId: study.activeSurveyVersionId } : {}),
    activePersonaVersionId: study.activePersonaVersionId,
    status: study.status,
    createdAt: study.createdAt,
    updatedAt: study.updatedAt
  };
}

function toStudyShell(item: StudyShellItem): StudyShell {
  return {
    id: item.id,
    ownerUserId: item.ownerUserId,
    title: item.title,
    description: item.description,
    defaultFreshnessDays: item.defaultFreshnessDays,
    defaultMaxInterviewMinutes: item.defaultMaxInterviewMinutes,
    activeConsentVersionId: item.activeConsentVersionId,
    activeSurveyVersionId: item.activeSurveyVersionId,
    activePersonaVersionId: item.activePersonaVersionId,
    persona: toLockedPersona(),
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}
