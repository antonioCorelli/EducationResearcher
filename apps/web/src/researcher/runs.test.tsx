import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RunScoreReview } from "../App";
import { ScoreReviewList } from "./runs";

const noop = () => undefined;

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

describe("ScoreReviewList", () => {
  it("renders confidence, rationale, safe flags, metadata, and citation links", () => {
    const markup = renderToStaticMarkup(
      <ScoreReviewList
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
        onDismissEvidenceCitation={noop}
        onDismissRawEvidence={noop}
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
        isLoadingEvidenceCitationId={null}
        participantCodeBySlotId={new Map([["slot_fixture_001", "P001"]])}
        scoreReviewState={{ status: "ready", scoreReviews: [] }}
        scoreReviews={[]}
        selectedEvidenceCitation={null}
        selectedEvidenceCitationError=""
        rescoreError=""
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
        rawEvidenceState={{ status: "idle" }}
        onDismissEvidenceCitation={noop}
        onDismissRawEvidence={noop}
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
