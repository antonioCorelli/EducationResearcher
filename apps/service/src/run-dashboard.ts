import type { ParticipantSlot, ParticipantSlotStore } from "./participant-slots.js";
import type { ScoringRun, ScoringStore } from "./scoring.js";
import type { InterviewAudioAsset, InterviewSession, Run, RunStatus, RunStore } from "./runs.js";

export interface ResearcherSafeRunStatus {
  readonly value: RunStatus;
  readonly label: string;
  readonly isStale: boolean;
  readonly isPartial: boolean;
  readonly isTechnicalInterruption: boolean;
  readonly isCompleted: boolean;
  readonly isScored: boolean;
}

export interface ResearcherRunArtifactSummary {
  readonly consentRecordCount: number;
  readonly surveyResponseCount: number;
  readonly interviewSessionCount: number;
  readonly interviewTurnCount: number;
  readonly audioAssetCount: number;
  readonly audioDurationSeconds: number;
  readonly transcriptTokenCount: number;
}

export interface ResearcherRunScoringSummary {
  readonly state: "not_started" | "completed";
  readonly scoringRunCount: number;
  readonly latestScoredAt?: string;
  readonly latestTrigger?: ScoringRun["trigger"];
}

export interface ResearcherDashboardRun {
  readonly id: string;
  readonly status: ResearcherSafeRunStatus;
  readonly freshnessDeadlineAt: string;
  readonly currentRunForSlot: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly artifactSummary: ResearcherRunArtifactSummary;
  readonly scoringSummary: ResearcherRunScoringSummary;
}

export interface ResearcherRunDashboardSlot {
  readonly participantSlot: ParticipantSlot;
  readonly currentRun?: ResearcherDashboardRun;
  readonly latestRun?: ResearcherDashboardRun;
  readonly runs: readonly ResearcherDashboardRun[];
}

export interface ResearcherRunDashboard {
  readonly slots: readonly ResearcherRunDashboardSlot[];
}

export class RunDashboardService {
  constructor(
    private readonly participantSlotStore: Pick<ParticipantSlotStore, "listByStudy">,
    private readonly runStore: Pick<
      RunStore,
      | "listByStudy"
      | "listConsentRecordsByRun"
      | "listSurveyResponsesByRun"
      | "listInterviewSessionsByRun"
      | "listInterviewTurnsByRun"
      | "listInterviewAudioAssetsByRun"
    >,
    private readonly scoringStore: Pick<ScoringStore, "listScoringRunsByRun">
  ) {}

  async listForStudy(studyId: string): Promise<ResearcherRunDashboard> {
    const [participantSlots, runs] = await Promise.all([
      this.participantSlotStore.listByStudy(studyId),
      this.runStore.listByStudy(studyId)
    ]);
    const runsBySlotId = new Map<string, Run[]>();

    for (const run of runs) {
      const slotRuns = runsBySlotId.get(run.participantSlotId) ?? [];
      slotRuns.push(run);
      runsBySlotId.set(run.participantSlotId, slotRuns);
    }

    return {
      slots: await Promise.all(
        participantSlots.map(async (participantSlot) => {
          const slotRuns = runsBySlotId.get(participantSlot.id) ?? [];
          const dashboardRuns = await Promise.all(slotRuns.map((run) => this.toDashboardRun(run)));
          const latestRun = dashboardRuns[0];
          const currentRun = dashboardRuns.find((run) => run.currentRunForSlot);

          return {
            participantSlot,
            ...(currentRun ? { currentRun } : {}),
            ...(latestRun ? { latestRun } : {}),
            runs: dashboardRuns
          };
        })
      )
    };
  }

  private async toDashboardRun(run: Run): Promise<ResearcherDashboardRun> {
    const [
      consentRecords,
      surveyResponses,
      interviewSessions,
      interviewTurns,
      audioAssets,
      scoringRuns
    ] = await Promise.all([
      this.runStore.listConsentRecordsByRun(run.id),
      this.runStore.listSurveyResponsesByRun(run.id),
      this.runStore.listInterviewSessionsByRun(run.id),
      this.runStore.listInterviewTurnsByRun(run.id),
      this.runStore.listInterviewAudioAssetsByRun(run.id),
      this.scoringStore.listScoringRunsByRun(run.id)
    ]);
    const latestScoringRun = scoringRuns[0];

    return {
      id: run.id,
      status: toResearcherSafeRunStatus(run.status),
      freshnessDeadlineAt: run.freshnessDeadlineAt,
      currentRunForSlot: run.currentRunForSlot,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      artifactSummary: summarizeArtifacts({
        consentRecordCount: consentRecords.length,
        surveyResponseCount: surveyResponses.length,
        interviewSessions,
        interviewTurnCount: interviewTurns.length,
        audioAssets
      }),
      scoringSummary: {
        state: latestScoringRun ? "completed" : "not_started",
        scoringRunCount: scoringRuns.length,
        ...(latestScoringRun
          ? {
              latestScoredAt: latestScoringRun.scoredAt,
              latestTrigger: latestScoringRun.trigger
            }
          : {})
      }
    };
  }
}

export function toResearcherSafeRunStatus(status: RunStatus): ResearcherSafeRunStatus {
  const labels: Record<RunStatus, string> = {
    created: "Created",
    consented: "Consented",
    survey_in_progress: "Survey in progress",
    survey_completed: "Survey completed",
    interview_in_progress: "Interview in progress",
    interview_paused: "Interview paused",
    interview_completed: "Interview completed",
    stale: "Stale",
    partial: "Partial",
    technical_interruption: "Technical interruption",
    scored: "Scored"
  };

  return {
    value: status,
    label: labels[status],
    isStale: status === "stale",
    isPartial: status === "partial",
    isTechnicalInterruption: status === "technical_interruption",
    isCompleted: status === "interview_completed" || status === "scored",
    isScored: status === "scored"
  };
}

function summarizeArtifacts(input: {
  readonly consentRecordCount: number;
  readonly surveyResponseCount: number;
  readonly interviewSessions: readonly InterviewSession[];
  readonly interviewTurnCount: number;
  readonly audioAssets: readonly InterviewAudioAsset[];
}): ResearcherRunArtifactSummary {
  return {
    consentRecordCount: input.consentRecordCount,
    surveyResponseCount: input.surveyResponseCount,
    interviewSessionCount: input.interviewSessions.length,
    interviewTurnCount: input.interviewTurnCount,
    audioAssetCount: input.audioAssets.length,
    audioDurationSeconds: input.audioAssets.reduce((total, asset) => total + asset.durationSeconds, 0),
    transcriptTokenCount: input.interviewSessions.reduce(
      (total, session) => total + (session.transcriptTokenCount ?? 0),
      0
    )
  };
}
