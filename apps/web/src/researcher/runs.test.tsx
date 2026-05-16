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
        onDismissEvidenceCitation={noop}
        onOpenEvidenceCitation={noop}
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
});
