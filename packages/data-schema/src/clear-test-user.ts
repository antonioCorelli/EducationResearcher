import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  type BatchWriteCommandInput,
  type BatchWriteCommandOutput
} from "@aws-sdk/lib-dynamodb";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DOMAIN_TABLES, tableNameForEnvironment, type DataDomainTableKey } from "./schema.js";

type DynamoItem = Record<string, unknown> & {
  readonly pk: string;
  readonly sk: string;
  readonly entity?: string;
};

interface TableItems {
  readonly tableKey: DataDomainTableKey;
  readonly tableName: string;
  readonly items: readonly DynamoItem[];
}

export interface DeleteCandidate {
  readonly tableKey: DataDomainTableKey;
  readonly tableName: string;
  readonly entity: string;
  readonly pk: string;
  readonly sk: string;
}

export interface ClearTestUserPlan {
  readonly normalizedEmail: string;
  readonly userIds: readonly string[];
  readonly studyIds: readonly string[];
  readonly runIds: readonly string[];
  readonly deleteCandidates: readonly DeleteCandidate[];
}

interface PurgeContext {
  readonly normalizedEmail: string;
  readonly userIds: Set<string>;
  readonly studyIds: Set<string>;
  readonly participantSlotIds: Set<string>;
  readonly consentVersionIds: Set<string>;
  readonly surveyVersionIds: Set<string>;
  readonly surveyGroupIds: Set<string>;
  readonly surveyQuestionIds: Set<string>;
  readonly objectiveVersionIds: Set<string>;
  readonly objectiveScoreIds: Set<string>;
  readonly scoringRunIds: Set<string>;
  readonly runIds: Set<string>;
  readonly interviewSessionIds: Set<string>;
}

type PurgeSetName = Exclude<keyof PurgeContext, "normalizedEmail">;

interface CliOptions {
  readonly email: string;
  readonly confirmEmail?: string;
  readonly environment: string;
  readonly region: string;
  readonly endpoint?: string;
}

const idSetsByEntity: Partial<Record<string, PurgeSetName>> = {
  user: "userIds",
  study: "studyIds",
  participant_slot: "participantSlotIds",
  consent_version: "consentVersionIds",
  survey_version: "surveyVersionIds",
  survey_group: "surveyGroupIds",
  survey_question: "surveyQuestionIds",
  objective_version: "objectiveVersionIds",
  run: "runIds",
  interview_session: "interviewSessionIds",
  scoring_run: "scoringRunIds",
  objective_score: "objectiveScoreIds"
};

const referenceAttributes = [
  ["ownerUserId", "userIds"],
  ["actorUserId", "userIds"],
  ["studyId", "studyIds"],
  ["participantSlotId", "participantSlotIds"],
  ["consentVersionId", "consentVersionIds"],
  ["surveyVersionId", "surveyVersionIds"],
  ["surveyGroupId", "surveyGroupIds"],
  ["surveyQuestionId", "surveyQuestionIds"],
  ["objectiveVersionId", "objectiveVersionIds"],
  ["objectiveScoreId", "objectiveScoreIds"],
  ["scoringRunId", "scoringRunIds"],
  ["runId", "runIds"],
  ["interviewSessionId", "interviewSessionIds"]
] as const satisfies readonly (readonly [string, PurgeSetName])[];

const keyPrefixes = [
  ["USER#", "userIds"],
  ["STUDY#", "studyIds"],
  ["SLOT#", "participantSlotIds"],
  ["CONSENT_VERSION#", "consentVersionIds"],
  ["SURVEY_VERSION#", "surveyVersionIds"],
  ["GROUP#", "surveyGroupIds"],
  ["QUESTION#", "surveyQuestionIds"],
  ["OBJECTIVE_VERSION#", "objectiveVersionIds"],
  ["OBJECTIVE_SCORE#", "objectiveScoreIds"],
  ["SCORING_RUN#", "scoringRunIds"],
  ["RUN#", "runIds"],
  ["INTERVIEW_SESSION#", "interviewSessionIds"]
] as const satisfies readonly (readonly [string, PurgeSetName])[];

const keyAttributeNames = ["pk", "sk", "gsi1pk", "gsi1sk", "gsi2pk", "gsi2sk", "gsi3pk", "gsi3sk"] as const;

