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
        onComplete={noop}
        onPause={noop}
        onRecordToggle={noop}
        onResume={noop}
        onStart={noop}
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
        onComplete={noop}
        onPause={noop}
        onRecordToggle={noop}
        onResume={noop}
        onStart={noop}
      />
    );

    expect(markup).toContain("Stop recording");
    expect(markup).toContain("Voice input recording");
  });
});
