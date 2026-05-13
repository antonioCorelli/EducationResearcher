import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export type ParticipantCodeSource = "researcher_supplied";
export type ParticipantSlotStatus = "active" | "archived";

export interface ParticipantSlot {
  readonly id: string;
  readonly studyId: string;
  readonly participantCode: string;
  readonly codeSource: ParticipantCodeSource;
  readonly status: ParticipantSlotStatus;
  readonly archivedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateParticipantSlotInput {
  readonly participantCode: string;
}

export interface ParticipantSlotStore {
  listByStudy(studyId: string): Promise<ParticipantSlot[]>;
  findByParticipantCode(studyId: string, normalizedParticipantCode: string): Promise<ParticipantSlot | undefined>;
  create(slot: ParticipantSlot, normalizedParticipantCode: string): Promise<ParticipantSlot>;
  archive(studyId: string, participantSlotId: string, archivedAt: string): Promise<ParticipantSlot | undefined>;
}

interface ParticipantSlotItem {
  readonly entity: "participant_slot";
  readonly pk: string;
  readonly sk: string;
  readonly gsi2pk: string;
  readonly gsi2sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantCode: string;
  readonly normalizedParticipantCode: string;
  readonly codeSource: ParticipantCodeSource;
  readonly status: ParticipantSlotStatus;
  readonly archivedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ParticipantSlotValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "ParticipantSlotValidationError";
  }
}

export interface ParticipantSlotServiceOptions {
  readonly now?: () => Date;
  readonly createParticipantSlotId?: () => string;
}

export class ParticipantSlotService {
  private readonly now: () => Date;
  private readonly createParticipantSlotId: () => string;

  constructor(
    private readonly store: ParticipantSlotStore,
    options: ParticipantSlotServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createParticipantSlotId = options.createParticipantSlotId ?? (() => `slot_${crypto.randomUUID()}`);
  }

  async listForStudy(studyId: string) {
    return {
      participantSlots: await this.store.listByStudy(studyId)
    };
  }

  async createParticipantSlot(studyId: string, input: CreateParticipantSlotInput) {
    const participantCode = parseParticipantCode(input.participantCode);
    const normalizedParticipantCode = normalizeParticipantCode(participantCode);
    const existingSlot = await this.store.findByParticipantCode(studyId, normalizedParticipantCode);

    if (existingSlot) {
      throw new ParticipantSlotValidationError("Participant code already exists for this study.");
    }

    const now = this.now().toISOString();
    const slot: ParticipantSlot = {
      id: this.createParticipantSlotId(),
      studyId,
      participantCode,
      codeSource: "researcher_supplied",
      status: "active",
      createdAt: now,
      updatedAt: now
    };

    try {
      return await this.store.create(slot, normalizedParticipantCode);
    } catch (error) {
      if (isDuplicateParticipantCodeError(error)) {
        throw new ParticipantSlotValidationError("Participant code already exists for this study.");
      }

      throw error;
    }
  }

  async archiveParticipantSlot(studyId: string, participantSlotId: string) {
    if (!participantSlotId.trim()) {
      throw new ParticipantSlotValidationError("Participant slot is required.");
    }

    const archivedSlot = await this.store.archive(studyId, participantSlotId, this.now().toISOString());

    if (!archivedSlot) {
      throw new ParticipantSlotValidationError("Participant slot was not found.");
    }

    return archivedSlot;
  }
}

export class InMemoryParticipantSlotStore implements ParticipantSlotStore {
  private readonly slots = new Map<string, ParticipantSlot>();

  constructor(initialSlots: readonly ParticipantSlot[] = []) {
    for (const slot of initialSlots) {
      this.slots.set(slot.id, slot);
    }
  }

  async listByStudy(studyId: string) {
    return [...this.slots.values()]
      .filter((slot) => slot.studyId === studyId)
      .sort((left, right) => left.participantCode.localeCompare(right.participantCode));
  }

  async findByParticipantCode(studyId: string, normalizedParticipantCode: string) {
    return [...this.slots.values()].find(
      (slot) =>
        slot.studyId === studyId && normalizeParticipantCode(slot.participantCode) === normalizedParticipantCode
    );
  }

  async create(slot: ParticipantSlot, normalizedParticipantCode: string) {
    const existingSlot = await this.findByParticipantCode(slot.studyId, normalizedParticipantCode);

    if (existingSlot) {
      throw new DuplicateParticipantCodeError();
    }

    this.slots.set(slot.id, slot);
    return slot;
  }

  async archive(studyId: string, participantSlotId: string, archivedAt: string) {
    const slot = this.slots.get(participantSlotId);

    if (!slot || slot.studyId !== studyId) {
      return undefined;
    }

    const archivedSlot: ParticipantSlot = {
      ...slot,
      status: "archived",
      archivedAt: slot.archivedAt ?? archivedAt,
      updatedAt: archivedAt
    };

    this.slots.set(participantSlotId, archivedSlot);
    return archivedSlot;
  }
}

