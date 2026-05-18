import { useState, type FormEvent } from "react";

import type {
  ParticipantSlot,
  ParticipantSlotBulkSummary,
  ParticipantSlotState,
  ResearcherRunDashboardSlot,
  Run,
  RunDashboardState,
  RunState,
  StudyShell
} from "../App";
import { formatDateTime, formatRunStatus, getStatusPillClassName } from "./runFormat";

interface ResearcherRunOperationsProps {
  readonly generatedParticipantSlotCount: number;
  readonly isArchivingParticipantSlotId: string | null;
  readonly isCreatingRuns: boolean;
  readonly isGeneratingParticipantSlots: boolean;
  readonly isImportingParticipantSlots: boolean;
  readonly isSavingParticipantSlot: boolean;
  readonly participantCode: string;
  readonly participantSlotBulkSummary: ParticipantSlotBulkSummary | null;
  readonly participantSlotCsv: string;
  readonly participantSlotError: string;
  readonly participantSlotState: ParticipantSlotState;
  readonly participantSlots: readonly ParticipantSlot[];
  readonly runDashboardState: RunDashboardState;
  readonly runError: string;
  readonly runState: RunState;
  readonly selectedRunParticipantSlotIds: readonly string[];
  readonly selectedStudy: StudyShell | undefined;
  readonly onArchiveParticipantSlot: (participantSlot: ParticipantSlot) => void;
  readonly onCreateRuns: (event: FormEvent<HTMLFormElement>) => void;
  readonly onGenerateParticipantSlots: (event: FormEvent<HTMLFormElement>) => void;
  readonly onGeneratedParticipantSlotCountChange: (count: number) => void;
  readonly onImportParticipantSlots: (event: FormEvent<HTMLFormElement>) => void;
  readonly onParticipantCodeChange: (participantCode: string) => void;
  readonly onParticipantSlotCsvChange: (csv: string) => void;
  readonly onSaveParticipantSlot: (event: FormEvent<HTMLFormElement>) => void;
  readonly onSelectedRunParticipantSlotIdsChange: (participantSlotIds: readonly string[]) => void;
}

