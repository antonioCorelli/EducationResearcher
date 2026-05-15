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

  it("keeps remaining intentionally deferred entities out of the schema", () => {
    expect(DEFERRED_SCHEMA_ENTITIES.map((entry) => entry.entity)).toEqual([
      "study_membership",
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
        "participant_access_token",
        "scoring_run",
        "objective_score",
        "evidence_citation",
        "operational_event",
        "audit_log"
      ])
    );
  });

  it("stores immutable configuration references on run fixtures", () => {
    const runDefinition = getEntityDefinition("run")?.definition;
    const run = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "run");

    expect(runDefinition?.requiredAttributes).toEqual(
      expect.arrayContaining([
        "status",
        "freshnessDeadlineAt",
        "currentRunForSlot"
      ])
    );
    expect(run?.attributes).toMatchObject({
      consentVersionId: "consent_version_001",
      surveyVersionId: "survey_version_001",
      personaVersionId: "persona_version_v1_default_001",
      objectiveVersionIds: ["objective_version_001"],
      status: "scored"
    });
  });

  it("seeds the fixed V1 interviewer persona with participant-safe interview boundaries", () => {
    const personaDefinition = getEntityDefinition("interviewer_persona_version")?.definition;
    const persona = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "interviewer_persona_version");
    const stylePrompt = persona?.attributes.stylePrompt;

    expect(personaDefinition?.requiredAttributes).toEqual(
      expect.arrayContaining(["id", "name", "versionNumber", "label", "stylePrompt", "isDefault"])
    );
    expect(persona).toMatchObject({
      pk: "PERSONA#v1_default",
      sk: "VERSION#1",
      gsi3pk: "PERSONA_DEFAULT#true",
      attributes: {
        id: "persona_version_v1_default_001",
        name: "v1_default",
        versionNumber: 1,
        label: "V1 default research interviewer",
        isDefault: true
      }
    });
    expect(stylePrompt).toEqual(expect.any(String));
    expect(stylePrompt).toContain("calm, warm, neutral, curious, and non-evaluative");
    expect(stylePrompt).toContain("ask one question at a time");
    expect(stylePrompt).toContain("Do not reveal scoring objectives, rubrics, grades, scores");
    expect(stylePrompt).toContain("gap map internals");
  });

  it("defines participant access token records without storing raw bearer tokens", () => {
    const participantAccessToken = getEntityDefinition("participant_access_token")?.definition;
    const fixtureParticipantAccessToken = FIRST_BUILD_SLICE_FIXTURE.find(
      (record) => record.entity === "participant_access_token"
    );

    expect(participantAccessToken?.requiredAttributes).toEqual(
      expect.arrayContaining(["tokenId", "tokenHash", "studyId", "participantSlotId", "runId", "status"])
    );
    expect(fixtureParticipantAccessToken?.attributes).toMatchObject({
      tokenId: "token_fixture_001",
      tokenHash: "sha256-fixture-token-hash",
      studyId: "study_formative_001",
      participantSlotId: "slot_fixture_001",
      runId: "run_fixture_001",
      status: "active"
    });
    expect(fixtureParticipantAccessToken?.attributes).not.toHaveProperty("token");
    expect(fixtureParticipantAccessToken?.attributes).not.toHaveProperty("rawToken");
  });

  it("declares survey questions as required long-form text", () => {
    const surveyQuestion = getEntityDefinition("survey_question")?.definition;
    const fixtureSurveyQuestion = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "survey_question");

    expect(surveyQuestion?.requiredAttributes).toEqual(
      expect.arrayContaining(["prompt", "required", "questionType", "sortOrder"])
    );
    expect(fixtureSurveyQuestion?.attributes).toMatchObject({
      required: true,
      questionType: "long_text"
    });
  });

  it("captures versioned consent fields and participant acceptance references", () => {
    const consentVersion = getEntityDefinition("consent_version")?.definition;
    const consentRecord = getEntityDefinition("consent_record")?.definition;
    const fixtureConsentRecord = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "consent_record");

    expect(consentVersion?.requiredAttributes).toEqual(
      expect.arrayContaining(["versionNumber", "consentText", "consentMethod", "isActive"])
    );
    expect(consentRecord?.requiredAttributes).toEqual(
      expect.arrayContaining(["studyId", "participantSlotId", "runId", "consentVersionId", "renderedConsentSnapshot"])
    );
    expect(fixtureConsentRecord?.attributes).toMatchObject({
      studyId: "study_formative_001",
      participantSlotId: "slot_fixture_001",
      runId: "run_fixture_001",
      consentVersionId: "consent_version_001"
    });
  });

  it("captures versioned scoring objective rubric fields", () => {
    const objectiveVersion = getEntityDefinition("objective_version")?.definition;
    const gradeExample = getEntityDefinition("objective_grade_example")?.definition;
    const fixtureObjectiveVersion = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "objective_version");
    const fixtureGradeExample = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "objective_grade_example");

    expect(objectiveVersion?.requiredAttributes).toEqual(
      expect.arrayContaining([
        "objectiveKey",
        "versionNumber",
        "title",
        "description",
        "gradeScale",
        "evidenceRequirements",
        "sortOrder",
        "isEnabled",
        "isActive"
      ])
    );
    expect(gradeExample?.requiredAttributes).toEqual(
      expect.arrayContaining(["objectiveVersionId", "gradeLabel", "exampleText", "sortOrder"])
    );
    expect(fixtureObjectiveVersion?.attributes).toMatchObject({
      objectiveKey: "reasoning_quality",
      gradeScale: ["1", "2", "3", "4"],
      sortOrder: 1,
      isEnabled: true,
      isActive: true
    });
    expect(fixtureGradeExample?.attributes).toMatchObject({
      objectiveVersionId: "objective_version_001",
      gradeLabel: "4"
    });
  });

  it("captures AI model metadata and safe provider categories", () => {
    const gapMapDefinition = getEntityDefinition("gap_map")?.definition;
    const scoringRunDefinition = getEntityDefinition("scoring_run")?.definition;
    const operationalEventDefinition = getEntityDefinition("operational_event")?.definition;
    const gapMap = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "gap_map");
    const scoringRun = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "scoring_run");
    const operationalEvent = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "operational_event");

    expect(gapMapDefinition?.requiredAttributes).toEqual(
      expect.arrayContaining(["modelName", "modelVersion", "serviceRequestId", "promptVersion"])
    );
    expect(scoringRunDefinition?.requiredAttributes).toEqual(
      expect.arrayContaining(["modelName", "modelVersion", "serviceRequestId", "promptVersion"])
    );
    expect(operationalEventDefinition?.statusAttributes).toEqual(expect.arrayContaining(["modelApiErrorCategory"]));
    expect(gapMap?.attributes).toMatchObject({
      modelName: "fake-gap-map",
      modelVersion: "local-1",
      serviceRequestId: "req_gap_map_fixture_001",
      promptVersion: "gap-map-v1"
    });
    expect(scoringRun?.attributes).toMatchObject({
      modelName: "fake-scoring",
      modelVersion: "local-1",
      serviceRequestId: "req_scoring_fixture_001",
      promptVersion: "scoring-v1"
    });
    expect(operationalEvent?.attributes).toMatchObject({
      modelApiErrorCategory: "service_unavailable"
    });
  });

  it("documents persisted interview transcript and audio artifact metadata", () => {
    const interviewSession = getEntityDefinition("interview_session")?.definition;
    const interviewTurn = getEntityDefinition("interview_turn")?.definition;
    const audioAsset = getEntityDefinition("interview_audio_asset")?.definition;
    const fixtureSession = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "interview_session");
    const fixtureTurn = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "interview_turn");
    const fixtureAudioAsset = FIRST_BUILD_SLICE_FIXTURE.find((record) => record.entity === "interview_audio_asset");

    expect(interviewSession?.description).toContain("audio duration and transcript token rollups");
    expect(interviewTurn?.requiredAttributes).toEqual(
      expect.arrayContaining(["runId", "interviewSessionId", "speaker", "text"])
    );
    expect(audioAsset?.requiredAttributes).toEqual(
      expect.arrayContaining(["runId", "interviewSessionId", "storageUri", "durationSeconds"])
    );
    expect(fixtureSession?.attributes).toMatchObject({
      audioDurationSeconds: 1200,
      transcriptTokenCount: 450
    });
    expect(fixtureTurn?.attributes).toMatchObject({
      speaker: "participant",
      audioStartMs: 60000,
      audioEndMs: 68000
    });
    expect(fixtureAudioAsset?.attributes).toMatchObject({
      storageUri: "s3://education-researcher-local-fixtures/study_formative_001/run_fixture_001/audio.wav",
      durationSeconds: 1200,
      status: "available"
    });
  });
});
