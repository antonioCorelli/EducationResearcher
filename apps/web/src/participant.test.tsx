import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ParticipantSurveyScreen,
  ParticipantInterviewScreen,
  createRealtimeResponseModeSessionUpdate,
  getRepeatQuestionUiState,
  parseRealtimeAiTranscriptUpdate,
  shouldNoticeStudentPause,
  shouldPausePushToTalkForAiSpeech,
  shouldShowRepeatQuestionControl
} from "./participant";

const noop = () => undefined;

const surveyLayoutItems = [
  {
    type: "question",
    sortOrder: 1,
    question: {
      id: "survey_question_001",
      prompt: "What helped you learn this topic?",
      required: true,
      questionType: "long_text",
      sortOrder: 1
    }
  }
] as const;

describe("ParticipantSurveyScreen", () => {
  it("asks participants to confirm before locking survey answers and moving to the interview", () => {
    const markup = renderToStaticMarkup(
      <ParticipantSurveyScreen
        isConfirmationOpen
        isSubmittingSurvey={false}
        layoutItems={surveyLayoutItems}
        surveyError=""
        surveyResponses={{ survey_question_001: "Working through examples helped." }}
        onCancelSubmit={noop}
        onChangeResponse={noop}
        onConfirmSubmit={noop}
        onSubmit={noop}
      />
    );

    expect(markup).toContain("Continue to the interview?");
    expect(markup).toContain("can no longer be edited");
    expect(markup).toContain("Continue to interview");
    expect(markup).toContain("Keep editing");
    expect(markup).toContain("role=\"dialog\"");
  });

  it("keeps the confirmation dialog hidden while participants are still editing", () => {
    const markup = renderToStaticMarkup(
      <ParticipantSurveyScreen
        isConfirmationOpen={false}
        isSubmittingSurvey={false}
        layoutItems={surveyLayoutItems}
        surveyError=""
        surveyResponses={{ survey_question_001: "Working through examples helped." }}
        onCancelSubmit={noop}
        onChangeResponse={noop}
        onConfirmSubmit={noop}
        onSubmit={noop}
      />
    );

    expect(markup).toContain("Submit survey");
    expect(markup).not.toContain("can no longer be edited");
    expect(markup).not.toContain("role=\"dialog\"");
  });
});

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
    expect(markup).toContain("not graded");
    expect(markup).toContain("interview-layout-centered");
    expect(markup).not.toContain("Current question");
    expect(markup).not.toContain("Microphone off");
    expect(markup).not.toContain("Connected");
  });

  it("clearly distinguishes AI speaking from microphone listening state", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="What felt uncertain or worth thinking about more?"
        error=""
        initialResponseMode="push_to_talk"
        initialUiState="ai_speaking"
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

  it("uses a buttonless realtime voice surface for natural conversation", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="What part of your survey answer would you like to explain more?"
        error=""
        isActionPending={false}
        isRecording
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="connected"
        realtimeVoiceActivity="ai_speaking"
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

    expect(markup).toContain("Voice conversation");
    expect(markup).toContain("OpenAI is speaking");
    expect(markup).toContain("Current question");
    expect(markup).toContain("What part of your survey answer would you like to explain more?");
    expect(markup).toContain("OpenAI");
    expect(markup).toContain("You");
    expect(markup).not.toContain("Repeat question");
    expect(markup).not.toContain("Repeat</button>");
    expect(markup).not.toContain("Start talking");
    expect(markup).not.toContain("Done");
    expect(markup).not.toContain("End interview");
  });

  it("keeps paused natural conversations out of the manual AI-speaking repeat flow", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="What part of your survey answer would you like to explain more?"
        error=""
        initialResponseMode="natural"
        initialUiState="paused"
        isActionPending={false}
        isRecording={false}
        maxInterviewMinutes={45}
        mode="paused"
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

    expect(markup).toContain("Interview paused");
    expect(markup).toContain("Resume interview");
    expect(markup).not.toContain("Current question");
    expect(markup).not.toContain("What part of your survey answer would you like to explain more?");
    expect(markup).not.toContain("Repeat question");
    expect(markup).not.toContain("Repeat</button>");
    expect(markup).not.toContain("I stopped - go ahead");
  });

  it("lets paused participants choose a different response mode before resuming", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="What part of your survey answer would you like to explain more?"
        error=""
        initialResponseMode="push_to_talk"
        initialUiState="paused"
        isActionPending={false}
        isRecording={false}
        maxInterviewMinutes={45}
        mode="paused"
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

    expect(markup).toContain("Interview paused");
    expect(markup).toContain("Talk naturally");
    expect(markup).toContain("Press to record each answer");
    expect(markup).toContain("Type my answers");
    expect(markup).toContain("Resume interview");
  });

  it("shows the paused screen immediately while a natural pause action is pending", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="What part of your survey answer would you like to explain more?"
        error=""
        initialResponseMode="natural"
        initialUiState="paused"
        isActionPending
        isRecording={false}
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="connected"
        realtimeVoiceActivity="participant_speaking"
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

    expect(markup).toContain("Interview paused");
    expect(markup).toContain("Resuming");
    expect(markup).not.toContain("Voice conversation");
    expect(markup).not.toContain("Current question");
    expect(markup).not.toContain("What part of your survey answer would you like to explain more?");
  });

  it("does not let repeat move a paused interview into AI speaking state", () => {
    expect(getRepeatQuestionUiState("paused")).toBe("paused");
    expect(getRepeatQuestionUiState("student_turn")).toBe("ai_speaking");
    expect(
      shouldShowRepeatQuestionControl({
        isNaturalRealtimeConversation: false,
        uiState: "paused"
      })
    ).toBe(false);
    expect(
      shouldShowRepeatQuestionControl({
        isNaturalRealtimeConversation: false,
        uiState: "ai_speaking"
      })
    ).toBe(true);
  });

  it("parses realtime AI audio transcript deltas without exposing participant transcripts", () => {
    expect(
      parseRealtimeAiTranscriptUpdate({
        type: "response.output_audio_transcript.delta",
        item_id: "item_ai_001",
        delta: "Can you"
      })
    ).toEqual({ type: "delta", itemId: "item_ai_001", text: "Can you" });

    expect(
      parseRealtimeAiTranscriptUpdate({
        type: "response.output_audio_transcript.done",
        item_id: "item_ai_001",
        transcript: "Can you say more about that?"
      })
    ).toEqual({ type: "done", itemId: "item_ai_001", text: "Can you say more about that?" });

    expect(
      parseRealtimeAiTranscriptUpdate({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "This is the participant answer."
      })
    ).toBeUndefined();
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

  it("requires the microphone check before continuing and does not offer retry copy", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialUiState="mic_check"
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

    expect(markup).toContain("Start mic check");
    expect(markup).toContain("Continue");
    expect(markup).toContain("disabled");
    expect(markup).toContain("mic-check-transcript");
    expect(markup).not.toContain("Try again");
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
    expect(markup).toContain("Start Talking");
    expect(markup).not.toMatch(/I(&#x27;|')m done/);
    expect(markup).not.toContain("Skip");
    expect(markup).toContain("End interview");
    expect(markup).not.toContain("Pause interview");
    expect(markup).not.toContain("Skip question");
  });

  it("labels the push-to-talk recording stop control explicitly", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialResponseMode="push_to_talk"
        initialUiState="student_speaking"
        isActionPending={false}
        isRecording
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

    expect(markup).toContain("Listening");
    expect(markup).toContain("Stop Talking");
    expect(markup).not.toContain("Done");
  });

  it("does not notice a pause while natural speech is still active", () => {
    expect(
      shouldNoticeStudentPause({
        isActive: true,
        microphoneLevel: 0.08,
        responseMode: "natural",
        uiState: "student_speaking"
      })
    ).toBe(false);

    expect(
      shouldNoticeStudentPause({
        isActive: true,
        microphoneLevel: 0,
        responseMode: "natural",
        uiState: "student_speaking"
      })
    ).toBe(true);

    expect(
      shouldNoticeStudentPause({
        isActive: true,
        microphoneLevel: 0,
        responseMode: "push_to_talk",
        uiState: "student_speaking"
      })
    ).toBe(false);
  });

  it("uses manual realtime turn control for push-to-talk mode", () => {
    expect(createRealtimeResponseModeSessionUpdate("push_to_talk")).toEqual({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: null
          }
        }
      }
    });

    expect(createRealtimeResponseModeSessionUpdate("natural")).toEqual({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: "low",
              create_response: true,
              interrupt_response: true
            }
          }
        }
      }
    });
  });

  it("pauses push-to-talk voice input when the AI starts speaking", () => {
    expect(
      shouldPausePushToTalkForAiSpeech({
        isActive: true,
        realtimeVoiceActivity: "ai_speaking",
        responseMode: "push_to_talk",
        uiState: "student_speaking"
      })
    ).toBe(true);

    expect(
      shouldPausePushToTalkForAiSpeech({
        isActive: true,
        realtimeVoiceActivity: "ai_speaking",
        responseMode: "natural",
        uiState: "student_speaking"
      })
    ).toBe(false);

    expect(
      shouldPausePushToTalkForAiSpeech({
        isActive: true,
        realtimeVoiceActivity: "participant_speaking",
        responseMode: "push_to_talk",
        uiState: "student_speaking"
      })
    ).toBe(false);
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

  it("shows transcript confirmation before continuing after natural spoken answers", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialResponseMode="natural"
        initialUiState="transcript_review"
        isActionPending={false}
        isRecording={false}
        latestSpokenTranscript="Hello, how are you doing today?"
        maxInterviewMinutes={45}
        mode="active"
        realtimeConnectionState="disconnected"
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
