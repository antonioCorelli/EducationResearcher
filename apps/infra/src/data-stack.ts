import { RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, Table } from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import { DATA_DOMAIN_TABLES, DATA_SCHEMA_VERSION, tableNameForEnvironment } from "@education-researcher/data-schema";

export interface EducationResearcherDataStackProps extends StackProps {
  readonly environment: string;
}

export class EducationResearcherDataStack extends Stack {
  readonly tables: Record<string, Table> = {};

  constructor(scope: Construct, id: string, props: EducationResearcherDataStackProps) {
    super(scope, id, props);

    for (const tableDefinition of DATA_DOMAIN_TABLES) {
      const table = new Table(this, tableDefinition.cdkConstructId, {
        tableName: tableNameForEnvironment(tableDefinition, props.environment),
        partitionKey: {
          name: tableDefinition.partitionKey,
          type: AttributeType.STRING
        },
        sortKey: {
          name: tableDefinition.sortKey,
          type: AttributeType.STRING
        },
        billingMode: BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: props.environment !== "local"
        },
        removalPolicy: props.environment === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
      });

      for (const index of tableDefinition.indexes) {
        table.addGlobalSecondaryIndex({
          indexName: index.name,
          partitionKey: {
            name: index.partitionKey,
            type: AttributeType.STRING
          },
          sortKey: {
            name: index.sortKey,
            type: AttributeType.STRING
          },
          projectionType: ProjectionType.ALL
        });
      }

      Tags.of(table).add("DataDomain", tableDefinition.sharedLanguageName);
      Tags.of(table).add("SchemaVersion", DATA_SCHEMA_VERSION);

      this.tables[tableDefinition.key] = table;
    }
  }
}
