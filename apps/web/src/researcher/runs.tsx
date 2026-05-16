import { useState, type FormEvent } from "react";

import type {
  EvidenceCitation,
  ParticipantSlot,
  RawEvidenceState,
  ResolvedEvidenceCitation,
  Run,
  RunScoreReview,
  RunState,
  ScoreFlag,
  ScoreReviewState,
  ScoringRun,
  StudySetupTab,
  StudyShell
} from "../App";

interface ResearcherRunsProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly isLoadingEvidenceCitationId: string | null;
  readonly isLoadingRawEvidenceRunId: string | null;
  readonly isCreatingRuns: boolean;
  readonly isRescoringRunId: string | null;
  readonly participantSlots: readonly ParticipantSlot[];
  readonly rawEvidenceState: RawEvidenceState;
  readonly rescoreError: string;
  readonly runError: string;
  readonly runState: RunState;
  readonly scoreReviewState: ScoreReviewState;
  readonly selectedEvidenceCitation: ResolvedEvidenceCitation | null;
  readonly selectedEvidenceCitationError: string;
  readonly selectedRunParticipantSlotIds: readonly string[];
  readonly selectedStudy: StudyShell | undefined;
  readonly onCreateRuns: (event: FormEvent<HTMLFormElement>) => void;
  readonly onDismissEvidenceCitation: () => void;
  readonly onDismissRawEvidence: () => void;
  readonly onOpenEvidenceCitation: (runId: string, evidenceCitationId: string) => void;
  readonly onOpenRawEvidence: (runId: string) => void;
  readonly onManualRescore: (runId: string) => void;
  readonly onSelectedRunParticipantSlotIdsChange: (participantSlotIds: readonly string[]) => void;
}

