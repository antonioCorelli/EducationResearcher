import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ObjectiveVersionStore } from "./objectives.js";
import type { ParticipantSlotStore } from "./participant-slots.js";
import type { StudyShell } from "./study-shell.js";

export type RunStatus =
  | "created"
  | "consented"
  | "survey_in_progress"
  | "survey_completed"
  | "interview_in_progress"
  | "interview_paused"
  | "interview_completed"
  | "stale"
  | "partial"
  | "technical_interruption"
  | "scored";

export interface Run {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly consentVersionId: string;
  readonly surveyVersionId: string;
  readonly personaVersionId: string;
  readonly objectiveVersionIds: readonly string[];
  readonly freshnessDeadlineAt: string;
  readonly maxInterviewMinutes: number;
  readonly status: RunStatus;
  readonly currentRunForSlot: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResearcherRun extends Run {
  readonly participantAccessUrl?: string;
  readonly participantAccessTokenId?: string;
}

export type ParticipantAccessTokenStatus = "active" | "revoked";

export interface ParticipantAccessToken {
  readonly id: string;
  readonly tokenId: string;
  readonly tokenHash: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly status: ParticipantAccessTokenStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ParticipantRunAccess {
  readonly run: {
    readonly id: string;
    readonly studyId: string;
    readonly participantSlotId: string;
    readonly status: RunStatus;
    readonly freshnessDeadlineAt: string;
    readonly maxInterviewMinutes: number;
  };
}

export interface CreateRunsInput {
  readonly participantSlotIds: unknown;
}

export interface RunStore {
  getById(runId: string): Promise<Run | undefined>;
  listByStudy(studyId: string): Promise<Run[]>;
  listByParticipantSlot(participantSlotId: string): Promise<Run[]>;
  create(run: Run, previousCurrentRuns: readonly Run[]): Promise<Run>;
}

export interface ParticipantAccessTokenStore {
  getByTokenId(tokenId: string): Promise<ParticipantAccessToken | undefined>;
  listByRun(runId: string): Promise<ParticipantAccessToken[]>;
  create(token: ParticipantAccessToken): Promise<ParticipantAccessToken>;
}

interface RunItem {
  readonly entity: "run";
  readonly pk: string;
  readonly sk: "PROFILE";
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly gsi2pk: string;
  readonly gsi2sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly consentVersionId: string;
  readonly surveyVersionId: string;
  readonly personaVersionId: string;
  readonly objectiveVersionIds?: readonly string[];
  readonly freshnessDeadlineAt: string;
  readonly maxInterviewMinutes: number;
  readonly status: RunStatus;
  readonly currentRunForSlot: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ParticipantAccessTokenItem {
  readonly entity: "participant_access_token";
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly gsi2pk: string;
  readonly gsi2sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly tokenId: string;
  readonly tokenHash: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly status: ParticipantAccessTokenStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class RunValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "RunValidationError";
  }
}

export class ParticipantAccessError extends Error {
  readonly statusCode = 403;

  constructor(readonly safeMessage = "This participant link is not available.") {
    super(safeMessage);
    this.name = "ParticipantAccessError";
  }
}

export interface RunServiceOptions {
  readonly now?: () => Date;
  readonly createRunId?: () => string;
  readonly createParticipantAccessTokenId?: () => string;
  readonly participantAccessBaseUrl?: string;
  readonly participantAccessTokenSecret?: string;
}

export class RunService {
  private readonly now: () => Date;
  private readonly createRunId: () => string;
  private readonly createParticipantAccessTokenId: () => string;
  private readonly participantAccessBaseUrl: string;
  private readonly participantAccessTokenSecret: string;

  constructor(
    private readonly runStore: RunStore,
    private readonly participantAccessTokenStore: ParticipantAccessTokenStore,
    private readonly participantSlotStore: Pick<ParticipantSlotStore, "listByStudy">,
    private readonly objectiveVersionStore: Pick<ObjectiveVersionStore, "listByStudy">,
    options: RunServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createRunId = options.createRunId ?? (() => `run_${randomUUID()}`);
    this.createParticipantAccessTokenId =
      options.createParticipantAccessTokenId ?? (() => createSecureRandomTokenId());
    this.participantAccessBaseUrl =
      options.participantAccessBaseUrl ?? process.env.PARTICIPANT_ACCESS_BASE_URL ?? "http://localhost:5173";
    this.participantAccessTokenSecret =
      options.participantAccessTokenSecret ?? getConfiguredParticipantAccessTokenSecret();
  }

