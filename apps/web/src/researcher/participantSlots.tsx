import type { FormEvent } from "react";

import type { ParticipantSlot, ParticipantSlotState, StudySetupTab, StudyShell } from "../App";

interface ResearcherParticipantSlotsProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly isArchivingParticipantSlotId: string | null;
  readonly isSavingParticipantSlot: boolean;
  readonly participantCode: string;
  readonly participantSlotError: string;
  readonly participantSlotState: ParticipantSlotState;
  readonly selectedStudy: StudyShell | undefined;
  readonly onArchiveParticipantSlot: (participantSlot: ParticipantSlot) => void;
  readonly onParticipantCodeChange: (participantCode: string) => void;
  readonly onSaveParticipantSlot: (event: FormEvent<HTMLFormElement>) => void;
}

export function ResearcherParticipantSlots({
  activeStudySetupTab,
  isArchivingParticipantSlotId,
  isSavingParticipantSlot,
  participantCode,
  participantSlotError,
  participantSlotState,
  selectedStudy,
  onArchiveParticipantSlot,
  onParticipantCodeChange,
  onSaveParticipantSlot
}: ResearcherParticipantSlotsProps) {
  const participantSlots = participantSlotState.status === "ready" ? participantSlotState.participantSlots : [];

  return (
    <form
      aria-labelledby="participant-slots-title"
      className="study-form study-setup-panel"
      hidden={activeStudySetupTab !== "shell"}
      id="participant-slots-panel"
      onSubmit={onSaveParticipantSlot}
    >
      <div className="section-heading">
        <h2 id="participant-slots-title">Participant slots</h2>
      </div>
      <div className="participant-slot-create-row">
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
      </div>
      {participantSlotState.status === "loading" ? <p className="muted-copy">Loading participant slots</p> : null}
      {participantSlotState.status === "error" ? <p className="form-error">{participantSlotState.message}</p> : null}
      {participantSlotError ? <p className="form-error">{participantSlotError}</p> : null}
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
              <span role="cell">{slot.codeSource === "researcher_supplied" ? "Researcher supplied" : slot.codeSource}</span>
              <span role="cell">{slot.status}</span>
              <span role="cell">{slot.status === "archived" ? "Yes" : "No"}</span>
              <span role="cell">
                <button
                  className="secondary-button compact-button"
                  disabled={slot.status === "archived" || isArchivingParticipantSlotId === slot.id}
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
    </form>
  );
}