export function ResearcherRuns({
  activeStudySetupTab,
  isLoadingEvidenceCitationId,
  isLoadingRawEvidenceRunId,
  isCreatingRuns,
  isRescoringRunId,
  participantSlots,
  rawEvidenceState,
  rescoreError,
  runError,
  runState,
  scoreReviewState,
  selectedEvidenceCitation,
  selectedEvidenceCitationError,
  selectedRunParticipantSlotIds,
  selectedStudy,
  onCreateRuns,
  onDismissEvidenceCitation,
  onDismissRawEvidence,
  onOpenEvidenceCitation,
  onOpenRawEvidence,
  onManualRescore,
  onSelectedRunParticipantSlotIdsChange
}: ResearcherRunsProps) {
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const runs = runState.status === "ready" ? runState.runs : [];
  const scoreReviews = scoreReviewState.status === "ready" ? scoreReviewState.scoreReviews : [];
  const activeParticipantSlots = participantSlots.filter((slot) => slot.status === "active");
  const participantCodeBySlotId = new Map(participantSlots.map((slot) => [slot.id, slot.participantCode]));
  const currentRunBySlotId = new Map(runs.filter((run) => run.currentRunForSlot).map((run) => [run.participantSlotId, run]));

  function toggleParticipantSlot(participantSlotId: string) {
    if (selectedRunParticipantSlotIds.includes(participantSlotId)) {
      onSelectedRunParticipantSlotIdsChange(selectedRunParticipantSlotIds.filter((slotId) => slotId !== participantSlotId));
      return;
    }

    onSelectedRunParticipantSlotIdsChange([...selectedRunParticipantSlotIds, participantSlotId]);
  }

  return (
    <section
      aria-labelledby="runs-title"
      className="study-form study-setup-panel"
      hidden={activeStudySetupTab !== "runs"}
      id="runs-panel"
    >
      <div className="section-heading">
        <h2 id="runs-title">Researcher-authorized runs</h2>
      </div>
      <form className="run-create-panel" onSubmit={onCreateRuns}>
        <div className="run-slot-picker" role="group" aria-label="Participant slots for new runs">
          {activeParticipantSlots.map((slot) => {
            const currentRun = currentRunBySlotId.get(slot.id);

            return (
              <label className="run-slot-option" key={slot.id}>
                <input
                  checked={selectedRunParticipantSlotIds.includes(slot.id)}
                  disabled={!selectedStudy || isCreatingRuns}
                  onChange={() => toggleParticipantSlot(slot.id)}
                  type="checkbox"
                />
                <span>
                  <strong>{slot.participantCode}</strong>
                  {currentRun ? <small>Current run: {formatRunStatus(currentRun)}</small> : <small>No current run</small>}
                </span>
              </label>
            );
          })}
        </div>
        {activeParticipantSlots.length === 0 ? <p className="muted-copy">Add active participant slots before creating runs</p> : null}
        {runError ? <p className="form-error">{runError}</p> : null}
        <button
          className="primary-button"
          disabled={!selectedStudy || isCreatingRuns || selectedRunParticipantSlotIds.length === 0}
          type="submit"
        >
          {isCreatingRuns ? "Creating runs" : `Create ${selectedRunParticipantSlotIds.length || ""} run${selectedRunParticipantSlotIds.length === 1 ? "" : "s"}`}
        </button>
      </form>
      {runState.status === "loading" ? <p className="muted-copy">Loading runs</p> : null}
      {runState.status === "error" ? <p className="form-error">{runState.message}</p> : null}
      {runState.status === "ready" && runs.length === 0 ? <p className="muted-copy">No runs yet</p> : null}
      {runs.length > 0 ? (
        <div className="run-table" role="table" aria-label="Runs">
          <div className="run-row run-header" role="row">
            <span role="columnheader">Participant</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Fresh until</span>
            <span role="columnheader">Interview cap</span>
            <span role="columnheader">Current</span>
            <span role="columnheader">Access</span>
            <span role="columnheader">Evidence</span>
          </div>
          {runs.map((run) => (
            <div className="run-row" key={run.id} role="row">
              <span role="cell">{participantCodeBySlotId.get(run.participantSlotId) ?? run.participantSlotId}</span>
              <span role="cell">{formatRunStatus(run)}</span>
              <span role="cell">{formatDateTime(run.freshnessDeadlineAt)}</span>
              <span role="cell">{run.maxInterviewMinutes} min</span>
              <span role="cell">{run.currentRunForSlot ? "Yes" : "No"}</span>
              <span role="cell">
                {run.participantAccessUrl ? (
                  <button
                    className="secondary-button compact-button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(run.participantAccessUrl ?? "");
                      setCopiedRunId(run.id);
                    }}
                    type="button"
                  >
                    {copiedRunId === run.id ? "Copied" : "Copy link"}
                  </button>
                ) : (
                  "Unavailable"
                )}
              </span>
              <span role="cell">
                <button
                  className="secondary-button compact-button"
                  disabled={isLoadingRawEvidenceRunId === run.id}
                  onClick={() => onOpenRawEvidence(run.id)}
                  type="button"
                >
                  {isLoadingRawEvidenceRunId === run.id ? "Opening" : "View evidence"}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <ScoreReviewList
        isLoadingEvidenceCitationId={isLoadingEvidenceCitationId}
        participantCodeBySlotId={participantCodeBySlotId}
        scoreReviewState={scoreReviewState}
        scoreReviews={scoreReviews}
        selectedEvidenceCitation={selectedEvidenceCitation}
        selectedEvidenceCitationError={selectedEvidenceCitationError}
        rawEvidenceState={rawEvidenceState}
        rescoreError={rescoreError}
        onDismissEvidenceCitation={onDismissEvidenceCitation}
        onDismissRawEvidence={onDismissRawEvidence}
        onManualRescore={onManualRescore}
        onOpenEvidenceCitation={onOpenEvidenceCitation}
        isRescoringRunId={isRescoringRunId}
      />
    </section>
  );
}

interface ScoreReviewListProps {
  readonly isLoadingEvidenceCitationId: string | null;
  readonly participantCodeBySlotId: ReadonlyMap<string, string>;
  readonly scoreReviewState: ScoreReviewState;
  readonly scoreReviews: readonly RunScoreReview[];
  readonly selectedEvidenceCitation: ResolvedEvidenceCitation | null;
  readonly selectedEvidenceCitationError: string;
  readonly rawEvidenceState: RawEvidenceState;
  readonly rescoreError: string;
  readonly onDismissEvidenceCitation: () => void;
  readonly onDismissRawEvidence: () => void;
  readonly onManualRescore: (runId: string) => void;
  readonly onOpenEvidenceCitation: (runId: string, evidenceCitationId: string) => void;
  readonly isRescoringRunId: string | null;
}

export function ScoreReviewList({
  isLoadingEvidenceCitationId,
  participantCodeBySlotId,
  scoreReviewState,
  scoreReviews,
  selectedEvidenceCitation,
  selectedEvidenceCitationError,
  rawEvidenceState,
  rescoreError,
  onDismissEvidenceCitation,
  onDismissRawEvidence,
  onManualRescore,
  isRescoringRunId,
  onOpenEvidenceCitation
}: ScoreReviewListProps) {
  const scoredReviews = scoreReviews.filter((review) => review.scoringRun);

  return (
    <div className="score-review-section" aria-labelledby="score-review-title">
      <div className="section-heading">
        <h2 id="score-review-title">Score review</h2>
        {scoredReviews.length > 0 ? <span className="version-pill">{scoredReviews.length} scored</span> : null}
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
                    Run {review.run.id} · {formatRunStatus(review.run)}
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
                        runId={review.run.id}
                        onOpenEvidenceCitation={onOpenEvidenceCitation}
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
      {selectedEvidenceCitationError ? <p className="form-error">{selectedEvidenceCitationError}</p> : null}
      {selectedEvidenceCitation ? (
        <EvidenceCitationPanel citation={selectedEvidenceCitation} onDismiss={onDismissEvidenceCitation} />
      ) : null}
      <RawEvidencePanel rawEvidenceState={rawEvidenceState} onDismiss={onDismissRawEvidence} />
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
  runId,
  onOpenEvidenceCitation
}: {
  readonly citations: readonly EvidenceCitation[];
  readonly isLoadingEvidenceCitationId: string | null;
  readonly runId: string;
  readonly onOpenEvidenceCitation: (runId: string, evidenceCitationId: string) => void;
}) {
  if (citations.length === 0) {
    return <p className="muted-copy">No cited evidence</p>;
  }

  return (
    <div className="citation-list" aria-label="Evidence citations">
      {citations.map((citation) => (
        <button
          className="citation-link"
          key={citation.id}
          onClick={() => onOpenEvidenceCitation(runId, citation.id)}
          type="button"
        >
          <span>{formatCitationSource(citation)}</span>
          <small>{isLoadingEvidenceCitationId === citation.id ? "Opening evidence" : citation.quote}</small>
        </button>
      ))}
    </div>
  );
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

function RawEvidencePanel({
  rawEvidenceState,
  onDismiss
}: {
  readonly rawEvidenceState: RawEvidenceState;
  readonly onDismiss: () => void;
}) {
  if (rawEvidenceState.status !== "ready") {
    if (rawEvidenceState.status === "error") {
      return <p className="form-error">{rawEvidenceState.message}</p>;
    }

    if (rawEvidenceState.status === "loading") {
      return <p className="muted-copy">Loading raw evidence</p>;
    }

    return null;
  }

  const { evidence, focusSourceId } = rawEvidenceState;

  return (
    <section className="evidence-panel raw-evidence-panel" id="raw-evidence-panel" aria-labelledby="raw-evidence-title">
      <div className="section-heading">
        <div>
          <h3 id="raw-evidence-title">Raw evidence</h3>
          <p>Run {evidence.run.id}</p>
        </div>
        <button className="secondary-button compact-button" onClick={onDismiss} type="button">
          Close
        </button>
      </div>
      <div className="raw-evidence-grid">
        <section aria-labelledby="survey-evidence-title">
          <h4 id="survey-evidence-title">Survey responses</h4>
          {evidence.surveyResponses.length === 0 ? <p className="muted-copy">No survey responses captured</p> : null}
          {evidence.surveyResponses.map((response) => (
            <article
              className={focusSourceId === response.id ? "raw-evidence-item focused-raw-evidence" : "raw-evidence-item"}
              id={`raw-evidence-${response.id}`}
              key={response.id}
            >
              <span>{response.surveyQuestionId}</span>
              <p>{response.responseText}</p>
              <small>{formatDateTime(response.submittedAt)}</small>
            </article>
          ))}
        </section>
        <section aria-labelledby="transcript-evidence-title">
          <h4 id="transcript-evidence-title">Transcript turns</h4>
          {evidence.interviewTurns.length === 0 ? <p className="muted-copy">No transcript turns captured</p> : null}
          {evidence.interviewTurns.map((turn) => (
            <article
              className={focusSourceId === turn.id ? "raw-evidence-item focused-raw-evidence" : "raw-evidence-item"}
              id={`raw-evidence-${turn.id}`}
              key={turn.id}
            >
              <span>{formatSpeaker(turn.speaker)}</span>
              <p>{turn.text}</p>
              <small>{formatOptionalAudioSpan(turn.audioStartMs, turn.audioEndMs)}</small>
            </article>
          ))}
        </section>
        <section aria-labelledby="audio-evidence-title">
          <h4 id="audio-evidence-title">Audio</h4>
          {evidence.audioAssets.length === 0 ? <p className="muted-copy">No audio assets captured</p> : null}
          {evidence.audioAssets.map((asset) => (
            <article
              className={focusSourceId === asset.id ? "raw-evidence-item focused-raw-evidence" : "raw-evidence-item"}
              id={`raw-evidence-${asset.id}`}
              key={asset.id}
            >
              <span>{asset.status}</span>
              <p>{formatAudioDuration(asset.durationSeconds)}</p>
              {asset.signedUrl ? (
                <>
                  <audio controls preload="none" src={asset.signedUrl} />
                  <a href={asset.signedUrl} rel="noreferrer" target="_blank">
                    Open signed audio link
                  </a>
                </>
              ) : (
                <small>Audio link unavailable</small>
              )}
              {asset.signedUrlExpiresAt ? <small>Link expires {formatDateTime(asset.signedUrlExpiresAt)}</small> : null}
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}

function formatRunStatus(run: Run) {
  return run.status.replaceAll("_", " ");
}

function formatScoringTrigger(trigger: "automatic" | "manual_rescore") {
  return trigger === "manual_rescore" ? "Manual rescore" : "Automatic";
}

function formatConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}% confidence`;
}

function formatScoreFlag(flag: ScoreFlag) {
  const labels: Record<ScoreFlag, string> = {
    low_confidence: "Low confidence",
    missing_interview_evidence: "Missing interview evidence",
    survey_interview_contradiction: "Survey/interview contradiction",
    stale_run: "Stale run",
    partial_run: "Partial run",
    technical_interruption: "Technical interruption"
  };

  return labels[flag];
}

function formatCitationSource(citation: EvidenceCitation) {
  if (citation.sourceType === "survey_response") {
    return "Survey evidence";
  }

  if (citation.sourceType === "interview_turn") {
    return "Interview transcript";
  }

  return `Audio span ${formatOptionalAudioSpan(citation.audioStartMs, citation.audioEndMs)}`;
}

function formatResolvedEvidenceTitle(citation: ResolvedEvidenceCitation) {
  if (citation.source.type === "survey_response") {
    return "Survey evidence";
  }

  if (citation.source.type === "interview_turn") {
    return "Interview transcript evidence";
  }

  return "Audio evidence";
}

function formatSpeaker(speaker: "ai" | "participant") {
  return speaker === "ai" ? "AI interviewer" : "Participant";
}

function formatOptionalAudioSpan(startMs: number | undefined, endMs: number | undefined) {
  if (startMs === undefined || endMs === undefined) {
    return "No timing";
  }

  return formatAudioSpan(startMs, endMs);
}

function formatAudioSpan(startMs: number, endMs: number) {
  return `${formatMilliseconds(startMs)}-${formatMilliseconds(endMs)}`;
}

function formatMilliseconds(value: number) {
  return `${(value / 1000).toFixed(1)}s`;
}

function formatAudioDuration(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
