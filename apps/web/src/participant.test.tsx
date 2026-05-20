import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ParticipantInterviewScreen } from "./participant";

const noop = () => undefined;

describe("ParticipantInterviewScreen", () => {
  it("starts with a low-friction onboarding flow before the interview begins", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Earlier, you said science feels useful when it connects to real problems. Can you tell me about a time when science felt useful to you?"
        error=""
        isActionPending={false}
        isRecording={false}
        maxInterviewMinutes={45}
        mode="ready"
        realtimeConnectionState="idle"
        onComplete={noop}
        onConfirmAnswer={noop}
        onPause={noop}
        onRecordingChange={noop}
        onResume={noop}
        onRetry={noop}
        onStart={noop}
        onStopAfterFailure={noop}
        retryCount={0}
      />
    );

    expect(markup).toContain("A few follow-up questions");
    expect(markup).toContain("no right or wrong answers");
    expect(markup).toContain("pause, skip, redo, or type");
    expect(markup).toContain("This is not graded");
    expect(markup).toContain("interview-layout-centered");
    expect(markup).not.toContain("Current question");
    expect(markup).not.toContain("Microphone off");
    expect(markup).not.toContain("Connected");
    expect(markup).not.toContain("Quiet mode");
  });

  it("clearly distinguishes AI speaking from microphone listening state", () => {
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
        onConfirmAnswer={noop}
        onPause={noop}
        onRecordingChange={noop}
        onResume={noop}
        onRetry={noop}
        onStart={noop}
        onStopAfterFailure={noop}
        retryCount={0}
      />
    );

    expect(markup).toContain("What felt uncertain or worth thinking about more?");
    expect(markup).toContain("Current question");
    expect(markup).toContain("interview-layout-with-question");
    expect(markup).toContain("AI speaking");
    expect(markup).toContain("Repeat question");
    expect(markup).toContain("Say that another way");
    expect(markup).not.toMatch(/participant caption|full transcript|rubric|score|gap map|objective progress/i);
  });

  it("hides the current question section through microphone check and response mode setup", () => {
    const baseProps = {
      aiQuestion: "Could you share a concrete example?",
      error: "",
      isActionPending: false,
      isRecording: false,
      maxInterviewMinutes: 45,
      mode: "ready" as const,
      realtimeConnectionState: "idle" as const,
      onComplete: noop,
      onConfirmAnswer: noop,
      onPause: noop,
      onRecordingChange: noop,
      onResume: noop,
      onRetry: noop,
      onStart: noop,
      onStopAfterFailure: noop,
      retryCount: 0
    };

    const micCheckMarkup = renderToStaticMarkup(<ParticipantInterviewScreen {...baseProps} initialUiState="mic_check" />);
    const modeSelectionMarkup = renderToStaticMarkup(<ParticipantInterviewScreen {...baseProps} initialUiState="mode_selection" />);

    expect(micCheckMarkup).toContain("Microphone check");
    expect(micCheckMarkup).toContain("interview-layout-centered");
    expect(micCheckMarkup).not.toContain("Current question");
    expect(modeSelectionMarkup).toContain("Response mode");
    expect(modeSelectionMarkup).toContain("interview-layout-centered");
    expect(modeSelectionMarkup).not.toContain("Current question");
  });

  it("supports a push-to-talk student turn with manual completion controls", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialResponseMode="push_to_talk"
        initialUiState="student_turn"
        isActionPending={false}
        isRecording={false}
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="connected"
        onComplete={noop}
        onConfirmAnswer={noop}
        onPause={noop}
        onRecordingChange={noop}
        onResume={noop}
        onRetry={noop}
        onStart={noop}
        onStopAfterFailure={noop}
        retryCount={0}
      />
    );

    expect(markup).toContain("Your turn");
    expect(markup).toContain("Press record when you are ready");
    expect(markup).toContain("Start talking");
    expect(markup).not.toMatch(/I(&#x27;|')m done/);
    expect(markup).not.toContain("Skip");
    expect(markup).toContain("End interview");
    expect(markup).not.toContain("Pause interview");
    expect(markup).not.toContain("Skip question");
  });

  it("supports typing-only quiet mode", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialQuietMode
        initialResponseMode="typing"
        initialUiState="student_turn"
        isActionPending={false}
        isRecording={false}
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="connected"
        onComplete={noop}
        onConfirmAnswer={noop}
        onPause={noop}
        onRecordingChange={noop}
        onResume={noop}
        onRetry={noop}
        onStart={noop}
        onStopAfterFailure={noop}
        retryCount={0}
      />
    );

    expect(markup).toContain("Quiet mode");
    expect(markup).toContain("Type your answer");
    expect(markup).toContain("Your microphone is off");
  });

  it("lets push-to-talk participants return to recording after choosing typing", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialResponseMode="typing"
        initialUiState="student_turn"
        isActionPending={false}
        isRecording={false}
        latestSpokenTranscript=""
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="connected"
        onComplete={noop}
        onConfirmAnswer={noop}
        onPause={noop}
        onRecordingChange={noop}
        onResume={noop}
        onRetry={noop}
        onStart={noop}
        onStopAfterFailure={noop}
        retryCount={0}
      />
    );

    expect(markup).toContain("Record instead");
  });

  it("shows transcript confirmation before continuing after spoken answers", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialUiState="transcript_review"
        isActionPending={false}
        isRecording={false}
        latestSpokenTranscript="Hello, how are you doing today?"
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="connected"
        onComplete={noop}
        onConfirmAnswer={noop}
        onPause={noop}
        onRecordingChange={noop}
        onResume={noop}
        onRetry={noop}
        onStart={noop}
        onStopAfterFailure={noop}
        retryCount={0}
      />
    );

    expect(markup).toMatch(/Here(&#x27;|')s what we heard/);
    expect(markup).toContain("Hello, how are you doing today?");
    expect(markup).toContain("Transcript preview");
    expect(markup).toContain("Edit by typing");
    expect(markup).toContain("Redo");
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
        onConfirmAnswer={noop}
        onPause={noop}
        onRecordingChange={noop}
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
