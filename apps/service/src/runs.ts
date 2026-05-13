import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
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

export interface CreateRunsInput {
  readonly participantSlotIds: unknown;
}

export interface RunStore {
  listByStudy(studyId: string): Promise<Run[]>;
  listByParticipantSlot(participantSlotId: string): Promise<Run[]>;
  create(run: Run, previousCurrentRuns: readonly Run[]): Promise<Run>;
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

export class RunValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "RunValidationError";
  }
}

export interface RunServiceOptions {
  readonly now?: () => Date;
  readonly createRunId?: () => string;
}

export class RunService {
  private readonly now: () => Date;
  private readonly createRunId: () => string;

  constructor(
    private readonly runStore: RunStore,
    private readonly participantSlotStore: Pick<ParticipantSlotStore, "listByStudy">,
    private readonly objectiveVersionStore: Pick<ObjectiveVersionStore, "listByStudy">,
    options: RunServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createRunId = options.createRunId ?? (() => `run_${crypto.randomUUID()}`);
  }

  async listForStudy(studyId: string) {
    return {
      runs: await this.runStore.listByStudy(studyId)
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

    const createdRuns: Run[] = [];

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

      createdRuns.push(await this.runStore.create(run, previousCurrentRuns));
    }

    return {
      createdRuns
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

function studyRunStatusPk(studyId: string, status: RunStatus) {
  return `STUDY#${studyId}#RUN_STATUS#${status}`;
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
