import type { FormEvent } from "react";

import type { ParticipantSlot, ParticipantSlotBulkSummary, ParticipantSlotState, StudySetupTab, StudyShell } from "../App";

interface ResearcherParticipantSlotsProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly generatedParticipantSlotCount: number;
  readonly isArchivingParticipantSlotId: string | null;
  readonly isGeneratingParticipantSlots: boolean;
  readonly isImportingParticipantSlots: boolean;
  readonly isSavingParticipantSlot: boolean;
  readonly participantCode: string;
  readonly participantSlotBulkSummary: ParticipantSlotBulkSummary | null;
  readonly participantSlotCsv: string;
  readonly participantSlotError: string;
  readonly participantSlotState: ParticipantSlotState;
  readonly selectedStudy: StudyShell | undefined;
  readonly onArchiveParticipantSlot: (participantSlot: ParticipantSlot) => void;
  readonly onGenerateParticipantSlots: (event: FormEvent<HTMLFormElement>) => void;
  readonly onGeneratedParticipantSlotCountChange: (count: number) => void;
  readonly onImportParticipantSlots: (event: FormEvent<HTMLFormElement>) => void;
  readonly onParticipantCodeChange: (participantCode: string) => void;
  readonly onParticipantSlotCsvChange: (csv: string) => void;
  readonly onSaveParticipantSlot: (event: FormEvent<HTMLFormElement>) => void;
}

export function ResearcherParticipantSlots({
  activeStudySetupTab,
  generatedParticipantSlotCount,
  isArchivingParticipantSlotId,
  isGeneratingParticipantSlots,
  isImportingParticipantSlots,
  isSavingParticipantSlot,
  participantCode,
  participantSlotBulkSummary,
  participantSlotCsv,
  participantSlotError,
  participantSlotState,
  selectedStudy,
  onArchiveParticipantSlot,
  onGenerateParticipantSlots,
  onGeneratedParticipantSlotCountChange,
  onImportParticipantSlots,
  onParticipantCodeChange,
  onParticipantSlotCsvChange,
  onSaveParticipantSlot
}: ResearcherParticipantSlotsProps) {
  const participantSlots = participantSlotState.status === "ready" ? participantSlotState.participantSlots : [];
  const isBulkActionRunning = isImportingParticipantSlots || isGeneratingParticipantSlots;

  return (
    <section
      aria-labelledby="participant-slots-title"
      className="study-form study-setup-panel"
      hidden={activeStudySetupTab !== "shell"}
      id="participant-slots-panel"
    >
      <div className="section-heading">
        <h2 id="participant-slots-title">Participant slots</h2>
      </div>
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
          {isSavingParticipantSlot ? "Adding slot" : "Add slot"}
        </button>
      </form>
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
      {participantSlotState.status === "loading" ? <p className="muted-copy">Loading participant slots</p> : null}
      {participantSlotState.status === "error" ? <p className="form-error">{participantSlotState.message}</p> : null}
      {participantSlotError ? <p className="form-error">{participantSlotError}</p> : null}
      {participantSlotBulkSummary ? (
        <div className="participant-slot-import-result" role="status">
          <p>
            Created {participantSlotBulkSummary.createdCount} participant slot
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
      ) : null}
      {participantSlotState.status === "ready" && participantSlots.length === 0 ? (
        <p className="muted-copy">No participant slots yet</p>
      ) : null}
      {participantSlots.length > 0 ? (
        <div className="participant-slot-table" role="table" aria-label="Participant slots">
          <div className="participant-slot-row participant-slot-header" role="row">
            <span role="columnheader">Code</span>
            <span role="columnheader">Source</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Archived</span>
            <span role="columnheader">Actions</span>
          </div>
          {participantSlots.map((slot) => (
            <div className="participant-slot-row" key={slot.id} role="row">
              <span role="cell">{slot.participantCode}</span>
              <span role="cell">{slot.codeSource === "researcher_supplied" ? "Researcher supplied" : "Platform generated"}</span>
              <span role="cell">{slot.status}</span>
              <span role="cell">{slot.status === "archived" ? "Yes" : "No"}</span>
              <span role="cell">
                <button
                  className="secondary-button compact-button"
                  disabled={slot.status === "archived" || isArchivingParticipantSlotId === slot.id || isBulkActionRunning}
                  onClick={() => onArchiveParticipantSlot(slot)}
                  type="button"
                >
                  {isArchivingParticipantSlotId === slot.id ? "Archiving" : "Archive"}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
