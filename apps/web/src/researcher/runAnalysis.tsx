import type {
  EvidenceCitation,
  ParticipantSlot,
  RawEvidenceState,
  ResolvedEvidenceCitation,
  RunScoreReview,
  ScoreFlag,
  ScoreReviewState,
  ScoringRun
} from "../App";
import { RawEvidencePanel } from "./rawEvidence";
import {
  formatAudioSpan,
  formatCitationSource,
  formatConfidence,
  formatDateTime,
  formatOptionalAudioSpan,
  formatResolvedEvidenceTitle,
  formatRunStatus,
  formatScoreFlag,
  formatScoringTrigger,
  formatSpeaker
} from "./runFormat";

interface ResearcherRunAnalysisProps {
  readonly isExportingScores: boolean;
  readonly isLoadingEvidenceCitationId: string | null;
  readonly isRescoringRunId: string | null;
  readonly participantSlots: readonly ParticipantSlot[];
  readonly rawEvidenceState: RawEvidenceState;
  readonly rescoreError: string;
  readonly scoreExportError: string;
  readonly scoreReviewState: ScoreReviewState;
  readonly selectedEvidenceCitation: ResolvedEvidenceCitation | null;
  readonly selectedEvidenceCitationError: string;
  readonly onDismissEvidenceCitation: () => void;
  readonly onDismissRawEvidence: () => void;
  readonly onExportScores: () => void;
  readonly onManualRescore: (runId: string) => void;
  readonly onOpenEvidenceCitation: (runId: string, evidenceCitationId: string) => void;
  readonly onOpenRawEvidence: (runId: string, focusSourceId?: string) => void;
}

export function ResearcherRunAnalysis({
  isExportingScores,
  isLoadingEvidenceCitationId,
  isRescoringRunId,
  participantSlots,
  rawEvidenceState,
  rescoreError,
  scoreExportError,
  scoreReviewState,
  selectedEvidenceCitation,
  selectedEvidenceCitationError,
  onDismissEvidenceCitation,
  onDismissRawEvidence,
  onExportScores,
  onManualRescore,
  onOpenEvidenceCitation,
  onOpenRawEvidence
}: ResearcherRunAnalysisProps) {
  const scoreReviews = scoreReviewState.status === "ready" ? scoreReviewState.scoreReviews : [];
  const participantCodeBySlotId = new Map(participantSlots.map((slot) => [slot.id, slot.participantCode]));

  return (
    <section className="study-form workspace-task-panel" aria-labelledby="run-analysis-title">
      <div className="section-heading">
        <h2 id="run-analysis-title">Completed run analysis</h2>
      </div>
      <ScoreReviewList
        isExportingScores={isExportingScores}
        isLoadingEvidenceCitationId={isLoadingEvidenceCitationId}
        isRescoringRunId={isRescoringRunId}
        participantCodeBySlotId={participantCodeBySlotId}
        rawEvidenceState={rawEvidenceState}
        rescoreError={rescoreError}
        scoreExportError={scoreExportError}
        scoreReviewState={scoreReviewState}
        scoreReviews={scoreReviews}
        selectedEvidenceCitation={selectedEvidenceCitation}
        selectedEvidenceCitationError={selectedEvidenceCitationError}
        onDismissEvidenceCitation={onDismissEvidenceCitation}
        onDismissRawEvidence={onDismissRawEvidence}
        onExportScores={onExportScores}
        onManualRescore={onManualRescore}
        onOpenEvidenceCitation={onOpenEvidenceCitation}
        onOpenRawEvidence={onOpenRawEvidence}
      />
    </section>
  );
}

