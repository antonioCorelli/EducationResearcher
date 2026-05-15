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
  createParticipantAccessTokenForTest,
  hashParticipantAccessTokenForTest,
  isRunStatusTransitionAllowed,
  type Run,
  type RunStatus,
  type SurveyResponse,
  type StaleRunScoringTriggerInput
} from "./runs.js";
import type { GapMapGenerator } from "./gap-map.js";
import type { SurveyVersion } from "./survey.js";

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

function createSurveyVersion(): SurveyVersion {
  return {
    id: "survey_version_active",
    studyId: "study_fixture_001",
    versionNumber: 1,
    isActive: true,
    createdAt: "2026-05-06T12:00:00.000Z",
    layoutItems: [
      {
        type: "question",
        sortOrder: 1,
        question: {
          id: "survey_question_001",
          surveyVersionId: "survey_version_active",
          prompt: "What did you notice first?",
          required: true,
          questionType: "long_text",
          sortOrder: 1,
          createdAt: "2026-05-06T12:00:00.000Z"
        }
      }
    ],
    groups: [],
    ungroupedQuestions: [
      {
        id: "survey_question_001",
        surveyVersionId: "survey_version_active",
        prompt: "What did you notice first?",
        required: true,
        questionType: "long_text",
        sortOrder: 1,
        createdAt: "2026-05-06T12:00:00.000Z"
      }
    ]
  };
}

