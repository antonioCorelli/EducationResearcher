import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { StudyShell, StudyShellStore } from "./study-shell.js";

export type ConsentMethod = "checkmark" | "electronic_signature";

export interface ConsentVersion {
  readonly id: string;
  readonly studyId: string;
  readonly versionNumber: number;
  readonly consentText: string;
  readonly consentMethod: ConsentMethod;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface SaveConsentInput {
  readonly consentText: string;
  readonly consentMethod: ConsentMethod;
}

export interface ConsentVersionStore {
  listByStudy(studyId: string): Promise<ConsentVersion[]>;
  saveActiveVersion(version: ConsentVersion, previousActiveVersion?: ConsentVersion): Promise<ConsentVersion>;
  restoreActiveVersion(studyId: string, versionNumber: number): Promise<ConsentVersion | undefined>;
}

interface ConsentVersionItem {
  readonly entity: "consent_version";
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk?: string;
  readonly gsi1sk?: string;
  readonly id: string;
  readonly studyId: string;
  readonly versionNumber: number;
  readonly consentText: string;
  readonly consentMethod: ConsentMethod;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export class ConsentValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "ConsentValidationError";
  }
}

export interface ConsentServiceOptions {
  readonly now?: () => Date;
  readonly createConsentVersionId?: () => string;
}

export class ConsentService {
  private readonly now: () => Date;
  private readonly createConsentVersionId: () => string;

  constructor(
    private readonly consentVersionStore: ConsentVersionStore,
    private readonly studyShellStore: Pick<StudyShellStore, "update">,
    options: ConsentServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createConsentVersionId = options.createConsentVersionId ?? (() => `consent_version_${crypto.randomUUID()}`);
  }

  async listForStudy(studyId: string) {
    const versions = await this.consentVersionStore.listByStudy(studyId);
    return {
      activeConsentVersion: versions.find((version) => version.isActive),
      consentVersions: versions
    };
  }

  async saveConsent(study: StudyShell, input: SaveConsentInput) {
    const parsedInput = parseConsentInput(input);
    const versions = await this.consentVersionStore.listByStudy(study.id);
    const activeVersion = versions.find((version) => version.isActive);
    const nextVersionNumber = versions.reduce((highest, version) => Math.max(highest, version.versionNumber), 0) + 1;
    const consentVersion: ConsentVersion = {
      id: this.createConsentVersionId(),
      studyId: study.id,
      versionNumber: nextVersionNumber,
      consentText: parsedInput.consentText,
      consentMethod: parsedInput.consentMethod,
      isActive: true,
      createdAt: this.now().toISOString()
    };

    const savedVersion = await this.consentVersionStore.saveActiveVersion(consentVersion, activeVersion);
    await this.studyShellStore.update({
      ...study,
      activeConsentVersionId: savedVersion.id,
      updatedAt: savedVersion.createdAt
    });

    return savedVersion;
  }

  async restoreConsentVersion(study: StudyShell, versionNumber: number) {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new ConsentValidationError("Consent version number is required.");
    }

    const restoredVersion = await this.consentVersionStore.restoreActiveVersion(study.id, versionNumber);

    if (!restoredVersion) {
      throw new ConsentValidationError("Consent version was not found.");
    }

    await this.studyShellStore.update({
      ...study,
      activeConsentVersionId: restoredVersion.id,
      updatedAt: this.now().toISOString()
    });

    return restoredVersion;
  }
}

export class InMemoryConsentVersionStore implements ConsentVersionStore {
  private readonly versions = new Map<string, ConsentVersion>();

  constructor(initialVersions: readonly ConsentVersion[] = []) {
    for (const version of initialVersions) {
      this.versions.set(version.id, version);
    }
  }

  async listByStudy(studyId: string) {
    return [...this.versions.values()]
      .filter((version) => version.studyId === studyId)
      .sort((left, right) => right.versionNumber - left.versionNumber);
  }

  async saveActiveVersion(version: ConsentVersion, previousActiveVersion?: ConsentVersion) {
    if (previousActiveVersion) {
      this.versions.set(previousActiveVersion.id, {
        ...previousActiveVersion,
        isActive: false
      });
    }

    this.versions.set(version.id, version);
    return version;
  }

  async restoreActiveVersion(studyId: string, versionNumber: number) {
    const versions = await this.listByStudy(studyId);
    const selectedVersion = versions.find((version) => version.versionNumber === versionNumber);

    if (!selectedVersion) {
      return undefined;
    }

    for (const version of versions) {
      if (version.versionNumber > versionNumber) {
        this.versions.delete(version.id);
      } else {
        this.versions.set(version.id, {
          ...version,
          isActive: version.versionNumber === versionNumber
        });
      }
    }

    return {
      ...selectedVersion,
      isActive: true
    };
  }
}

