import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { StudyShell, StudyShellStore } from "./study-shell.js";

export interface SurveyQuestion {
  readonly id: string;
  readonly surveyVersionId: string;
  readonly surveyGroupId?: string;
  readonly prompt: string;
  readonly required: true;
  readonly questionType: "long_text";
  readonly sortOrder: number;
  readonly createdAt: string;
}

export interface SurveyGroup {
  readonly id: string;
  readonly surveyVersionId: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly questions: readonly SurveyQuestion[];
  readonly createdAt: string;
}

export interface SurveyVersion {
  readonly id: string;
  readonly studyId: string;
  readonly versionNumber: number;
  readonly isActive: boolean;
  readonly layoutItems: readonly SurveyLayoutItem[];
  readonly groups: readonly SurveyGroup[];
  readonly ungroupedQuestions: readonly SurveyQuestion[];
  readonly createdAt: string;
}

export interface SaveSurveyQuestionInput {
  readonly prompt: string;
}

export interface SaveSurveyGroupInput {
  readonly title: string;
  readonly questions: readonly SaveSurveyQuestionInput[];
}

export type SaveSurveyLayoutItemInput =
  | {
      readonly type: "question";
      readonly question: SaveSurveyQuestionInput;
    }
  | {
      readonly type: "group";
      readonly group: SaveSurveyGroupInput;
    };

export interface SaveSurveyInput {
  readonly items?: readonly SaveSurveyLayoutItemInput[];
  readonly groups?: readonly SaveSurveyGroupInput[];
  readonly questions?: readonly SaveSurveyQuestionInput[];
}

export type SurveyLayoutItem =
  | {
      readonly type: "question";
      readonly sortOrder: number;
      readonly question: SurveyQuestion;
    }
  | {
      readonly type: "group";
      readonly sortOrder: number;
      readonly group: SurveyGroup;
    };

export interface SurveyVersionStore {
  listByStudy(studyId: string): Promise<SurveyVersion[]>;
  saveActiveVersion(version: SurveyVersion, previousActiveVersion?: SurveyVersion): Promise<SurveyVersion>;
  restoreActiveVersion(studyId: string, versionNumber: number): Promise<SurveyVersion | undefined>;
}

interface SurveyVersionItem {
  readonly entity: "survey_version";
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk?: string;
  readonly gsi1sk?: string;
  readonly id: string;
  readonly studyId: string;
  readonly versionNumber: number;
  readonly isActive: boolean;
  readonly createdAt: string;
}

interface SurveyGroupItem {
  readonly entity: "survey_group";
  readonly pk: string;
  readonly sk: string;
  readonly id: string;
  readonly surveyVersionId: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly createdAt: string;
}

interface SurveyQuestionItem {
  readonly entity: "survey_question";
  readonly pk: string;
  readonly sk: string;
  readonly id: string;
  readonly surveyVersionId: string;
  readonly surveyGroupId?: string;
  readonly prompt: string;
  readonly required: true;
  readonly questionType: "long_text";
  readonly sortOrder: number;
  readonly createdAt: string;
}

export class SurveyValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "SurveyValidationError";
  }
}

export interface SurveyServiceOptions {
  readonly now?: () => Date;
  readonly createSurveyVersionId?: () => string;
  readonly createSurveyGroupId?: () => string;
  readonly createSurveyQuestionId?: () => string;
}

interface ParsedSurveyInput {
  readonly items: readonly ParsedSurveyLayoutItem[];
}

type ParsedSurveyLayoutItem =
  | {
      readonly type: "question";
      readonly question: {
        readonly prompt: string;
      };
    }
  | {
      readonly type: "group";
      readonly group: {
        readonly title: string;
        readonly questions: readonly {
          readonly prompt: string;
        }[];
      };
    };

export class SurveyService {
  private readonly now: () => Date;
  private readonly createSurveyVersionId: () => string;
  private readonly createSurveyGroupId: () => string;
  private readonly createSurveyQuestionId: () => string;

