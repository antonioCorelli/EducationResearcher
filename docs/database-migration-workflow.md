# Database Schema And Migration Workflow

Source issue: [#4](https://github.com/antonioCorelli/EducationResearcher/issues/4)

## Decisions

- The first physical data model uses DynamoDB with a table per data domain.
- AWS CDK owns deployable table and index definitions.
- DynamoDB Local supports local development and deterministic fixture checks.
- `@education-researcher/data-schema` is the shared schema contract for CDK, local setup, fixtures, and tests.
- Study collaborators, participant access tokens, and retention/deletion attributes are intentionally deferred from this first schema.

## Data Domain Tables

| Shared name | Physical suffix | Owns |
| --- | --- | --- |
| Identity Access Table | `identity-access` | `user` records for researchers and authorized admin engineers. |
| Study Setup Table | `study-setup` | `study` and `participant_slot` records. |
| Versioned Configuration Table | `versioned-configuration` | Consent versions, survey versions/groups/questions, objective versions/examples, and persona versions. |
| Run Lifecycle Table | `run-lifecycle` | Runs, consent records, survey responses, interview sessions, turns, and audio metadata. |
| Evidence Scoring Table | `evidence-scoring` | Scoring runs, objective scores, and evidence citations. |
| Operations Table | `operations` | Operational events and audit logs. |

Table names use the pattern:

```text
education-researcher-<environment>-<physical-suffix>
```

Every table uses `pk` and `sk` as its primary key attributes. Global secondary indexes use `gsi1pk`/`gsi1sk`, `gsi2pk`/`gsi2sk`, and `gsi3pk`/`gsi3sk` where needed by that domain.

## Relationship References

DynamoDB does not enforce relational foreign keys. The schema contract still documents relationship references on each entity. Service writes must preserve those references, and service reads must enforce authorization through the owning study, run, and participant slot relationships.

Immutable run-time configuration is represented by version IDs on `run` records:

- `consentVersionId`
- `surveyVersionId`
- `personaVersionId`

Scoring runs also store `objectiveVersionSetHash` so rescoring can be compared without mutating previous scoring output.

## Local Workflow

Start DynamoDB Local:

```bash
npm run db:local
```

In another terminal, create empty local tables:

```bash
npm run db:create
```

Reset local tables and load the first build slice fixture:

```bash
npm run db:reset
```

Load or overwrite fixture records without deleting tables:

```bash
npm run db:seed
```

The local scripts default to:

- `DYNAMODB_ENDPOINT=http://127.0.0.1:8000`
- `EDUCATION_RESEARCHER_ENV=local`
- `AWS_REGION=us-east-1`

When the service points at deployed AWS DynamoDB tables, set `EDUCATION_RESEARCHER_ENV` to the same CDK environment
context used at deploy time. The default CDK stack uses `dev`, producing table names like
`education-researcher-dev-study-setup`.

## CDK Workflow

List or synthesize the deployable stacks:

```bash
npm run infra:list
npm run infra:synth
```

CDK writes the cloud assembly to `apps/infra/cdk.out`. The `apps/infra/cdk.out/cdk.out` file is only a schema-version
marker; the synthesized CloudFormation templates are the `*.template.json` files next to it.

The CDK app accepts an environment context value:

```bash
npm run synth --workspace @education-researcher/infra -- -c environment=staging
```

Deploy with CDK rather than manually zipping or uploading `cdk.out`:

```bash
npm run infra:diff
npm run infra:bootstrap
npm run infra:deploy
```

Run `infra:bootstrap` once per AWS account/region before the first CDK deploy. `infra:deploy` currently deploys both
`EducationResearcherAuth-*` and `EducationResearcherData-*` stacks for the selected environment.

Production tables use `RemovalPolicy.RETAIN`. Non-production tables use `RemovalPolicy.DESTROY` to keep local and staging resets practical.

## Fixture Coverage

The first build slice fixture includes:

- Researcher user.
- Study shell and participant slot.
- Consent, survey, objective, grade example, and persona versions.
- Run with immutable configuration references.
- Consent record, survey response, interview session, interview turn, and audio asset.
- Scoring run, objective score, and evidence citation.
- Operational event and audit log.

Run the schema tests with:

```bash
npm test
```
