import {
  type AttributeDefinition,
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceNotFoundException,
  type ScalarAttributeType,
  waitUntilTableExists,
  waitUntilTableNotExists
} from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DATA_DOMAIN_TABLES, tableNameForEnvironment } from "./schema.js";
import { FIRST_BUILD_SLICE_FIXTURE, type FixtureRecord } from "./fixtures.js";

const endpoint = process.env.DYNAMODB_ENDPOINT ?? "http://127.0.0.1:8000";
const environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local";
const region = process.env.AWS_REGION ?? "us-east-1";

const client = new DynamoDBClient({
  endpoint,
  region,
  credentials: {
    accessKeyId: "local",
    secretAccessKey: "local"
  }
});

const documentClient = DynamoDBDocumentClient.from(client);

function tableName(tableKey: string) {
  const table = DATA_DOMAIN_TABLES.find((candidate) => candidate.key === tableKey);

  if (!table) {
    throw new Error(`Unknown table key: ${tableKey}`);
  }

  return tableNameForEnvironment(table, environment);
}

async function existingTableNames() {
  const response = await client.send(new ListTablesCommand({}));
  return new Set(response.TableNames ?? []);
}

async function createTables() {
  const existing = await existingTableNames();

  for (const table of DATA_DOMAIN_TABLES) {
    const name = tableNameForEnvironment(table, environment);

    if (existing.has(name)) {
      continue;
    }

    const attributeDefinitions: AttributeDefinition[] = [
      { AttributeName: table.partitionKey, AttributeType: "S" as ScalarAttributeType },
      { AttributeName: table.sortKey, AttributeType: "S" as ScalarAttributeType },
      ...table.indexes.flatMap((index) => [
        { AttributeName: index.partitionKey, AttributeType: "S" as ScalarAttributeType },
        { AttributeName: index.sortKey, AttributeType: "S" as ScalarAttributeType }
      ])
    ].filter(
      (definition, index, definitions) =>
        definitions.findIndex((candidate) => candidate.AttributeName === definition.AttributeName) === index
    );

    await client.send(
      new CreateTableCommand({
        TableName: name,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: attributeDefinitions,
        KeySchema: [
          { AttributeName: table.partitionKey, KeyType: "HASH" },
          { AttributeName: table.sortKey, KeyType: "RANGE" }
        ],
        GlobalSecondaryIndexes: table.indexes.map((index) => ({
          IndexName: index.name,
          KeySchema: [
            { AttributeName: index.partitionKey, KeyType: "HASH" },
            { AttributeName: index.sortKey, KeyType: "RANGE" }
          ],
          Projection: {
            ProjectionType: "ALL"
          }
        }))
      })
    );

    await waitUntilTableExists(
      {
        client,
        maxWaitTime: 30
      },
      {
        TableName: name
      }
    );
  }
}

async function deleteTables() {
  const existing = await existingTableNames();

  for (const table of DATA_DOMAIN_TABLES) {
    const name = tableNameForEnvironment(table, environment);

    if (!existing.has(name)) {
      continue;
    }

    try {
      await client.send(new DeleteTableCommand({ TableName: name }));
      await waitUntilTableNotExists(
        {
          client,
          maxWaitTime: 30
        },
        {
          TableName: name
        }
      );
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }
}

function toDynamoItem(record: FixtureRecord) {
  return {
    entity: record.entity,
    pk: record.pk,
    sk: record.sk,
    ...("gsi1pk" in record ? { gsi1pk: record.gsi1pk, gsi1sk: record.gsi1sk } : {}),
    ...("gsi2pk" in record ? { gsi2pk: record.gsi2pk, gsi2sk: record.gsi2sk } : {}),
    ...("gsi3pk" in record ? { gsi3pk: record.gsi3pk, gsi3sk: record.gsi3sk } : {}),
    ...record.attributes
  };
}

async function seedFixtureData() {
  const recordsByTable = new Map<string, FixtureRecord[]>();

  for (const record of FIRST_BUILD_SLICE_FIXTURE) {
    const records = recordsByTable.get(record.tableKey) ?? [];
    records.push(record);
    recordsByTable.set(record.tableKey, records);
  }

  for (const [tableKey, records] of recordsByTable) {
    for (let index = 0; index < records.length; index += 25) {
      const batch = records.slice(index, index + 25);

      await documentClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName(tableKey)]: batch.map((record) => ({
              PutRequest: {
                Item: toDynamoItem(record)
              }
            }))
          }
        })
      );
    }
  }
}

async function main() {
  const command = process.argv[2];

  if (command === "create") {
    await createTables();
    return;
  }

  if (command === "seed") {
    await createTables();
    await seedFixtureData();
    return;
  }

  if (command === "reset") {
    await deleteTables();
    await createTables();
    await seedFixtureData();
    return;
  }

  throw new Error("Usage: tsx src/local-dynamodb.ts <create|seed|reset>");
}

await main();