  constructor(
    private readonly surveyVersionStore: SurveyVersionStore,
    private readonly studyShellStore: Pick<StudyShellStore, "update">,
    options: SurveyServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createSurveyVersionId = options.createSurveyVersionId ?? (() => `survey_version_${crypto.randomUUID()}`);
    this.createSurveyGroupId = options.createSurveyGroupId ?? (() => `survey_group_${crypto.randomUUID()}`);
    this.createSurveyQuestionId = options.createSurveyQuestionId ?? (() => `survey_question_${crypto.randomUUID()}`);
  }

  async listForStudy(studyId: string) {
    const versions = await this.surveyVersionStore.listByStudy(studyId);

    return {
      activeSurveyVersion: versions.find((version) => version.isActive),
      surveyVersions: versions
    };
  }

  async saveSurvey(study: StudyShell, input: SaveSurveyInput) {
    const parsedInput = parseSurveyInput(input);
    const versions = await this.surveyVersionStore.listByStudy(study.id);
    const activeVersion = versions.find((version) => version.isActive);

    if (activeVersion && surveyInputMatchesVersion(parsedInput, activeVersion)) {
      throw new SurveyValidationError("Survey is unchanged from the active version.");
    }

    const nextVersionNumber = versions.reduce((highest, version) => Math.max(highest, version.versionNumber), 0) + 1;
    const createdAt = this.now().toISOString();
    const surveyVersionId = this.createSurveyVersionId();
    const layoutItems = parsedInput.items.map((item, itemIndex): SurveyLayoutItem => {
      const sortOrder = itemIndex + 1;

      if (item.type === "question") {
        return {
          type: "question",
          sortOrder,
          question: this.toSurveyQuestion(surveyVersionId, createdAt, item.question.prompt, sortOrder)
        };
      }

      const surveyGroupId = this.createSurveyGroupId();
      const group: SurveyGroup = {
        id: surveyGroupId,
        surveyVersionId,
        title: item.group.title,
        sortOrder,
        questions: item.group.questions.map((question, questionIndex) =>
          this.toSurveyQuestion(surveyVersionId, createdAt, question.prompt, questionIndex + 1, surveyGroupId)
        ),
        createdAt
      };

      return {
        type: "group",
        sortOrder,
        group
      };
    });
    const groups = layoutItems.filter((item): item is Extract<SurveyLayoutItem, { type: "group" }> => item.type === "group").map((item) => item.group);
    const ungroupedQuestions = layoutItems
      .filter((item): item is Extract<SurveyLayoutItem, { type: "question" }> => item.type === "question")
      .map((item) => item.question);
    const surveyVersion: SurveyVersion = {
      id: surveyVersionId,
      studyId: study.id,
      versionNumber: nextVersionNumber,
      isActive: true,
      layoutItems,
      groups,
      ungroupedQuestions,
      createdAt
    };

    const savedVersion = await this.surveyVersionStore.saveActiveVersion(surveyVersion, activeVersion);
    await this.studyShellStore.update({
      ...study,
      activeSurveyVersionId: savedVersion.id,
      updatedAt: savedVersion.createdAt
    });

    return savedVersion;
  }

  async restoreSurveyVersion(study: StudyShell, versionNumber: number) {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new SurveyValidationError("Survey version number is required.");
    }

    const restoredVersion = await this.surveyVersionStore.restoreActiveVersion(study.id, versionNumber);

    if (!restoredVersion) {
      throw new SurveyValidationError("Survey version was not found.");
    }

    await this.studyShellStore.update({
      ...study,
      activeSurveyVersionId: restoredVersion.id,
      updatedAt: this.now().toISOString()
    });

    return restoredVersion;
  }

  private toSurveyQuestion(
    surveyVersionId: string,
    createdAt: string,
    prompt: string,
    sortOrder: number,
    surveyGroupId?: string
  ): SurveyQuestion {
    return {
      id: this.createSurveyQuestionId(),
      surveyVersionId,
      ...(surveyGroupId ? { surveyGroupId } : {}),
      prompt,
      required: true,
      questionType: "long_text",
      sortOrder,
      createdAt
    };
  }
}

export class InMemorySurveyVersionStore implements SurveyVersionStore {
  private readonly versions = new Map<string, SurveyVersion>();

  constructor(initialVersions: readonly SurveyVersion[] = []) {
    for (const version of initialVersions) {
      this.versions.set(version.id, version);
    }
  }

