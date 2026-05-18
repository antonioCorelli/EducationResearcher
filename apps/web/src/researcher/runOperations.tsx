import { useState, type FormEvent } from "react";

import type { ParticipantSlot, RawEvidenceState, ResearcherRunDashboardSlot, RunDashboardState, RunState, StudyShell } from "../App";
import { RawEvidencePanel } from "./rawEvidence";
import {
  formatArtifactSummary,
  formatDateTime,
  formatRunStatus,
  formatScoringSummary,
  getStatusPillClassName
} from "./runFormat";

interface ResearcherRunOperationsProps {
  readonly isLoadingRawEvidenceRunId: string | null;
  readonly isCreatingRuns: boolean;
  readonly participantSlots: readonly ParticipantSlot[];
  readonly rawEvidenceState: RawEvidenceState;
  readonly runDashboardState: RunDashboardState;
  readonly runError: string;
  readonly runState: RunState;
  readonly selectedRunParticipantSlotIds: readonly string[];
  readonly selectedStudy: StudyShell | undefined;
  readonly onCreateRuns: (event: FormEvent<HTMLFormElement>) => void;
  readonly onDismissRawEvidence: () => void;
  readonly onOpenRawEvidence: (runId: string) => void;
  readonly onSelectedRunParticipantSlotIdsChange: (participantSlotIds: readonly string[]) => void;
}

export function ResearcherRunOperations({
  isLoadingRawEvidenceRunId,
  isCreatingRuns,
  participantSlots,
  rawEvidenceState,
  runDashboardState,
  runError,
  runState,
  selectedRunParticipantSlotIds,
  selectedStudy,
  onCreateRuns,
  onDismissRawEvidence,
  onOpenRawEvidence,
  onSelectedRunParticipantSlotIdsChange
}: ResearcherRunOperationsProps) {
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const runs = runState.status === "ready" ? runState.runs : [];
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
    <section className="study-form workspace-task-panel" aria-labelledby="run-operations-title">
      <div className="section-heading">
        <h2 id="run-operations-title">Run operations</h2>
      </div>
      <RunStatusDashboard runDashboardState={runDashboardState} />
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
      <RawEvidencePanel rawEvidenceState={rawEvidenceState} onDismiss={onDismissRawEvidence} />
    </section>
  );
}

function RunStatusDashboard({ runDashboardState }: { readonly runDashboardState: RunDashboardState }) {
  const slots = runDashboardState.status === "ready" ? runDashboardState.slots : [];

  return (
    <section className="run-dashboard" aria-labelledby="run-dashboard-title">
      <div className="section-heading">
        <h3 id="run-dashboard-title">Run status dashboard</h3>
        {slots.length > 0 ? <span className="version-pill">{slots.length} slots</span> : null}
      </div>
      {runDashboardState.status === "loading" ? <p className="muted-copy">Loading run dashboard</p> : null}
      {runDashboardState.status === "error" ? <p className="form-error">{runDashboardState.message}</p> : null}
      {runDashboardState.status === "ready" && slots.length === 0 ? <p className="muted-copy">No participant slots yet</p> : null}
      {slots.length > 0 ? (
        <div className="run-dashboard-table" role="table" aria-label="Run status dashboard">
          <div className="run-dashboard-row run-dashboard-header" role="row">
            <span role="columnheader">Participant</span>
            <span role="columnheader">Latest run</span>
            <span role="columnheader">Artifacts</span>
            <span role="columnheader">Scoring</span>
            <span role="columnheader">Associated runs</span>
          </div>
          {slots.map((slot) => (
            <RunStatusDashboardRow key={slot.participantSlot.id} slot={slot} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RunStatusDashboardRow({ slot }: { readonly slot: ResearcherRunDashboardSlot }) {
  const latestRun = slot.latestRun;

  return (
    <div className="run-dashboard-row" role="row">
      <span role="cell">
        <strong>{slot.participantSlot.participantCode}</strong>
        <small>{slot.participantSlot.status === "archived" ? "Archived slot" : "Active slot"}</small>
      </span>
      <span role="cell">
        {latestRun ? (
          <>
            <span className={getStatusPillClassName(latestRun.status)}>{latestRun.status.label}</span>
            <small>
              Updated {formatDateTime(latestRun.updatedAt)} | Fresh until {formatDateTime(latestRun.freshnessDeadlineAt)}
            </small>
          </>
        ) : (
          <span className="muted-copy">No runs</span>
        )}
      </span>
      <span role="cell">{latestRun ? formatArtifactSummary(latestRun.artifactSummary) : "No artifacts captured"}</span>
      <span role="cell">{latestRun ? formatScoringSummary(latestRun.scoringSummary) : "Not started"}</span>
      <span role="cell">
        {slot.runs.length > 0 ? (
          <span>
            {slot.runs.length} run{slot.runs.length === 1 ? "" : "s"}
            {slot.currentRun ? ` | current ${slot.currentRun.status.label}` : ""}
          </span>
        ) : (
          "None"
        )}
      </span>
    </div>
  );
}