export interface DynamoDbConsentVersionStoreOptions {
  readonly tableName?: string;
  readonly environment?: string;
  readonly region?: string;
  readonly endpoint?: string;
}

export class DynamoDbConsentVersionStore implements ConsentVersionStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbConsentVersionStoreOptions = {}) {
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
    this.tableName = options.tableName ?? getVersionedConfigurationTableName(options.environment);
  }

  async listByStudy(studyId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :study",
        ExpressionAttributeValues: {
          ":study": `STUDY#${studyId}`
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "consent_version")
      .map((item) => toConsentVersion(item as ConsentVersionItem))
      .sort((left, right) => right.versionNumber - left.versionNumber);
  }

  async saveActiveVersion(version: ConsentVersion, previousActiveVersion?: ConsentVersion) {
    if (previousActiveVersion) {
      await this.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `STUDY#${previousActiveVersion.studyId}`,
            sk: `CONSENT_VERSION#${previousActiveVersion.versionNumber}`
          },
          UpdateExpression: "SET isActive = :inactive REMOVE gsi1pk, gsi1sk",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: {
            ":inactive": false
          }
        })
      );
    }

    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toConsentVersionItem(version),
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );

    return version;
  }

  async restoreActiveVersion(studyId: string, versionNumber: number) {
    const versions = await this.listByStudy(studyId);
    const selectedVersion = versions.find((version) => version.versionNumber === versionNumber);

    if (!selectedVersion) {
      return undefined;
    }

    for (const version of versions) {
      if (version.versionNumber > versionNumber) {
        await this.documentClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: {
              pk: `STUDY#${version.studyId}`,
              sk: `CONSENT_VERSION#${version.versionNumber}`
            }
          })
        );
      } else {
        await this.documentClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: {
              pk: `STUDY#${version.studyId}`,
              sk: `CONSENT_VERSION#${version.versionNumber}`
            },
            UpdateExpression:
              version.versionNumber === versionNumber
                ? "SET isActive = :active, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk"
                : "SET isActive = :inactive REMOVE gsi1pk, gsi1sk",
            ExpressionAttributeValues:
              version.versionNumber === versionNumber
                ? {
                    ":active": true,
                    ":gsi1pk": `STUDY#${version.studyId}#ACTIVE_CONFIG`,
                    ":gsi1sk": `CONSENT_VERSION#${version.versionNumber}#${version.id}`
                  }
                : {
                    ":inactive": false
                  }
          })
        );
      }
    }

    return {
      ...selectedVersion,
      isActive: true
    };
  }
}

export function createConfiguredConsentVersionStore() {
  const storeMode = process.env.CONSENT_VERSION_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbConsentVersionStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemoryConsentVersionStore();
  }

  return new DynamoDbConsentVersionStore();
}

export function toSafeConsentValidationResponse(error: unknown) {
  if (error instanceof ConsentValidationError) {
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

function parseConsentInput(input: SaveConsentInput): SaveConsentInput {
  const consentText = parseConsentText(input.consentText);
  const consentMethod = parseConsentMethod(input.consentMethod);

  return {
    consentText,
    consentMethod
  };
}

function parseConsentText(value: string) {
  if (typeof value !== "string") {
    throw new ConsentValidationError("Consent text is required.");
  }

  const consentText = value.trim();

  if (!consentText) {
    throw new ConsentValidationError("Consent text is required.");
  }

  if (consentText.length > 12000) {
    throw new ConsentValidationError("Consent text must be 12,000 characters or fewer.");
  }

  return consentText;
}

function parseConsentMethod(value: string): ConsentMethod {
  if (value === "checkmark" || value === "electronic_signature") {
    return value;
  }

  throw new ConsentValidationError("Consent method must be checkmark or electronic signature.");
}

function getVersionedConfigurationTableName(environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local") {
  return `education-researcher-${environment}-versioned-configuration`;
}

function toConsentVersionItem(version: ConsentVersion): ConsentVersionItem {
  return {
    entity: "consent_version",
    pk: `STUDY#${version.studyId}`,
    sk: `CONSENT_VERSION#${version.versionNumber}`,
    gsi1pk: `STUDY#${version.studyId}#ACTIVE_CONFIG`,
    gsi1sk: `CONSENT_VERSION#${version.versionNumber}#${version.id}`,
    id: version.id,
    studyId: version.studyId,
    versionNumber: version.versionNumber,
    consentText: version.consentText,
    consentMethod: version.consentMethod,
    isActive: version.isActive,
    createdAt: version.createdAt
  };
}

function toConsentVersion(item: ConsentVersionItem): ConsentVersion {
  return {
    id: item.id,
    studyId: item.studyId,
    versionNumber: item.versionNumber,
    consentText: item.consentText,
    consentMethod: item.consentMethod,
    isActive: item.isActive,
    createdAt: item.createdAt
  };
}
