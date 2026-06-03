import type { RawEvidence, RawEvidenceState } from "../App";
import { formatDateTime, formatOptionalAudioSpan, formatSpeaker } from "./runFormat";

const serviceBaseUrl = import.meta.env.VITE_SERVICE_BASE_URL ?? "http://127.0.0.1:4000";

interface RawEvidencePanelProps {
  readonly rawEvidenceState: RawEvidenceState;
  readonly mode?: "all" | "transcript";
  readonly onDismiss: () => void;
  readonly showDismissButton?: boolean;
}

export function RawEvidencePanel({ mode = "all", rawEvidenceState, onDismiss, showDismissButton = true }: RawEvidencePanelProps) {
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
  const participantTurnAudioAssets = getParticipantTurnAudioAssets(evidence);
  const showSurveyResponses = mode === "all";

  return (
    <section className="evidence-panel raw-evidence-panel" id="raw-evidence-panel" aria-labelledby="raw-evidence-title">
      <div className="section-heading">
        <div>
          <h3 id="raw-evidence-title">{mode === "transcript" ? "Interview transcript" : "Raw evidence"}</h3>
          <p>Run {evidence.run.id}</p>
        </div>
        {showDismissButton ? (
          <button className="secondary-button compact-button" onClick={onDismiss} type="button">
            Close
          </button>
        ) : null}
      </div>
      <div className={showSurveyResponses ? "raw-evidence-grid" : "raw-evidence-grid transcript-only-evidence-grid"}>
        {showSurveyResponses ? (
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
        ) : null}
        <section aria-labelledby="transcript-evidence-title">
          <h4 id="transcript-evidence-title">Transcript turns</h4>
          {evidence.interviewTurns.length === 0 ? <p className="muted-copy">No transcript turns captured</p> : null}
          {evidence.interviewTurns.map((turn) => (
            <TranscriptEvidenceItem
              audioAsset={participantTurnAudioAssets.get(turn.id)}
              focusSourceId={focusSourceId}
              key={turn.id}
              turn={turn}
            />
          ))}
        </section>
      </div>
    </section>
  );
}

function TranscriptEvidenceItem({
  audioAsset,
  focusSourceId,
  turn
}: {
  readonly audioAsset?: RawEvidence["audioAssets"][number];
  readonly focusSourceId?: string;
  readonly turn: RawEvidence["interviewTurns"][number];
}) {
  return (
    <article
      className={focusSourceId === turn.id ? "raw-evidence-item focused-raw-evidence" : "raw-evidence-item"}
      id={`raw-evidence-${turn.id}`}
    >
      <span>{formatSpeaker(turn.speaker)}</span>
      <p>{turn.text}</p>
      <small>{formatOptionalAudioSpan(turn.audioStartMs, turn.audioEndMs)}</small>
      {audioAsset?.signedUrl ? <audio controls preload="none" src={normalizeAudioPlaybackUrl(audioAsset.signedUrl)} /> : null}
    </article>
  );
}

export function getParticipantTurnAudioAssets(evidence: Pick<RawEvidence, "audioAssets" | "interviewTurns">) {
  const assetsByTurnId = new Map<string, RawEvidence["audioAssets"][number]>();
  const participantTurnsWithAudio = evidence.interviewTurns
    .filter((turn) => turn.speaker === "participant" && turn.audioStartMs !== undefined && turn.audioEndMs !== undefined)
    .sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0));
  const audioAssets = [...evidence.audioAssets].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  participantTurnsWithAudio.forEach((turn, index) => {
    const audioAsset = audioAssets[index];

    if (audioAsset) {
      assetsByTurnId.set(turn.id, audioAsset);
    }
  });

  return assetsByTurnId;
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
