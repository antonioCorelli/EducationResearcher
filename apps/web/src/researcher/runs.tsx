import type { FormEvent } from "react";

import type { ParticipantSlot, Run, RunState, StudySetupTab, StudyShell } from "../App";

interface ResearcherRunsProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly isCreatingRuns: boolean;
  readonly participantSlots: readonly ParticipantSlot[];
  readonly runError: string;
  readonly runState: RunState;
  readonly selectedRunParticipantSlotIds: readonly string[];
  readonly selectedStudy: StudyShell | undefined;
  readonly onCreateRuns: (event: FormEvent<HTMLFormElement>) => void;
  readonly onSelectedRunParticipantSlotIdsChange: (participantSlotIds: readonly string[]) => void;
}

export function ResearcherRuns({
  activeStudySetupTab,
  isCreatingRuns,
  participantSlots,
  runError,
  runState,
  selectedRunParticipantSlotIds,
  selectedStudy,
  onCreateRuns,
  onSelectedRunParticipantSlotIdsChange
}: ResearcherRunsProps) {
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
          </div>
          {runs.map((run) => (
            <div className="run-row" key={run.id} role="row">
              <span role="cell">{participantCodeBySlotId.get(run.participantSlotId) ?? run.participantSlotId}</span>
              <span role="cell">{formatRunStatus(run)}</span>
              <span role="cell">{formatDateTime(run.freshnessDeadlineAt)}</span>
              <span role="cell">{run.maxInterviewMinutes} min</span>
              <span role="cell">{run.currentRunForSlot ? "Yes" : "No"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatRunStatus(run: Run) {
  return run.status.replaceAll("_", " ");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
