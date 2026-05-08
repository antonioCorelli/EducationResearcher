import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export interface ObjectiveGradeExample {
  readonly id: string;
  readonly objectiveVersionId: string;
  readonly gradeLabel: string;
  readonly exampleText: string;
  readonly sortOrder: number;
  readonly createdAt: string;
}

export interface ObjectiveVersion {
  readonly id: string;
  readonly studyId: string;
  readonly objectiveKey: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly description: string;
  readonly customScoringPrompt?: string;
  readonly gradeScale: readonly string[];
  readonly gradeExamples: readonly ObjectiveGradeExample[];
  readonly evidenceRequirements: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface SaveObjectiveGradeExampleInput {
  readonly gradeLabel: string;
  readonly exampleText: string;
}

export interface SaveObjectiveInput {
  readonly objectiveKey?: string;
  readonly title: string;
  readonly description: string;
  readonly customScoringPrompt?: string;
  readonly gradeLabels: readonly string[];
  readonly gradeExamples?: readonly SaveObjectiveGradeExampleInput[];
  readonly evidenceRequirements: string;
}

export interface SaveObjectivesInput {
  readonly objectives: readonly SaveObjectiveInput[];
}

export interface ObjectiveVersionStore {
  listByStudy(studyId: string): Promise<ObjectiveVersion[]>;
  saveActiveVersions(
    versions: readonly ObjectiveVersion[],
    previousActiveVersions: readonly ObjectiveVersion[]
  ): Promise<readonly ObjectiveVersion[]>;
  restoreActiveVersion(
    studyId: string,
    objectiveKey: string,
    versionNumber: number
  ): Promise<ObjectiveVersion | undefined>;
}

interface ObjectiveVersionItem {
  readonly entity: "objective_version";
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk?: string;
  readonly gsi1sk?: string;
  readonly gsi2pk: string;
  readonly gsi2sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly objectiveKey: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly description: string;
  readonly customScoringPrompt?: string;
  readonly gradeScale: readonly string[];
  readonly evidenceRequirements: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly createdAt: string;
}

interface ObjectiveGradeExampleItem {
  readonly entity: "objective_grade_example";
  readonly pk: string;
  readonly sk: string;
  readonly id: string;
  readonly objectiveVersionId: string;
  readonly gradeLabel: string;
  readonly exampleText: string;
  readonly sortOrder: number;
  readonly createdAt: string;
}

interface ParsedObjectiveInput {
  readonly objectiveKey?: string;
  readonly title: string;
  readonly description: string;
  readonly customScoringPrompt?: string;
  readonly gradeScale: readonly string[];
  readonly gradeExamples: readonly {
    readonly gradeLabel: string;
    readonly exampleText: string;
  }[];
  readonly evidenceRequirements: string;
}

export class ObjectiveValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "ObjectiveValidationError";
  }
}

export interface ObjectiveServiceOptions {
  readonly now?: () => Date;
  readonly createObjectiveVersionId?: () => string;
  readonly createObjectiveKey?: () => string;
  readonly createObjectiveGradeExampleId?: () => string;
}

export class ObjectiveService {
  private readonly now: () => Date;
  private readonly createObjectiveVersionId: () => string;
  private readonly createObjectiveKey: () => string;
  private readonly createObjectiveGradeExampleId: () => string;

  constructor(
    private readonly objectiveVersionStore: ObjectiveVersionStore,
    options: ObjectiveServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createObjectiveVersionId =
      options.createObjectiveVersionId ?? (() => `objective_version_${crypto.randomUUID()}`);
    this.createObjectiveKey = options.createObjectiveKey ?? (() => `objective_${crypto.randomUUID()}`);
    this.createObjectiveGradeExampleId =
      options.createObjectiveGradeExampleId ?? (() => `objective_grade_example_${crypto.randomUUID()}`);
  }

  async listForStudy(studyId: string) {
    const versions = await this.objectiveVersionStore.listByStudy(studyId);

    return {
      activeObjectiveVersions: versions
        .filter((version) => version.isActive)
        .sort((left, right) => left.sortOrder - right.sortOrder),
      objectiveVersions: versions
    };
  }