export interface DynamoDbParticipantSlotStoreOptions {
  readonly tableName?: string;
  readonly environment?: string;
  readonly region?: string;
  readonly endpoint?: string;
}

export class DynamoDbParticipantSlotStore implements ParticipantSlotStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbParticipantSlotStoreOptions = {}) {
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

  async listByStudy(studyId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :study AND begins_with(sk, :slotPrefix)",
        ExpressionAttributeValues: {
          ":study": `STUDY#${studyId}`,
          ":slotPrefix": "SLOT#"
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "participant_slot")
      .map((item) => toParticipantSlot(item as ParticipantSlotItem))
      .sort((left, right) => left.participantCode.localeCompare(right.participantCode));
  }

  async findByParticipantCode(studyId: string, normalizedParticipantCode: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "byParticipantCode",
        KeyConditionExpression: "gsi2pk = :participantCode",
        ExpressionAttributeValues: {
          ":participantCode": participantCodeIndexPk(studyId, normalizedParticipantCode)
        },
        Limit: 1
      })
    );

    const item = response.Items?.find((candidate) => candidate.entity === "participant_slot");
    return item ? toParticipantSlot(item as ParticipantSlotItem) : undefined;
  }

  async create(slot: ParticipantSlot, normalizedParticipantCode: string) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toParticipantSlotItem(slot, normalizedParticipantCode),
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );

    return slot;
  }

  async archive(studyId: string, participantSlotId: string, archivedAt: string) {
    const slot = (await this.listByStudy(studyId)).find((candidate) => candidate.id === participantSlotId);

    if (!slot) {
      return undefined;
    }

    const archivedSlot: ParticipantSlot = {
      ...slot,
      status: "archived",
      archivedAt: slot.archivedAt ?? archivedAt,
      updatedAt: archivedAt
    };

    await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `STUDY#${studyId}`,
          sk: `SLOT#${participantSlotId}`
        },
        UpdateExpression: "SET #status = :status, archivedAt = :archivedAt, updatedAt = :updatedAt, gsi3pk = :gsi3pk",
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": archivedSlot.status,
          ":archivedAt": archivedSlot.archivedAt,
          ":updatedAt": archivedSlot.updatedAt,
          ":gsi3pk": `STUDY#${studyId}#SLOT_STATUS#archived`
        }
      })
    );

    return archivedSlot;
  }
}

export function createConfiguredParticipantSlotStore() {
  const storeMode = process.env.PARTICIPANT_SLOT_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbParticipantSlotStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemoryParticipantSlotStore();
  }

  return new DynamoDbParticipantSlotStore();
}

export function toSafeParticipantSlotValidationResponse(error: unknown) {
  if (error instanceof ParticipantSlotValidationError) {
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

function parseParticipantCode(value: string) {
  if (typeof value !== "string") {
    throw new ParticipantSlotValidationError("Participant code is required.");
  }

  const participantCode = value.trim();

  if (!participantCode) {
    throw new ParticipantSlotValidationError("Participant code is required.");
  }

  if (participantCode.length > 80) {
    throw new ParticipantSlotValidationError("Participant code must be 80 characters or fewer.");
  }

  return participantCode;
}

function normalizeParticipantCode(participantCode: string) {
  return participantCode.trim().toUpperCase();
}

function participantCodeIndexPk(studyId: string, normalizedParticipantCode: string) {
  return `STUDY#${studyId}#PARTICIPANT_CODE#${normalizedParticipantCode}`;
}

function isDuplicateParticipantCodeError(error: unknown) {
  return error instanceof DuplicateParticipantCodeError || (error instanceof Error && error.name === "ConditionalCheckFailedException");
}

class DuplicateParticipantCodeError extends Error {
  constructor() {
    super("Participant code already exists.");
    this.name = "DuplicateParticipantCodeError";
  }
}

function getStudySetupTableName(environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local") {
  return `education-researcher-${environment}-study-setup`;
}

function toParticipantSlotItem(slot: ParticipantSlot, normalizedParticipantCode: string): ParticipantSlotItem {
  return {
    entity: "participant_slot",
    pk: `STUDY#${slot.studyId}`,
    sk: `SLOT#${slot.id}`,
    gsi2pk: participantCodeIndexPk(slot.studyId, normalizedParticipantCode),
    gsi2sk: `SLOT#${slot.id}`,
    gsi3pk: `STUDY#${slot.studyId}#SLOT_STATUS#${slot.status}`,
    gsi3sk: `SLOT#${slot.participantCode}#${slot.id}`,
    id: slot.id,
    studyId: slot.studyId,
    participantCode: slot.participantCode,
    normalizedParticipantCode,
    codeSource: slot.codeSource,
    status: slot.status,
    ...(slot.archivedAt ? { archivedAt: slot.archivedAt } : {}),
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt
  };
}

function toParticipantSlot(item: ParticipantSlotItem): ParticipantSlot {
  return {
    id: item.id,
    studyId: item.studyId,
    participantCode: item.participantCode,
    codeSource: item.codeSource,
    status: item.status,
    ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}
