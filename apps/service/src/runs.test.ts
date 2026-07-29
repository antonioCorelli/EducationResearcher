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
  type InterviewSession,
  type AutomaticRunScoringTriggerInput,
  type StaleRunScoringTriggerInput
} from "./runs.js";
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
    allowWrittenInterviewResponses: true,
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
  readonly newVoiceModelEnabled?: boolean;
  readonly now?: () => Date;
}) {
  const rawToken = createParticipantAccessTokenForTest({
    tokenId: "token_fixture_participant",
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
          id: "participant_access_token_fixture",
          tokenId: "token_fixture_participant",
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
        createInterviewSessionId: input.createInterviewSessionId,
        createSurveyResponseId: () => "survey_response_fixture_001",
        newVoiceModelEnabled: input.newVoiceModelEnabled,
        now: input.now ?? (() => new Date("2026-05-06T12:20:00.000Z")),
        participantAccessTokenSecret: "test-participant-secret"
      }
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
        ["interview_paused", "interview_completed"],
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
    expect(
      applyRunStatusTransition(
        createFixtureRun({ status: "interview_paused" }),
        "interview_completed",
        new Date("2026-05-06T12:15:00.000Z")
      ).status
    ).toBe("interview_completed");

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
    const automaticScoringTriggers: AutomaticRunScoringTriggerInput[] = [];
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
        },
        automaticScoringTrigger: {
          async triggerAutomaticScoring(input) {
            automaticScoringTriggers.push(input);
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
    expect(automaticScoringTriggers).toEqual([
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

describe("survey to interview readiness", () => {
  it("stores the survey and returns interview readiness without generating an intermediate artifact", async () => {
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

    expect(result).toMatchObject({
      run: {
        status: "survey_completed",
        remainingInterviewSeconds: 2700
      },
      surveyResponses: [
        {
          id: "survey_response_fixture_001",
          responseText: "I noticed the diagram first, but I am not sure why the labels changed my reasoning."
        }
      ]
    });
    expect(result).not.toHaveProperty(["gap", "Map"].join(""));
  });

  it("passes snapshot interviewer instructions into realtime interview context", async () => {
    const activeRun = createFixtureRun({
      status: "interview_in_progress",
      interviewerInstructions: "Clarify learner confidence and gather concrete examples."
    });
    const runStore = new InMemoryRunStore([activeRun]);
    const capturedInstructions: string[] = [];
    const capturedVoiceExperiences: string[] = [];
    await runStore.submitSurvey(
      [
        {
          id: "survey_response_fixture_001",
          studyId: activeRun.studyId,
          participantSlotId: activeRun.participantSlotId,
          runId: activeRun.id,
          surveyVersionId: activeRun.surveyVersionId,
          surveyQuestionId: "survey_question_001",
          responseText: "I noticed the diagram first.",
          submittedAt: "2026-05-06T12:16:00.000Z",
          createdAt: "2026-05-06T12:16:00.000Z"
        }
      ],
      activeRun,
      "interview_in_progress"
    );
    await runStore.createInterviewSession(
      {
        id: "interview_session_active_001",
        studyId: activeRun.studyId,
        participantSlotId: activeRun.participantSlotId,
        runId: activeRun.id,
        sessionNumber: 1,
        status: "active",
        startedAt: "2026-05-06T12:18:00.000Z",
        createdAt: "2026-05-06T12:18:00.000Z",
        updatedAt: "2026-05-06T12:18:00.000Z"
      },
      activeRun,
      "interview_in_progress"
    );
    const { rawToken, service } = createParticipantRunService({
      newVoiceModelEnabled: true,
      runStore
    });

    await service.createParticipantRealtimeVoiceSession(
      rawToken,
      {
        async createSession(request) {
          capturedInstructions.push(request.instructions);
          capturedVoiceExperiences.push(request.voiceExperience);

          return {
            provider: "fake",
            model: "fake-realtime",
            voice: "fake-voice",
            clientSecret: "client-secret",
            realtimeUrl: "https://api.openai.com/v1/realtime/calls",
            serviceRequestId: "req_realtime_fixture_001",
            promptVersion: request.promptVersion
          };
        }
      },
      { voiceExperience: "new_voice" }
    );

    expect(capturedVoiceExperiences).toEqual(["new_voice"]);
    expect(capturedInstructions[0]).toContain("Clarify learner confidence and gather concrete examples.");
    expect(capturedInstructions[0]).toContain("Researcher instructions for interviewer planning only");
    expect(capturedInstructions[0]).not.toContain("Reasoning Quality");
    expect(capturedInstructions[0]).not.toContain("intermediate artifact");
  });

  it("fails closed when the new voice model is disabled or the requested experience is invalid", async () => {
    const activeRun = createFixtureRun({ status: "interview_in_progress" });
    const runStore = new InMemoryRunStore([activeRun]);
    await runStore.createInterviewSession(
      {
        id: "interview_session_new_voice_flag_001",
        studyId: activeRun.studyId,
        participantSlotId: activeRun.participantSlotId,
        runId: activeRun.id,
        sessionNumber: 1,
        status: "active",
        startedAt: "2026-05-06T12:18:00.000Z",
        createdAt: "2026-05-06T12:18:00.000Z",
        updatedAt: "2026-05-06T12:18:00.000Z"
      },
      activeRun,
      "interview_in_progress"
    );
    const { rawToken, service } = createParticipantRunService({ runStore });
    const provider = {
      async createSession() {
        throw new Error("Realtime provider should not be called.");
      }
    };

    await expect(
      service.createParticipantRealtimeVoiceSession(rawToken, provider, { voiceExperience: "new_voice" })
    ).rejects.toMatchObject({
      safeMessage: "This voice option is not available."
    });
    await expect(
      service.createParticipantRealtimeVoiceSession(rawToken, provider, { voiceExperience: "arbitrary-model" })
    ).rejects.toMatchObject({
      safeMessage: "Voice experience is invalid."
    });
    const standardExperiences: string[] = [];
    await service.createParticipantRealtimeVoiceSession(rawToken, {
      async createSession(request) {
        standardExperiences.push(request.voiceExperience);

        return {
          provider: "fake",
          model: "fake-realtime",
          voice: "fake-voice",
          clientSecret: "client-secret",
          realtimeUrl: "https://api.openai.com/v1/realtime/calls",
          serviceRequestId: "req_realtime_standard_001",
          promptVersion: request.promptVersion
        };
      }
    });

    expect(standardExperiences).toEqual(["standard"]);
    await expect(service.validateParticipantAccess(rawToken)).resolves.toMatchObject({
      run: {
        newVoiceModelEnabled: false
      }
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

  it("completes a paused interview without requiring participants to resume", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "survey_completed" })]);
    const { rawToken, service } = createParticipantRunService({
      runStore,
      createInterviewSessionId: () => "interview_session_paused_complete_001"
    });

    await service.startParticipantInterview(rawToken);
    const paused = await service.pauseParticipantInterview(rawToken);
    const completed = await service.completeParticipantInterview(rawToken);

    expect(paused).toMatchObject({
      interviewSession: {
        id: "interview_session_paused_complete_001",
        status: "paused",
        endedAt: "2026-05-06T12:20:00.000Z"
      },
      run: {
        status: "interview_paused"
      }
    });
    expect(completed).toMatchObject({
      interviewSession: {
        id: "interview_session_paused_complete_001",
        status: "completed",
        endedAt: "2026-05-06T12:20:00.000Z"
      },
      run: {
        status: "interview_completed"
      }
    });
    expect(await runStore.listInterviewSessionsByRun("run_fixture_001")).toEqual([
      expect.objectContaining({
        id: "interview_session_paused_complete_001",
        status: "completed"
      })
    ]);
  });

  it("reports remaining interview time using active sessions only", async () => {
    const activeRun = createFixtureRun({
      status: "interview_in_progress",
      maxInterviewMinutes: 2
    });
    const activeSession: InterviewSession = {
      id: "interview_session_active_time_001",
      studyId: activeRun.studyId,
      participantSlotId: activeRun.participantSlotId,
      runId: activeRun.id,
      sessionNumber: 1,
      status: "active",
      startedAt: "2026-05-06T12:20:00.000Z",
      createdAt: "2026-05-06T12:20:00.000Z",
      updatedAt: "2026-05-06T12:20:00.000Z"
    };
    const runStore = new InMemoryRunStore([activeRun]);
    await runStore.createInterviewSession(activeSession, activeRun, "interview_in_progress");
    const active = createParticipantRunService({
      runStore,
      now: () => new Date("2026-05-06T12:21:00.000Z")
    });

    await expect(active.service.validateParticipantAccess(active.rawToken)).resolves.toMatchObject({
      run: {
        maxInterviewMinutes: 2,
        remainingInterviewSeconds: 60
      }
    });

    const paused = await active.service.pauseParticipantInterview(active.rawToken);
    expect(paused.run.remainingInterviewSeconds).toBe(60);

    const later = createParticipantRunService({
      runStore,
      now: () => new Date("2026-05-06T12:25:00.000Z")
    });
    await expect(later.service.validateParticipantAccess(later.rawToken)).resolves.toMatchObject({
      run: {
        status: "interview_paused",
        remainingInterviewSeconds: 60
      }
    });
  });

  it("does not mint a realtime session after the interview time cap is reached", async () => {
    const activeRun = createFixtureRun({
      status: "interview_in_progress",
      maxInterviewMinutes: 2
    });
    const runStore = new InMemoryRunStore([activeRun]);
    await runStore.createInterviewSession(
      {
        id: "interview_session_expired_001",
        studyId: activeRun.studyId,
        participantSlotId: activeRun.participantSlotId,
        runId: activeRun.id,
        sessionNumber: 1,
        status: "active",
        startedAt: "2026-05-06T12:18:00.000Z",
        createdAt: "2026-05-06T12:18:00.000Z",
        updatedAt: "2026-05-06T12:18:00.000Z"
      },
      activeRun,
      "interview_in_progress"
    );
    const { rawToken, service } = createParticipantRunService({
      runStore,
      now: () => new Date("2026-05-06T12:20:00.000Z")
    });

    await expect(
      service.createParticipantRealtimeVoiceSession(rawToken, {
        async createSession() {
          throw new Error("Realtime provider should not be called.");
        }
      })
    ).rejects.toMatchObject({
      safeMessage: "Interview time has ended for this run."
    });
  });

  it("triggers automatic scoring after interview completion", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "survey_completed" })]);
    const automaticScoringTriggers: AutomaticRunScoringTriggerInput[] = [];
    const { rawToken, service } = createParticipantRunService({
      runStore,
      createInterviewSessionId: () => "interview_session_scoring_001"
    });
    const scoringService = new RunService(
      runStore,
      new InMemoryParticipantAccessTokenStore([
        {
          id: "participant_access_token_fixture",
          tokenId: "token_fixture_participant",
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
        now: () => new Date("2026-05-06T12:21:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret",
        automaticScoringTrigger: {
          async triggerAutomaticScoring(input) {
            automaticScoringTriggers.push(input);
          }
        }
      }
    );

    await service.startParticipantInterview(rawToken);
    await scoringService.completeParticipantInterview(rawToken);
    await scoringService.completeParticipantInterview(rawToken);

    expect(automaticScoringTriggers).toEqual([
      expect.objectContaining({
        previousStatus: "interview_in_progress",
        triggeredAt: "2026-05-06T12:21:00.000Z",
        run: expect.objectContaining({
          id: "run_fixture_001",
          status: "interview_completed"
        }),
        context: {}
      })
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

  it("triggers automatic scoring after technical interruption", async () => {
    const runStore = new InMemoryRunStore([createFixtureRun({ status: "survey_completed" })]);
    const automaticScoringTriggers: AutomaticRunScoringTriggerInput[] = [];
    const { rawToken, service } = createParticipantRunService({
      runStore,
      createInterviewSessionId: () => "interview_session_interrupted_scoring_001"
    });
    const scoringService = new RunService(
      runStore,
      new InMemoryParticipantAccessTokenStore([
        {
          id: "participant_access_token_fixture",
          tokenId: "token_fixture_participant",
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
        now: () => new Date("2026-05-06T12:21:00.000Z"),
        participantAccessTokenSecret: "test-participant-secret",
        automaticScoringTrigger: {
          async triggerAutomaticScoring(input) {
            automaticScoringTriggers.push(input);
          }
        }
      }
    );

    await service.startParticipantInterview(rawToken);
    await scoringService.interruptParticipantInterview(rawToken, {
      safeStatus: "technical_interruption"
    });

    expect(automaticScoringTriggers).toEqual([
      expect.objectContaining({
        previousStatus: "interview_in_progress",
        run: expect.objectContaining({
          id: "run_fixture_001",
          status: "technical_interruption"
        }),
        context: {
          technicalInterruption: true,
          partialRun: true
        }
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
          id: "participant_access_token_fixture",
          tokenId: "token_fixture_participant",
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
          sequenceNumber: 1,
          speaker: "ai",
          text: "Could you share a concrete example?",
          audioStartMs: 1000,
          audioEndMs: 3200
        },
        {
          id: "interview_turn_artifacts_002",
          sequenceNumber: 2,
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
    const savedFollowUp = await artifactService.saveParticipantInterviewArtifacts(rawToken, {
      turns: [
        {
          speaker: "participant",
          text: "I would use that comparison again.",
          audioStartMs: 8800,
          audioEndMs: 11000
        }
      ],
      transcriptTokenCount: 5
    });

    expect(await runStore.listInterviewTurnsByRun("run_fixture_001")).toEqual([...saved.turns, ...savedFollowUp.turns]);
    expect(await runStore.listInterviewAudioAssetsByRun("run_fixture_001")).toEqual([saved.audioAsset]);
    expect(savedFollowUp.interviewSession).toMatchObject({
      id: "interview_session_artifacts_001",
      transcriptTokenCount: 24
    });
    expect(savedFollowUp.turns).toEqual([
      expect.objectContaining({
        id: "interview_turn_artifacts_003",
        sequenceNumber: 3,
        speaker: "participant"
      })
    ]);
    expect(await runStore.listInterviewSessionsByRun("run_fixture_001")).toEqual([
      expect.objectContaining({
        id: "interview_session_artifacts_001",
        audioDurationSeconds: 8.7,
        transcriptTokenCount: 24
      })
    ]);
  });
});