  async listByStudy(studyId: string) {
    return [...this.versions.values()]
      .filter((version) => version.studyId === studyId)
      .sort((left, right) => right.versionNumber - left.versionNumber);
  }

  async saveActiveVersion(version: SurveyVersion, previousActiveVersion?: SurveyVersion) {
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

export interface DynamoDbSurveyVersionStoreOptions {
  readonly tableName?: string;
  readonly environment?: string;
  readonly region?: string;
  readonly endpoint?: string;
}

export class DynamoDbSurveyVersionStore implements SurveyVersionStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbSurveyVersionStoreOptions = {}) {
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
      .filter((item) => item.entity === "survey_version")
      .map((item) => toSurveyVersionShell(item as SurveyVersionItem))
      .sort((left, right) => right.versionNumber - left.versionNumber);

    return Promise.all(versions.map((version) => this.hydrateSurveyVersion(version)));
  }

  async saveActiveVersion(version: SurveyVersion, previousActiveVersion?: SurveyVersion) {
    if (previousActiveVersion) {
      await this.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `STUDY#${previousActiveVersion.studyId}`,
            sk: `SURVEY_VERSION#${previousActiveVersion.versionNumber}`
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
        Item: toSurveyVersionItem(version),
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );

    for (const group of version.groups) {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: toSurveyGroupItem(group),
          ConditionExpression: "attribute_not_exists(pk)"
        })
      );

      for (const question of group.questions) {
        await this.putSurveyQuestion(question);
      }
    }

    for (const question of version.ungroupedQuestions) {
      await this.putSurveyQuestion(question);
    }

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
        await this.deleteSurveyVersion(version);
      } else {
        await this.documentClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: {
              pk: `STUDY#${version.studyId}`,
              sk: `SURVEY_VERSION#${version.versionNumber}`
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
                    ":gsi1sk": `SURVEY_VERSION#${version.versionNumber}#${version.id}`
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

  private async hydrateSurveyVersion(
    version: Omit<SurveyVersion, "groups" | "layoutItems" | "ungroupedQuestions">
  ): Promise<SurveyVersion> {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :version",
        ExpressionAttributeValues: {
          ":version": `SURVEY_VERSION#${version.id}`
        }
      })
    );
    const groups = (response.Items ?? [])
      .filter((item) => item.entity === "survey_group")
      .map((item) => ({
        ...toSurveyGroup(item as SurveyGroupItem),
        questions: [] as SurveyQuestion[]
      }))
      .sort((left, right) => left.sortOrder - right.sortOrder);
    const questions = (response.Items ?? [])
      .filter((item) => item.entity === "survey_question")
      .map((item) => toSurveyQuestion(item as SurveyQuestionItem))
      .sort((left, right) => left.sortOrder - right.sortOrder);

    const hydratedGroups = groups.map((group) => ({
      ...group,
      questions: questions.filter((question) => question.surveyGroupId === group.id)
    }));
    const ungroupedQuestions = questions.filter((question) => !question.surveyGroupId);

    return {
      ...version,
      layoutItems: toSurveyLayoutItems(hydratedGroups, ungroupedQuestions),
      groups: hydratedGroups,
      ungroupedQuestions
    };
  }

  private async putSurveyQuestion(question: SurveyQuestion) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toSurveyQuestionItem(question),
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );
  }

  private async deleteSurveyVersion(version: SurveyVersion) {
    const childResponse = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :version",
        ExpressionAttributeValues: {
          ":version": `SURVEY_VERSION#${version.id}`
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
          sk: `SURVEY_VERSION#${version.versionNumber}`
        }
      })
    );
  }
}

export function createConfiguredSurveyVersionStore() {
  const storeMode = process.env.SURVEY_VERSION_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbSurveyVersionStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemorySurveyVersionStore();
  }

  return new DynamoDbSurveyVersionStore();
}