export function ResearcherRunOperations({
  generatedParticipantSlotCount,
  isArchivingParticipantSlotId,
  isCreatingRuns,
  isGeneratingParticipantSlots,
  isImportingParticipantSlots,
  isSavingParticipantSlot,
  participantCode,
  participantSlotBulkSummary,
  participantSlotCsv,
  participantSlotError,
  participantSlotState,
  participantSlots,
  runDashboardState,
  runError,
  runState,
  selectedRunParticipantSlotIds,
  selectedStudy,
  onArchiveParticipantSlot,
  onCreateRuns,
  onGenerateParticipantSlots,
  onGeneratedParticipantSlotCountChange,
  onImportParticipantSlots,
  onParticipantCodeChange,
  onParticipantSlotCsvChange,
  onSaveParticipantSlot,
  onSelectedRunParticipantSlotIdsChange
}: ResearcherRunOperationsProps) {
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const runs = runState.status === "ready" ? runState.runs : [];
  const dashboardSlots = runDashboardState.status === "ready" ? runDashboardState.slots : [];
  const dashboardSlotById = new Map(dashboardSlots.map((slot) => [slot.participantSlot.id, slot]));
  const currentRunBySlotId = new Map(runs.filter((run) => run.currentRunForSlot).map((run) => [run.participantSlotId, run]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  const isBulkActionRunning = isImportingParticipantSlots || isGeneratingParticipantSlots;

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
      <div className="participant-add-panel">
        <form className="participant-slot-create-row" onSubmit={onSaveParticipantSlot}>
          <label>
            Participant code
            <input
              disabled={!selectedStudy || isSavingParticipantSlot}
              maxLength={80}
              name="participant-code"
              onChange={(event) => onParticipantCodeChange(event.target.value)}
              placeholder={selectedStudy ? "P001" : "Create or select a study first"}
              required={Boolean(selectedStudy)}
              type="text"
              value={participantCode}
            />
          </label>
          <button className="primary-button" disabled={!selectedStudy || isSavingParticipantSlot} type="submit">
            {isSavingParticipantSlot ? "Adding participant" : "Add participant"}
          </button>
        </form>
        <details className="participant-slot-bulk-disclosure">
          <summary>Bulk add participants</summary>
          <div className="participant-slot-bulk-grid">
            <form className="participant-slot-bulk-panel" onSubmit={onImportParticipantSlots}>
              <label>
                Import codes from CSV
                <textarea
                  disabled={!selectedStudy || isImportingParticipantSlots}
                  name="participant-slot-csv"
                  onChange={(event) => onParticipantSlotCsvChange(event.target.value)}
                  placeholder={"participantCode\nP001\nP002"}
                  value={participantSlotCsv}
                />
              </label>
              <button className="secondary-button" disabled={!selectedStudy || isImportingParticipantSlots} type="submit">
                {isImportingParticipantSlots ? "Importing" : "Import CSV"}
              </button>
            </form>
            <form className="participant-slot-bulk-panel" onSubmit={onGenerateParticipantSlots}>
              <label>
                Generate slots
                <input
                  disabled={!selectedStudy || isGeneratingParticipantSlots}
                  max={200}
                  min={1}
                  name="generated-participant-slot-count"
                  onChange={(event) => onGeneratedParticipantSlotCountChange(Number(event.target.value))}
                  type="number"
                  value={generatedParticipantSlotCount}
                />
              </label>
              <button className="secondary-button" disabled={!selectedStudy || isGeneratingParticipantSlots} type="submit">
                {isGeneratingParticipantSlots ? "Generating" : "Generate"}
              </button>
            </form>
          </div>
        </details>
        {participantSlotState.status === "loading" ? <p className="muted-copy">Loading participants</p> : null}
        {participantSlotState.status === "error" ? <p className="form-error">{participantSlotState.message}</p> : null}
        {participantSlotError ? <p className="form-error">{participantSlotError}</p> : null}
        <ParticipantSlotBulkResult participantSlotBulkSummary={participantSlotBulkSummary} />
      </div>
      {runState.status === "loading" ? <p className="muted-copy">Loading runs</p> : null}
      {runState.status === "error" ? <p className="form-error">{runState.message}</p> : null}
      {runDashboardState.status === "loading" ? <p className="muted-copy">Loading participant status</p> : null}
      {runDashboardState.status === "error" ? <p className="form-error">{runDashboardState.message}</p> : null}
      <form className="participant-operations-panel" onSubmit={onCreateRuns}>
        <div className="section-heading">
          <h3>Participants</h3>
          <button
            className="primary-button compact-button"
            disabled={!selectedStudy || isCreatingRuns || selectedRunParticipantSlotIds.length === 0}
            type="submit"
          >
            {isCreatingRuns
              ? "Creating runs"
              : `Create ${selectedRunParticipantSlotIds.length || ""} run${selectedRunParticipantSlotIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
        {participantSlots.length === 0 && participantSlotState.status === "ready" ? <p className="muted-copy">No participants yet</p> : null}
        {participantSlots.length > 0 ? (
          <div className="participant-operations-table" role="table" aria-label="Participants">
            <div className="participant-operations-row participant-operations-header" role="row">
              <span role="columnheader">Run</span>
              <span role="columnheader">Participant ID</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Link</span>
              <span role="columnheader">Archive</span>
            </div>
            {participantSlots.map((slot) => {
              const dashboardSlot = dashboardSlotById.get(slot.id);
              const currentRun = currentRunBySlotId.get(slot.id);
              const latestRun = dashboardSlot?.latestRun;
              const latestRunWithAccess = latestRun ? runById.get(latestRun.id) : undefined;
              const copyableRun = currentRun ?? latestRunWithAccess;

              return (
                <ParticipantOperationRow
                  copiedRunId={copiedRunId}
                  currentRun={currentRun}
                  dashboardSlot={dashboardSlot}
                  isArchiving={isArchivingParticipantSlotId === slot.id}
                  isArchiveDisabled={slot.status === "archived" || isBulkActionRunning}
                  isCreateRunDisabled={!selectedStudy || isCreatingRuns || slot.status === "archived"}
                  isSelected={selectedRunParticipantSlotIds.includes(slot.id)}
                  key={slot.id}
                  participantSlot={slot}
                  runWithAccess={copyableRun}
                  onArchiveParticipantSlot={onArchiveParticipantSlot}
                  onCopiedRunIdChange={setCopiedRunId}
                  onToggleParticipantSlot={toggleParticipantSlot}
                />
              );
            })}
          </div>
        ) : null}
        {participantSlots.length > 0 && participantSlots.every((slot) => slot.status === "archived") ? (
          <p className="muted-copy">Add an active participant before creating runs</p>
        ) : null}
        {runError ? <p className="form-error">{runError}</p> : null}
      </form>
    </section>
  );
}

function ParticipantSlotBulkResult({
  participantSlotBulkSummary
}: {
  readonly participantSlotBulkSummary: ParticipantSlotBulkSummary | null;
}) {
  if (!participantSlotBulkSummary) {
    return null;
  }

  return (
    <div className="participant-slot-import-result" role="status">
      <p>
        Created {participantSlotBulkSummary.createdCount} participant
        {participantSlotBulkSummary.createdCount === 1 ? "" : "s"}
        {participantSlotBulkSummary.rejectedRows.length > 0
          ? `; ${participantSlotBulkSummary.rejectedRows.length} row${participantSlotBulkSummary.rejectedRows.length === 1 ? "" : "s"} need review.`
          : "."}
      </p>
      {participantSlotBulkSummary.rejectedRows.length > 0 ? (
        <div className="participant-slot-rejection-list" role="list">
          {participantSlotBulkSummary.rejectedRows.map((row) => (
            <div className="participant-slot-rejection-row" key={`${row.rowNumber}-${row.reason}`} role="listitem">
              <strong>Row {row.rowNumber}</strong>
              <span>{row.participantCode ?? "No code"}</span>
              <span>{row.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ParticipantOperationRow({
  copiedRunId,
  currentRun,
  dashboardSlot,
  isArchiving,
  isArchiveDisabled,
  isCreateRunDisabled,
  isSelected,
  participantSlot,
  runWithAccess,
  onArchiveParticipantSlot,
  onCopiedRunIdChange,
  onToggleParticipantSlot
}: {
  readonly copiedRunId: string | null;
  readonly currentRun: Run | undefined;
  readonly dashboardSlot: ResearcherRunDashboardSlot | undefined;
  readonly isArchiving: boolean;
  readonly isArchiveDisabled: boolean;
  readonly isCreateRunDisabled: boolean;
  readonly isSelected: boolean;
  readonly participantSlot: ParticipantSlot;
  readonly runWithAccess: Run | undefined;
  readonly onArchiveParticipantSlot: (participantSlot: ParticipantSlot) => void;
  readonly onCopiedRunIdChange: (runId: string) => void;
  readonly onToggleParticipantSlot: (participantSlotId: string) => void;
}) {
  const latestRun = dashboardSlot?.latestRun;

  return (
    <div className="participant-operations-row" role="row">
      <span role="cell">
        <label className="participant-run-checkbox">
          <input
            checked={isSelected}
            disabled={isCreateRunDisabled}
            onChange={() => onToggleParticipantSlot(participantSlot.id)}
            type="checkbox"
          />
          <span className="visually-hidden">Select {participantSlot.participantCode} for a new run</span>
        </label>
      </span>
      <span role="cell">
        <strong>{participantSlot.participantCode}</strong>
        <small>{participantSlot.status === "archived" ? "Archived participant" : "Active participant"}</small>
      </span>
      <span role="cell">
        {latestRun ? (
          <>
            <span className={getStatusPillClassName(latestRun.status)}>{latestRun.status.label}</span>
            <small>
              Updated {formatDateTime(latestRun.updatedAt)} | Fresh until {formatDateTime(latestRun.freshnessDeadlineAt)}
            </small>
          </>
        ) : currentRun ? (
          <>
            <span className="run-status-pill">{formatRunStatus(currentRun)}</span>
            <small>Fresh until {formatDateTime(currentRun.freshnessDeadlineAt)}</small>
          </>
        ) : (
          <span className="muted-copy">No run yet</span>
        )}
      </span>
      <span role="cell">
        {runWithAccess?.participantAccessUrl ? (
          <button
            className="secondary-button compact-button"
            onClick={async () => {
              await navigator.clipboard.writeText(runWithAccess.participantAccessUrl ?? "");
              onCopiedRunIdChange(runWithAccess.id);
            }}
            type="button"
          >
            {copiedRunId === runWithAccess.id ? "Copied" : "Copy link"}
          </button>
        ) : (
          <span className="muted-copy">No link</span>
        )}
      </span>
      <span role="cell">
        <button
          className="secondary-button compact-button"
          disabled={isArchiveDisabled || isArchiving}
          onClick={() => onArchiveParticipantSlot(participantSlot)}
          type="button"
        >
          {isArchiving ? "Archiving" : "Archive"}
        </button>
      </span>
    </div>
  );
}
