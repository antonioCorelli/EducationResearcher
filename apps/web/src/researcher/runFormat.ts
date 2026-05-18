import type { EvidenceCitation, ResearcherRunDashboardSlot, ResolvedEvidenceCitation, Run, ScoreFlag } from "../App";

export function formatRunStatus(run: Run) {
  return run.status.replaceAll("_", " ");
}

export function getStatusPillClassName(status: ResearcherRunDashboardSlot["runs"][number]["status"]) {
  if (status.isTechnicalInterruption) {
    return "run-status-pill technical-status-pill";
  }

  if (status.isStale || status.isPartial) {
    return "run-status-pill caution-status-pill";
  }

  if (status.isScored || status.isCompleted) {
    return "run-status-pill complete-status-pill";
  }

  return "run-status-pill";
}

export function formatArtifactSummary(summary: ResearcherRunDashboardSlot["runs"][number]["artifactSummary"]) {
  return [
    formatCount(summary.surveyResponseCount, "survey response"),
    formatCount(summary.interviewTurnCount, "transcript turn"),
    formatCount(summary.audioAssetCount, "audio asset"),
    formatAudioDuration(summary.audioDurationSeconds)
  ].join(" | ");
}

export function formatScoringSummary(summary: ResearcherRunDashboardSlot["runs"][number]["scoringSummary"]) {
  if (summary.state === "not_started") {
    return "Not started";
  }

  const latestScoredAt = summary.latestScoredAt ? ` | ${formatDateTime(summary.latestScoredAt)}` : "";
  const trigger = summary.latestTrigger ? formatScoringTrigger(summary.latestTrigger) : "Completed";

  return `${trigger}${latestScoredAt}`;
}

export function formatScoringTrigger(trigger: "automatic" | "manual_rescore") {
  return trigger === "manual_rescore" ? "Manual rescore" : "Automatic";
}

export function formatConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}% confidence`;
}

export function formatScoreFlag(flag: ScoreFlag) {
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

export function formatCitationSource(citation: EvidenceCitation) {
  if (citation.sourceType === "survey_response") {
    return "Survey evidence";
  }

  if (citation.sourceType === "interview_turn") {
    return "Interview transcript";
  }

  return `Audio span ${formatOptionalAudioSpan(citation.audioStartMs, citation.audioEndMs)}`;
}

export function formatResolvedEvidenceTitle(citation: ResolvedEvidenceCitation) {
  if (citation.source.type === "survey_response") {
    return "Survey evidence";
  }

  if (citation.source.type === "interview_turn") {
    return "Interview transcript evidence";
  }

  return "Audio evidence";
}

export function formatSpeaker(speaker: "ai" | "participant") {
  return speaker === "ai" ? "AI interviewer" : "Participant";
}

export function formatOptionalAudioSpan(startMs: number | undefined, endMs: number | undefined) {
  if (startMs === undefined || endMs === undefined) {
    return "No timing";
  }

  return formatAudioSpan(startMs, endMs);
}

export function formatAudioSpan(startMs: number, endMs: number) {
  return `${formatMilliseconds(startMs)}-${formatMilliseconds(endMs)}`;
}

export function formatAudioDuration(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatCount(count: number, singularLabel: string) {
  return `${count} ${singularLabel}${count === 1 ? "" : "s"}`;
}

function formatMilliseconds(value: number) {
  return `${(value / 1000).toFixed(1)}s`;
}
