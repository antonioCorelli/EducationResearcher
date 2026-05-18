import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ParticipantSlot, ResearcherDashboardRun, ResearcherRunDashboardSlot, RunScoreReview, StudyShell } from "../App";
import { ScoreReviewList } from "./runAnalysis";
import { ResearcherRunOperations, sortParticipantOperationSlots } from "./runOperations";

const noop = () => undefined;
const noopSubmit = (event: { preventDefault: () => void }) => event.preventDefault();
const configuredStudyShell: StudyShell = {
  id: "study_fixture_001",
  title: "Fixture study",
  defaultFreshnessDays: 14,
  defaultMaxInterviewMinutes: 45,
  activeConsentVersionId: "consent_version_001",
  activeSurveyVersionId: "survey_version_001",
  activePersonaVersionId: "persona_version_v1_default_001",
  persona: {
    label: "V1 default",
    stylePrompt: "Calm research interviewer.",
    locked: true
  }
};

function createScoreReview(runId: string, flags: RunScoreReview["objectiveScores"][number]["score"]["flags"]): RunScoreReview {
  return {
    run: {
      id: runId,
      studyId: "study_fixture_001",
      participantSlotId: "slot_fixture_001",
      consentVersionId: "consent_version_001",
      surveyVersionId: "survey_version_001",
      personaVersionId: "persona_version_v1_default_001",
      objectiveVersionIds: ["objective_version_001"],
      freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
      maxInterviewMinutes: 45,
      status: "scored",
      currentRunForSlot: true,
      createdAt: "2026-05-06T12:00:00.000Z",
      updatedAt: "2026-05-06T12:40:00.000Z"
    },
    scoringRun: {
      id: `scoring_${runId}`,
      runId,
      status: "completed",
      trigger: "automatic",
      modelName: "fake-scoring",
      modelVersion: "local-1",
      serviceRequestId: "req_scoring_001",
      promptVersion: "scoring-v1",
      objectiveVersionSetHash: "sha256:fixture",
      scoredAt: "2026-05-06T12:40:00.000Z",
      createdAt: "2026-05-06T12:40:00.000Z"
    },
    scoringRuns: [
      {
        id: `scoring_${runId}`,
        runId,
        status: "completed",
        trigger: "automatic",
        modelName: "fake-scoring",
        modelVersion: "local-1",
        serviceRequestId: "req_scoring_001",
        promptVersion: "scoring-v1",
        objectiveVersionSetHash: "sha256:fixture",
        scoredAt: "2026-05-06T12:40:00.000Z",
        createdAt: "2026-05-06T12:40:00.000Z"
      }
    ],
    objectiveScores: [
      {
        objectiveVersion: {
          id: "objective_version_001",
          objectiveKey: "reasoning_quality",
          versionNumber: 1,
          title: "Reasoning Quality",
          sortOrder: 1
        },
        score: {
          id: `score_${runId}`,
          scoringRunId: `scoring_${runId}`,
          runId,
          objectiveVersionId: "objective_version_001",
          gradeLabel: "2",
          confidence: flags.includes("low_confidence") ? 0.38 : 0.86,
          rationale: "The participant connected evidence to a claim.",
          flags,
          createdAt: "2026-05-06T12:40:00.000Z"
        },
        citations: [
          {
            id: `citation_${runId}`,
            objectiveScoreId: `score_${runId}`,
            runId,
            sourceType: "survey_response",
            sourceId: "survey_response_001",
            quote: "I noticed that the example changed my reasoning.",
            createdAt: "2026-05-06T12:40:00.000Z"
          }
        ]
      }
    ]
  };
}