  async saveObjectives(studyId: string, input: SaveObjectivesInput) {
    const parsedObjectives = parseObjectivesInput(input);
    const existingVersions = await this.objectiveVersionStore.listByStudy(studyId);
    const activeVersions = existingVersions.filter((version) => version.isActive);

    if (activeVersions.length > 0 && objectiveInputsMatchActiveVersions(parsedObjectives, activeVersions)) {
      throw new ObjectiveValidationError("Scoring objectives are unchanged from the active versions.");
    }

    const existingKeys = new Set(existingVersions.map((version) => version.objectiveKey));
    const seenKeys = new Set<string>();
    const createdAt = this.now().toISOString();
    const objectiveVersions = parsedObjectives.map((objective, objectiveIndex): ObjectiveVersion => {
      const objectiveKey = objective.objectiveKey ?? this.createObjectiveKey();

      if (seenKeys.has(objectiveKey)) {
        throw new ObjectiveValidationError("Each objective can only appear once in the active set.");
      }

      if (objective.objectiveKey && !existingKeys.has(objective.objectiveKey)) {
        throw new ObjectiveValidationError("Objective key was not found for this study.");
      }

      seenKeys.add(objectiveKey);

      const activeVersion = activeVersions.find((version) => version.objectiveKey === objectiveKey);

      if (activeVersion && objectiveInputMatchesVersion(objective, activeVersion, objectiveIndex + 1)) {
        return activeVersion;
      }

      const priorVersions = existingVersions.filter((version) => version.objectiveKey === objectiveKey);
      const versionNumber = priorVersions.reduce((highest, version) => Math.max(highest, version.versionNumber), 0) + 1;
      const objectiveVersionId = this.createObjectiveVersionId();

      return {
        id: objectiveVersionId,
        studyId,
        objectiveKey,
        versionNumber,
        title: objective.title,
        description: objective.description,
        ...(objective.customScoringPrompt ? { customScoringPrompt: objective.customScoringPrompt } : {}),
        gradeScale: objective.gradeScale,
        gradeExamples: objective.gradeExamples.map((example, exampleIndex) => ({
          id: this.createObjectiveGradeExampleId(),
          objectiveVersionId,
          gradeLabel: example.gradeLabel,
          exampleText: example.exampleText,
          sortOrder: exampleIndex + 1,
          createdAt
        })),
        evidenceRequirements: objective.evidenceRequirements,
        sortOrder: objectiveIndex + 1,
        isActive: true,
        createdAt
      };
    });

    return this.objectiveVersionStore.saveActiveVersions(objectiveVersions, activeVersions);
  }

  async restoreObjectiveVersion(studyId: string, objectiveKey: string, versionNumber: number) {
    if (typeof objectiveKey !== "string" || !/^[A-Za-z0-9_-]{3,120}$/.test(objectiveKey)) {
      throw new ObjectiveValidationError("Objective key is required.");
    }

    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new ObjectiveValidationError("Objective version number is required.");
    }

    const restoredVersion = await this.objectiveVersionStore.restoreActiveVersion(studyId, objectiveKey, versionNumber);

    if (!restoredVersion) {
      throw new ObjectiveValidationError("Objective version was not found.");
    }

    return restoredVersion;
  }
}

export class InMemoryObjectiveVersionStore implements ObjectiveVersionStore {
  private readonly versions = new Map<string, ObjectiveVersion>();

  constructor(initialVersions: readonly ObjectiveVersion[] = []) {
    for (const version of initialVersions) {
      this.versions.set(version.id, version);
    }
  }

  async listByStudy(studyId: string) {
    return [...this.versions.values()]
      .filter((version) => version.studyId === studyId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.sortOrder - right.sortOrder);
  }

  async saveActiveVersions(versions: readonly ObjectiveVersion[], previousActiveVersions: readonly ObjectiveVersion[]) {
    const nextActiveKeys = new Set(versions.map((version) => version.objectiveKey));
    const nextActiveVersionIds = new Set(versions.map((version) => version.id));

    for (const previousVersion of previousActiveVersions) {
      if (!nextActiveVersionIds.has(previousVersion.id)) {
        this.versions.set(previousVersion.id, {
          ...previousVersion,
          isActive: false
        });
      }
    }

    for (const version of versions) {
      this.versions.set(version.id, version);
    }

    for (const previousVersion of previousActiveVersions) {
      if (!nextActiveKeys.has(previousVersion.objectiveKey)) {
        this.versions.set(previousVersion.id, {
          ...previousVersion,
          isActive: false
        });
      }
    }

    return versions;
  }