export function toSafeSurveyValidationResponse(error: unknown) {
  if (error instanceof SurveyValidationError) {
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

function parseSurveyInput(input: SaveSurveyInput): ParsedSurveyInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SurveyValidationError("Survey settings are required.");
  }

  const items = input.items ? parseLayoutItems(input.items) : parseLegacyLayoutItems(input);
  const questionCount = items.reduce((count, item) => {
    if (item.type === "question") {
      return count + 1;
    }

    return count + item.group.questions.length;
  }, 0);

  if (questionCount < 1) {
    throw new SurveyValidationError("Add at least one required long-form question.");
  }

  return {
    items
  };
}

function surveyInputMatchesVersion(input: ParsedSurveyInput, version: SurveyVersion) {
  const versionItems =
    version.layoutItems ??
    [
      ...version.ungroupedQuestions.map((question) => ({ type: "question" as const, sortOrder: question.sortOrder, question })),
      ...version.groups.map((group) => ({ type: "group" as const, sortOrder: group.sortOrder, group }))
    ].sort((left, right) => left.sortOrder - right.sortOrder);

  if (input.items.length !== versionItems.length) {
    return false;
  }

  return input.items.every((inputItem, index) => {
    const versionItem = versionItems[index];

    if (!versionItem || inputItem.type !== versionItem.type) {
      return false;
    }

    if (inputItem.type === "question" && versionItem.type === "question") {
      return inputItem.question.prompt === versionItem.question.prompt;
    }

    if (inputItem.type === "group" && versionItem.type === "group") {
      return (
        inputItem.group.title === versionItem.group.title &&
        inputItem.group.questions.length === versionItem.group.questions.length &&
        inputItem.group.questions.every(
          (question, questionIndex) => question.prompt === versionItem.group.questions[questionIndex]?.prompt
        )
      );
    }

    return false;
  });
}

function parseLegacyLayoutItems(input: SaveSurveyInput): ParsedSurveyLayoutItem[] {
  const ungroupedQuestions = parseQuestions(input.questions, "Ungrouped question");
  const groups = parseGroups(input.groups);

  return [
    ...ungroupedQuestions.map(
      (question): ParsedSurveyLayoutItem => ({
        type: "question",
        question
      })
    ),
    ...groups.map(
      (group): ParsedSurveyLayoutItem => ({
        type: "group",
        group
      })
    )
  ];
}

function parseLayoutItems(value: readonly SaveSurveyLayoutItemInput[]) {
  if (!Array.isArray(value)) {
    throw new SurveyValidationError("Survey layout items must be a list.");
  }

  return value.map((item, index): ParsedSurveyLayoutItem => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new SurveyValidationError(`Survey item ${index + 1} is invalid.`);
    }

    if (item.type === "question") {
      return {
        type: "question",
        question: parseQuestion(item.question, `Survey item ${index + 1} question`, 1)
      };
    }

    if (item.type === "group") {
      return {
        type: "group",
        group: parseGroup(item.group, index + 1)
      };
    }

    throw new SurveyValidationError(`Survey item ${index + 1} type must be question or group.`);
  });
}

function parseGroups(value: readonly SaveSurveyGroupInput[] | undefined) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new SurveyValidationError("Survey groups must be a list.");
  }

  return value.map((group, index) => parseGroup(group, index + 1));
}

function parseGroup(group: SaveSurveyGroupInput, index: number) {
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    throw new SurveyValidationError(`Group ${index} is invalid.`);
  }

  const title = parseGroupTitle(group.title, index);
  const questions = parseQuestions(group.questions, `Group ${index} question`);

  if (questions.length < 1) {
    throw new SurveyValidationError(`Group ${index} must include at least one question.`);
  }

  return {
    title,
    questions
  };
}

function parseQuestions(value: readonly SaveSurveyQuestionInput[] | undefined, label: string) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new SurveyValidationError(`${label}s must be a list.`);
  }

  return value.map((question, index) => parseQuestion(question, label, index + 1));
}

function parseQuestion(question: SaveSurveyQuestionInput, label: string, index: number) {
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    throw new SurveyValidationError(`${label} ${index} is invalid.`);
  }

  return {
    prompt: parsePrompt(question.prompt, label, index)
  };
}