function createParticipantRunService(input: {
  readonly runStore: InMemoryRunStore;
  readonly createInterviewSessionId?: () => string;
  readonly gapMapGenerator?: GapMapGenerator;
  readonly now?: () => Date;
}) {
  const rawToken = createParticipantAccessTokenForTest({
    tokenId: "token_fixture_gap_map",
    runId: "run_fixture_001",
    participantSlotId: "slot_fixture_001",
    secret: "test-participant-secret"
  });

  return {
    rawToken,
    service: new RunService(
      input.runStore,
      new InMemoryParticipantAccessTokenStore([
        {
          id: "participant_access_token_gap_map",
          tokenId: "token_fixture_gap_map",
          tokenHash: hashParticipantAccessTokenForTest(rawToken),
          studyId: "study_fixture_001",
          participantSlotId: "slot_fixture_001",
          runId: "run_fixture_001",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      participantSlotStore,
      objectiveVersionStore,
      new InMemoryConsentVersionStore(),
      new InMemorySurveyVersionStore([createSurveyVersion()]),
      {
        createGapMapId: () => "gap_map_fixture_001",
        createInterviewSessionId: input.createInterviewSessionId,
        createSurveyResponseId: () => "survey_response_fixture_001",
        now: input.now ?? (() => new Date("2026-05-06T12:20:00.000Z")),
        participantAccessTokenSecret: "test-participant-secret"
      },
      input.gapMapGenerator
    )
  };
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

describe("run freshness enforcement", () => {
  it("allows participant access before the freshness deadline and blocks it at and after the deadline", async () => {
    const deadline = "2026-05-20T12:00:00.000Z";

    const beforeStore = new InMemoryRunStore([createFixtureRun({ status: "consented", freshnessDeadlineAt: deadline })]);
    const before = createParticipantRunService({
      runStore: beforeStore,
      now: () => new Date("2026-05-20T11:59:59.999Z")
    });

    await expect(before.service.validateParticipantAccess(before.rawToken)).resolves.toMatchObject({
      run: {
        id: "run_fixture_001",
        status: "consented",
        freshnessDeadlineAt: deadline
      }
    });

    for (const nowIso of ["2026-05-20T12:00:00.000Z", "2026-05-20T12:00:00.001Z"]) {
      const runStore = new InMemoryRunStore([createFixtureRun({ status: "consented", freshnessDeadlineAt: deadline })]);
      const { rawToken, service } = createParticipantRunService({
        runStore,
        now: () => new Date(nowIso)
      });

      await expect(service.validateParticipantAccess(rawToken)).rejects.toMatchObject({
        safeMessage: "This participant link is not available."
      });
    }
  });

  it("sweeps stale runs at the deadline, preserves artifacts, and triggers stale partial scoring context", async () => {
    const runStore = new InMemoryRunStore([
      createFixtureRun({
        status: "consented",
        freshnessDeadlineAt: "2026-05-20T12:00:00.000Z"
      }),
      createFixtureRun({
        id: "run_future_001",
        participantSlotId: "slot_fixture_002",
        status: "survey_completed",
        freshnessDeadlineAt: "2026-05-20T12:00:00.001Z"
      }),
      createFixtureRun({
        id: "run_other_study_001",
        studyId: "study_other_001",
        status: "survey_completed",
        freshnessDeadlineAt: "2026-05-20T12:00:00.000Z"
      })
    ]);
    const surveyResponse: SurveyResponse = {
      id: "survey_response_stale_001",
      studyId: "study_fixture_001",
      participantSlotId: "slot_fixture_001",
      runId: "run_fixture_001",
      surveyVersionId: "survey_version_active",
      surveyQuestionId: "survey_question_001",
      responseText: "The example changed my reasoning.",
      submittedAt: "2026-05-19T12:00:00.000Z",
      createdAt: "2026-05-19T12:00:00.000Z"
    };
    const scoringTriggers: StaleRunScoringTriggerInput[] = [];
    const service = new RunService(
      runStore,
      new InMemoryParticipantAccessTokenStore(),
      participantSlotStore,
      objectiveVersionStore,
      new InMemoryConsentVersionStore(),
      new InMemorySurveyVersionStore([createSurveyVersion()]),
      {
        now: () => new Date("2026-05-20T12:00:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret",
        staleRunScoringTrigger: {
          async triggerStaleRunScoring(input) {
            scoringTriggers.push(input);
          }
        }
      }
    );

    await runStore.submitSurvey(
      [surveyResponse],
      createFixtureRun({
        status: "survey_completed",
        freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-19T12:00:00.000Z"
      }),
      "consented"
    );
    await runStore.saveGapMap({
      id: "gap_map_stale_001",
      studyId: "study_fixture_001",
      participantSlotId: "slot_fixture_001",
      runId: "run_fixture_001",
      surveyVersionId: "survey_version_active",
      objectiveVersionIds: ["objective_version_001"],
      status: "generated",
      modelName: "fake-gap-map",
      modelVersion: "local-1",
      serviceRequestId: "fake-gap-map-request",
      promptVersion: "gap-map-v1",
      alreadyAnswered: ["The survey captured a change in reasoning."],
      ambiguities: [],
      contradictions: [],
      missingEvidence: ["Need interview evidence."],
      recommendedProbes: ["What example changed your reasoning?"],
      generatedAt: "2026-05-19T12:01:00.000Z",
      createdAt: "2026-05-19T12:01:00.000Z"
    });

    const result = await service.sweepStaleRunsForStudy("study_fixture_001");

    expect(result.staleRuns).toEqual([
      expect.objectContaining({
        id: "run_fixture_001",
        status: "stale",
        updatedAt: "2026-05-20T12:00:00.000Z"
      })
    ]);
    expect(await runStore.getById("run_future_001")).toMatchObject({ status: "survey_completed" });
    expect(await runStore.getById("run_other_study_001")).toMatchObject({ status: "survey_completed" });
    expect(await runStore.listSurveyResponsesByRun("run_fixture_001")).toEqual([surveyResponse]);
    expect(await runStore.listGapMapsByRun("run_fixture_001")).toEqual([
      expect.objectContaining({
        id: "gap_map_stale_001",
        status: "generated"
      })
    ]);
    expect(scoringTriggers).toEqual([
      expect.objectContaining({
        previousStatus: "survey_completed",
        triggeredAt: "2026-05-20T12:00:00.000Z",
        run: expect.objectContaining({
          id: "run_fixture_001",
          status: "stale"
        }),
        context: {
          staleRun: true,
          partialRun: true
        }
      })
    ]);
  });
});

describe("gap map generation", () => {
  it("generates and persists a structured gap map after survey completion", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "consented" })]);
    const { rawToken, service } = createParticipantRunService({ runStore });
    const result = await service.submitParticipantSurvey(rawToken, {
      responses: [
        {
          surveyQuestionId: "survey_question_001",
          responseText: "I noticed the diagram first, but I am not sure why the labels changed my reasoning."
        }
      ]
    });

    expect(result.gapMap).toMatchObject({
      id: "gap_map_fixture_001",
      runId: "run_fixture_001",
      surveyVersionId: "survey_version_active",
      objectiveVersionIds: ["objective_version_001"],
      status: "generated",
      modelName: "fake-gap-map",
      modelVersion: "local-1",
      serviceRequestId: "fake-gap-map-request",
      promptVersion: "gap-map-v1",
      generatedAt: "2026-05-06T12:20:00.000Z",
      contradictions: [
        {
          priority: "high"
        }
      ]
    });
    expect(await runStore.listGapMapsByRun("run_fixture_001")).toEqual([result.gapMap]);
  });

  it("persists a failed gap map artifact when AI output is invalid without losing survey data", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "consented" })]);
    const { rawToken, service } = createParticipantRunService({
      runStore,
      gapMapGenerator: {
        async generate() {
          return {
            modelName: "fake-gap-map",
            modelVersion: "local-1",
            alreadyAnswered: "not a list"
          };
        }
      }
    });
    const result = await service.submitParticipantSurvey(rawToken, {
      responses: [
        {
          surveyQuestionId: "survey_question_001",
          responseText: "I noticed the diagram first."
        }
      ]
    });

    expect(result.run.status).toBe("survey_completed");
    expect(await runStore.listSurveyResponsesByRun("run_fixture_001")).toHaveLength(1);
    expect(result.gapMap).toMatchObject({
      status: "failed",
      failureCategory: "invalid_ai_output",
      modelName: "unknown",
      modelVersion: "unknown",
      serviceRequestId: "unknown",
      promptVersion: "unknown"
    });
  });

  it("persists a failed gap map artifact when the AI provider fails without losing survey data", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "consented" })]);
    const { rawToken, service } = createParticipantRunService({
      runStore,
      gapMapGenerator: {
        async generate() {
          throw new Error("provider unavailable");
        }
      }
    });
    const result = await service.submitParticipantSurvey(rawToken, {
      responses: [
        {
          surveyQuestionId: "survey_question_001",
          responseText: "I noticed the diagram first."
        }
      ]
    });

    expect(result.run.status).toBe("survey_completed");
    expect(await runStore.listSurveyResponsesByRun("run_fixture_001")).toHaveLength(1);
    expect(result.gapMap).toMatchObject({
      status: "failed",
      failureCategory: "provider_failure"
    });
  });
});

