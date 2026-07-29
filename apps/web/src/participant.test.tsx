import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ParticipantConsentScreen,
  ParticipantSurveyScreen,
  ParticipantInterviewScreen,
  createInterviewArtifactBatches,
  createInterviewAudioUploadHeaders,
  createSurveyDraftStorageKey,
  createSurveyDraftSnapshot,
  createRealtimeResponseModeSessionUpdate,
  createRealtimeVoiceSessionRequestBody,
  createRealtimeTypedAnswerEvents,
  getSupportedInterviewAudioMimeType,
  normalizeRealtimeVoiceExperienceForResponseMode,
  normalizeSurveyDraftResponses,
  persistSurveyDraft,
  parseRealtimeAiTranscriptUpdate,
  readStoredSurveyDraft,
  shouldShowInterviewCardBackButton,
  shouldNoticeStudentPause,
  shouldPausePushToTalkForAiSpeech,
  shouldSpeakInterviewQuestionWithBrowserVoice
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

describe("ParticipantConsentScreen", () => {
  it("asks signature participants to sign below and keeps continue disabled before the consent text is fully reviewed", () => {
    const markup = renderToStaticMarkup(
      <ParticipantConsentScreen
        accepted={false}
        consentError=""
        consentMethod="electronic_signature"
        consentText="Consent text"
        hasScrolledConsentText={false}
        isSubmittingConsent={false}
        signatureText=""
        onAcceptedChange={noop}
        onConsentTextScrollStateChange={noop}
        onSignatureTextChange={noop}
        onSubmit={noop}
      />
    );

    expect(markup).toContain("Please sign below");
    expect(markup).not.toContain("Electronic signature");
    expect(markup).toContain("Review the full consent form to continue.");
    expect(markup).toContain("<button class=\"primary-button\" disabled=\"\" type=\"submit\">Continue</button>");
  });

  it("enables consent submission once the consent text has been reviewed", () => {
    const markup = renderToStaticMarkup(
      <ParticipantConsentScreen
        accepted
        consentError=""
        consentMethod="checkmark"
        consentText="Consent text"
        hasScrolledConsentText
        isSubmittingConsent={false}
        signatureText=""
        onAcceptedChange={noop}
        onConsentTextScrollStateChange={noop}
        onSignatureTextChange={noop}
        onSubmit={noop}
      />
    );

    expect(markup).toContain("I have read the consent information and agree to participate.");
    expect(markup).toContain("<button class=\"primary-button\" type=\"submit\">Continue</button>");
    expect(markup).not.toContain("Review the full consent form to continue.");
  });
});

describe("ParticipantSurveyScreen", () => {
  it("asks participants to confirm before locking survey answers and moving to the interview", () => {
    const markup = renderToStaticMarkup(
      <ParticipantSurveyScreen
        isConfirmationOpen
        isSubmittingSurvey={false}
        layoutItems={surveyLayoutItems}
        surveyDraftSaveState={{ status: "idle" }}
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
        surveyDraftSaveState={{ status: "saved", savedAt: "2026-06-11T12:00:00.000Z" }}
        surveyError=""
        surveyResponses={{ survey_question_001: "Working through examples helped." }}
        onCancelSubmit={noop}
        onChangeResponse={noop}
        onConfirmSubmit={noop}
        onSubmit={noop}
      />
    );

    expect(markup).toContain("Submit survey");
    expect(markup).toContain("Draft saved locally");
    expect(markup).not.toContain("can no longer be edited");
    expect(markup).not.toContain("role=\"dialog\"");
  });
});

