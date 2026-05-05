import { describe, expect, it } from "vitest";
import {
  DATA_DOMAIN_TABLES,
  DEFERRED_SCHEMA_ENTITIES,
  getEntityDefinition,
  tableNameForEnvironment
} from "./schema.js";
import { FIRST_BUILD_SLICE_FIXTURE } from "./fixtures.js";

describe("data domain schema", () => {
  it("uses the approved table-per-domain shape", () => {
    expect(DATA_DOMAIN_TABLES.map((table) => table.sharedLanguageName)).toEqual([
      "Identity Access Table",
      "Study Setup Table",
      "Versioned Configuration Table",
      "Run Lifecycle Table",
      "Evidence Scoring Table",
      "Operations Table"
    ]);

    for (const table of DATA_DOMAIN_TABLES) {
      expect(table.partitionKey).toBe("pk");
      expect(table.sortKey).toBe("sk");
      expect(table.indexes.length).toBeGreaterThan(0);
      expect(tableNameForEnvironment(table, "test")).toBe(`education-researcher-test-${table.tableNameSuffix}`);
    }
  });

  it("keeps intentionally deferred entities out of the initial schema", () => {
    expect(DEFERRED_SCHEMA_ENTITIES.map((entry) => entry.entity)).toEqual([
      "study_membership",
      "participant_access_token",
      "retention_policy"
    ]);
  });

  it("declares relationship references and lifecycle fields for each entity", () => {
    for (const table of DATA_DOMAIN_TABLES) {
      for (const entity of table.entities) {
        expect(entity.requiredAttributes.length).toBeGreaterThan(0);
        expect(entity.timestampAttributes.length).toBeGreaterThan(0);
        expect(entity.partitionKeyPattern).toContain("#");
        expect(entity.sortKeyPattern.length).toBeGreaterThan(0);
      }
    }
  });

  it("marks run-time configuration as immutable after a run can reference it", () => {
    const versionedEntities = [
      "consent_version",
      "survey_version",
      "survey_group",
      "survey_question",
      "objective_version",
      "objective_grade_example",
      "interviewer_persona_version"
    ] as const;

    for (const entity of versionedEntities) {
      expect(getEntityDefinition(entity)?.definition.immutableAfterReference).toBe(true);
    }
  });

  it("provides first build slice fixture coverage", () => {
    const fixtureEntities = new Set(FIRST_BUILD_SLICE_FIXTURE.map((record) => record.entity));

    expect(fixtureEntities).toEqual(
      new Set([
        "user",
        "study",
        "participant_slot",
        "consent_version",
        "survey_version",
        "survey_group",
        "survey_question",
        "objective_version",
        "objective_grade_example",
        "interviewer_persona_version",
        "run",
        "consent_record",
        "survey_response",
        "gap_map",
        "interview_session",
        "interview_turn",
        "interview_audio_asset",
        "scoring_run",
        "objective_score",
        "evidence_citation",
        "operational_event",
        "audit_log"
      ])
    );
  });

  it("stores immutable configuration references on run fixtures", () => {
    const run = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "run");

    expect(run?.attributes).toMatchObject({
      consentVersionId: "consent_version_001",
      surveyVersionId: "survey_version_001",
      personaVersionId: "persona_version_v1_default_001"
    });
  });
});
