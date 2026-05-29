import type { RawEvidenceState } from "../App";
import { formatAudioDuration, formatDateTime, formatOptionalAudioSpan, formatSpeaker } from "./runFormat";

const serviceBaseUrl = import.meta.env.VITE_SERVICE_BASE_URL ?? "http://127.0.0.1:4000";

interface RawEvidencePanelProps {
  readonly rawEvidenceState: RawEvidenceState;
  readonly onDismiss: () => void;
}

export function RawEvidencePanel({ rawEvidenceState, onDismiss }: RawEvidencePanelProps) {
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
                  <audio controls preload="none" src={normalizeAudioPlaybackUrl(asset.signedUrl)} />
                  <a href={normalizeAudioPlaybackUrl(asset.signedUrl)} rel="noreferrer" target="_blank">
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

export function normalizeAudioPlaybackUrl(signedUrl: string, baseUrl = serviceBaseUrl) {
  const parsedSignedUrl = new URL(signedUrl);

  if (parsedSignedUrl.pathname !== "/audio/interview") {
    return signedUrl;
  }

  const playbackBaseUrl = new URL(baseUrl);

  if (playbackBaseUrl.hostname === "localhost") {
    playbackBaseUrl.hostname = "127.0.0.1";
  }

  return new URL(`${parsedSignedUrl.pathname}${parsedSignedUrl.search}`, playbackBaseUrl).toString();
}
