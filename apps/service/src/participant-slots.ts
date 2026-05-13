import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export type ParticipantCodeSource = "researcher_supplied" | "platform_generated";
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

export interface ImportParticipantSlotsInput {
  readonly csv: unknown;
}

export interface GenerateParticipantSlotsInput {
  readonly count: unknown;
}

export interface ParticipantSlotImportRejectedRow {
  readonly rowNumber: number;
  readonly participantCode?: string;
  readonly reason: "duplicate" | "invalid" | "malformed";
  readonly message: string;
}

export interface ParticipantSlotBulkResult {
  readonly createdParticipantSlots: ParticipantSlot[];
  readonly rejectedRows: ParticipantSlotImportRejectedRow[];
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
  readonly createGeneratedParticipantCode?: () => string;
}

export class ParticipantSlotService {
  private readonly now: () => Date;
  private readonly createParticipantSlotId: () => string;
  private readonly createGeneratedParticipantCode: () => string;

  constructor(
    private readonly store: ParticipantSlotStore,
    options: ParticipantSlotServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createParticipantSlotId = options.createParticipantSlotId ?? (() => `slot_${crypto.randomUUID()}`);
    this.createGeneratedParticipantCode = options.createGeneratedParticipantCode ?? createGeneratedParticipantCode;
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

    try {
      return await this.createValidatedParticipantSlot(studyId, participantCode, "researcher_supplied");
    } catch (error) {
      if (isDuplicateParticipantCodeError(error)) {
        throw new ParticipantSlotValidationError("Participant code already exists for this study.");
      }

      throw error;
    }
  }

  async importParticipantSlots(studyId: string, input: ImportParticipantSlotsInput): Promise<ParticipantSlotBulkResult> {
    const csv = parseCsvInput(input.csv);
    const parsedRows = parseParticipantCodeCsv(csv);
    const createdParticipantSlots: ParticipantSlot[] = [];
    const rejectedRows: ParticipantSlotImportRejectedRow[] = [];
    const seenCodes = new Set<string>();

    for (const row of parsedRows) {
      if ("error" in row) {
        rejectedRows.push(row.error);
        continue;
      }

      const normalizedParticipantCode = normalizeParticipantCode(row.participantCode);

      if (seenCodes.has(normalizedParticipantCode)) {
        rejectedRows.push({
          rowNumber: row.rowNumber,
          participantCode: row.participantCode,
          reason: "duplicate",
          message: "Participant code is duplicated in this import."
        });
        continue;
      }

      seenCodes.add(normalizedParticipantCode);

      const existingSlot = await this.store.findByParticipantCode(studyId, normalizedParticipantCode);

      if (existingSlot) {
        rejectedRows.push({
          rowNumber: row.rowNumber,
          participantCode: row.participantCode,
          reason: "duplicate",
          message: "Participant code already exists for this study."
        });
        continue;
      }

      try {
        const participantSlot = await this.createValidatedParticipantSlot(studyId, row.participantCode, "researcher_supplied");
        createdParticipantSlots.push(participantSlot);
      } catch (error) {
        if (isDuplicateParticipantCodeError(error)) {
          rejectedRows.push({
            rowNumber: row.rowNumber,
            participantCode: row.participantCode,
            reason: "duplicate",
            message: "Participant code already exists for this study."
          });
          continue;
        }

        throw error;
      }
    }

    return {
      createdParticipantSlots,
      rejectedRows
    };
  }