interface ScoreReviewListProps {
  readonly isExportingScores: boolean;
  readonly isLoadingEvidenceCitationId: string | null;
  readonly participantCodeBySlotId: ReadonlyMap<string, string>;
  readonly scoreReviewState: ScoreReviewState;
  readonly scoreReviews: readonly RunScoreReview[];
  readonly selectedEvidenceCitation: ResolvedEvidenceCitation | null;
  readonly selectedEvidenceCitationError: string;
  readonly rawEvidenceState: RawEvidenceState;
  readonly rescoreError: string;
  readonly scoreExportError: string;
  readonly onDismissEvidenceCitation: () => void;
  readonly onDismissRawEvidence: () => void;
  readonly onExportScores: () => void;
  readonly onManualRescore: (runId: string) => void;
  readonly onOpenEvidenceCitation: (runId: string, evidenceCitationId: string) => void;
  readonly onOpenRawEvidence: (runId: string, focusSourceId?: string) => void;
  readonly isRescoringRunId: string | null;
}

export function ScoreReviewList({
  isExportingScores,
  isLoadingEvidenceCitationId,
  participantCodeBySlotId,
  scoreReviewState,
  scoreReviews,
  selectedEvidenceCitation,
  selectedEvidenceCitationError,
  rawEvidenceState,
  rescoreError,
  scoreExportError,
  onDismissEvidenceCitation,
  onDismissRawEvidence,
  onExportScores,
  onManualRescore,
  isRescoringRunId,
  onOpenEvidenceCitation,
  onOpenRawEvidence
}: ScoreReviewListProps) {
  const scoredReviews = scoreReviews.filter((review) => review.scoringRun);
  const hasInlineTranscriptEvidence = scoredReviews.some((review) =>
    review.objectiveScores.some(({ citations }) =>
      citations.some((citation) => isInlineTranscriptEvidenceCitation(rawEvidenceState, review.run.id, citation))
    )
  );

  return (
    <div className="score-review-section" aria-labelledby="score-review-title">
      <div className="section-heading">
        <h2 id="score-review-title">Score review</h2>
        {scoredReviews.length > 0 ? (
          <div className="score-review-toolbar">
            <span className="version-pill">{scoredReviews.length} scored</span>
            <button className="secondary-button compact-button" disabled={isExportingScores} onClick={onExportScores} type="button">
              {isExportingScores ? "Exporting CSV" : "Export CSV"}
            </button>
          </div>
        ) : null}
      </div>
      {scoreReviewState.status === "loading" ? <p className="muted-copy">Loading score reviews</p> : null}
      {scoreReviewState.status === "error" ? <p className="form-error">{scoreReviewState.message}</p> : null}
      {scoreReviewState.status === "ready" && scoredReviews.length === 0 ? (
        <p className="muted-copy">No scored participant runs yet</p>
      ) : null}
      {scoredReviews.length > 0 ? (
        <div className="score-review-list">
          {scoredReviews.map((review) => (
            <article className="score-review-run" key={review.run.id}>
              <div className="score-review-run-heading">
                <div>
                  <h3>{participantCodeBySlotId.get(review.run.participantSlotId) ?? review.run.participantSlotId}</h3>
                  <p>
                    Run {review.run.id} - {formatRunStatus(review.run)}
                  </p>
                </div>
                {review.scoringRun ? (
                  <div className="score-review-actions">
                    <dl className="score-metadata">
                      <div>
                        <dt>Latest scored</dt>
                        <dd>{formatDateTime(review.scoringRun.scoredAt)}</dd>
                      </div>
                      <div>
                        <dt>Trigger</dt>
                        <dd>{formatScoringTrigger(review.scoringRun.trigger)}</dd>
                      </div>
                      <div>
                        <dt>Model</dt>
                        <dd>{review.scoringRun.modelName}</dd>
                      </div>
                      <div>
                        <dt>Prompt</dt>
                        <dd>{review.scoringRun.promptVersion}</dd>
                      </div>
                    </dl>
                    <button
                      className="secondary-button compact-button"
                      disabled={isRescoringRunId === review.run.id}
                      onClick={() => onManualRescore(review.run.id)}
                      type="button"
                    >
                      {isRescoringRunId === review.run.id ? "Rescoring" : "Rescore"}
                    </button>
                  </div>
                ) : null}
              </div>
              <ScoringHistory scoringRuns={review.scoringRuns} />
              <div className="objective-score-list">
                {review.objectiveScores.map(({ objectiveVersion, score, citations }) => {
                  const lowConfidence = score.confidence < 0.5 || score.flags.includes("low_confidence");

                  return (
                    <section className={lowConfidence ? "objective-score low-confidence-score" : "objective-score"} key={score.id}>
                      <div className="objective-score-heading">
                        <div>
                          <h4>{objectiveVersion.title}</h4>
                          <p>
                            {objectiveVersion.status === "missing"
                              ? `Objective reference ${objectiveVersion.id}`
                              : `Objective v${objectiveVersion.versionNumber}`}
                          </p>
                        </div>
                        <div className="score-grade-stack">
                          <strong>{score.gradeLabel}</strong>
                          <span className={lowConfidence ? "confidence-pill low-confidence-pill" : "confidence-pill"}>
                            {formatConfidence(score.confidence)}
                          </span>
                        </div>
                      </div>
                      <p className="score-rationale">{score.rationale}</p>
                      <FlagList flags={score.flags} />
                      <CitationList
                        citations={citations}
                        isLoadingEvidenceCitationId={isLoadingEvidenceCitationId}
                        rawEvidenceState={rawEvidenceState}
                        runId={review.run.id}
                        onDismissRawEvidence={onDismissRawEvidence}
                        onOpenEvidenceCitation={onOpenEvidenceCitation}
                        onOpenRawEvidence={onOpenRawEvidence}
                      />
                    </section>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {rescoreError ? <p className="form-error">{rescoreError}</p> : null}
      {scoreExportError ? <p className="form-error">{scoreExportError}</p> : null}
      {selectedEvidenceCitationError ? <p className="form-error">{selectedEvidenceCitationError}</p> : null}
      {selectedEvidenceCitation ? (
        <EvidenceCitationPanel citation={selectedEvidenceCitation} onDismiss={onDismissEvidenceCitation} />
      ) : null}
      {hasInlineTranscriptEvidence ? null : <RawEvidencePanel rawEvidenceState={rawEvidenceState} onDismiss={onDismissRawEvidence} />}
    </div>
  );
}

function ScoringHistory({ scoringRuns }: { readonly scoringRuns: readonly ScoringRun[] }) {
  if (scoringRuns.length <= 1) {
    return null;
  }

  return (
    <div className="scoring-history" aria-label="Scoring history">
      {scoringRuns.map((scoringRun, index) => (
        <span className={index === 0 ? "score-history-chip latest-score-history-chip" : "score-history-chip"} key={scoringRun.id}>
          {index === 0 ? "Latest" : "Previous"} - {formatScoringTrigger(scoringRun.trigger)} - {formatDateTime(scoringRun.scoredAt)}
        </span>
      ))}
    </div>
  );
}

function FlagList({ flags }: { readonly flags: readonly ScoreFlag[] }) {
  if (flags.length === 0) {
    return <p className="muted-copy">No scoring flags</p>;
  }

  return (
    <div className="score-flag-list" aria-label="Score flags">
      {flags.map((flag) => (
        <span className={flag === "low_confidence" ? "score-flag low-confidence-flag" : "score-flag"} key={flag}>
          {formatScoreFlag(flag)}
        </span>
      ))}
    </div>
  );
}

function CitationList({
  citations,
  isLoadingEvidenceCitationId,
  rawEvidenceState,
  runId,
  onDismissRawEvidence,
  onOpenEvidenceCitation,
  onOpenRawEvidence
}: {
  readonly citations: readonly EvidenceCitation[];
  readonly isLoadingEvidenceCitationId: string | null;
  readonly rawEvidenceState: RawEvidenceState;
  readonly runId: string;
  readonly onDismissRawEvidence: () => void;
  readonly onOpenEvidenceCitation: (runId: string, evidenceCitationId: string) => void;
  readonly onOpenRawEvidence: (runId: string, focusSourceId?: string) => void;
}) {
  if (citations.length === 0) {
    return <p className="muted-copy">No cited evidence</p>;
  }

  return (
    <div className="citation-list" aria-label="Evidence citations">
      {citations.map((citation) => {
        const isTranscriptCitation = citation.sourceType === "interview_turn";
        const isInlineTranscriptEvidence = isInlineTranscriptEvidenceCitation(rawEvidenceState, runId, citation);

        if (isTranscriptCitation && isInlineTranscriptEvidence) {
          return (
            <div className="inline-transcript-panel" key={citation.id}>
              <button className="secondary-button compact-button" onClick={onDismissRawEvidence} type="button">
                Collapse transcript
              </button>
              {rawEvidenceState.status === "loading" ? <p className="muted-copy">Loading interview transcript</p> : null}
              {rawEvidenceState.status === "error" ? <p className="form-error">{rawEvidenceState.message}</p> : null}
              {rawEvidenceState.status === "ready" ? (
                <RawEvidencePanel
                  mode="transcript"
                  rawEvidenceState={rawEvidenceState}
                  showDismissButton={false}
                  onDismiss={onDismissRawEvidence}
                />
              ) : null}
            </div>
          );
        }

        return (
          <button
            className="citation-link"
            key={citation.id}
            onClick={() =>
              isTranscriptCitation ? onOpenRawEvidence(runId, citation.sourceId) : onOpenEvidenceCitation(runId, citation.id)
            }
            type="button"
          >
            <span>{formatCitationSource(citation)}</span>
            <small>{isLoadingEvidenceCitationId === citation.id ? "Opening evidence" : citation.quote}</small>
          </button>
        );
      })}
    </div>
  );
}

function isInlineTranscriptEvidenceCitation(rawEvidenceState: RawEvidenceState, runId: string, citation: EvidenceCitation) {
  if (citation.sourceType !== "interview_turn") {
    return false;
  }

  if (rawEvidenceState.status === "idle") {
    return false;
  }

  const rawEvidenceRunId = rawEvidenceState.status === "ready" ? rawEvidenceState.evidence.run.id : rawEvidenceState.runId;

  return rawEvidenceRunId === runId && rawEvidenceState.focusSourceId === citation.sourceId;
}

function EvidenceCitationPanel({
  citation,
  onDismiss
}: {
  readonly citation: ResolvedEvidenceCitation;
  readonly onDismiss: () => void;
}) {
  return (
    <section className="evidence-panel" aria-labelledby="evidence-panel-title">
      <div className="section-heading">
        <h3 id="evidence-panel-title">{formatResolvedEvidenceTitle(citation)}</h3>
        <button className="secondary-button compact-button" onClick={onDismiss} type="button">
          Close
        </button>
      </div>
      <blockquote>{citation.citation.quote}</blockquote>
      {citation.source.type === "survey_response" ? (
        <dl className="evidence-details">
          <div>
            <dt>Survey question</dt>
            <dd>{citation.source.surveyResponse.surveyQuestionId}</dd>
          </div>
          <div>
            <dt>Full response</dt>
            <dd>{citation.source.surveyResponse.responseText}</dd>
          </div>
        </dl>
      ) : null}
      {citation.source.type === "interview_turn" ? (
        <dl className="evidence-details">
          <div>
            <dt>Speaker</dt>
            <dd>{formatSpeaker(citation.source.interviewTurn.speaker)}</dd>
          </div>
          <div>
            <dt>Transcript turn</dt>
            <dd>{citation.source.interviewTurn.text}</dd>
          </div>
          <div>
            <dt>Audio span</dt>
            <dd>{formatOptionalAudioSpan(citation.source.interviewTurn.audioStartMs, citation.source.interviewTurn.audioEndMs)}</dd>
          </div>
        </dl>
      ) : null}
      {citation.source.type === "audio_span" ? (
        <dl className="evidence-details">
          <div>
            <dt>Audio asset</dt>
            <dd>{citation.source.audioAsset.storageUri}</dd>
          </div>
          <div>
            <dt>Audio span</dt>
            <dd>{formatAudioSpan(citation.source.audioStartMs, citation.source.audioEndMs)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{citation.source.audioAsset.status}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