describe("interview session lifecycle", () => {
  it("starts, pauses, resumes, and completes numbered interview sessions", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "survey_completed" })]);
    let sessionSequence = 0;
    const { rawToken, service } = createParticipantRunService({
      runStore,
      createInterviewSessionId: () => `interview_session_fixture_00${++sessionSequence}`
    });

    const started = await service.startParticipantInterview(rawToken);
    const repeatedStart = await service.startParticipantInterview(rawToken);
    const paused = await service.pauseParticipantInterview(rawToken);
    const resumed = await service.resumeParticipantInterview(rawToken);
    const completed = await service.completeParticipantInterview(rawToken);

    expect(started).toMatchObject({
      interviewSession: {
        id: "interview_session_fixture_001",
        runId: "run_fixture_001",
        sessionNumber: 1,
        status: "active",
        startedAt: "2026-05-06T12:20:00.000Z"
      },
      run: {
        status: "interview_in_progress"
      }
    });
    expect(repeatedStart.interviewSession).toEqual(started.interviewSession);
    expect(paused).toMatchObject({
      interviewSession: {
        id: "interview_session_fixture_001",
        sessionNumber: 1,
        status: "paused",
        endedAt: "2026-05-06T12:20:00.000Z"
      },
      run: {
        status: "interview_paused"
      }
    });
    expect(resumed).toMatchObject({
      interviewSession: {
        id: "interview_session_fixture_002",
        sessionNumber: 2,
        status: "active"
      },
      run: {
        status: "interview_in_progress"
      }
    });
    expect(completed).toMatchObject({
      interviewSession: {
        id: "interview_session_fixture_002",
        sessionNumber: 2,
        status: "completed",
        endedAt: "2026-05-06T12:20:00.000Z"
      },
      run: {
        status: "interview_completed"
      }
    });
    expect(await runStore.listInterviewSessionsByRun("run_fixture_001")).toEqual([
      expect.objectContaining({ id: "interview_session_fixture_002", sessionNumber: 2, status: "completed" }),
      expect.objectContaining({ id: "interview_session_fixture_001", sessionNumber: 1, status: "paused" })
    ]);
  });

  it("blocks interview lifecycle changes when the participant run is stale", async () => {
    const runStore = new InMemoryRunStore([
      createFixtureRun({
        status: "survey_completed",
        freshnessDeadlineAt: "2026-05-06T12:19:59.000Z"
      })
    ]);
    const { rawToken, service } = createParticipantRunService({ runStore });

    await expect(service.startParticipantInterview(rawToken)).rejects.toMatchObject({
      safeMessage: "This participant link is not available."
    });
    expect(await runStore.listInterviewSessionsByRun("run_fixture_001")).toEqual([]);
  });

  it("records a safe interruption status and preserves the interrupted session", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "survey_completed" })]);
    const { rawToken, service } = createParticipantRunService({
      runStore,
      createInterviewSessionId: () => "interview_session_interrupted_001"
    });

    await service.startParticipantInterview(rawToken);
    await expect(
      service.interruptParticipantInterview(rawToken, {
        safeStatus: "provider_error"
      })
    ).rejects.toMatchObject({
      safeMessage: "Interview interruption status is invalid."
    });
    const interrupted = await service.interruptParticipantInterview(rawToken, {
      safeStatus: "unable_to_complete_interview"
    });

    expect(interrupted).toMatchObject({
      interviewSession: {
        id: "interview_session_interrupted_001",
        sessionNumber: 1,
        status: "interrupted",
        safeStatus: "unable_to_complete_interview",
        endedAt: "2026-05-06T12:20:00.000Z"
      },
      run: {
        status: "technical_interruption"
      }
    });
    expect(await runStore.listInterviewSessionsByRun("run_fixture_001")).toEqual([
      expect.objectContaining({
        id: "interview_session_interrupted_001",
        status: "interrupted",
        safeStatus: "unable_to_complete_interview"
      })
    ]);
  });

  it("persists transcript turns, audio asset metadata, and session rollups for scoring evidence", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "survey_completed" })]);
    let turnSequence = 0;
    const { rawToken, service } = createParticipantRunService({
      runStore,
      createInterviewSessionId: () => "interview_session_artifacts_001"
    });
    const artifactService = new RunService(
      runStore,
      new InMemoryParticipantAccessTokenStore([
        {
          id: "participant_access_token_gap_map",
          tokenId: "token_fixture_gap_map",
          tokenHash: hashParticipantAccessTokenForTest(rawToken),
          studyId: "study_fixture_001",
          participantSlotId: "slot_fixture_001",
          runId: "run_fixture_001",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        }
      ]),
      participantSlotStore,
      objectiveVersionStore,
      new InMemoryConsentVersionStore(),
      new InMemorySurveyVersionStore([createSurveyVersion()]),
      {
        createInterviewAudioAssetId: () => "interview_audio_asset_artifacts_001",
        createInterviewTurnId: () => `interview_turn_artifacts_00${++turnSequence}`,
        now: () => new Date("2026-05-06T12:24:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret"
      }
    );

    await service.startParticipantInterview(rawToken);
    const saved = await artifactService.saveParticipantInterviewArtifacts(rawToken, {
      turns: [
        {
          speaker: "ai",
          text: "Could you share a concrete example?",
          audioStartMs: 1000,
          audioEndMs: 3200
        },
        {
          speaker: "participant",
          text: "The worked example helped me compare the two methods.",
          audioStartMs: 3300,
          audioEndMs: 8700
        }
      ],
      audioAsset: {
        storageUri: "s3://education-researcher-local/study_fixture_001/run_fixture_001/audio/session.wav",
        durationSeconds: 8.7,
        mimeType: "audio/wav",
        byteSize: 2048
      },
      transcriptTokenCount: 19
    });

    expect(saved).toMatchObject({
      interviewSession: {
        id: "interview_session_artifacts_001",
        audioDurationSeconds: 8.7,
        transcriptTokenCount: 19,
        updatedAt: "2026-05-06T12:24:00.000Z"
      },
      turns: [
        {
          id: "interview_turn_artifacts_001",
          speaker: "ai",
          text: "Could you share a concrete example?",
          audioStartMs: 1000,
          audioEndMs: 3200
        },
        {
          id: "interview_turn_artifacts_002",
          speaker: "participant",
          text: "The worked example helped me compare the two methods.",
          audioStartMs: 3300,
          audioEndMs: 8700
        }
      ],
      audioAsset: {
        id: "interview_audio_asset_artifacts_001",
        storageUri: "s3://education-researcher-local/study_fixture_001/run_fixture_001/audio/session.wav",
        durationSeconds: 8.7,
        status: "available"
      }
    });
    expect(await runStore.listInterviewTurnsByRun("run_fixture_001")).toEqual(saved.turns);
    expect(await runStore.listInterviewAudioAssetsByRun("run_fixture_001")).toEqual([saved.audioAsset]);
    expect(await runStore.listInterviewSessionsByRun("run_fixture_001")).toEqual([
      expect.objectContaining({
        id: "interview_session_artifacts_001",
        audioDurationSeconds: 8.7,
        transcriptTokenCount: 19
      })
    ]);
  });
});
