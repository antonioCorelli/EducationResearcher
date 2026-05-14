import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ConsentMethod, ConsentVersion, ConsentVersionStore } from "./consent.js";
import type { ObjectiveVersionStore } from "./objectives.js";
import type { ParticipantSlotStore } from "./participant-slots.js";
import type { StudyShell } from "./study-shell.js";
import type { SurveyQuestion, SurveyVersion, SurveyVersionStore } from "./survey.js";

export const RUN_STATUSES = [
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
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_TRANSITIONS = {
  created: ["consented"],
  consented: ["survey_in_progress"],
  survey_in_progress: ["survey_completed", "stale"],
  survey_completed: ["interview_in_progress", "stale", "partial"],
  interview_in_progress: ["interview_completed", "interview_paused", "stale", "technical_interruption"],
  interview_paused: ["interview_in_progress", "stale", "partial"],
  interview_completed: ["scored"],
  stale: ["scored"],
  partial: ["scored"],
  technical_interruption: ["scored", "partial"],
  scored: []
} as const satisfies Record<RunStatus, readonly RunStatus[]>;

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
  readonly consentVersion?: ConsentVersion;
  readonly surveyVersion?: SurveyVersion;
}

export interface CreateRunsInput {
  readonly participantSlotIds: unknown;
}

export interface CaptureParticipantConsentInput {
  readonly accepted?: unknown;
  readonly signatureText?: unknown;
}

export interface SubmitParticipantSurveyInput {
  readonly responses?: unknown;
}

export interface ConsentRecord {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly consentVersionId: string;
  readonly consentMethod: ConsentMethod;
  readonly signatureText?: string;
  readonly renderedConsentSnapshot: string;
  readonly acceptedAt: string;
  readonly createdAt: string;
}

export interface SurveyResponse {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly surveyVersionId: string;
  readonly surveyQuestionId: string;
  readonly responseText: string;
  readonly submittedAt: string;
  readonly createdAt: string;
}

export interface RunStore {
  getById(runId: string): Promise<Run | undefined>;
  listByStudy(studyId: string): Promise<Run[]>;
  listByParticipantSlot(participantSlotId: string): Promise<Run[]>;
  listConsentRecordsByRun(runId: string): Promise<ConsentRecord[]>;
  listSurveyResponsesByRun(runId: string): Promise<SurveyResponse[]>;
  create(run: Run, previousCurrentRuns: readonly Run[]): Promise<Run>;
  updateStatus(run: Run, previousStatus: RunStatus): Promise<Run>;
  captureConsent(record: ConsentRecord, run: Run, previousStatus: RunStatus): Promise<{
    consentRecord: ConsentRecord;
    run: Run;
  }>;
  submitSurvey(responses: readonly SurveyResponse[], run: Run, previousStatus: RunStatus): Promise<{
    surveyResponses: readonly SurveyResponse[];
    run: Run;
  }>;
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

interface ConsentRecordItem {
  readonly entity: "consent_record";
  readonly pk: string;
  readonly sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly consentVersionId: string;
  readonly consentMethod: ConsentMethod;
  readonly signatureText?: string;
  readonly renderedConsentSnapshot: string;
  readonly acceptedAt: string;
  readonly createdAt: string;
}

interface SurveyResponseItem {
  readonly entity: "survey_response";
  readonly pk: string;
  readonly sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly surveyVersionId: string;
  readonly surveyQuestionId: string;
  readonly responseText: string;
  readonly submittedAt: string;
  readonly createdAt: string;
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
  readonly createConsentRecordId?: () => string;
  readonly createSurveyResponseId?: () => string;
  readonly createParticipantAccessTokenId?: () => string;
  readonly participantAccessBaseUrl?: string;
  readonly participantAccessTokenSecret?: string;
}

export class RunService {
  private readonly now: () => Date;
  private readonly createRunId: () => string;
  private readonly createConsentRecordId: () => string;
  private readonly createSurveyResponseId: () => string;
  private readonly createParticipantAccessTokenId: () => string;
  private readonly participantAccessBaseUrl: string;
  private readonly participantAccessTokenSecret: string;