function createDashboardSlot(
  slotId: string,
  participantCode: string,
  statusValue: ResearcherRunDashboardSlot["runs"][number]["status"]["value"],
  statusLabel: string,
  scoringOverrides: Partial<ResearcherRunDashboardSlot["runs"][number]["scoringSummary"]> = {}
): ResearcherRunDashboardSlot {
  const run: ResearcherDashboardRun = {
    id: `run_${slotId}`,
    status: {
      value: statusValue,
      label: statusLabel,
      isStale: statusValue === "stale",
      isPartial: statusValue === "partial",
      isTechnicalInterruption: statusValue === "technical_interruption",
      isCompleted: statusValue === "interview_completed" || statusValue === "scored",
      isScored: statusValue === "scored"
    },
    freshnessDeadlineAt: "2026-05-20T12:00:00.000Z",
    currentRunForSlot: true,
    createdAt: "2026-05-06T12:00:00.000Z",
    updatedAt: "2026-05-06T12:30:00.000Z",
    artifactSummary: {
      consentRecordCount: 1,
      surveyResponseCount: 2,
      gapMapCount: 1,
      interviewSessionCount: 1,
      interviewTurnCount: 3,
      audioAssetCount: 1,
      audioDurationSeconds: 120,
      transcriptTokenCount: 450
    },
    scoringSummary: {
      state: scoringOverrides.scoringRunCount ? "completed" : "not_started",
      scoringRunCount: 0,
      ...scoringOverrides
    }
  };

  return {
    participantSlot: {
      id: slotId,
      studyId: "study_fixture_001",
      participantCode,
      codeSource: "researcher_supplied",
      status: "active",
      createdAt: "2026-05-06T12:00:00.000Z",
      updatedAt: "2026-05-06T12:00:00.000Z"
    },
    currentRun: run,
    latestRun: run,
    runs: [run]
  };
}