  async listForStudy(studyId: string) {
    const runs = await this.runStore.listByStudy(studyId);

    return {
      runs: await Promise.all(runs.map((run) => this.toResearcherRun(run)))
    };
  }

  async createRuns(study: StudyShell, input: CreateRunsInput) {
    const participantSlotIds = parseParticipantSlotIds(input.participantSlotIds);
    const participantSlots = await this.participantSlotStore.listByStudy(study.id);
    const slotsById = new Map(participantSlots.map((slot) => [slot.id, slot]));
    const activeObjectiveVersionIds = (await this.objectiveVersionStore.listByStudy(study.id))
      .filter((version) => version.isActive && version.isEnabled !== false)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((version) => version.id);

    if (!study.activeConsentVersionId) {
      throw new RunValidationError("Active consent is required before creating runs.");
    }

    if (!study.activeSurveyVersionId) {
      throw new RunValidationError("Active survey is required before creating runs.");
    }

    if (activeObjectiveVersionIds.length === 0) {
      throw new RunValidationError("At least one enabled scoring objective is required before creating runs.");
    }

    const createdRuns: ResearcherRun[] = [];

    for (const participantSlotId of participantSlotIds) {
      const slot = slotsById.get(participantSlotId);

      if (!slot || slot.studyId !== study.id) {
        throw new RunValidationError("Participant slot was not found.");
      }

      if (slot.status !== "active") {
        throw new RunValidationError("Runs can only be created for active participant slots.");
      }

      const createdAt = this.now().toISOString();
      const previousCurrentRuns = (await this.runStore.listByParticipantSlot(participantSlotId)).filter(
        (run) => run.currentRunForSlot
      );
      const run: Run = {
        id: this.createRunId(),
        studyId: study.id,
        participantSlotId,
        consentVersionId: study.activeConsentVersionId,
        surveyVersionId: study.activeSurveyVersionId,
        personaVersionId: study.activePersonaVersionId,
        objectiveVersionIds: activeObjectiveVersionIds,
        freshnessDeadlineAt: addDays(this.now(), study.defaultFreshnessDays).toISOString(),
        maxInterviewMinutes: study.defaultMaxInterviewMinutes,
        status: "created",
        currentRunForSlot: true,
        createdAt,
        updatedAt: createdAt
      };

      const createdRun = await this.runStore.create(run, previousCurrentRuns);
      const tokenId = this.createParticipantAccessTokenId();
      const rawToken = createParticipantAccessTokenValue({
        tokenId,
        runId: createdRun.id,
        participantSlotId: createdRun.participantSlotId,
        secret: this.participantAccessTokenSecret
      });

      await this.participantAccessTokenStore.create({
        id: `participant_access_token_${randomUUID()}`,
        tokenId,
        tokenHash: hashParticipantAccessToken(rawToken),
        studyId: createdRun.studyId,
        participantSlotId: createdRun.participantSlotId,
        runId: createdRun.id,
        status: "active",
        createdAt,
        updatedAt: createdAt
      });

      createdRuns.push(await this.toResearcherRun(createdRun, rawToken));
    }

    return {
      createdRuns
    };
  }

  async validateParticipantAccess(rawToken: string): Promise<ParticipantRunAccess> {
    const parsedToken = parseParticipantAccessTokenValue(rawToken);

    if (!parsedToken) {
      throw new ParticipantAccessError();
    }

    const tokenRecord = await this.participantAccessTokenStore.getByTokenId(parsedToken.tokenId);

    if (!tokenRecord || tokenRecord.status !== "active") {
      throw new ParticipantAccessError();
    }

    const expectedToken = createParticipantAccessTokenValue({
      tokenId: tokenRecord.tokenId,
      runId: tokenRecord.runId,
      participantSlotId: tokenRecord.participantSlotId,
      secret: this.participantAccessTokenSecret
    });

    if (
      !safeEqual(hashParticipantAccessToken(rawToken), tokenRecord.tokenHash) ||
      !safeEqual(hashParticipantAccessToken(expectedToken), tokenRecord.tokenHash)
    ) {
      throw new ParticipantAccessError();
    }

    const run = await this.runStore.getById(tokenRecord.runId);

    if (
      !run ||
      run.studyId !== tokenRecord.studyId ||
      run.participantSlotId !== tokenRecord.participantSlotId ||
      !isParticipantAccessibleRunStatus(run.status) ||
      new Date(run.freshnessDeadlineAt).getTime() <= this.now().getTime()
    ) {
      throw new ParticipantAccessError();
    }

    const participantSlot = (await this.participantSlotStore.listByStudy(run.studyId)).find(
      (slot) => slot.id === run.participantSlotId
    );

    if (!participantSlot || participantSlot.status !== "active") {
      throw new ParticipantAccessError();
    }

    return {
      run: {
        id: run.id,
        studyId: run.studyId,
        participantSlotId: run.participantSlotId,
        status: run.status,
        freshnessDeadlineAt: run.freshnessDeadlineAt,
        maxInterviewMinutes: run.maxInterviewMinutes
      }
    };
  }

