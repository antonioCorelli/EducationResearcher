import type { FormEvent } from "react";

import type { ConsentMethod, ConsentState, ConsentVersion, StudySetupTab, StudyShell } from "../App";

export const defaultConsentForm = {
  consentText: "",
  consentMethod: "checkmark" as ConsentMethod,
  selectedConsentVersionNumber: null
};

export function createConsentForm(consentVersion: ConsentVersion | undefined) {
  return {
    consentText: consentVersion?.consentText ?? defaultConsentForm.consentText,
    consentMethod: consentVersion?.consentMethod ?? defaultConsentForm.consentMethod,
    selectedConsentVersionNumber: consentVersion?.versionNumber ?? defaultConsentForm.selectedConsentVersionNumber
  };
}

interface ResearcherConsentProps {
  readonly activeStudySetupTab: StudySetupTab;
  readonly consentError: string;
  readonly consentMethod: ConsentMethod;
  readonly consentState: ConsentState;
  readonly consentText: string;
  readonly isPreviewingPreviousConsent: boolean;
  readonly isSavingConsent: boolean;
  readonly selectedConsentVersion: ConsentVersion | undefined;
  readonly selectedConsentVersionNumber: number | null;
  readonly selectedStudy: StudyShell | undefined;
  readonly onConsentMethodChange: (method: ConsentMethod) => void;
  readonly onConsentTextChange: (text: string) => void;
  readonly onSaveConsent: (event: FormEvent<HTMLFormElement>) => void;
  readonly onSelectConsentVersion: (consentVersion: ConsentVersion) => void;
}

export function ResearcherConsent({
  activeStudySetupTab,
  consentError,
  consentMethod,
  consentState,
  consentText,
  isPreviewingPreviousConsent,
  isSavingConsent,
  selectedConsentVersion,
  selectedConsentVersionNumber,
  selectedStudy,
  onConsentMethodChange,
  onConsentTextChange,
  onSaveConsent,
  onSelectConsentVersion
}: ResearcherConsentProps) {
  return (
    <form
      aria-labelledby="study-setup-tab-consent"
      className="study-form study-setup-panel"
      hidden={activeStudySetupTab !== "consent"}
      id="study-setup-panel-consent"
      onSubmit={onSaveConsent}
      role="tabpanel"
    >
      <div className="section-heading">
        <h2>Consent information</h2>
        {selectedConsentVersion ? (
          <span className={isPreviewingPreviousConsent ? "version-pill preview-version-pill" : "version-pill"}>
            Version {selectedConsentVersion.versionNumber}
          </span>
        ) : null}
      </div>
      <p className="muted-copy">
        Capture the text and acceptance method shown to participants.
        Confirm legal or institutional requirements outside this tool.
      </p>
      <fieldset className="method-fieldset" disabled={!selectedStudy}>
        <legend>Consent method</legend>
        <label className="radio-option">
          <input
            checked={consentMethod === "checkmark"}
            disabled={isPreviewingPreviousConsent}
            name="consent-method"
            onChange={() => onConsentMethodChange("checkmark")}
            type="radio"
            value="checkmark"
          />
          Checkmark
        </label>
        <label className="radio-option">
          <input
            checked={consentMethod === "electronic_signature"}
            disabled={isPreviewingPreviousConsent}
            name="consent-method"
            onChange={() => onConsentMethodChange("electronic_signature")}
            type="radio"
            value="electronic_signature"
          />
          Electronic signature
        </label>
      </fieldset>
      <label>
        Consent text
        <textarea
          disabled={!selectedStudy || isPreviewingPreviousConsent}
          maxLength={12000}
          name="consent-text"
          onChange={(event) => onConsentTextChange(event.target.value)}
          placeholder={selectedStudy ? "Enter participant-facing consent text" : "Create or select a study first"}
          required={Boolean(selectedStudy)}
          value={consentText}
        />
      </label>
      {consentState.status === "loading" ? <p className="muted-copy">Loading consent</p> : null}
      {consentState.status === "error" ? <p className="form-error">{consentState.message}</p> : null}
      {consentState.status === "ready" && consentState.consentVersions.length > 0 ? (
        <div className="version-history" aria-label="Consent versions">
          {consentState.consentVersions.map((version) => (
            <button
              className={[
                "version-chip",
                version.isActive ? "active-version-chip" : "",
                version.versionNumber === selectedConsentVersionNumber ? "selected-version-chip" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              key={version.id}
              onClick={() => onSelectConsentVersion(version)}
              type="button"
            >
              v{version.versionNumber}
            </button>
          ))}
        </div>
      ) : null}
      {consentError ? <p className="form-error">{consentError}</p> : null}
      <div className="form-actions">
        <button
          className={isPreviewingPreviousConsent ? "danger-button" : "primary-button"}
          disabled={!selectedStudy || isSavingConsent}
          type="submit"
        >
          {isSavingConsent
            ? isPreviewingPreviousConsent
              ? "Restoring version"
              : "Saving consent"
            : isPreviewingPreviousConsent
              ? "Restore Version"
              : consentState.status === "ready" && consentState.activeConsentVersion
                ? "Create new version"
                : "Save consent"}
        </button>
      </div>
    </form>
  );
}