export function normalizeUserEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Provide a valid user email address.");
  }

  return normalizedEmail;
}

export function planClearTestUser(itemsByTable: readonly TableItems[], email: string): ClearTestUserPlan {
  const context = createPurgeContext(normalizeUserEmail(email));
  const deleteCandidates = new Map<string, DeleteCandidate>();
  const allItems: (DynamoItem & { readonly tableKey: DataDomainTableKey; readonly tableName: string })[] =
    itemsByTable.flatMap((table) =>
      table.items.map((item) => ({
        ...item,
        tableKey: table.tableKey,
        tableName: table.tableName
      }))
    );

  for (const item of allItems) {
    if (isTargetUserItem(item, context.normalizedEmail)) {
      addStringId(context.userIds, item.id);
    }
  }

  if (context.userIds.size === 0) {
    return toPlan(context, deleteCandidates);
  }

  let changed = true;

  while (changed) {
    changed = false;

    for (const item of allItems) {
      const candidateKey = `${item.tableName}\0${item.pk}\0${item.sk}`;

      if (!deleteCandidates.has(candidateKey) && shouldDeleteItem(item, context)) {
        deleteCandidates.set(candidateKey, {
          tableKey: item.tableKey,
          tableName: item.tableName,
          entity: typeof item.entity === "string" ? item.entity : "unknown",
          pk: item.pk,
          sk: item.sk
        });
        changed = collectReferences(item, context) || changed;
      }
    }
  }

  return toPlan(context, deleteCandidates);
}

function createPurgeContext(normalizedEmail: string): PurgeContext {
  return {
    normalizedEmail,
    userIds: new Set(),
    studyIds: new Set(),
    participantSlotIds: new Set(),
    consentVersionIds: new Set(),
    surveyVersionIds: new Set(),
    surveyGroupIds: new Set(),
    surveyQuestionIds: new Set(),
    objectiveVersionIds: new Set(),
    objectiveScoreIds: new Set(),
    scoringRunIds: new Set(),
    runIds: new Set(),
    interviewSessionIds: new Set()
  };
}

function isTargetUserItem(item: DynamoItem, normalizedEmail: string) {
  if (item.entity !== "user") {
    return false;
  }

  return (
    normalizeOptionalEmail(item.normalizedEmail) === normalizedEmail ||
    normalizeOptionalEmail(item.email) === normalizedEmail
  );
}

function shouldDeleteItem(item: DynamoItem, context: PurgeContext) {
  if (isTargetUserItem(item, context.normalizedEmail)) {
    return true;
  }

  for (const [attribute, setName] of referenceAttributes) {
    if (hasMatchingStringAttribute(item[attribute], context[setName])) {
      return true;
    }
  }

  if (hasMatchingStringArrayAttribute(item.objectiveVersionIds, context.objectiveVersionIds)) {
    return true;
  }

  for (const attribute of keyAttributeNames) {
    const value = item[attribute];

    if (typeof value !== "string") {
      continue;
    }

    for (const [prefix, setName] of keyPrefixes) {
      if (matchesKeyPrefix(value, prefix, context[setName])) {
        return true;
      }
    }
  }

  return false;
}

function collectReferences(item: DynamoItem, context: PurgeContext) {
  let changed = false;
  const idSetName = typeof item.entity === "string" ? idSetsByEntity[item.entity] : undefined;

  if (idSetName) {
    changed = addStringId(context[idSetName], item.id) || changed;
  }

  for (const [attribute, setName] of referenceAttributes) {
    changed = addStringId(context[setName], item[attribute]) || changed;
  }

  if (Array.isArray(item.objectiveVersionIds)) {
    for (const id of item.objectiveVersionIds) {
      changed = addStringId(context.objectiveVersionIds, id) || changed;
    }
  }

  return changed;
}

function toPlan(context: PurgeContext, deleteCandidates: Map<string, DeleteCandidate>): ClearTestUserPlan {
  return {
    normalizedEmail: context.normalizedEmail,
    userIds: [...context.userIds].sort(),
    studyIds: [...context.studyIds].sort(),
    runIds: [...context.runIds].sort(),
    deleteCandidates: [...deleteCandidates.values()].sort((left, right) =>
      `${left.tableName}\0${left.pk}\0${left.sk}`.localeCompare(`${right.tableName}\0${right.pk}\0${right.sk}`)
    )
  };
}

function normalizeOptionalEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function hasMatchingStringAttribute(value: unknown, candidates: ReadonlySet<string>) {
  return typeof value === "string" && candidates.has(value);
}

function hasMatchingStringArrayAttribute(value: unknown, candidates: ReadonlySet<string>) {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && candidates.has(item));
}

function matchesKeyPrefix(value: string, prefix: string, candidates: ReadonlySet<string>) {
  for (const candidate of candidates) {
    if (value === `${prefix}${candidate}` || value.startsWith(`${prefix}${candidate}#`)) {
      return true;
    }
  }

  return false;
}

function addStringId(ids: Set<string>, value: unknown) {
  if (typeof value !== "string" || ids.has(value)) {
    return false;
  }

  ids.add(value);
  return true;
}

async function scanTable(documentClient: DynamoDBDocumentClient, tableKey: DataDomainTableKey, tableName: string) {
  const items: DynamoItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await documentClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: exclusiveStartKey
      })
    );

    items.push(...((response.Items ?? []) as DynamoItem[]));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return {
    tableKey,
    tableName,
    items
  };
}

async function assertUserExists(
  documentClient: DynamoDBDocumentClient,
  identityTableName: string,
  normalizedEmail: string
) {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: identityTableName,
      IndexName: "byEmail",
      KeyConditionExpression: "gsi1pk = :email",
      ExpressionAttributeValues: {
        ":email": `EMAIL#${normalizedEmail}`
      }
    })
  );

  return (response.Items ?? []).some((item) => isTargetUserItem(item as DynamoItem, normalizedEmail));
}

async function deleteCandidates(documentClient: DynamoDBDocumentClient, candidates: readonly DeleteCandidate[]) {
  const candidatesByTable = new Map<string, DeleteCandidate[]>();

  for (const candidate of candidates) {
    const tableCandidates = candidatesByTable.get(candidate.tableName) ?? [];
    tableCandidates.push(candidate);
    candidatesByTable.set(candidate.tableName, tableCandidates);
  }

  for (const [tableName, tableCandidates] of candidatesByTable) {
    for (let index = 0; index < tableCandidates.length; index += 25) {
      const batch = tableCandidates.slice(index, index + 25);
      let requestItems: NonNullable<BatchWriteCommandInput["RequestItems"]> | undefined = toDeleteRequestItems(
        tableName,
        batch
      );

      do {
        const response: BatchWriteCommandOutput = await documentClient.send(
          new BatchWriteCommand({
            RequestItems: requestItems
          })
        );
        const unprocessedItems: NonNullable<BatchWriteCommandInput["RequestItems"]> = response.UnprocessedItems ?? {};

        requestItems = Object.keys(unprocessedItems).length > 0 ? unprocessedItems : undefined;
      } while (requestItems);
    }
  }
}