  private async toResearcherRun(run: Run, rawToken?: string): Promise<ResearcherRun> {
    let token = rawToken;
    let tokenId: string | undefined;

    if (!token) {
      const activeTokenRecord = (await this.participantAccessTokenStore.listByRun(run.id)).find(
        (record) => record.status === "active"
      );

      if (activeTokenRecord) {
        tokenId = activeTokenRecord.tokenId;
        token = createParticipantAccessTokenValue({
          tokenId: activeTokenRecord.tokenId,
          runId: run.id,
          participantSlotId: run.participantSlotId,
          secret: this.participantAccessTokenSecret
        });
      }
    }

    return {
      ...run,
      ...(token
        ? {
            participantAccessUrl: createParticipantAccessUrl(this.participantAccessBaseUrl, token),
            participantAccessTokenId: tokenId ?? parseParticipantAccessTokenValue(token)?.tokenId
          }
        : {})
    };
  }
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, Run>();

  constructor(initialRuns: readonly Run[] = []) {
    for (const run of initialRuns) {
      this.runs.set(run.id, run);
    }
  }

  async getById(runId: string) {
    return this.runs.get(runId);
  }

  async listByStudy(studyId: string) {
    return [...this.runs.values()]
      .filter((run) => run.studyId === studyId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listByParticipantSlot(participantSlotId: string) {
    return [...this.runs.values()]
      .filter((run) => run.participantSlotId === participantSlotId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(run: Run, previousCurrentRuns: readonly Run[]) {
    for (const previousRun of previousCurrentRuns) {
      this.runs.set(previousRun.id, {
        ...previousRun,
        currentRunForSlot: false,
        updatedAt: run.createdAt
      });
    }

    this.runs.set(run.id, run);
    return run;
  }
}

export class InMemoryParticipantAccessTokenStore implements ParticipantAccessTokenStore {
  private readonly tokens = new Map<string, ParticipantAccessToken>();

  constructor(initialTokens: readonly ParticipantAccessToken[] = []) {
    for (const token of initialTokens) {
      this.tokens.set(token.id, token);
    }
  }

  async getByTokenId(tokenId: string) {
    return [...this.tokens.values()].find((token) => token.tokenId === tokenId);
  }

  async listByRun(runId: string) {
    return [...this.tokens.values()]
      .filter((token) => token.runId === runId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(token: ParticipantAccessToken) {
    this.tokens.set(token.id, token);
    return token;
  }
}

export interface DynamoDbRunStoreOptions {
  readonly tableName?: string;
  readonly environment?: string;
  readonly region?: string;
  readonly endpoint?: string;
}

export class DynamoDbRunStore implements RunStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbRunStoreOptions = {}) {
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
    this.tableName = options.tableName ?? getRunLifecycleTableName(options.environment);
  }

  async getById(runId: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `RUN#${runId}`,
          sk: "PROFILE"
        }
      })
    );

    if (!response.Item || response.Item.entity !== "run") {
      return undefined;
    }

    return toRun(response.Item as RunItem);
  }

  async listByStudy(studyId: string) {
    const statuses: RunStatus[] = [
      "created",
      "consented",
      "survey_in_progress",
      "survey_completed",
      "interview_in_progress",
      "interview_paused",
      "interview_completed",
      "stale",
      "partial",
      "technical_interruption",
      "scored"
    ];
    const resultSets = await Promise.all(
      statuses.map((status) =>
        this.documentClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: "byStudyRunStatus",
            KeyConditionExpression: "gsi1pk = :status",
            ExpressionAttributeValues: {
              ":status": studyRunStatusPk(studyId, status)
            }
          })
        )
      )
    );