  async generateParticipantSlots(studyId: string, input: GenerateParticipantSlotsInput) {
    const count = parseGeneratedSlotCount(input.count);
    const createdParticipantSlots: ParticipantSlot[] = [];
    const seenCodes = new Set<string>();
    let attempts = 0;
    const maxAttempts = count * 20;

    while (createdParticipantSlots.length < count && attempts < maxAttempts) {
      attempts += 1;
      const participantCode = parseParticipantCode(this.createGeneratedParticipantCode());
      const normalizedParticipantCode = normalizeParticipantCode(participantCode);

      if (seenCodes.has(normalizedParticipantCode)) {
        continue;
      }

      seenCodes.add(normalizedParticipantCode);

      const existingSlot = await this.store.findByParticipantCode(studyId, normalizedParticipantCode);

      if (existingSlot) {
        continue;
      }

      try {
        const participantSlot = await this.createValidatedParticipantSlot(studyId, participantCode, "platform_generated");
        createdParticipantSlots.push(participantSlot);
      } catch (error) {
        if (!isDuplicateParticipantCodeError(error)) {
          throw error;
        }
      }
    }

    if (createdParticipantSlots.length < count) {
      throw new ParticipantSlotValidationError("Unable to generate enough unique participant codes. Try a smaller count.");
    }

    return {
      createdParticipantSlots
    };
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

  private async createValidatedParticipantSlot(
    studyId: string,
    participantCode: string,
    codeSource: ParticipantCodeSource
  ) {
    const normalizedParticipantCode = normalizeParticipantCode(participantCode);
    const now = this.now().toISOString();
    const slot: ParticipantSlot = {
      id: this.createParticipantSlotId(),
      studyId,
      participantCode,
      codeSource,
      status: "active",
      createdAt: now,
      updatedAt: now
    };

    return this.store.create(slot, normalizedParticipantCode);
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

  if ([...participantCode].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new ParticipantSlotValidationError("Participant code contains invalid characters.");
  }

  return participantCode;
}

function parseCsvInput(value: unknown) {
  if (typeof value !== "string") {
    throw new ParticipantSlotValidationError("Participant slot CSV is required.");
  }

  if (!value.trim()) {
    throw new ParticipantSlotValidationError("Participant slot CSV is required.");
  }

  if (value.length > 100_000) {
    throw new ParticipantSlotValidationError("Participant slot CSV is too large.");
  }

  return value;
}

function parseGeneratedSlotCount(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ParticipantSlotValidationError("Generated slot count must be a whole number.");
  }

  if (value < 1 || value > 200) {
    throw new ParticipantSlotValidationError("Generated slot count must be between 1 and 200.");
  }

  return value;
}

type ParsedParticipantCodeCsvRow =
  | { readonly rowNumber: number; readonly participantCode: string }
  | { readonly error: ParticipantSlotImportRejectedRow };

function parseParticipantCodeCsv(csv: string): ParsedParticipantCodeCsvRow[] {
  const parsedRows = parseCsvRows(csv);

  if (parsedRows.length === 0) {
    throw new ParticipantSlotValidationError("Participant slot CSV is required.");
  }

  const firstRow = parsedRows[0];
  const hasHeader =
    firstRow?.cells.length === 1 &&
    ["participantcode", "participant_code"].includes(firstRow.cells[0]?.trim().toLowerCase() ?? "");
  const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;

  if (dataRows.length === 0) {
    throw new ParticipantSlotValidationError("Participant slot CSV must include at least one participant code.");
  }

  return dataRows.map((row) => {
    if (row.malformed) {
      return {
        error: {
          rowNumber: row.rowNumber,
          reason: "malformed",
          message: "CSV row is malformed."
        }
      };
    }

    if (row.cells.length !== 1) {
      return {
        error: {
          rowNumber: row.rowNumber,
          reason: "invalid",
          message: "CSV rows must contain exactly one participant code."
        }
      };
    }

    try {
      return {
        rowNumber: row.rowNumber,
        participantCode: parseParticipantCode(row.cells[0] ?? "")
      };
    } catch (error) {
      return {
        error: {
          rowNumber: row.rowNumber,
          participantCode: row.cells[0]?.trim() || undefined,
          reason: "invalid",
          message: error instanceof ParticipantSlotValidationError ? error.safeMessage : "Participant code is invalid."
        }
      };
    }
  });
}

function parseCsvRows(csv: string) {
  const rows: { rowNumber: number; cells: string[]; malformed?: true }[] = [];
  let cells: string[] = [];
  let cell = "";
  let rowNumber = 1;
  let inQuotes = false;
  let malformed = false;

  const pushRow = () => {
    cells.push(cell);
    if (cells.some((value) => value.trim())) {
      rows.push({ rowNumber, cells, ...(malformed || inQuotes ? { malformed: true } : {}) });
    }
    cells = [];
    cell = "";
    malformed = false;
  };

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const nextChar = csv[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
        continue;
      }

      if (cell.length === 0 && !inQuotes) {
        inQuotes = true;
        continue;
      }

      if (inQuotes) {
        inQuotes = false;
        continue;
      }

      malformed = true;
      cell += char;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      pushRow();
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      rowNumber += 1;
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || cells.length > 0) {
    pushRow();
  }

  return rows;
}

function normalizeParticipantCode(participantCode: string) {
  return participantCode.trim().toUpperCase();
}

function createGeneratedParticipantCode() {
  const randomBytes = new Uint8Array(5);
  crypto.getRandomValues(randomBytes);
  const code = [...randomBytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 8).toUpperCase();
  return `P-${code}`;
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