  constructor(
    private readonly runStore: RunStore,
    private readonly participantAccessTokenStore: ParticipantAccessTokenStore,
    private readonly participantSlotStore: Pick<ParticipantSlotStore, "listByStudy">,
    private readonly objectiveVersionStore: Pick<ObjectiveVersionStore, "listByStudy">,
    private readonly consentVersionStore: Pick<ConsentVersionStore, "listByStudy">,
    private readonly surveyVersionStore: Pick<SurveyVersionStore, "listByStudy">,
    options: RunServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createRunId = options.createRunId ?? (() => `run_${randomUUID()}`);
    this.createConsentRecordId = options.createConsentRecordId ?? (() => `consent_record_${randomUUID()}`);
    this.createSurveyResponseId = options.createSurveyResponseId ?? (() => `survey_response_${randomUUID()}`);
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
    const run = await this.resolveParticipantRun(rawToken);
    const consentVersion = run.status === "created" ? await this.getRunConsentVersion(run) : undefined;
    const surveyVersion = isParticipantSurveyRenderableRunStatus(run.status)
      ? await this.getRunSurveyVersion(run)
      : undefined;

    return {
      run: {
        id: run.id,
        studyId: run.studyId,
        participantSlotId: run.participantSlotId,
        status: run.status,
        freshnessDeadlineAt: run.freshnessDeadlineAt,
        maxInterviewMinutes: run.maxInterviewMinutes
      },
      ...(consentVersion ? { consentVersion } : {}),
      ...(surveyVersion ? { surveyVersion } : {})
    };
  }

  async captureParticipantConsent(rawToken: string, input: CaptureParticipantConsentInput) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status !== "created") {
      throw new ParticipantAccessError("Consent cannot be submitted for this run.");
    }

    const consentVersion = await this.getRunConsentVersion(run);
    const acceptedAt = this.now().toISOString();
    const record: ConsentRecord = {
      id: this.createConsentRecordId(),
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      consentVersionId: consentVersion.id,
      consentMethod: consentVersion.consentMethod,
      ...parseConsentAcceptance(consentVersion.consentMethod, input),
      renderedConsentSnapshot: consentVersion.consentText,
      acceptedAt,
      createdAt: acceptedAt
    };
    const consentedRun = applyRunStatusTransition(run, "consented", this.now());