    return resultSets
      .flatMap((response) => response.Items ?? [])
      .filter((item) => item.entity === "run")
      .map((item) => toRun(item as RunItem))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listByParticipantSlot(participantSlotId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "byParticipantSlot",
        KeyConditionExpression: "gsi2pk = :slot",
        ExpressionAttributeValues: {
          ":slot": `SLOT#${participantSlotId}`
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "run")
      .map((item) => toRun(item as RunItem))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(run: Run, previousCurrentRuns: readonly Run[]) {
    for (const previousRun of previousCurrentRuns) {
      await this.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `RUN#${previousRun.id}`,
            sk: "PROFILE"
          },
          UpdateExpression: "SET currentRunForSlot = :currentRunForSlot, updatedAt = :updatedAt",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: {
            ":currentRunForSlot": false,
            ":updatedAt": run.createdAt
          }
        })
      );
    }

    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toRunItem(run),
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );

    return run;
  }
}

export class DynamoDbParticipantAccessTokenStore implements ParticipantAccessTokenStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbRunStoreOptions = {}) {
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
    this.tableName = options.tableName ?? getRunLifecycleTableName(options.environment);
  }

  async getByTokenId(tokenId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "byParticipantAccessToken",
        KeyConditionExpression: "gsi3pk = :token",
        ExpressionAttributeValues: {
          ":token": participantAccessTokenLookupPk(tokenId)
        },
        Limit: 1
      })
    );
    const item = response.Items?.find((candidate) => candidate.entity === "participant_access_token");

    return item ? toParticipantAccessToken(item as ParticipantAccessTokenItem) : undefined;
  }

  async listByRun(runId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :run AND begins_with(sk, :tokenPrefix)",
        ExpressionAttributeValues: {
          ":run": `RUN#${runId}`,
          ":tokenPrefix": "PARTICIPANT_ACCESS_TOKEN#"
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "participant_access_token")
      .map((item) => toParticipantAccessToken(item as ParticipantAccessTokenItem))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(token: ParticipantAccessToken) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toParticipantAccessTokenItem(token),
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
      })
    );

    return token;
  }
}

export function createConfiguredRunStore() {
  const storeMode = process.env.RUN_LIFECYCLE_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbRunStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemoryRunStore();
  }

  return new DynamoDbRunStore();
}

export function createConfiguredParticipantAccessTokenStore() {
  const storeMode = process.env.RUN_LIFECYCLE_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbParticipantAccessTokenStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemoryParticipantAccessTokenStore();
  }

  return new DynamoDbParticipantAccessTokenStore();
}

export function toSafeRunValidationResponse(error: unknown) {
  if (error instanceof RunValidationError) {
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

export function toSafeParticipantAccessResponse(error: unknown) {
  if (error instanceof ParticipantAccessError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: "Forbidden",
        message: error.safeMessage
      }
    };
  }

  return undefined;
}

export function createParticipantAccessTokenForTest(input: {
  readonly tokenId: string;
  readonly runId: string;
  readonly participantSlotId: string;
  readonly secret: string;
}) {
  return createParticipantAccessTokenValue(input);
}

export function hashParticipantAccessTokenForTest(token: string) {
  return hashParticipantAccessToken(token);
}

function parseParticipantSlotIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new RunValidationError("Select at least one participant slot.");
  }

  if (value.length < 1) {
    throw new RunValidationError("Select at least one participant slot.");
  }

  if (value.length > 200) {
    throw new RunValidationError("Create runs for 200 or fewer slots at a time.");
  }

  const participantSlotIds = value.map((participantSlotId) => {
    if (typeof participantSlotId !== "string" || !participantSlotId.trim()) {
      throw new RunValidationError("Participant slot selection is invalid.");
    }

    return participantSlotId.trim();
  });
  const uniqueParticipantSlotIds = new Set(participantSlotIds);

  if (uniqueParticipantSlotIds.size !== participantSlotIds.length) {
    throw new RunValidationError("Each participant slot can only be selected once.");
  }

  return participantSlotIds;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function createSecureRandomTokenId() {
  return randomBytes(18).toString("base64url");
}

function createParticipantAccessTokenValue({
  tokenId,
  runId,
  participantSlotId,
  secret
}: {
  readonly tokenId: string;
  readonly runId: string;
  readonly participantSlotId: string;
  readonly secret: string;
}) {
  const signature = createHmac("sha256", secret).update(`${tokenId}.${runId}.${participantSlotId}`).digest("base64url");

  return `pat_${tokenId}_${signature}`;
}

