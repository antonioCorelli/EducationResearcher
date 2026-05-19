import { describe, expect, it } from "vitest";
import { FIRST_BUILD_SLICE_FIXTURE } from "./fixtures.js";
import { planClearTestUser, normalizeUserEmail } from "./clear-test-user.js";

function toDynamoItem(record: (typeof FIRST_BUILD_SLICE_FIXTURE)[number]) {
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

describe("clear test user planning", () => {
  it("normalizes user email input", () => {
    expect(normalizeUserEmail(" Researcher@Example.Test ")).toBe("researcher@example.test");
  });

  it("plans a complete purge for a researcher-owned first build slice", () => {
    const plan = planClearTestUser(
      [
        {
          tableKey: "identityAccess",
          tableName: "identity",
          items: FIRST_BUILD_SLICE_FIXTURE.filter((record) => record.tableKey === "identityAccess").map(toDynamoItem)
        },
        {
          tableKey: "studySetup",
          tableName: "study",
          items: FIRST_BUILD_SLICE_FIXTURE.filter((record) => record.tableKey === "studySetup").map(toDynamoItem)
        },
        {
          tableKey: "versionedConfiguration",
          tableName: "config",
          items: FIRST_BUILD_SLICE_FIXTURE.filter((record) => record.tableKey === "versionedConfiguration").map(
            toDynamoItem
          )
        },
        {
          tableKey: "runLifecycle",
          tableName: "runs",
          items: FIRST_BUILD_SLICE_FIXTURE.filter((record) => record.tableKey === "runLifecycle").map(toDynamoItem)
        },
        {
          tableKey: "evidenceScoring",
          tableName: "scoring",
          items: FIRST_BUILD_SLICE_FIXTURE.filter((record) => record.tableKey === "evidenceScoring").map(toDynamoItem)
        },
        {
          tableKey: "operations",
          tableName: "operations",
          items: FIRST_BUILD_SLICE_FIXTURE.filter((record) => record.tableKey === "operations").map(toDynamoItem)
        }
      ],
      "researcher@example.test"
    );

    expect(plan.userIds).toEqual(["user_researcher_001"]);
    expect(plan.studyIds).toEqual(["study_formative_001"]);
    expect(plan.runIds).toEqual(["run_fixture_001"]);
    expect(plan.deleteCandidates).toHaveLength(FIRST_BUILD_SLICE_FIXTURE.length - 1);
    expect(plan.deleteCandidates.map((candidate) => candidate.entity)).not.toContain("interviewer_persona_version");
  });

  it("does not delete anything when the email has no user record", () => {
    const plan = planClearTestUser(
      [
        {
          tableKey: "identityAccess",
          tableName: "identity",
          items: FIRST_BUILD_SLICE_FIXTURE.map(toDynamoItem)
        }
      ],
      "missing@example.test"
    );

    expect(plan.deleteCandidates).toEqual([]);
  });
});