    return this.runStore.captureConsent(record, consentedRun, run.status);
  }

  async submitParticipantSurvey(rawToken: string, input: SubmitParticipantSurveyInput) {
    const run = await this.resolveParticipantRun(rawToken);

    if (!isParticipantSurveySubmittableRunStatus(run.status)) {
      throw new ParticipantAccessError("Survey cannot be submitted for this run.");
    }

    const existingResponses = await this.runStore.listSurveyResponsesByRun(run.id);

    if (existingResponses.length > 0) {
      throw new ParticipantAccessError("Survey has already been submitted for this run.");
    }

    const surveyVersion = await this.getRunSurveyVersion(run);
    const submittedAt = this.now().toISOString();
    const surveyResponses = parseSurveyResponses(input, surveyVersion).map((response) => ({
      id: this.createSurveyResponseId(),
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      surveyVersionId: run.surveyVersionId,
      surveyQuestionId: response.surveyQuestionId,
      responseText: response.responseText,
      submittedAt,
      createdAt: submittedAt
    }));
    const startedRun =
      run.status === "consented" ? applyRunStatusTransition(run, "survey_in_progress", this.now()) : run;
    const submittedRun = applyRunStatusTransition(startedRun, "survey_completed", this.now());

    return this.runStore.submitSurvey(surveyResponses, submittedRun, run.status);
  }

  async transitionRunStatus(runId: string, status: RunStatus) {
    const run = await this.runStore.getById(runId);

    if (!run) {
      throw new RunValidationError("Run was not found.");
    }

    const transitionedRun = applyRunStatusTransition(run, status, this.now());

    if (transitionedRun === run) {
      return run;
    }

    return this.runStore.updateStatus(transitionedRun, run.status);
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

  private async resolveParticipantRun(rawToken: string) {
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

    return run;
  }

  private async getRunConsentVersion(run: Run) {
    const consentVersion = (await this.consentVersionStore.listByStudy(run.studyId)).find(
      (version) => version.id === run.consentVersionId
    );

    if (!consentVersion) {
      throw new ParticipantAccessError();
    }

    return consentVersion;
  }

  private async getRunSurveyVersion(run: Run) {
    const surveyVersion = (await this.surveyVersionStore.listByStudy(run.studyId)).find(
      (version) => version.id === run.surveyVersionId
    );

    if (!surveyVersion) {
      throw new ParticipantAccessError();
    }

    return surveyVersion;
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

  async listConsentRecordsByRun(runId: string) {
    return [...this.runs.values()]
      .filter((run) => run.id === runId)
      .flatMap(() => [...this.consentRecords.values()].filter((record) => record.runId === runId))
      .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt));
  }

  async listSurveyResponsesByRun(runId: string) {
    return [...this.surveyResponses.values()]
      .filter((response) => response.runId === runId)
      .sort((left, right) => left.surveyQuestionId.localeCompare(right.surveyQuestionId));
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

  async updateStatus(run: Run, previousStatus: RunStatus) {
    const currentRun = this.runs.get(run.id);

    if (!currentRun) {
      throw new RunValidationError("Run was not found.");
    }

    if (currentRun.status !== previousStatus) {
      throw new RunValidationError(`Run cannot transition from ${currentRun.status} to ${run.status}.`);
    }

    this.runs.set(run.id, run);
    return run;
  }

  private readonly consentRecords = new Map<string, ConsentRecord>();
  private readonly surveyResponses = new Map<string, SurveyResponse>();

  async captureConsent(record: ConsentRecord, run: Run, previousStatus: RunStatus) {
    const currentRun = this.runs.get(run.id);

    if (!currentRun) {
      throw new RunValidationError("Run was not found.");
    }

    if (currentRun.status !== previousStatus) {
      throw new RunValidationError(`Run cannot transition from ${currentRun.status} to ${run.status}.`);
    }

    this.consentRecords.set(record.id, record);
    this.runs.set(run.id, run);

    return {
      consentRecord: record,
      run
    };
  }

  async submitSurvey(responses: readonly SurveyResponse[], run: Run, previousStatus: RunStatus) {
    const currentRun = this.runs.get(run.id);

    if (!currentRun) {
      throw new RunValidationError("Run was not found.");
    }

    if (currentRun.status !== previousStatus) {
      throw new RunValidationError(`Run cannot transition from ${currentRun.status} to ${run.status}.`);
    }

    if ((await this.listSurveyResponsesByRun(run.id)).length > 0) {
      throw new RunValidationError("Survey has already been submitted for this run.");
    }

    for (const response of responses) {
      this.surveyResponses.set(response.id, response);
    }

    this.runs.set(run.id, run);

    return {
      surveyResponses: responses,
      run
    };
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
    const resultSets = await Promise.all(
      RUN_STATUSES.map((status) =>
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

  async listConsentRecordsByRun(runId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :run AND begins_with(sk, :recordPrefix)",
        ExpressionAttributeValues: {
          ":run": `RUN#${runId}`,
          ":recordPrefix": "CONSENT_RECORD#"
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "consent_record")
      .map((item) => toConsentRecord(item as ConsentRecordItem))
      .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt));
  }

  async listSurveyResponsesByRun(runId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :run AND begins_with(sk, :responsePrefix)",
        ExpressionAttributeValues: {
          ":run": `RUN#${runId}`,
          ":responsePrefix": "SURVEY_RESPONSE#"
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "survey_response")
      .map((item) => toSurveyResponse(item as SurveyResponseItem))
      .sort((left, right) => left.surveyQuestionId.localeCompare(right.surveyQuestionId));
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

  async updateStatus(run: Run, previousStatus: RunStatus) {
    const response = await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `RUN#${run.id}`,
          sk: "PROFILE"
        },
        UpdateExpression:
          "SET #status = :status, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
        ConditionExpression: "attribute_exists(pk) AND #status = :previousStatus",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": run.status,
          ":previousStatus": previousStatus,
          ":updatedAt": run.updatedAt,
          ":gsi1pk": studyRunStatusPk(run.studyId, run.status),
          ":gsi1sk": studyRunStatusSk(run)
        },
        ReturnValues: "ALL_NEW"
      })
    );

    return toRun(response.Attributes as RunItem);
  }

  async captureConsent(record: ConsentRecord, run: Run, previousStatus: RunStatus) {
    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: toConsentRecordItem(record),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          },
          {
            Update: {
              TableName: this.tableName,
              Key: {
                pk: `RUN#${run.id}`,
                sk: "PROFILE"
              },
              UpdateExpression:
                "SET #status = :status, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
              ConditionExpression: "attribute_exists(pk) AND #status = :previousStatus",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":status": run.status,
                ":previousStatus": previousStatus,
                ":updatedAt": run.updatedAt,
                ":gsi1pk": studyRunStatusPk(run.studyId, run.status),
                ":gsi1sk": studyRunStatusSk(run)
              }
            }
          }
        ]
      })
    );

    return {
      consentRecord: record,
      run
    };
  }

  async submitSurvey(responses: readonly SurveyResponse[], run: Run, previousStatus: RunStatus) {
    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          ...responses.map((response) => ({
            Put: {
              TableName: this.tableName,
              Item: toSurveyResponseItem(response),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          })),
          {
            Update: {
              TableName: this.tableName,
              Key: {
                pk: `RUN#${run.id}`,
                sk: "PROFILE"
              },
              UpdateExpression:
                "SET #status = :status, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
              ConditionExpression: "attribute_exists(pk) AND #status = :previousStatus",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":status": run.status,
                ":previousStatus": previousStatus,
                ":updatedAt": run.updatedAt,
                ":gsi1pk": studyRunStatusPk(run.studyId, run.status),
                ":gsi1sk": studyRunStatusSk(run)
              }
            }
          }
        ]
      })
    );

    return {
      surveyResponses: responses,
      run
    };
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

