import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ParticipantInterviewScreen } from "./participant";

const noop = () => undefined;

describe("ParticipantInterviewScreen", () => {
  it("renders only sparse participant interview information", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="What felt uncertain or worth thinking about more?"
        error=""
        isActionPending={false}
        isRecording={false}
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="connected"
        onComplete={noop}
        onPause={noop}
        onRecordToggle={noop}
        onResume={noop}
        onRetry={noop}
        onStart={noop}
        onStopAfterFailure={noop}
        retryCount={0}
      />
    );

    expect(markup).toContain("What felt uncertain or worth thinking about more?");
    expect(markup).toContain("Record");
    expect(markup).toContain("Voice input ready");
    expect(markup).not.toMatch(/participant caption|full transcript|rubric|score|gap map|objective progress/i);
  });

  it("changes the record control to stop recording while active input is captured", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        isActionPending={false}
        isRecording
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="connected"
        onComplete={noop}
        onPause={noop}
        onRecordToggle={noop}
        onResume={noop}
        onRetry={noop}
        onStart={noop}
        onStopAfterFailure={noop}
        retryCount={0}
      />
    );

    expect(markup).toContain("Stop recording");
    expect(markup).toContain("Voice input recording");
  });

  it("shows participant-safe retry and resume options after recoverable technical failures", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error="We had trouble keeping the voice interview connected. Your responses so far are saved."
        isActionPending={false}
        isRecording={false}
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="failed"
        onComplete={noop}
        onPause={noop}
        onRecordToggle={noop}
        onResume={noop}
        onRetry={noop}
        onStart={noop}
        onStopAfterFailure={noop}
        retryCount={1}
      />
    );

    expect(markup).toContain("Retry connection");
    expect(markup).toContain("End session");
    expect(markup).toContain("Your responses so far are saved");
    expect(markup).not.toMatch(/openai|stack|diagnostic|provider/i);
  });
});