function toDeleteRequestItems(tableName: string, candidates: readonly DeleteCandidate[]) {
  return {
    [tableName]: candidates.map((candidate) => ({
      DeleteRequest: {
        Key: {
          pk: candidate.pk,
          sk: candidate.sk
        }
      }
    }))
  };
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const args = [...argv.slice(2)];
  const options: Record<string, string | undefined> = {};
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[index + 1];

      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for --${key}.\n\n${usage()}`);
      }

      options[key] = next;
      index += 1;
      continue;
    }

    positional.push(arg);
  }

  const email = options.email ?? positional[0];

  if (!email) {
    throw new Error(usage());
  }

  const environment = options.environment ?? process.env.EDUCATION_RESEARCHER_ENV ?? "local";

  return {
    email,
    confirmEmail: options.confirm ?? positional[1],
    environment,
    region: options.region ?? process.env.AWS_REGION ?? "us-east-1",
    endpoint:
      options.endpoint ?? process.env.DYNAMODB_ENDPOINT ?? (environment === "local" ? "http://127.0.0.1:8000" : undefined)
  };
}

function usage() {
  return [
    "Usage: tsx src/clear-test-user.ts <email> [confirm-email] [--environment <environment>] [--region <region>] [--endpoint <url>]",
    "   or: tsx src/clear-test-user.ts --email <email> [--confirm <email>] [--environment <environment>] [--region <region>] [--endpoint <url>]",
    "",
    "Runs as a dry-run unless the confirmation email exactly matches the normalized email."
  ].join("\n");
}

async function main(argv: readonly string[]) {
  const options = parseCliOptions(argv);
  const normalizedEmail = normalizeUserEmail(options.email);
  const normalizedConfirmEmail = options.confirmEmail ? normalizeUserEmail(options.confirmEmail) : undefined;
  const tableNames = new Map(
    DATA_DOMAIN_TABLES.map((table) => [table.key, tableNameForEnvironment(table, options.environment)])
  );
  const client = new DynamoDBClient({
    region: options.region,
    ...(options.endpoint
      ? {
          endpoint: options.endpoint,
          credentials: {
            accessKeyId: "local",
            secretAccessKey: "local"
          }
        }
      : {})
  });
  const documentClient = DynamoDBDocumentClient.from(client);
  const identityTableName = tableNames.get("identityAccess");

  if (!identityTableName) {
    throw new Error("Identity Access table is not defined.");
  }

  const userExists = await assertUserExists(documentClient, identityTableName, normalizedEmail);

  if (!userExists) {
    console.log(`No database user found for ${normalizedEmail}. Nothing to delete.`);
    return;
  }

  const itemsByTable = await Promise.all(
    DATA_DOMAIN_TABLES.map((table) => scanTable(documentClient, table.key, tableNames.get(table.key)!))
  );
  const plan = planClearTestUser(itemsByTable, normalizedEmail);
  const countsByTable = summarizeByTable(plan.deleteCandidates);
  const isConfirmed = normalizedConfirmEmail === normalizedEmail;

  console.log(`${isConfirmed ? "Deleting" : "Dry run for"} database user ${normalizedEmail}`);
  console.log(`Environment: ${options.environment}`);
  console.log(`Endpoint: ${options.endpoint ?? "AWS DynamoDB"}`);
  console.log(`User IDs: ${plan.userIds.join(", ") || "(none)"}`);
  console.log(`Studies: ${plan.studyIds.length}`);
  console.log(`Runs: ${plan.runIds.length}`);
  console.log(`Records: ${plan.deleteCandidates.length}`);

  for (const [tableName, count] of countsByTable) {
    console.log(`- ${tableName}: ${count}`);
  }

  if (!isConfirmed) {
    console.log("");
    console.log(`No records deleted. Re-run with --confirm ${normalizedEmail} to delete these records.`);
    return;
  }

  await deleteCandidates(documentClient, plan.deleteCandidates);
  console.log(`Deleted ${plan.deleteCandidates.length} records for ${normalizedEmail}.`);
}

function summarizeByTable(candidates: readonly DeleteCandidate[]) {
  const counts = new Map<string, number>();

  for (const candidate of candidates) {
    counts.set(candidate.tableName, (counts.get(candidate.tableName) ?? 0) + 1);
  }

  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function isCliEntryPoint() {
  return basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] ?? "");
}

if (isCliEntryPoint()) {
  try {
    await main(process.argv);
  } catch (error) {
    console.error(formatCliError(error));
    process.exitCode = 1;
  }
}

function formatCliError(error: unknown) {
  if (isConnectionRefusedError(error)) {
    return [
      `Could not connect to DynamoDB at ${error.address}:${error.port}.`,
      "",
      "For local DynamoDB, start it in another terminal with:",
      "  npm run db:local",
      "",
      "Then create or reset local tables with:",
      "  npm run db:create",
      "  npm run db:reset",
      "",
      "For deployed DynamoDB, pass the deployed environment and do not set a local endpoint, for example:",
      "  npm run db:clear-test-user -- user@example.com --environment dev",
      "",
      "The first run is still a dry run. Confirm deletion by repeating the email as the second positional argument."
    ].join("\n");
  }

  return error instanceof Error ? error.message : String(error);
}

function isConnectionRefusedError(error: unknown): error is { readonly address: string; readonly port: number } {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ECONNREFUSED" &&
    "address" in error &&
    typeof error.address === "string" &&
    "port" in error &&
    typeof error.port === "number"
  );
}