export function isRunStatusTransitionAllowed(from: RunStatus, to: RunStatus) {
  const allowedStatuses: readonly RunStatus[] = RUN_STATUS_TRANSITIONS[from];

  return from === to || allowedStatuses.includes(to);
}

export function applyRunStatusTransition(run: Run, status: RunStatus, now: Date): Run {
  if (run.status === status) {
    return run;
  }

  if (!isRunStatusTransitionAllowed(run.status, status)) {
    throw new RunValidationError(`Run cannot transition from ${run.status} to ${status}.`);
  }

  return {
    ...run,
    status,
    updatedAt: now.toISOString()
  };
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
  const match = /^pat_([A-Za-z0-9_-]{12,})_([A-Za-z0-9_-]{43})$/.exec(token);

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

function isParticipantSurveyRenderableRunStatus(status: RunStatus) {
  return status === "consented" || status === "survey_in_progress";
}

function isParticipantSurveySubmittableRunStatus(status: RunStatus) {
  return status === "consented" || status === "survey_in_progress";
}

function parseConsentAcceptance(method: ConsentMethod, input: CaptureParticipantConsentInput) {
  if (method === "checkmark") {
    if (input.accepted !== true) {
      throw new RunValidationError("Consent must be accepted before continuing.");
    }

    return {};
  }

  return {
    signatureText: parseSignatureText(input.signatureText)
  };
}

function parseSignatureText(value: unknown) {
  if (typeof value !== "string") {
    throw new RunValidationError("Signature text is required.");
  }

  const signatureText = value.trim();

  if (!signatureText) {
    throw new RunValidationError("Signature text is required.");
  }

  if (signatureText.length > 200) {
    throw new RunValidationError("Signature text must be 200 characters or fewer.");
  }

  return signatureText;
}

function parseSurveyResponses(input: SubmitParticipantSurveyInput, surveyVersion: SurveyVersion) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RunValidationError("Survey responses are required.");
  }

  if (!Array.isArray(input.responses)) {
    throw new RunValidationError("Survey responses must be a list.");
  }

  const questions = getSurveyQuestions(surveyVersion);
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const responseByQuestionId = new Map<string, { surveyQuestionId: string; responseText: string }>();

  for (const [index, response] of input.responses.entries()) {
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new RunValidationError(`Survey response ${index + 1} is invalid.`);
    }

    const record = response as Record<string, unknown>;

    if (typeof record.surveyQuestionId !== "string" || !questionsById.has(record.surveyQuestionId)) {
      throw new RunValidationError("Survey response references an unknown question.");
    }

    if (responseByQuestionId.has(record.surveyQuestionId)) {
      throw new RunValidationError("Each survey question can only be answered once.");
    }

    responseByQuestionId.set(record.surveyQuestionId, {
      surveyQuestionId: record.surveyQuestionId,
      responseText: parseSurveyResponseText(record.responseText, questionsById.get(record.surveyQuestionId)!)
    });
  }

  const missingQuestion = questions.find((question) => !responseByQuestionId.has(question.id));

  if (missingQuestion) {
    throw new RunValidationError("All required survey questions must be answered.");
  }

  if (responseByQuestionId.size !== questions.length) {
    throw new RunValidationError("Survey responses do not match the run survey version.");
  }

  return questions.map((question) => responseByQuestionId.get(question.id)!);
}

