import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import type { AuditLogWrite } from "./authorization.js";

export const AUDIO_CONNECTION_STATES = [
  "session_requested",
  "connecting",
  "connected",
  "disconnected",
  "failed",
  "closed"
] as const;

export type AudioConnectionState = (typeof AUDIO_CONNECTION_STATES)[number];

export const TECHNICAL_FAILURE_CATEGORIES = [
  "microphone_unavailable",
  "voice_provider_unavailable",
  "disconnect",
  "transcription_unavailable",
  "model_api_unavailable",
  "unknown"
] as const;

export type TechnicalFailureCategory = (typeof TECHNICAL_FAILURE_CATEGORIES)[number];

export interface OperationalEvent {
  readonly id: string;
  readonly studyId: string;
  readonly runId: string;
  readonly participantSlotId: string;
  readonly eventType: "realtime_session_created" | "audio_connection_state_changed" | "technical_failure";
  readonly serviceRequestId: string;
  readonly audioConnectionState?: AudioConnectionState;
  readonly technicalFailureCategory?: TechnicalFailureCategory;
  readonly provider?: "fake" | "openai";
  readonly modelName?: string;
  readonly latencyMs?: number;
  readonly retryCount?: number;
  readonly createdAt: string;
}

export interface OperationalEventStore {
  record(event: OperationalEvent): Promise<OperationalEvent>;
}

export interface AuditLogStore {
  writeAuditLog(entry: AuditLogWrite): Promise<void>;
}

export interface OperationalEventServiceOptions {
  readonly now?: () => Date;
  readonly createOperationalEventId?: () => string;
}

export class OperationalEventService {
  private readonly now: () => Date;
  private readonly createOperationalEventId: () => string;

  constructor(
    private readonly store: OperationalEventStore,
    options: OperationalEventServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createOperationalEventId = options.createOperationalEventId ?? (() => `operational_event_${randomUUID()}`);
  }

  async recordRealtimeSessionCreated(input: {
    readonly studyId: string;
    readonly runId: string;
    readonly participantSlotId: string;
    readonly serviceRequestId: string;
    readonly provider: "fake" | "openai";
    readonly modelName: string;
  }) {
    return this.store.record({
      id: this.createOperationalEventId(),
      studyId: input.studyId,
      runId: input.runId,
      participantSlotId: input.participantSlotId,
      eventType: "realtime_session_created",
      serviceRequestId: input.serviceRequestId,
      audioConnectionState: "session_requested",
      provider: input.provider,
      modelName: input.modelName,
      createdAt: this.now().toISOString()
    });
  }

  async recordAudioConnectionState(input: {
    readonly studyId: string;
    readonly runId: string;
    readonly participantSlotId: string;
    readonly serviceRequestId: string;
    readonly audioConnectionState: AudioConnectionState;
    readonly retryCount?: number;
    readonly latencyMs?: number;
  }) {
    return this.store.record({
      id: this.createOperationalEventId(),
      studyId: input.studyId,
      runId: input.runId,
      participantSlotId: input.participantSlotId,
      eventType: "audio_connection_state_changed",
      serviceRequestId: input.serviceRequestId,
      audioConnectionState: input.audioConnectionState,
      ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
      ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
      createdAt: this.now().toISOString()
    });
  }

  async recordTechnicalFailure(input: {
    readonly studyId: string;
    readonly runId: string;
    readonly participantSlotId: string;
    readonly serviceRequestId: string;
    readonly technicalFailureCategory: TechnicalFailureCategory;
    readonly audioConnectionState: AudioConnectionState;
    readonly retryCount: number;
    readonly latencyMs?: number;
  }) {
    return this.store.record({
      id: this.createOperationalEventId(),
      studyId: input.studyId,
      runId: input.runId,
      participantSlotId: input.participantSlotId,
      eventType: "technical_failure",
      serviceRequestId: input.serviceRequestId,
      technicalFailureCategory: input.technicalFailureCategory,
      audioConnectionState: input.audioConnectionState,
      ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
      ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
      createdAt: this.now().toISOString()
    });
  }
}

export class InMemoryOperationalEventStore implements OperationalEventStore, AuditLogStore {
  private readonly events: OperationalEvent[] = [];
  private readonly auditLogs: AuditLogWrite[] = [];

  constructor(initialEvents: readonly OperationalEvent[] = []) {
    this.events = [...initialEvents];
  }

  async record(event: OperationalEvent) {
    this.events.push(event);
    return event;
  }

  async listByRun(runId: string) {
    return this.events
      .filter((event) => event.runId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async writeAuditLog(entry: AuditLogWrite) {
    this.auditLogs.push(entry);
  }

  async listAuditLogsByStudy(studyId: string) {
    return this.auditLogs
      .filter((entry) => entry.studyId === studyId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
}

interface OperationalEventItem extends OperationalEvent {
  readonly entity: "operational_event";
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk: string;
  readonly gsi1sk: string;
}

interface AuditLogItem extends AuditLogWrite {
  readonly entity: "audit_log";
  readonly pk: string;
  readonly sk: string;
  readonly gsi2pk: string;
  readonly gsi2sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
}

export class DynamoDbOperationalEventStore implements OperationalEventStore, AuditLogStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: { readonly tableName?: string; readonly region?: string; readonly endpoint?: string } = {}) {
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
    this.tableName = options.tableName ?? getOperationsTableName();
  }

  async record(event: OperationalEvent) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toOperationalEventItem(event),
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
      })
    );

    return event;
  }

  async writeAuditLog(entry: AuditLogWrite) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toAuditLogItem(entry),
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
      })
    );
  }
}

export function createConfiguredOperationalEventStore() {
  const storeMode = process.env.OPERATIONS_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbOperationalEventStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemoryOperationalEventStore();
  }

  return new DynamoDbOperationalEventStore();
}

export function parseAudioConnectionState(value: unknown): AudioConnectionState {
  if (AUDIO_CONNECTION_STATES.some((state) => state === value)) {
    return value as AudioConnectionState;
  }

  throw {
    statusCode: 400,
    body: {
      error: "Bad Request",
      message: "Audio connection state is invalid."
    }
  };
}

export function parseTechnicalFailureCategory(value: unknown): TechnicalFailureCategory {
  if (TECHNICAL_FAILURE_CATEGORIES.some((category) => category === value)) {
    return value as TechnicalFailureCategory;
  }

  throw {
    statusCode: 400,
    body: {
      error: "Bad Request",
      message: "Technical failure category is invalid."
    }
  };
}

function toOperationalEventItem(event: OperationalEvent): OperationalEventItem {
  return {
    entity: "operational_event",
    pk: `RUN#${event.runId}`,
    sk: `OPERATIONAL_EVENT#${event.createdAt}#${event.id}`,
    gsi1pk: `RUN#${event.runId}#OPERATIONAL_EVENT`,
    gsi1sk: `OPERATIONAL_EVENT#${event.createdAt}#${event.id}`,
    ...event
  };
}

function toAuditLogItem(entry: AuditLogWrite): AuditLogItem {
  return {
    entity: "audit_log",
    pk: `STUDY#${entry.studyId}`,
    sk: `AUDIT#${entry.createdAt}#${entry.id}`,
    gsi2pk: `STUDY#${entry.studyId}`,
    gsi2sk: `AUDIT#${entry.createdAt}#${entry.id}`,
    gsi3pk: `ACTOR#${entry.actorUserId}`,
    gsi3sk: `AUDIT#${entry.createdAt}#${entry.id}`,
    ...entry
  };
}

function getOperationsTableName(environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local") {
  return `education-researcher-${environment}-operations`;
}