function parseGroupTitle(value: string, index: number) {
  if (typeof value !== "string") {
    throw new SurveyValidationError(`Group ${index} title is required.`);
  }

  const title = value.trim();

  if (!title) {
    throw new SurveyValidationError(`Group ${index} title is required.`);
  }

  if (title.length > 240) {
    throw new SurveyValidationError(`Group ${index} title must be 240 characters or fewer.`);
  }

  return title;
}

function parsePrompt(value: string, label: string, index: number) {
  if (typeof value !== "string") {
    throw new SurveyValidationError(`${label} ${index} prompt is required.`);
  }

  const prompt = value.trim();

  if (!prompt) {
    throw new SurveyValidationError(`${label} ${index} prompt is required.`);
  }

  if (prompt.length > 1000) {
    throw new SurveyValidationError(`${label} ${index} prompt must be 1,000 characters or fewer.`);
  }

  return prompt;
}

function getVersionedConfigurationTableName(environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local") {
  return `education-researcher-${environment}-versioned-configuration`;
}

function padSortOrder(sortOrder: number) {
  return sortOrder.toString().padStart(3, "0");
}

function toSurveyVersionItem(version: SurveyVersion): SurveyVersionItem {
  return {
    entity: "survey_version",
    pk: `STUDY#${version.studyId}`,
    sk: `SURVEY_VERSION#${version.versionNumber}`,
    gsi1pk: `STUDY#${version.studyId}#ACTIVE_CONFIG`,
    gsi1sk: `SURVEY_VERSION#${version.versionNumber}#${version.id}`,
    id: version.id,
    studyId: version.studyId,
    versionNumber: version.versionNumber,
    isActive: version.isActive,
    createdAt: version.createdAt
  };
}

function toSurveyGroupItem(group: SurveyGroup): SurveyGroupItem {
  return {
    entity: "survey_group",
    pk: `SURVEY_VERSION#${group.surveyVersionId}`,
    sk: `GROUP#${padSortOrder(group.sortOrder)}#${group.id}`,
    id: group.id,
    surveyVersionId: group.surveyVersionId,
    title: group.title,
    sortOrder: group.sortOrder,
    createdAt: group.createdAt
  };
}

function toSurveyQuestionItem(question: SurveyQuestion): SurveyQuestionItem {
  return {
    entity: "survey_question",
    pk: `SURVEY_VERSION#${question.surveyVersionId}`,
    sk: `QUESTION#${padSortOrder(question.sortOrder)}#${question.id}`,
    id: question.id,
    surveyVersionId: question.surveyVersionId,
    ...(question.surveyGroupId ? { surveyGroupId: question.surveyGroupId } : {}),
    prompt: question.prompt,
    required: true,
    questionType: "long_text",
    sortOrder: question.sortOrder,
    createdAt: question.createdAt
  };
}

function toSurveyVersionShell(item: SurveyVersionItem): Omit<SurveyVersion, "groups" | "layoutItems" | "ungroupedQuestions"> {
  return {
    id: item.id,
    studyId: item.studyId,
    versionNumber: item.versionNumber,
    isActive: item.isActive,
    createdAt: item.createdAt
  };
}

function toSurveyLayoutItems(groups: readonly SurveyGroup[], ungroupedQuestions: readonly SurveyQuestion[]): SurveyLayoutItem[] {
  return [
    ...ungroupedQuestions.map(
      (question): SurveyLayoutItem => ({
        type: "question",
        sortOrder: question.sortOrder,
        question
      })
    ),
    ...groups.map(
      (group): SurveyLayoutItem => ({
        type: "group",
        sortOrder: group.sortOrder,
        group
      })
    )
  ].sort((left, right) => left.sortOrder - right.sortOrder);
}

function toSurveyGroup(item: SurveyGroupItem): Omit<SurveyGroup, "questions"> {
  return {
    id: item.id,
    surveyVersionId: item.surveyVersionId,
    title: item.title,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt
  };
}

function toSurveyQuestion(item: SurveyQuestionItem): SurveyQuestion {
  return {
    id: item.id,
    surveyVersionId: item.surveyVersionId,
    ...(item.surveyGroupId ? { surveyGroupId: item.surveyGroupId } : {}),
    prompt: item.prompt,
    required: true,
    questionType: "long_text",
    sortOrder: item.sortOrder,
    createdAt: item.createdAt
  };
}