function parseSurveyResponseText(value: unknown, question: SurveyQuestion) {
  if (typeof value !== "string") {
    throw new RunValidationError("All required survey questions must be answered.");
  }

  const responseText = value.trim();

  if (!responseText) {
    throw new RunValidationError("All required survey questions must be answered.");
  }

  if (responseText.length > 20000) {
    throw new RunValidationError(`Response to "${question.prompt}" must be 20,000 characters or fewer.`);
  }

  return responseText;
}

function getSurveyQuestions(surveyVersion: SurveyVersion) {
  return surveyVersion.layoutItems.flatMap((item) => {
    if (item.type === "question") {
      return [item.question];
    }

    return item.group.questions;
  });
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
    gsi1sk: studyRunStatusSk(run),
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

function studyRunStatusSk(run: Run) {
  return `FRESHNESS#${run.freshnessDeadlineAt}#RUN#${run.id}`;
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

function toConsentRecordItem(record: ConsentRecord): ConsentRecordItem {
  return {
    entity: "consent_record",
    pk: `RUN#${record.runId}`,
    sk: `CONSENT_RECORD#${record.id}`,
    gsi3pk: `RUN#${record.runId}#ARTIFACT#consent_record`,
    gsi3sk: `CONSENT_RECORD#${record.acceptedAt}#${record.id}`,
    id: record.id,
    studyId: record.studyId,
    participantSlotId: record.participantSlotId,
    runId: record.runId,
    consentVersionId: record.consentVersionId,
    consentMethod: record.consentMethod,
    ...(record.signatureText ? { signatureText: record.signatureText } : {}),
    renderedConsentSnapshot: record.renderedConsentSnapshot,
    acceptedAt: record.acceptedAt,
    createdAt: record.createdAt
  };
}

function toConsentRecord(item: ConsentRecordItem): ConsentRecord {
  return {
    id: item.id,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    runId: item.runId,
    consentVersionId: item.consentVersionId,
    consentMethod: item.consentMethod,
    ...(item.signatureText ? { signatureText: item.signatureText } : {}),
    renderedConsentSnapshot: item.renderedConsentSnapshot,
    acceptedAt: item.acceptedAt,
    createdAt: item.createdAt
  };
}

function toSurveyResponseItem(response: SurveyResponse): SurveyResponseItem {
  return {
    entity: "survey_response",
    pk: `RUN#${response.runId}`,
    sk: `SURVEY_RESPONSE#${response.surveyQuestionId}`,
    gsi3pk: `RUN#${response.runId}#ARTIFACT#survey_response`,
    gsi3sk: `QUESTION#${response.surveyQuestionId}#${response.id}`,
    id: response.id,
    studyId: response.studyId,
    participantSlotId: response.participantSlotId,
    runId: response.runId,
    surveyVersionId: response.surveyVersionId,
    surveyQuestionId: response.surveyQuestionId,
    responseText: response.responseText,
    submittedAt: response.submittedAt,
    createdAt: response.createdAt
  };
}

function toSurveyResponse(item: SurveyResponseItem): SurveyResponse {
  return {
    id: item.id,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    runId: item.runId,
    surveyVersionId: item.surveyVersionId,
    surveyQuestionId: item.surveyQuestionId,
    responseText: item.responseText,
    submittedAt: item.submittedAt,
    createdAt: item.createdAt
  };
}