  async restoreActiveVersion(studyId: string, objectiveKey: string, versionNumber: number) {
    const versions = (await this.listByStudy(studyId)).filter((version) => version.objectiveKey === objectiveKey);
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

export interface DynamoDbObjectiveVersionStoreOptions {
  readonly tableName?: string;
  readonly environment?: string;
  readonly region?: string;
  readonly endpoint?: string;
}

export class DynamoDbObjectiveVersionStore implements ObjectiveVersionStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbObjectiveVersionStoreOptions = {}) {
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
    const versionResponse = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :study",
        ExpressionAttributeValues: {
          ":study": `STUDY#${studyId}`
        }
      })
    );
    const versions = (versionResponse.Items ?? [])
      .filter((item) => item.entity === "objective_version")
      .map((item) => toObjectiveVersionShell(item as ObjectiveVersionItem))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.sortOrder - right.sortOrder);

    return Promise.all(versions.map((version) => this.hydrateObjectiveVersion(version)));
  }

  async saveActiveVersions(versions: readonly ObjectiveVersion[], previousActiveVersions: readonly ObjectiveVersion[]) {
    const previousActiveVersionIds = new Set(previousActiveVersions.map((version) => version.id));
    const nextActiveVersionIds = new Set(versions.map((version) => version.id));

    for (const previousVersion of previousActiveVersions) {
      if (!nextActiveVersionIds.has(previousVersion.id)) {
        await this.documentClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: {
              pk: `STUDY#${previousVersion.studyId}`,
              sk: `OBJECTIVE#${previousVersion.objectiveKey}#VERSION#${previousVersion.versionNumber}`
            },
            UpdateExpression: "SET isActive = :inactive REMOVE gsi1pk, gsi1sk",
            ConditionExpression: "attribute_exists(pk)",
            ExpressionAttributeValues: {
              ":inactive": false
            }
          })
        );
      }
    }

    for (const version of versions) {
      if (previousActiveVersionIds.has(version.id)) {
        continue;
      }

      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: toObjectiveVersionItem(version),
          ConditionExpression: "attribute_not_exists(pk)"
        })
      );

      for (const example of version.gradeExamples) {
        await this.documentClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: toObjectiveGradeExampleItem(example),
            ConditionExpression: "attribute_not_exists(pk)"
          })
        );
      }
    }

    return versions;
  }

  async restoreActiveVersion(studyId: string, objectiveKey: string, versionNumber: number) {
    const versions = (await this.listByStudy(studyId)).filter((version) => version.objectiveKey === objectiveKey);
    const selectedVersion = versions.find((version) => version.versionNumber === versionNumber);

    if (!selectedVersion) {
      return undefined;
    }

    for (const version of versions) {
      if (version.versionNumber > versionNumber) {
        await this.deleteObjectiveVersion(version);
      } else {
        await this.documentClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: {
              pk: `STUDY#${version.studyId}`,
              sk: `OBJECTIVE#${version.objectiveKey}#VERSION#${version.versionNumber}`
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
                    ":gsi1sk": `OBJECTIVE_VERSION#${padSortOrder(version.sortOrder)}#${version.objectiveKey}#${version.versionNumber}#${version.id}`
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

  private async hydrateObjectiveVersion(
    version: Omit<ObjectiveVersion, "gradeExamples">
  ): Promise<ObjectiveVersion> {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :version",
        ExpressionAttributeValues: {
          ":version": `OBJECTIVE_VERSION#${version.id}`
        }
      })
    );
    const gradeExamples = (response.Items ?? [])
      .filter((item) => item.entity === "objective_grade_example")
      .map((item) => toObjectiveGradeExample(item as ObjectiveGradeExampleItem))
      .sort((left, right) => left.sortOrder - right.sortOrder);

    return {
      ...version,
      gradeExamples
    };
  }

  private async deleteObjectiveVersion(version: ObjectiveVersion) {
    const childResponse = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :version",
        ExpressionAttributeValues: {
          ":version": `OBJECTIVE_VERSION#${version.id}`
        }
      })
    );

    for (const item of childResponse.Items ?? []) {
      await this.documentClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: item.pk,
            sk: item.sk
          }
        })
      );
    }

    await this.documentClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          pk: `STUDY#${version.studyId}`,
          sk: `OBJECTIVE#${version.objectiveKey}#VERSION#${version.versionNumber}`
        }
      })
    );
  }
}

export function createConfiguredObjectiveVersionStore() {
  const storeMode = process.env.OBJECTIVE_VERSION_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbObjectiveVersionStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemoryObjectiveVersionStore();
  }

  return new DynamoDbObjectiveVersionStore();
}