describe("survey draft persistence", () => {
  it("keys drafts by participant token and immutable survey version", () => {
    expect(createSurveyDraftStorageKey("token/with spaces", "survey_version_001")).toBe(
      "education-researcher:participant-survey-draft:v1:token%2Fwith%20spaces:survey_version_001"
    );
  });

  it("normalizes drafts to known survey questions only", () => {
    expect(
      normalizeSurveyDraftResponses(
        {
          survey_question_001: "A saved answer",
          unknown_question: "Unexpected",
          survey_question_002: 42
        },
        [{ id: "survey_question_001" }, { id: "survey_question_002" }]
      )
    ).toEqual({
      survey_question_001: "A saved answer",
      survey_question_002: ""
    });
  });

  it("persists and restores a partial survey draft", () => {
    const storage = new FakeStorage();
    const result = persistSurveyDraft(
      storage,
      "participant_token_001",
      "survey_version_active",
      [{ id: "survey_question_001" }, { id: "survey_question_002" }],
      {
        survey_question_001: "First answer",
        survey_question_002: ""
      },
      () => new Date("2026-06-11T12:00:00.000Z")
    );

    expect(result).toEqual({ status: "saved", savedAt: "2026-06-11T12:00:00.000Z" });
    expect(
      readStoredSurveyDraft(storage, "participant_token_001", "survey_version_active", [
        { id: "survey_question_001" },
        { id: "survey_question_002" }
      ])
    ).toEqual({
      surveyVersionId: "survey_version_active",
      savedAt: "2026-06-11T12:00:00.000Z",
      responses: {
        survey_question_001: "First answer",
        survey_question_002: ""
      }
    });
  });

  it("ignores drafts from another survey version and clears empty drafts", () => {
    const storage = new FakeStorage();
    const draftKey = createSurveyDraftStorageKey("participant_token_001", "survey_version_active");

    storage.setItem(
      draftKey,
      JSON.stringify({
        surveyVersionId: "survey_version_old",
        savedAt: "2026-06-11T12:00:00.000Z",
        responses: {
          survey_question_001: "Old answer"
        }
      })
    );

    expect(readStoredSurveyDraft(storage, "participant_token_001", "survey_version_active", [{ id: "survey_question_001" }])).toBeUndefined();
    expect(
      persistSurveyDraft(storage, "participant_token_001", "survey_version_active", [{ id: "survey_question_001" }], {
        survey_question_001: "   "
      })
    ).toEqual({ status: "cleared" });
    expect(storage.getItem(draftKey)).toBeNull();
  });

  it("creates stable draft snapshots in survey question order", () => {
    expect(
      createSurveyDraftSnapshot(
        {
          survey_question_002: "Second",
          survey_question_001: "First"
        },
        [{ id: "survey_question_001" }, { id: "survey_question_002" }]
      )
    ).toBe('{"survey_question_001":"First","survey_question_002":"Second"}');
  });
});

class FakeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

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

  it("starts push-to-talk active interviews on the participant turn", () => {
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
    expect(markup).toContain("Your turn");
    expect(markup).toContain("Press record when you are ready");
    expect(markup).not.toContain("AI speaking");
    expect(markup).not.toContain("Repeat question");
    expect(markup).not.toContain("Say that another way");
    expect(markup).not.toMatch(/participant caption|full transcript|rubric|score|objective progress/i);
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

  it("shows remaining interview time in the active voice UI", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="What part of your survey answer would you like to explain more?"
        error=""
        isActionPending={false}
        isRecording
        maxInterviewMinutes={2}
        mode="active"
        realtimeConnectionState="connected"
        remainingInterviewSeconds={83}
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

    expect(markup).toContain("Time remaining");
    expect(markup).toContain("01:23");
    expect(markup).toContain("2 min max");
    expect(markup).toContain("role=\"timer\"");
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

  it("selects Talk naturally by default in the response mode step", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialUiState="mode_selection"
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

    expect(markup).toMatch(/checked="" value="natural"/);
    expect(markup).not.toMatch(/checked="" value="push_to_talk"/);
    expect(markup).not.toMatch(/checked="" value="typing"/);
  });

  it("offers the gated Voxaria Live voice experience without changing the safe default", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialUiState="mode_selection"
        isActionPending={false}
        isRecording={false}
        maxInterviewMinutes={45}
        mode="ready"
        newVoiceModelEnabled
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

    expect(markup).toContain("Voxaria Live");
    expect(markup).toContain("NEW");
    expect(markup).toContain("pauses, background noise, and interruptions");
    expect(markup).toContain("interview-mode-option-new-voice");
    expect(markup).toMatch(/value="new_voice"/);
    expect(markup).toMatch(/checked="" value="natural"/);
    expect(markup).not.toMatch(/checked="" value="new_voice"/);
  });

  it("keeps the new voice choice hidden when its server capability is off", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        error=""
        initialVoiceExperience="new_voice"
        initialUiState="mode_selection"
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

    expect(markup).not.toContain("Voxaria Live");
    expect(markup).not.toMatch(/value="new_voice"/);
    expect(markup).toMatch(/checked="" value="natural"/);
  });

  it("keeps written response options enabled for runs with the legacy disabled setting", () => {
    const markup = renderToStaticMarkup(
      <ParticipantInterviewScreen
        aiQuestion="Could you share a concrete example?"
        allowWrittenResponses={false}
        error=""
        initialResponseMode="typing"
        initialUiState="mode_selection"
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

    expect(markup).toContain("Talk naturally");
    expect(markup).toContain("Press to record each answer");
    expect(markup).toContain("Type my answers");
    expect(markup).toMatch(/checked="" value="typing"/);
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

  it("shows card back controls whenever interview history can return to the previous card", () => {
    expect(
      shouldShowInterviewCardBackButton({
        canReturnToPreviousCard: true
      })
    ).toBe(true);
    expect(
      shouldShowInterviewCardBackButton({
        canReturnToPreviousCard: false
      })
    ).toBe(false);
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

  it("hides the current question section through voice capture setup and response mode setup", () => {
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

    expect(micCheckMarkup).toContain("Voice capture");
    expect(micCheckMarkup).toContain("interview-layout-centered");
    expect(micCheckMarkup).not.toContain("Current question");
    expect(modeSelectionMarkup).toContain("Response mode");
    expect(modeSelectionMarkup).toContain("interview-layout-centered");
    expect(modeSelectionMarkup).not.toContain("Current question");
  });

  it("requires voice capture before continuing and does not offer retry copy", () => {
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

    expect(markup).toContain("Start voice capture");
    expect(markup).toContain("Continue");
    expect(markup).toContain("disabled");
    expect(markup).toContain("mic-check-transcript");
    expect(markup).not.toContain("Start mic check");
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
    expect(markup).toContain("<button class=\"secondary-button\" type=\"button\">End interview</button>");
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
            transcription: {
              model: "gpt-4o-transcribe"
            },
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
            transcription: {
              model: "gpt-4o-transcribe"
            },
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

  it("sends only the allowlisted voice experience instead of a client model ID", () => {
    expect(
      createRealtimeVoiceSessionRequestBody("new_voice", [
        {
          speaker: "participant",
          text: "I would like to add one more example.",
          audioStartMs: 120,
          audioEndMs: 850
        }
      ])
    ).toEqual({
      voiceExperience: "new_voice",
      currentTurns: [
        {
          speaker: "participant",
          text: "I would like to add one more example."
        }
      ]
    });
    expect(JSON.stringify(createRealtimeVoiceSessionRequestBody("new_voice"))).not.toContain("gpt-realtime");
  });

  it("uses the standard model whenever typing is the selected response mode", () => {
    expect(normalizeRealtimeVoiceExperienceForResponseMode("new_voice", "typing", true)).toBe("standard");
    expect(normalizeRealtimeVoiceExperienceForResponseMode("new_voice", "natural", true)).toBe("new_voice");
    expect(normalizeRealtimeVoiceExperienceForResponseMode("new_voice", "natural", false)).toBe("standard");
  });

  it("adds typed answers to realtime voice context before requesting a follow-up", () => {
    expect(createRealtimeTypedAnswerEvents("  I would explain this with a classroom example.  ")).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "I would explain this with a classroom example."
            }
          ]
        }
      },
      {
        type: "response.create"
      }
    ]);
    expect(createRealtimeTypedAnswerEvents("   ")).toEqual([]);
  });

  it("batches transcript artifacts within the service route limit", () => {
    const turns = Array.from({ length: 51 }, (_, index) => ({
      speaker: index % 2 === 0 ? ("ai" as const) : ("participant" as const),
      text: `Transcript turn ${index + 1}`
    }));

    expect(createInterviewArtifactBatches(turns)).toEqual([
      expect.objectContaining({
        turns: turns.slice(0, 50),
        transcriptTokenCount: expect.any(Number)
      }),
      expect.objectContaining({
        turns: turns.slice(50),
        transcriptTokenCount: expect.any(Number)
      })
    ]);
  });

  it("prepares browser audio uploads with recorder MIME type and duration metadata", () => {
    const audioBlob = new Blob(["audio-bytes"], { type: "audio/webm;codecs=opus" });

    expect(getSupportedInterviewAudioMimeType((mimeType) => mimeType === "audio/webm")).toBe("audio/webm");
    expect(createInterviewAudioUploadHeaders({ blob: audioBlob, durationSeconds: 7.42 })).toEqual({
      "content-type": "audio/webm;codecs=opus",
      "x-audio-duration-seconds": "7.42"
    });
  });

  it("does not use browser narration for push-to-talk questions", () => {
    expect(
      shouldSpeakInterviewQuestionWithBrowserVoice({
        isActive: true,
        responseMode: "push_to_talk",
        uiState: "ai_speaking"
      })
    ).toBe(false);

    expect(
      shouldSpeakInterviewQuestionWithBrowserVoice({
        isActive: true,
        responseMode: "typing",
        uiState: "ai_speaking"
      })
    ).toBe(true);
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
        initialVoiceExperience="new_voice"
        isActionPending={false}
        isRecording={false}
        maxInterviewMinutes={45}
        mode="active"
        newVoiceModelEnabled
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
    expect(markup).toContain("Try standard voice");
    expect(markup).toContain("End session");
    expect(markup).toContain("Your responses so far are saved");
    expect(markup).not.toMatch(/openai|stack|diagnostic|provider/i);
  });
});