describe("ScoreReviewList", () => {
  it("renders consolidated participant operations with safe statuses and key actions", () => {
    const dashboardSlots: ResearcherRunDashboardSlot[] = [
      createDashboardSlot("slot_completed", "P001", "interview_completed", "Interview completed"),
      createDashboardSlot("slot_scored", "P002", "scored", "Scored", {
        scoringRunCount: 1,
        latestScoredAt: "2026-05-06T12:40:00.000Z",
        latestTrigger: "automatic"
      }),
      createDashboardSlot("slot_stale", "P003", "stale", "Stale"),
      createDashboardSlot("slot_partial", "P004", "partial", "Partial"),
      createDashboardSlot("slot_technical", "P005", "technical_interruption", "Technical interruption"),
      {
        participantSlot: {
          id: "slot_empty",
          studyId: "study_fixture_001",
          participantCode: "P006",
          codeSource: "researcher_supplied",
          status: "active",
          createdAt: "2026-05-06T12:00:00.000Z",
          updatedAt: "2026-05-06T12:00:00.000Z"
        },
        runs: []
      }
    ];
    const markup = renderToStaticMarkup(
      <ResearcherRunOperations
        generatedParticipantSlotCount={10}
        isCreatingRuns={false}
        isGeneratingParticipantSlots={false}
        isImportingParticipantSlots={false}
        isSavingParticipantSlot={false}
        participantCode=""
        participantSlotBulkSummary={null}
        participantSlotCsv=""
        participantSlotError=""
        participantSlotState={{ status: "ready", participantSlots: dashboardSlots.map((slot) => slot.participantSlot) }}
        participantSlots={dashboardSlots.map((slot) => slot.participantSlot)}
        runDashboardState={{ status: "ready", slots: dashboardSlots }}
        runError=""
        runState={{
          status: "ready",
          runs: dashboardSlots
            .filter((slot) => slot.latestRun)
            .map((slot) => ({
              id: slot.latestRun!.id,
              studyId: "study_fixture_001",
              participantSlotId: slot.participantSlot.id,
              consentVersionId: "consent_version_001",
              surveyVersionId: "survey_version_001",
              personaVersionId: "persona_version_v1_default_001",
              objectiveVersionIds: ["objective_version_001"],
              freshnessDeadlineAt: slot.latestRun!.freshnessDeadlineAt,
              maxInterviewMinutes: 45,
              status: slot.latestRun!.status.value,
              currentRunForSlot: true,
              participantAccessUrl: `https://participant.example.test/${slot.latestRun!.id}`,
              createdAt: slot.latestRun!.createdAt,
              updatedAt: slot.latestRun!.updatedAt
            }))
        }}
        selectedRunParticipantSlotIds={[]}
        selectedStudy={configuredStudyShell}
        onCreateRuns={noopSubmit}
        onGenerateParticipantSlots={noopSubmit}
        onGeneratedParticipantSlotCountChange={noop}
        onImportParticipantSlots={noopSubmit}
        onParticipantCodeChange={noop}
        onParticipantSlotCsvChange={noop}
        onSaveParticipantSlot={noopSubmit}
        onSelectedRunParticipantSlotIdsChange={noop}
      />
    );

    expect(markup).toContain("Participants");
    expect(markup).toContain("Participant ID");
    expect(markup).toContain("Interview completed");
    expect(markup).toContain("Scored");
    expect(markup).toContain("Stale");
    expect(markup).toContain("Partial");
    expect(markup).toContain("Technical interruption");
    expect(markup).toContain("No run yet");
    expect(markup).toContain("Copy link");
    expect(markup).toContain("Select all participants without runs");
    expect(markup).toContain("Run already created for P001");
    expect(markup).not.toContain("Archive");
    expect(markup).not.toContain("Artifacts");
    expect(markup).not.toContain("Scoring");
    expect(markup).not.toContain("survey responses");
    expect(markup).not.toContain("audio asset");
    expect(markup).not.toMatch(/openai|diagnostic|provider error|stack trace|disconnect/i);
  });

  it("sorts participant operations by displayed ID and participant-safe status", () => {
    const participantSlots: ParticipantSlot[] = [
      {
        id: "slot_empty",
        studyId: "study_fixture_001",
        participantCode: "P006",
        codeSource: "researcher_supplied",
        status: "active",
        createdAt: "2026-05-06T12:00:00.000Z",
        updatedAt: "2026-05-06T12:00:00.000Z"
      },
      createDashboardSlot("slot_created", "P010", "created", "Created").participantSlot,
      createDashboardSlot("slot_scored", "P002", "scored", "Scored").participantSlot,
      createDashboardSlot("slot_survey", "P003", "survey_completed", "Survey completed").participantSlot
    ];
    const statusBySlotId = new Map([
      ["slot_created", "created" as const],
      ["slot_scored", "scored" as const],
      ["slot_survey", "survey_completed" as const]
    ]);

    expect(
      sortParticipantOperationSlots(participantSlots, { key: "participantId", direction: "ascending" }, (slot) =>
        statusBySlotId.get(slot.id)
      ).map((slot) => slot.participantCode)
    ).toEqual(["P002", "P003", "P006", "P010"]);
    expect(
      sortParticipantOperationSlots(participantSlots, { key: "status" }, (slot) => statusBySlotId.get(slot.id)).map(
        (slot) => slot.participantCode
      )
    ).toEqual(["P002", "P003", "P010", "P006"]);
  });

  it("renders confidence, rationale, safe flags, metadata, and citation links", () => {
    const markup = renderToStaticMarkup(
      <ScoreReviewList
        isExportingScores={false}
        isLoadingEvidenceCitationId={null}
        participantCodeBySlotId={new Map([["slot_fixture_001", "P001"]])}
        scoreReviewState={{
          status: "ready",
          scoreReviews: [
            createScoreReview("run_completed_001", []),
            createScoreReview("run_stale_001", ["low_confidence", "stale_run", "missing_interview_evidence"]),
            createScoreReview("run_partial_001", ["low_confidence", "partial_run", "missing_interview_evidence"]),
            createScoreReview("run_technical_001", ["low_confidence", "technical_interruption", "missing_interview_evidence"])
          ]
        }}
        scoreReviews={[
          createScoreReview("run_completed_001", []),
          createScoreReview("run_stale_001", ["low_confidence", "stale_run", "missing_interview_evidence"]),
          createScoreReview("run_partial_001", ["low_confidence", "partial_run", "missing_interview_evidence"]),
          createScoreReview("run_technical_001", ["low_confidence", "technical_interruption", "missing_interview_evidence"])
        ]}
        selectedEvidenceCitation={null}
        selectedEvidenceCitationError=""
        rawEvidenceState={{ status: "idle" }}
        rescoreError=""
        scoreExportError=""
        onDismissEvidenceCitation={noop}
        onDismissRawEvidence={noop}
        onExportScores={noop}
        onManualRescore={noop}
        onOpenEvidenceCitation={noop}
        isRescoringRunId={null}
      />
    );

    expect(markup).toContain("Reasoning Quality");
    expect(markup).toContain("86% confidence");
    expect(markup).toContain("The participant connected evidence to a claim.");
    expect(markup).toContain("Stale run");
    expect(markup).toContain("Partial run");
    expect(markup).toContain("Technical interruption");
    expect(markup).toContain("Survey evidence");
    expect(markup).not.toMatch(/openai|diagnostic|provider error|stack trace/i);
  });

  it("renders raw survey, transcript, and signed audio evidence", () => {
    const markup = renderToStaticMarkup(
      <ScoreReviewList
        isExportingScores={false}
        isLoadingEvidenceCitationId={null}
        participantCodeBySlotId={new Map([["slot_fixture_001", "P001"]])}
        scoreReviewState={{ status: "ready", scoreReviews: [] }}
        scoreReviews={[]}
        selectedEvidenceCitation={null}
        selectedEvidenceCitationError=""
        rescoreError=""
        scoreExportError=""
        rawEvidenceState={{
          status: "ready",
          focusSourceId: "interview_turn_001",
          evidence: {
            run: createScoreReview("run_completed_001", []).run,
            surveyResponses: [
              {
                id: "survey_response_001",
                surveyQuestionId: "survey_question_001",
                responseText: "I noticed that the example changed my reasoning.",
                submittedAt: "2026-05-06T12:10:00.000Z"
              }
            ],
            interviewTurns: [
              {
                id: "interview_turn_001",
                speaker: "participant",
                text: "The second example made the pattern much clearer.",
                audioStartMs: 60000,
                audioEndMs: 68000,
                createdAt: "2026-05-06T12:25:00.000Z"
              }
            ],
            audioAssets: [
              {
                id: "interview_audio_asset_001",
                storageUri: "s3://fixture/audio.wav",
                durationSeconds: 900,
                status: "available",
                signedUrl: "https://signed.example.test/audio",
                signedUrlExpiresAt: "2026-05-06T13:00:00.000Z",
                createdAt: "2026-05-06T12:35:00.000Z"
              }
            ]
          }
        }}
        onDismissEvidenceCitation={noop}
        onDismissRawEvidence={noop}
        onExportScores={noop}
        onManualRescore={noop}
        onOpenEvidenceCitation={noop}
        isRescoringRunId={null}
      />
    );

    expect(markup).toContain("Raw evidence");
    expect(markup).toContain("I noticed that the example changed my reasoning.");
    expect(markup).toContain("The second example made the pattern much clearer.");
    expect(markup).toContain("Open signed audio link");
    expect(markup).toContain("focused-raw-evidence");
  });

  it("distinguishes the latest score from older manual rescoring history", () => {
    const review = createScoreReview("run_rescored_001", []);
    const markup = renderToStaticMarkup(
      <ScoreReviewList
        isExportingScores={false}
        isLoadingEvidenceCitationId={null}
        participantCodeBySlotId={new Map([["slot_fixture_001", "P001"]])}
        scoreReviewState={{ status: "ready", scoreReviews: [review] }}
        scoreReviews={[
          {
            ...review,
            scoringRun: {
              ...review.scoringRun!,
              id: "scoring_run_latest_001",
              trigger: "manual_rescore",
              scoredAt: "2026-05-07T12:40:00.000Z"
            },
            scoringRuns: [
              {
                ...review.scoringRun!,
                id: "scoring_run_latest_001",
                trigger: "manual_rescore",
                scoredAt: "2026-05-07T12:40:00.000Z"
              },
              {
                ...review.scoringRun!,
                id: "scoring_run_original_001",
                trigger: "automatic",
                scoredAt: "2026-05-06T12:40:00.000Z"
              }
            ]
          }
        ]}
        selectedEvidenceCitation={null}
        selectedEvidenceCitationError=""
        rescoreError=""
        scoreExportError=""
        rawEvidenceState={{ status: "idle" }}
        onDismissEvidenceCitation={noop}
        onDismissRawEvidence={noop}
        onExportScores={noop}
        onManualRescore={noop}
        onOpenEvidenceCitation={noop}
        isRescoringRunId={null}
      />
    );

    expect(markup).toContain("Latest scored");
    expect(markup).toContain("Manual rescore");
    expect(markup).toContain("Previous - Automatic");
    expect(markup).toContain("Rescore");
  });
});