export function toSafeObjectiveValidationResponse(error: unknown) {
  if (error instanceof ObjectiveValidationError) {
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

function parseObjectivesInput(input: SaveObjectivesInput): readonly ParsedObjectiveInput[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ObjectiveValidationError("Scoring objectives are required.");
  }

  if (!Array.isArray(input.objectives)) {
    throw new ObjectiveValidationError("Scoring objectives must be a list.");
  }

  if (input.objectives.length < 1) {
    throw new ObjectiveValidationError("Add at least one scoring objective.");
  }

  if (input.objectives.length > 20) {
    throw new ObjectiveValidationError("Use 20 or fewer scoring objectives.");
  }

  return input.objectives.map((objective, index) => parseObjective(objective, index + 1));
}

function objectiveInputsMatchActiveVersions(
  inputs: readonly ParsedObjectiveInput[],
  activeVersions: readonly ObjectiveVersion[]
) {
  const sortedActiveVersions = [...activeVersions].sort((left, right) => left.sortOrder - right.sortOrder);

  if (inputs.length !== sortedActiveVersions.length) {
    return false;
  }

  return inputs.every((input, index) => {
    const version = sortedActiveVersions[index];

    return Boolean(version && objectiveInputMatchesVersion(input, version, index + 1));
  });
}

function objectiveInputMatchesVersion(input: ParsedObjectiveInput, version: ObjectiveVersion, sortOrder: number) {
  return (
    input.objectiveKey === version.objectiveKey &&
    input.title === version.title &&
    input.description === version.description &&
    (input.customScoringPrompt ?? "") === (version.customScoringPrompt ?? "") &&
    input.evidenceRequirements === version.evidenceRequirements &&
    sortOrder === version.sortOrder &&
    input.gradeScale.length === version.gradeScale.length &&
    input.gradeScale.every((label, labelIndex) => label === version.gradeScale[labelIndex]) &&
    input.gradeExamples.length === version.gradeExamples.length &&
    input.gradeExamples.every((example, exampleIndex) => {
      const versionExample = [...version.gradeExamples].sort((left, right) => left.sortOrder - right.sortOrder)[
        exampleIndex
      ];

      return (
        versionExample &&
        example.gradeLabel === versionExample.gradeLabel &&
        example.exampleText === versionExample.exampleText
      );
    })
  );
}

function parseObjective(objective: SaveObjectiveInput, index: number): ParsedObjectiveInput {
  if (!objective || typeof objective !== "object" || Array.isArray(objective)) {
    throw new ObjectiveValidationError(`Objective ${index} is invalid.`);
  }

  const gradeScale = parseGradeScale(objective.gradeLabels, index);
  const gradeExamples = parseGradeExamples(objective.gradeExamples, gradeScale, index);
  const customScoringPrompt = parseOptionalText(
    objective.customScoringPrompt,
    `Objective ${index} custom scoring prompt`,
    4000
  );

  return {
    ...(objective.objectiveKey ? { objectiveKey: parseObjectiveKey(objective.objectiveKey, index) } : {}),
    title: parseRequiredText(objective.title, `Objective ${index} title`, 160),
    description: parseRequiredText(objective.description, `Objective ${index} description`, 2000),
    ...(customScoringPrompt ? { customScoringPrompt } : {}),
    gradeScale,
    gradeExamples,
    evidenceRequirements: parseRequiredText(objective.evidenceRequirements, `Objective ${index} evidence requirements`, 2000)
  };
}

function parseObjectiveKey(value: string, index: number) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{3,120}$/.test(value)) {
    throw new ObjectiveValidationError(`Objective ${index} key is invalid.`);
  }

  return value;
}

function parseGradeScale(value: readonly string[], objectiveIndex: number) {
  if (!Array.isArray(value)) {
    throw new ObjectiveValidationError(`Objective ${objectiveIndex} grade labels must be a list.`);
  }

  if (value.length < 2) {
    throw new ObjectiveValidationError(`Objective ${objectiveIndex} needs at least two grade labels.`);
  }

  if (value.length > 12) {
    throw new ObjectiveValidationError(`Objective ${objectiveIndex} can use 12 or fewer grade labels.`);
  }

  const labels = value.map((label, labelIndex) =>
    parseRequiredText(label, `Objective ${objectiveIndex} grade label ${labelIndex + 1}`, 40)
  );
  const uniqueLabels = new Set(labels.map((label) => label.toLowerCase()));

  if (uniqueLabels.size !== labels.length) {
    throw new ObjectiveValidationError(`Objective ${objectiveIndex} grade labels must be unique.`);
  }

  return labels;
}

