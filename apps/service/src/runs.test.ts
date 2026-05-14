import { describe, expect, it } from "vitest";
import { InMemoryConsentVersionStore } from "./consent.js";
import {
  InMemoryObjectiveVersionStore,
  type ObjectiveVersion
} from "./objectives.js";
import { InMemoryParticipantSlotStore } from "./participant-slots.js";
import { InMemorySurveyVersionStore } from "./survey.js";
import {
  RUN_STATUSES,
  InMemoryParticipantAccessTokenStore,
  InMemoryRunStore,
  RunService,
  RunValidationError,
  applyRunStatusTransition,
  isRunStatusTransitionAllowed,
  type Run,
  type RunStatus
} from "./runs.js";

function createFixtureRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_fixture_001",
    studyId: "study_fixture_001",
    participantSlotId: "slot_fixture_001",
    consentVersionId: "consent_version_active",
    surveyVersionId: "survey_version_active",
    personaVersionId: "persona_version_v1_default_001",
    objectiveVersionIds: ["objective_version_001"],
    freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
    maxInterviewMinutes: 45,
    status: "created",
    currentRunForSlot: true,
    createdAt: "2026-05-06T12:00:00.000Z",
    updatedAt: "2026-05-06T12:00:00.000Z",
    ...overrides
  };
}

const participantSlotStore = new InMemoryParticipantSlotStore([
  {
    id: "slot_fixture_001",
    studyId: "study_fixture_001",
    participantCode: "P001",
    codeSource: "researcher_supplied",
    status: "active",
    createdAt: "2026-05-06T12:00:00.000Z",
    updatedAt: "2026-05-06T12:00:00.000Z"
  }
]);

const objectiveVersionStore = new InMemoryObjectiveVersionStore([
  {
    id: "objective_version_001",
    studyId: "study_fixture_001",
    objectiveKey: "reasoning_quality",
    versionNumber: 1,
    title: "Reasoning Quality",
    description: "Reasoning.",
    gradeScale: ["1", "2"],
    gradeExamples: [],
    evidenceRequirements: "Use evidence.",
    sortOrder: 1,
    isEnabled: true,
    isActive: true,
    createdAt: "2026-05-06T12:00:00.000Z"
  } satisfies ObjectiveVersion
]);

function createRunService(runStore: InMemoryRunStore) {
  return new RunService(
    runStore,
    new InMemoryParticipantAccessTokenStore(),
    participantSlotStore,
    objectiveVersionStore,
    new InMemoryConsentVersionStore(),
    new InMemorySurveyVersionStore(),
    {
      now: () => new Date("2026-05-06T12:15:00.000Z"),
      participantAccessTokenSecret: "test-participant-secret"
    }
  );
}