function parseParticipantAccessTokenValue(token: string) {
  const match = /^pat_([A-Za-z0-9_-]{12,})_([A-Za-z0-9_-]{32,})$/.exec(token);

  if (!match) {
    return undefined;
  }

  return {
    tokenId: match[1]!,
    signature: match[2]!
  };
}

function hashParticipantAccessToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isParticipantAccessibleRunStatus(status: RunStatus) {
  return [
    "created",
    "consented",
    "survey_in_progress",
    "survey_completed",
    "interview_in_progress",
    "interview_paused"
  ].includes(status);
}

function createParticipantAccessUrl(baseUrl: string, token: string) {
  const url = new URL(`/participant/runs/${encodeURIComponent(token)}`, normalizeBaseUrl(baseUrl));

  return url.toString();
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function getConfiguredParticipantAccessTokenSecret() {
  const secret = process.env.PARTICIPANT_ACCESS_TOKEN_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("PARTICIPANT_ACCESS_TOKEN_SECRET is required in production.");
  }

  return "local-development-participant-access-token-secret";
}

function studyRunStatusPk(studyId: string, status: RunStatus) {
  return `STUDY#${studyId}#RUN_STATUS#${status}`;
}

function participantAccessTokenLookupPk(tokenId: string) {
  return `PARTICIPANT_ACCESS_TOKEN#${tokenId}`;
}

function getRunLifecycleTableName(environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local") {
  return `education-researcher-${environment}-run-lifecycle`;
}

function toRunItem(run: Run): RunItem {
  return {
    entity: "run",
    pk: `RUN#${run.id}`,
    sk: "PROFILE",
    gsi1pk: studyRunStatusPk(run.studyId, run.status),
    gsi1sk: `FRESHNESS#${run.freshnessDeadlineAt}#RUN#${run.id}`,
    gsi2pk: `SLOT#${run.participantSlotId}`,
    gsi2sk: `RUN#${run.createdAt}#${run.id}`,
    id: run.id,
    studyId: run.studyId,
    participantSlotId: run.participantSlotId,
    consentVersionId: run.consentVersionId,
    surveyVersionId: run.surveyVersionId,
    personaVersionId: run.personaVersionId,
    objectiveVersionIds: run.objectiveVersionIds,
    freshnessDeadlineAt: run.freshnessDeadlineAt,
    maxInterviewMinutes: run.maxInterviewMinutes,
    status: run.status,
    currentRunForSlot: run.currentRunForSlot,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function toRun(item: RunItem): Run {
  return {
    id: item.id,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    consentVersionId: item.consentVersionId,
    surveyVersionId: item.surveyVersionId,
    personaVersionId: item.personaVersionId,
    objectiveVersionIds: item.objectiveVersionIds ?? [],
    freshnessDeadlineAt: item.freshnessDeadlineAt,
    maxInterviewMinutes: item.maxInterviewMinutes,
    status: item.status,
    currentRunForSlot: item.currentRunForSlot,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function toParticipantAccessTokenItem(token: ParticipantAccessToken): ParticipantAccessTokenItem {
  return {
    entity: "participant_access_token",
    pk: `RUN#${token.runId}`,
    sk: `PARTICIPANT_ACCESS_TOKEN#${token.createdAt}#${token.id}`,
    gsi1pk: `STUDY#${token.studyId}#PARTICIPANT_ACCESS_TOKEN#${token.status}`,
    gsi1sk: `RUN#${token.runId}#TOKEN#${token.tokenId}`,
    gsi2pk: `SLOT#${token.participantSlotId}`,
    gsi2sk: `TOKEN#${token.createdAt}#${token.tokenId}`,
    gsi3pk: participantAccessTokenLookupPk(token.tokenId),
    gsi3sk: `RUN#${token.runId}`,
    id: token.id,
    tokenId: token.tokenId,
    tokenHash: token.tokenHash,
    studyId: token.studyId,
    participantSlotId: token.participantSlotId,
    runId: token.runId,
    status: token.status,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt
  };
}

function toParticipantAccessToken(item: ParticipantAccessTokenItem): ParticipantAccessToken {
  return {
    id: item.id,
    tokenId: item.tokenId,
    tokenHash: item.tokenHash,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    runId: item.runId,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}