function parseGradeExamples(
  value: readonly SaveObjectiveGradeExampleInput[] | undefined,
  gradeScale: readonly string[],
  objectiveIndex: number
) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ObjectiveValidationError(`Objective ${objectiveIndex} grade examples must be a list.`);
  }

  if (value.length > 60) {
    throw new ObjectiveValidationError(`Objective ${objectiveIndex} can use 60 or fewer grade examples.`);
  }

  const gradeLabels = new Set(gradeScale);

  return value.map((example, exampleIndex) => {
    if (!example || typeof example !== "object" || Array.isArray(example)) {
      throw new ObjectiveValidationError(`Objective ${objectiveIndex} grade example ${exampleIndex + 1} is invalid.`);
    }

    const gradeLabel = parseRequiredText(
      example.gradeLabel,
      `Objective ${objectiveIndex} grade example ${exampleIndex + 1} label`,
      40
    );

    if (!gradeLabels.has(gradeLabel)) {
      throw new ObjectiveValidationError(`Objective ${objectiveIndex} grade examples must use configured labels.`);
    }

    return {
      gradeLabel,
      exampleText: parseRequiredText(
        example.exampleText,
        `Objective ${objectiveIndex} grade example ${exampleIndex + 1} text`,
        2000
      )
    };
  });
}

function parseRequiredText(value: string, label: string, maximumLength: number) {
  if (typeof value !== "string") {
    throw new ObjectiveValidationError(`${label} is required.`);
  }

  const text = value.trim();

  if (!text) {
    throw new ObjectiveValidationError(`${label} is required.`);
  }

  if (text.length > maximumLength) {
    throw new ObjectiveValidationError(`${label} must be ${maximumLength.toLocaleString("en-US")} characters or fewer.`);
  }

  return text;
}

function parseOptionalText(value: string | undefined, label: string, maximumLength: number) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ObjectiveValidationError(`${label} must be text.`);
  }

  const text = value.trim();

  if (text.length > maximumLength) {
    throw new ObjectiveValidationError(`${label} must be ${maximumLength.toLocaleString("en-US")} characters or fewer.`);
  }

  return text || undefined;
}

function getVersionedConfigurationTableName(environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local") {
  return `education-researcher-${environment}-versioned-configuration`;
}

function padSortOrder(sortOrder: number) {
  return sortOrder.toString().padStart(3, "0");
}

function toObjectiveVersionItem(version: ObjectiveVersion): ObjectiveVersionItem {
  return {
    entity: "objective_version",
    pk: `STUDY#${version.studyId}`,
    sk: `OBJECTIVE#${version.objectiveKey}#VERSION#${version.versionNumber}`,
    gsi1pk: `STUDY#${version.studyId}#ACTIVE_CONFIG`,
    gsi1sk: `OBJECTIVE_VERSION#${padSortOrder(version.sortOrder)}#${version.objectiveKey}#${version.versionNumber}#${version.id}`,
    gsi2pk: `OBJECTIVE#${version.objectiveKey}`,
    gsi2sk: `VERSION#${version.versionNumber}#${version.id}`,
    id: version.id,
    studyId: version.studyId,
    objectiveKey: version.objectiveKey,
    versionNumber: version.versionNumber,
    title: version.title,
    description: version.description,
    ...(version.customScoringPrompt ? { customScoringPrompt: version.customScoringPrompt } : {}),
    gradeScale: version.gradeScale,
    evidenceRequirements: version.evidenceRequirements,
    sortOrder: version.sortOrder,
    isActive: version.isActive,
    createdAt: version.createdAt
  };
}

function toObjectiveGradeExampleItem(example: ObjectiveGradeExample): ObjectiveGradeExampleItem {
  return {
    entity: "objective_grade_example",
    pk: `OBJECTIVE_VERSION#${example.objectiveVersionId}`,
    sk: `GRADE_EXAMPLE#${padSortOrder(example.sortOrder)}#${example.id}`,
    id: example.id,
    objectiveVersionId: example.objectiveVersionId,
    gradeLabel: example.gradeLabel,
    exampleText: example.exampleText,
    sortOrder: example.sortOrder,
    createdAt: example.createdAt
  };
}

function toObjectiveVersionShell(item: ObjectiveVersionItem): Omit<ObjectiveVersion, "gradeExamples"> {
  return {
    id: item.id,
    studyId: item.studyId,
    objectiveKey: item.objectiveKey,
    versionNumber: item.versionNumber,
    title: item.title,
    description: item.description,
    ...(item.customScoringPrompt ? { customScoringPrompt: item.customScoringPrompt } : {}),
    gradeScale: item.gradeScale,
    evidenceRequirements: item.evidenceRequirements,
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    createdAt: item.createdAt
  };
}

function toObjectiveGradeExample(item: ObjectiveGradeExampleItem): ObjectiveGradeExample {
  return {
    id: item.id,
    objectiveVersionId: item.objectiveVersionId,
    gradeLabel: item.gradeLabel,
    exampleText: item.exampleText,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt
  };
}