describe("run state machine", () => {
  const allowedTransitions = new Set(
    (
      [
        ["created", "consented"],
        ["consented", "survey_in_progress"],
        ["survey_in_progress", "survey_completed"],
        ["survey_completed", "interview_in_progress"],
        ["interview_in_progress", "interview_completed"],
        ["interview_completed", "scored"],
        ["interview_in_progress", "interview_paused"],
        ["interview_paused", "interview_in_progress"],
        ["survey_in_progress", "stale"],
        ["survey_completed", "stale"],
        ["interview_in_progress", "stale"],
        ["interview_paused", "stale"],
        ["interview_in_progress", "technical_interruption"],
        ["technical_interruption", "scored"],
        ["survey_completed", "partial"],
        ["interview_paused", "partial"],
        ["technical_interruption", "partial"],
        ["partial", "scored"],
        ["stale", "scored"]
      ] satisfies readonly (readonly [RunStatus, RunStatus])[]
    ).map(([from, to]) => `${from}->${to}`)
  );

  it("supports the happy path transitions", () => {
    let run = createFixtureRun();

    for (const status of [
      "consented",
      "survey_in_progress",
      "survey_completed",
      "interview_in_progress",
      "interview_completed",
      "scored"
    ] satisfies readonly RunStatus[]) {
      run = applyRunStatusTransition(run, status, new Date("2026-05-06T12:15:00.000Z"));
      expect(run.status).toBe(status);
    }
  });

  it("supports pause, resume, stale, technical interruption, partial, and scoring paths", () => {
    expect(
      applyRunStatusTransition(
        createFixtureRun({ status: "interview_in_progress" }),
        "interview_paused",
        new Date("2026-05-06T12:15:00.000Z")
      ).status
    ).toBe("interview_paused");
    expect(
      applyRunStatusTransition(
        createFixtureRun({ status: "interview_paused" }),
        "interview_in_progress",
        new Date("2026-05-06T12:15:00.000Z")
      ).status
    ).toBe("interview_in_progress");

    const staleSourceStatuses = [
      "survey_in_progress",
      "survey_completed",
      "interview_in_progress",
      "interview_paused"
    ] satisfies readonly RunStatus[];

    for (const status of staleSourceStatuses) {
      expect(
        applyRunStatusTransition(createFixtureRun({ status }), "stale", new Date("2026-05-06T12:15:00.000Z")).status
      ).toBe("stale");
    }

    expect(
      applyRunStatusTransition(
        createFixtureRun({ status: "interview_in_progress" }),
        "technical_interruption",
        new Date("2026-05-06T12:15:00.000Z")
      ).status
    ).toBe("technical_interruption");

    const partialSourceStatuses = [
      "survey_completed",
      "interview_paused",
      "technical_interruption"
    ] satisfies readonly RunStatus[];

    for (const status of partialSourceStatuses) {
      expect(
        applyRunStatusTransition(createFixtureRun({ status }), "partial", new Date("2026-05-06T12:15:00.000Z")).status
      ).toBe("partial");
    }

    for (const status of ["stale", "technical_interruption", "partial"] satisfies readonly RunStatus[]) {
      expect(
        applyRunStatusTransition(createFixtureRun({ status }), "scored", new Date("2026-05-06T12:15:00.000Z")).status
      ).toBe("scored");
    }
  });

  it("rejects every disallowed non-idempotent transition", () => {
    for (const from of RUN_STATUSES) {
      for (const to of RUN_STATUSES) {
        const isAllowed = allowedTransitions.has(`${from}->${to}`);

        expect(isRunStatusTransitionAllowed(from, to)).toBe(isAllowed || from === to);

        if (!isAllowed && from !== to) {
          expect(() =>
            applyRunStatusTransition(createFixtureRun({ status: from }), to, new Date("2026-05-06T12:15:00.000Z"))
          ).toThrow(RunValidationError);
        }
      }
    }
  });

  it("keeps retries idempotent without changing update timestamps", () => {
    const run = createFixtureRun({
      status: "survey_completed",
      updatedAt: "2026-05-06T12:10:00.000Z"
    });
    const transitionedRun = applyRunStatusTransition(run, "survey_completed", new Date("2026-05-06T12:15:00.000Z"));

    expect(transitionedRun).toBe(run);
    expect(transitionedRun.updatedAt).toBe("2026-05-06T12:10:00.000Z");
  });

  it("persists valid service transitions and leaves idempotent retries unchanged", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun()]);
    const service = createRunService(runStore);
    const transitionedRun = await service.transitionRunStatus("run_fixture_001", "consented");
    const retriedRun = await service.transitionRunStatus("run_fixture_001", "consented");

    expect(transitionedRun).toMatchObject({
      id: "run_fixture_001",
      status: "consented",
      updatedAt: "2026-05-06T12:15:00.000Z"
    });
    expect(retriedRun).toEqual(transitionedRun);
    await expect(service.transitionRunStatus("run_fixture_001", "interview_completed")).rejects.toBeInstanceOf(
      RunValidationError
    );
    await expect(service.transitionRunStatus("run_missing", "consented")).rejects.toMatchObject({
      safeMessage: "Run was not found."
    });
  });
});
