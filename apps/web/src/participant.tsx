import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";

const serviceBaseUrl = import.meta.env.VITE_SERVICE_BASE_URL ?? "http://localhost:4000";

type ConsentMethod = "checkmark" | "electronic_signature";

interface ConsentVersion {
  readonly id: string;
  readonly consentText: string;
  readonly consentMethod: ConsentMethod;
  readonly versionNumber: number;
}

interface SurveyQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly required: true;
  readonly questionType: "long_text";
  readonly sortOrder: number;
}

interface SurveyGroup {
  readonly id: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly questions: readonly SurveyQuestion[];
}

type SurveyLayoutItem =
  | {
      readonly type: "question";
      readonly sortOrder: number;
      readonly question: SurveyQuestion;
    }
  | {
      readonly type: "group";
      readonly sortOrder: number;
      readonly group: SurveyGroup;
    };

interface SurveyVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly layoutItems?: readonly SurveyLayoutItem[];
  readonly groups: readonly SurveyGroup[];
  readonly ungroupedQuestions: readonly SurveyQuestion[];
}

type RunStatus =
  | "created"
  | "consented"
  | "survey_in_progress"
  | "survey_completed"
  | "interview_in_progress"
  | "interview_paused"
  | "interview_completed"
  | "stale"
  | "partial"
  | "technical_interruption"
  | "scored";

type ParticipantAccessState =
  | { readonly status: "checking" }
  | {
      readonly status: "ready";
      readonly run: {
        readonly id: string;
        readonly status: RunStatus;
        readonly freshnessDeadlineAt: string;
        readonly maxInterviewMinutes: number;
      };
      readonly consentVersion?: ConsentVersion;
      readonly surveyVersion?: SurveyVersion;
    }
  | { readonly status: "blocked"; readonly message: string };

type InterviewMode = "ready" | "active" | "paused";
type InterviewResponseMode = "natural" | "push_to_talk" | "typing";
type InterviewUiState =
  | "onboarding"
  | "mic_check"
  | "mode_selection"
  | "ai_speaking"
  | "ai_thinking"
  | "student_turn"
  | "student_speaking"
  | "student_paused"
  | "transcript_review"
  | "paused"
  | "break_prompt"
  | "completed";
type RealtimeConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "failed" | "closed";
type RealtimeVoiceActivity = "idle" | "ai_speaking" | "participant_speaking";
type TechnicalFailureCategory =
  | "microphone_unavailable"
  | "voice_provider_unavailable"
  | "disconnect"
  | "transcription_unavailable"
  | "model_api_unavailable"
  | "unknown";

const speechPauseVoiceLevelThreshold = 0.025;
const speechPauseSilenceMs = 6500;

interface RealtimeVoiceSession {
  readonly provider: "fake" | "openai";
  readonly model: string;
  readonly voice: string;
  readonly clientSecret: string;
  readonly expiresAt?: number;
  readonly realtimeUrl: string;
  readonly serviceRequestId: string;
  readonly promptVersion: string;
}

export function Participant() {
  const [accepted, setAccepted] = useState(false);
  const [signatureText, setSignatureText] = useState("");
  const [consentError, setConsentError] = useState("");
  const [isSubmittingConsent, setIsSubmittingConsent] = useState(false);
  const [surveyResponses, setSurveyResponses] = useState<Record<string, string>>({});
  const [surveyError, setSurveyError] = useState("");
  const [isSubmittingSurvey, setIsSubmittingSurvey] = useState(false);
  const [isSurveyConfirmationOpen, setIsSurveyConfirmationOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [interviewError, setInterviewError] = useState("");
  const [isSubmittingInterviewAction, setIsSubmittingInterviewAction] = useState(false);
  const [latestAiQuestionTranscript, setLatestAiQuestionTranscript] = useState("");
  const [realtimeConnectionState, setRealtimeConnectionState] = useState<RealtimeConnectionState>("idle");
  const [realtimeServiceRequestId, setRealtimeServiceRequestId] = useState<string>();
  const [realtimeRetryCount, setRealtimeRetryCount] = useState(0);
  const [realtimeVoiceActivity, setRealtimeVoiceActivity] = useState<RealtimeVoiceActivity>("idle");
  const [latestParticipantTranscript, setLatestParticipantTranscript] = useState("");
  const peerConnectionRef = useRef<RTCPeerConnection | undefined>(undefined);
  const dataChannelRef = useRef<RTCDataChannel | undefined>(undefined);
  const mediaStreamRef = useRef<MediaStream | undefined>(undefined);
  const remoteAudioRef = useRef<HTMLAudioElement | undefined>(undefined);
  const pendingInterviewTurnsRef = useRef<PendingInterviewTurn[]>([]);
  const [accessState, setAccessState] = useState<ParticipantAccessState>(() => {
    const accessToken = getParticipantAccessTokenFromPath();

    return accessToken
      ? { status: "checking" }
      : { status: "blocked", message: "This participant link is not available." };
  });

  useEffect(() => {
    const accessToken = getParticipantAccessTokenFromPath();

    if (!accessToken) {
      return;
    }

    const confirmedAccessToken = accessToken;
    let cancelled = false;

    async function validateAccess() {
      try {
        const payload = await fetchParticipantAccess(confirmedAccessToken);

        if (!cancelled) {
          setAccessState({ status: "ready", ...payload });
        }
      } catch (error) {
        if (!cancelled) {
          setAccessState({
            status: "blocked",
            message: error instanceof Error ? error.message : "This participant link is not available."
          });
        }
      }
    }

    void validateAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (accessState.status !== "ready" || !accessState.surveyVersion) {
      return;
    }

    const surveyVersion = accessState.surveyVersion;

    setSurveyResponses((currentResponses) => {
      const nextResponses = { ...currentResponses };

      for (const question of getSurveyQuestions(surveyVersion)) {
        nextResponses[question.id] ??= "";
      }

      return nextResponses;
    });
  }, [accessState]);

  useEffect(() => {
    if (accessState.status !== "ready" || accessState.run.status !== "interview_in_progress") {
      setIsRecording(false);
      disconnectRealtimeVoice("closed");
    }
  }, [accessState]);

  useEffect(() => () => disconnectRealtimeVoice("closed"), []);

  async function submitInterviewAction(action: "start" | "pause" | "resume" | "complete") {
    setInterviewError("");

    const accessToken = getParticipantAccessTokenFromPath();

    if (!accessToken || accessState.status !== "ready") {
      setInterviewError("This participant link is not available.");
      return;
    }

    setIsSubmittingInterviewAction(true);

    try {
      if (action === "pause" || action === "complete") {
        await flushPendingInterviewArtifacts(accessToken);
      }

      const response = await fetch(`${serviceBaseUrl}/participant/runs/${accessToken}/interview/${action}`, {
        method: "POST"
      });
      const payload = (await response.json()) as {
        run?: { id: string; status: RunStatus; freshnessDeadlineAt: string; maxInterviewMinutes: number };
        message?: string;
      };

      if (!response.ok || !payload.run) {
        throw new Error(payload.message ?? "Unable to update the interview.");
      }

      setAccessState({ status: "ready", run: payload.run });
      setIsRecording(false);

      if (action === "start" || action === "resume") {
        setLatestAiQuestionTranscript("");
        setRealtimeRetryCount(0);
        setLatestParticipantTranscript("");
        await connectRealtimeVoice(accessToken, 0);
      } else {
        disconnectRealtimeVoice("closed");
      }
    } catch (error) {
      setInterviewError(error instanceof Error ? error.message : "Unable to update the interview.");
    } finally {
      setIsSubmittingInterviewAction(false);
    }
  }

  function setInterviewRecording(recording: boolean) {
    setInterviewError("");
    setIsRecording((currentValue) => {
      if (currentValue === recording) {
        return currentValue;
      }

      setMicrophoneEnabled(recording);

      return recording;
    });
  }

  function confirmInterviewAnswer(answer: { readonly aiQuestion: string; readonly responseText: string }) {
    pendingInterviewTurnsRef.current.push(
      {
        speaker: "ai",
        text: answer.aiQuestion
      },
      {
        speaker: "participant",
        text: answer.responseText
      }
    );
  }

  async function connectRealtimeVoice(accessToken: string, retryCount = realtimeRetryCount) {
    disconnectRealtimeVoice("closed");
    setRealtimeConnectionState("connecting");
    let activeServiceRequestId = realtimeServiceRequestId;
    const startedAt = performance.now();

    try {
      const realtimeSession = await fetchRealtimeVoiceSession(accessToken);
      activeServiceRequestId = realtimeSession.serviceRequestId;
      setRealtimeServiceRequestId(realtimeSession.serviceRequestId);
      await reportAudioConnectionState(accessToken, realtimeSession.serviceRequestId, "connecting", {
        retryCount,
        latencyMs: Math.round(performance.now() - startedAt)
      });

      if (realtimeSession.provider === "fake") {
        setRealtimeConnectionState("connected");
        await reportAudioConnectionState(accessToken, realtimeSession.serviceRequestId, "connected", {
          retryCount,
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return;
      }

      const connection = await connectOpenAiRealtimeVoice(
        realtimeSession,
        (turn) => {
          pendingInterviewTurnsRef.current.push(turn);

          if (turn.speaker === "participant") {
            setLatestParticipantTranscript(turn.text);
          }
        },
        setRealtimeVoiceActivity,
        setLatestAiQuestionTranscript
      );
      peerConnectionRef.current = connection.peerConnection;
      dataChannelRef.current = connection.dataChannel;
      mediaStreamRef.current = connection.mediaStream;
      remoteAudioRef.current = connection.remoteAudio;
      setMicrophoneEnabled(false);
      setRealtimeConnectionState("connected");
      await reportAudioConnectionState(accessToken, realtimeSession.serviceRequestId, "connected", {
        retryCount,
        latencyMs: Math.round(performance.now() - startedAt)
      });
    } catch (error) {
      setRealtimeConnectionState("failed");
      const technicalFailureCategory = categorizeTechnicalFailure(error);
      const latencyMs = Math.round(performance.now() - startedAt);

      if (activeServiceRequestId) {
        await reportAudioConnectionState(accessToken, activeServiceRequestId, "failed", {
          retryCount,
          latencyMs,
          technicalFailureCategory
        });
      }

      setInterviewError("We had trouble keeping the voice interview connected. Your responses so far are saved.");

      if (retryCount >= maximumRecoverableRetryCount) {
        await markTechnicalInterruption(accessToken, technicalFailureCategory, latencyMs, retryCount);
      }
    }
  }

  async function retryRealtimeVoice() {
    const accessToken = getParticipantAccessTokenFromPath();

    if (!accessToken) {
      setInterviewError("This participant link is not available.");
      return;
    }

    const nextRetryCount = realtimeRetryCount + 1;

    setRealtimeRetryCount(nextRetryCount);
    setInterviewError("");

    try {
      await connectRealtimeVoice(accessToken, nextRetryCount);
    } catch (error) {
      setInterviewError(error instanceof Error ? error.message : "Unable to reconnect the voice interview.");
    }
  }

  async function markTechnicalInterruption(
    accessToken: string,
    technicalFailureCategory: TechnicalFailureCategory,
    latencyMs?: number,
    retryCount = realtimeRetryCount
  ) {
    await flushPendingInterviewArtifacts(accessToken);

    const response = await fetch(`${serviceBaseUrl}/participant/runs/${accessToken}/interview/interrupt`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        safeStatus: "unable_to_complete_interview",
        serviceRequestId: realtimeServiceRequestId ?? "participant_recovery_unknown",
        technicalFailureCategory,
        audioConnectionState: "failed",
        retryCount,
        ...(latencyMs !== undefined ? { latencyMs } : {})
      })
    });
    const payload = (await response.json()) as {
      run?: { id: string; status: RunStatus; freshnessDeadlineAt: string; maxInterviewMinutes: number };
      message?: string;
    };

    if (!response.ok || !payload.run) {
      throw new Error(payload.message ?? "Unable to finish this interview safely.");
    }

    setAccessState({ status: "ready", run: payload.run });
    setIsRecording(false);
    disconnectRealtimeVoice("closed");
  }

  async function stopAfterTechnicalFailure() {
    const accessToken = getParticipantAccessTokenFromPath();

    if (!accessToken) {
      setInterviewError("This participant link is not available.");
      return;
    }

    setIsSubmittingInterviewAction(true);
    setInterviewError("");

    try {
      await markTechnicalInterruption(accessToken, "unknown");
    } catch (error) {
      setInterviewError(error instanceof Error ? error.message : "Unable to finish this interview safely.");
    } finally {
      setIsSubmittingInterviewAction(false);
    }
  }

  async function flushPendingInterviewArtifacts(accessToken: string) {
    const turns = pendingInterviewTurnsRef.current;

    if (turns.length === 0) {
      return;
    }

    await fetch(`${serviceBaseUrl}/participant/runs/${accessToken}/interview/artifacts`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        turns
      })
    });
    pendingInterviewTurnsRef.current = [];
  }

  function disconnectRealtimeVoice(state: Extract<RealtimeConnectionState, "closed" | "disconnected">) {
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteAudioRef.current?.remove();
    dataChannelRef.current = undefined;
    peerConnectionRef.current = undefined;
    mediaStreamRef.current = undefined;
    remoteAudioRef.current = undefined;
    setRealtimeVoiceActivity("idle");
    setRealtimeConnectionState((currentState) => (currentState === "idle" ? currentState : state));
  }

  function setMicrophoneEnabled(enabled: boolean) {
    mediaStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  async function submitConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConsentError("");

    const accessToken = getParticipantAccessTokenFromPath();

    if (!accessToken || accessState.status !== "ready" || !accessState.consentVersion) {
      setConsentError("This participant link is not available.");
      return;
    }

    if (accessState.consentVersion.consentMethod === "checkmark" && !accepted) {
      setConsentError("Please confirm consent before continuing.");
      return;
    }

    if (accessState.consentVersion.consentMethod === "electronic_signature" && !signatureText.trim()) {
      setConsentError("Please enter your signature before continuing.");
      return;
    }

    setIsSubmittingConsent(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/participant/runs/${accessToken}/consent`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(
          accessState.consentVersion.consentMethod === "checkmark"
            ? { accepted: true }
            : { signatureText }
        )
      });
      const payload = (await response.json()) as {
        run?: { id: string; status: RunStatus; freshnessDeadlineAt: string; maxInterviewMinutes: number };
        message?: string;
      };

      if (!response.ok || !payload.run) {
        throw new Error(payload.message ?? "Unable to submit consent.");
      }

      const updatedAccess = await fetchParticipantAccess(accessToken);
      setAccessState({ status: "ready", ...updatedAccess });
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : "Unable to submit consent.");
    } finally {
      setIsSubmittingConsent(false);
    }
  }

  function requestSurveySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSurveyError("");

    if (accessState.status !== "ready" || !accessState.surveyVersion) {
      setSurveyError("This participant link is not available.");
      return;
    }

    const questions = getSurveyQuestions(accessState.surveyVersion);
    const missingResponse = questions.find((question) => !surveyResponses[question.id]?.trim());

    if (missingResponse) {
      setSurveyError("Please answer every survey question before continuing.");
      return;
    }

    setIsSurveyConfirmationOpen(true);
  }

  async function submitSurvey() {
    setSurveyError("");

    const accessToken = getParticipantAccessTokenFromPath();

    if (!accessToken || accessState.status !== "ready" || !accessState.surveyVersion) {
      setSurveyError("This participant link is not available.");
      setIsSurveyConfirmationOpen(false);
      return;
    }

    const questions = getSurveyQuestions(accessState.surveyVersion);

    setIsSubmittingSurvey(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/participant/runs/${accessToken}/survey`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          responses: questions.map((question) => ({
            surveyQuestionId: question.id,
            responseText: surveyResponses[question.id]
          }))
        })
      });
      const payload = (await response.json()) as {
        run?: { id: string; status: RunStatus; freshnessDeadlineAt: string; maxInterviewMinutes: number };
        message?: string;
      };

      if (!response.ok || !payload.run) {
        throw new Error(payload.message ?? "Unable to submit survey.");
      }

      setIsSurveyConfirmationOpen(false);
      setAccessState({ status: "ready", run: payload.run });
    } catch (error) {
      setSurveyError(error instanceof Error ? error.message : "Unable to submit survey.");
      setIsSurveyConfirmationOpen(false);
    } finally {
      setIsSubmittingSurvey(false);
    }
  }

  if (accessState.status === "checking") {
    return (
      <ParticipantStatusScreen
        eyebrow="Participant access"
        title="Checking link"
        message="Please wait while we confirm this run is available."
      />
    );
  }

  if (accessState.status === "blocked") {
    return (
      <ParticipantStatusScreen
        eyebrow="Participant access"
        title="This link is not available"
        message={accessState.message}
      />
    );
  }

  if (accessState.status === "ready") {
    if (accessState.run.status === "created" && accessState.consentVersion) {
      return (
        <main className="app-shell participant-shell">
          <section className="workspace-panel participant-consent-panel" aria-labelledby="participant-title">
            <p className="eyebrow">Participant consent</p>
            <h1 id="participant-title">Study consent</h1>
            <div className="participant-consent-text">{accessState.consentVersion.consentText}</div>
            <form className="participant-consent-form" onSubmit={submitConsent}>
              {accessState.consentVersion.consentMethod === "checkmark" ? (
                <label className="participant-consent-option">
                  <input
                    checked={accepted}
                    disabled={isSubmittingConsent}
                    onChange={(event) => setAccepted(event.target.checked)}
                    type="checkbox"
                  />
                  <span>I have read the consent information and agree to participate.</span>
                </label>
              ) : (
                <label>
                  Electronic signature
                  <input
                    autoComplete="name"
                    disabled={isSubmittingConsent}
                    maxLength={200}
                    onChange={(event) => setSignatureText(event.target.value)}
                    required
                    type="text"
                    value={signatureText}
                  />
                </label>
              )}
              {consentError ? <p className="form-error">{consentError}</p> : null}
              <button className="primary-button" disabled={isSubmittingConsent} type="submit">
                {isSubmittingConsent ? "Submitting consent" : "Continue"}
              </button>
            </form>
          </section>
        </main>
      );
    }

    if (
      (accessState.run.status === "consented" || accessState.run.status === "survey_in_progress") &&
      accessState.surveyVersion
    ) {
      return (
        <ParticipantSurveyScreen
          isConfirmationOpen={isSurveyConfirmationOpen}
          isSubmittingSurvey={isSubmittingSurvey}
          layoutItems={getSurveyLayoutItems(accessState.surveyVersion)}
          surveyError={surveyError}
          surveyResponses={surveyResponses}
          onCancelSubmit={() => setIsSurveyConfirmationOpen(false)}
          onChangeResponse={(questionId, value) =>
            setSurveyResponses((currentResponses) => ({
              ...currentResponses,
              [questionId]: value
            }))
          }
          onConfirmSubmit={() => void submitSurvey()}
          onSubmit={requestSurveySubmit}
        />
      );
    }

    if (
      accessState.run.status === "survey_completed" ||
      accessState.run.status === "interview_in_progress" ||
      accessState.run.status === "interview_paused"
    ) {
      const interviewMode = getInterviewMode(accessState.run.status);

      return (
        <ParticipantInterviewScreen
          aiQuestion={latestAiQuestionTranscript}
          error={interviewError}
          isActionPending={isSubmittingInterviewAction}
          isRecording={isRecording}
          latestSpokenTranscript={latestParticipantTranscript}
          maxInterviewMinutes={accessState.run.maxInterviewMinutes}
          mode={interviewMode}
          realtimeConnectionState={realtimeConnectionState}
          realtimeVoiceActivity={realtimeVoiceActivity}
          onComplete={() => void submitInterviewAction("complete")}
          onConfirmAnswer={confirmInterviewAnswer}
          onPause={() => void submitInterviewAction("pause")}
          onRecordingChange={setInterviewRecording}
          onResume={() => void submitInterviewAction("resume")}
          onRetry={() => void retryRealtimeVoice()}
          onStart={() => void submitInterviewAction("start")}
          onStopAfterFailure={() => void stopAfterTechnicalFailure()}
          retryCount={realtimeRetryCount}
        />
      );
    }

    const terminalScreen = getParticipantTerminalScreen(accessState.run.status);

    if (terminalScreen) {
      return <ParticipantStatusScreen {...terminalScreen} />;
    }

    return (
      <ParticipantStatusScreen
        eyebrow="Participant access"
        title="This step is not available"
        message="This participant link cannot continue from the current run state."
      />
    );
  }
  return (
    <ParticipantStatusScreen
      eyebrow="Participant access"
      title="This link is not available"
      message="This participant link is not available."
    />
  );
}

export function ParticipantInterviewScreen({
  aiQuestion,
  error,
  initialResponseMode,
  initialUiState,
  isActionPending,
  isRecording,
  latestSpokenTranscript,
  maxInterviewMinutes,
  mode,
  realtimeConnectionState,
  realtimeVoiceActivity = "idle",
  onComplete,
  onConfirmAnswer,
  onPause,
  onRecordingChange,
  onResume,
  onRetry,
  onStart,
  onStopAfterFailure,
  retryCount
}: {
  readonly aiQuestion: string;
  readonly error: string;
  readonly initialResponseMode?: InterviewResponseMode;
  readonly initialUiState?: InterviewUiState;
  readonly isActionPending: boolean;
  readonly isRecording: boolean;
  readonly latestSpokenTranscript?: string;
  readonly maxInterviewMinutes: number;
  readonly mode: InterviewMode;
  readonly realtimeConnectionState: RealtimeConnectionState;
  readonly realtimeVoiceActivity?: RealtimeVoiceActivity;
  readonly onComplete: () => void;
  readonly onConfirmAnswer: (answer: { readonly aiQuestion: string; readonly responseText: string }) => void;
  readonly onPause: () => void;
  readonly onRecordingChange: (recording: boolean) => void;
  readonly onResume: () => void;
  readonly onRetry: () => void;
  readonly onStart: () => void;
  readonly onStopAfterFailure: () => void;
  readonly retryCount: number;
}) {
  const isActive = mode === "active";
  const hasRecoverableFailure = isActive && realtimeConnectionState === "failed";
  const [uiState, setUiState] = useState<InterviewUiState>(() => initialUiState ?? getInitialInterviewUiState(mode));
  const [responseMode, setResponseMode] = useState<InterviewResponseMode>(initialResponseMode ?? "natural");
  const [lastVoiceResponseMode, setLastVoiceResponseMode] = useState<Exclude<InterviewResponseMode, "typing">>(
    initialResponseMode === "push_to_talk" ? "push_to_talk" : "natural"
  );
  const [micCheckStatus, setMicCheckStatus] = useState<"idle" | "checking" | "heard">("idle");
  const [micCheckTranscript, setMicCheckTranscript] = useState("");
  const [answerCount, setAnswerCount] = useState(0);
  const [transcriptDraft, setTranscriptDraft] = useState(latestSpokenTranscript ?? "");
  const [typedDraft, setTypedDraft] = useState("");
  const [displayQuestion, setDisplayQuestion] = useState(getDisplayQuestionText(aiQuestion));
  const [speechNonce, setSpeechNonce] = useState(0);
  const [interruptionNotice, setInterruptionNotice] = useState("");
  const [previousAnswers, setPreviousAnswers] = useState<readonly { readonly question: string; readonly answer: string }[]>([]);
  const [canReturnToPreviousCard, setCanReturnToPreviousCard] = useState(false);
  const interviewHistoryIndexRef = useRef(0);
  
  const isNaturalRealtimeConversation =
    isActive && uiState !== "paused" && responseMode === "natural" && realtimeConnectionState === "connected";
  const elapsedSeconds = useElapsedSeconds(uiState === "student_speaking" || (uiState === "student_turn" && responseMode === "natural"));
  const shouldCaptureSpeech = isActive && uiState === "student_speaking" && responseMode !== "typing";
  const shouldCaptureMicCheckSpeech = mode === "ready" && uiState === "mic_check" && (micCheckStatus === "checking" || micCheckStatus === "heard");
  const speechTranscript = useBrowserSpeechTranscript(shouldCaptureSpeech || shouldCaptureMicCheckSpeech);
  const microphoneLevel = useMicrophoneLevel(
    (uiState === "mic_check" && (micCheckStatus === "checking" || micCheckStatus === "heard")) ||
      shouldCaptureSpeech ||
      isNaturalRealtimeConversation
  );
  const participantVoiceState = isNaturalRealtimeConversation
    ? getNaturalConversationTitle(realtimeVoiceActivity)
    : getParticipantVoiceState(uiState, responseMode, isActive);
  const shouldShowInterviewControls =
    mode === "active" && uiState !== "completed" && uiState !== "paused" && !isNaturalRealtimeConversation;
  const shouldShowCurrentQuestion =
    uiState !== "paused" && (mode !== "ready" || !["onboarding", "mic_check", "mode_selection"].includes(uiState));
  const shouldShowRepeatQuestion = shouldShowRepeatQuestionControl({ isNaturalRealtimeConversation, uiState });
  const interviewLayoutClassName = shouldShowCurrentQuestion
    ? "interview-layout interview-layout-with-question"
    : "interview-layout interview-layout-centered";
  const shouldWatchForStudentPause = shouldNoticeStudentPause({
    isActive,
    microphoneLevel,
    responseMode,
    uiState
  });
  const isPushToTalkAiSpeaking = shouldPausePushToTalkForAiSpeech({
    isActive,
    realtimeVoiceActivity,
    responseMode,
    uiState
  });

  useEffect(() => {
    setDisplayQuestion(getDisplayQuestionText(aiQuestion));
  }, [aiQuestion]);

  useEffect(() => {
    const currentEntry = getInterviewHistoryEntry(window.history.state);
    const entry =
      currentEntry?.mode === mode
        ? currentEntry
        : createInterviewHistoryEntry({
            mode,
            responseMode,
            uiState,
            index: 0
          });

    interviewHistoryIndexRef.current = entry.index;
    setCanReturnToPreviousCard(entry.index > 0);
    replaceInterviewHistoryEntry(entry);

    if (entry.uiState !== uiState) {
      setResponseMode(entry.responseMode);
      setUiState(entry.uiState);
    }

    function handleBrowserBack(event: PopStateEvent) {
      const historyEntry = getInterviewHistoryEntry(event.state);

      if (!historyEntry || historyEntry.mode !== mode) {
        return;
      }

      interviewHistoryIndexRef.current = historyEntry.index;
      setCanReturnToPreviousCard(historyEntry.index > 0);
      setResponseMode(historyEntry.responseMode);
      setUiState(historyEntry.uiState);
    }

    window.addEventListener("popstate", handleBrowserBack);

    return () => window.removeEventListener("popstate", handleBrowserBack);
  }, [mode]);

  useEffect(() => {
    if (latestSpokenTranscript?.trim()) {
      setTranscriptDraft(latestSpokenTranscript.trim());
    }
  }, [latestSpokenTranscript]);

  useEffect(() => {
    if (shouldCaptureMicCheckSpeech && speechTranscript.trim()) {
      setMicCheckTranscript(speechTranscript.trim());
      return;
    }

    if (shouldCaptureSpeech && speechTranscript.trim()) {
      setTranscriptDraft(speechTranscript.trim());
    }
  }, [shouldCaptureMicCheckSpeech, shouldCaptureSpeech, speechTranscript]);

  useEffect(() => {
    if (uiState === "mic_check" && micCheckStatus === "checking" && microphoneLevel > 0.05) {
      setMicCheckStatus("heard");
    }
  }, [micCheckStatus, microphoneLevel, uiState]);

  useEffect(() => {
    setUiState((currentState) => {
      if (mode === "ready") {
        return currentState === "onboarding" || currentState === "mic_check" || currentState === "mode_selection"
          ? currentState
          : "onboarding";
      }

      if (mode === "paused") {
        return "paused";
      }

      if (currentState === "onboarding" || currentState === "mic_check" || currentState === "mode_selection" || currentState === "paused") {
        return "ai_speaking";
      }

      return currentState;
    });
  }, [mode]);

  useEffect(() => {
    if (!isActive) {
      onRecordingChange(false);
      return;
    }

    const shouldRecord =
      realtimeConnectionState !== "failed" &&
      (responseMode === "natural" &&
        (isNaturalRealtimeConversation ||
          uiState === "student_turn" ||
          uiState === "student_speaking")) ||
      (responseMode === "push_to_talk" && uiState === "student_speaking" && !isPushToTalkAiSpeaking) ||
      (uiState === "mic_check" && micCheckStatus === "checking");

    onRecordingChange(shouldRecord);
  }, [
    isActive,
    isNaturalRealtimeConversation,
    isPushToTalkAiSpeaking,
    micCheckStatus,
    onRecordingChange,
    realtimeConnectionState,
    responseMode,
    uiState
  ]);

  useEffect(() => {
    if (!isPushToTalkAiSpeaking) {
      return;
    }

    setUiState("student_turn");
  }, [isPushToTalkAiSpeaking]);

  useEffect(() => {
    if (!isActive || uiState !== "ai_speaking" || responseMode === "natural") {
      return;
    }

    speakInterviewQuestion(displayQuestion);
    const timeout = window.setTimeout(() => setUiState("student_turn"), 1400);

    return () => window.clearTimeout(timeout);
  }, [isActive, responseMode, uiState, displayQuestion, speechNonce]);

  useEffect(() => {
    if (!shouldWatchForStudentPause) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setUiState((currentState) => (currentState === "student_speaking" ? "student_paused" : currentState));
    }, speechPauseSilenceMs);

    return () => window.clearTimeout(timeout);
  }, [shouldWatchForStudentPause, speechTranscript]);

  useEffect(() => {
    if (uiState !== "ai_thinking") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setUiState(answerCount > 0 && answerCount % 3 === 0 ? "break_prompt" : "ai_speaking");
    }, 850);

    return () => window.clearTimeout(timeout);
  }, [answerCount, uiState]);

  function startMicCheck() {
    setMicCheckTranscript("");
    setMicCheckStatus("checking");
    window.setTimeout(() => setMicCheckStatus("heard"), 850);
  }

  function navigateToInterviewCard({
    nextResponseMode = responseMode,
    nextUiState,
    replace = false
  }: {
    readonly nextResponseMode?: InterviewResponseMode;
    readonly nextUiState: InterviewUiState;
    readonly replace?: boolean;
  }) {
    const nextIndex = replace ? interviewHistoryIndexRef.current : interviewHistoryIndexRef.current + 1;
    const nextEntry = createInterviewHistoryEntry({
      mode,
      responseMode: nextResponseMode,
      uiState: nextUiState,
      index: nextIndex
    });

    interviewHistoryIndexRef.current = nextEntry.index;
    setCanReturnToPreviousCard(nextEntry.index > 0);
    setResponseMode(nextResponseMode);
    setUiState(nextUiState);

    if (replace) {
      replaceInterviewHistoryEntry(nextEntry);
    } else {
      pushInterviewHistoryEntry(nextEntry);
    }
  }

  function returnToPreviousInterviewCard() {
    if (canReturnToPreviousCard) {
      window.history.back();
    }
  }

  function handleStartInterview() {
    setInterruptionNotice("");
    onStart();
  }

  function handleInterruptAi() {
    cancelInterviewSpeech();
    setInterruptionNotice("I stopped - go ahead.");
    navigateToInterviewCard({ nextUiState: "student_turn" });
  }

  function handleRepeatQuestion() {
    const nextUiState = getRepeatQuestionUiState(uiState);

    if (nextUiState === uiState) {
      return;
    }

    setSpeechNonce((value) => value + 1);
    setUiState(nextUiState);
  }

  function handleRephraseQuestion() {
    setDisplayQuestion(`Said another way: ${getRephrasedQuestion(displayQuestion)}`);
    setSpeechNonce((value) => value + 1);
    setUiState("ai_speaking");
  }

  function handleStartAnswer() {
    setInterruptionNotice("");
    setTranscriptDraft("");
    setTypedDraft("");

    if (responseMode === "push_to_talk" && realtimeVoiceActivity === "ai_speaking") {
      navigateToInterviewCard({ nextUiState: "student_turn" });
      return;
    }

    if (responseMode === "typing") {
      navigateToInterviewCard({ nextUiState: "student_turn" });
      return;
    }

    navigateToInterviewCard({ nextUiState: "student_speaking" });
  }

  function handleFinishSpeaking() {
    setTranscriptDraft(getBestTranscriptDraft(transcriptDraft, speechTranscript, latestSpokenTranscript));
    navigateToInterviewCard({ nextUiState: "transcript_review" });
  }

  function handleRedoAnswer() {
    setTranscriptDraft("");
    setTypedDraft("");
    setUiState("student_turn");
  }

  function handleSkipQuestion() {
    confirmAnswer("Skipped this question.");
  }

  function confirmAnswer(answerText: string) {
    const normalizedAnswer = answerText.trim();

    if (!normalizedAnswer) {
      return;
    }

    const confirmedAnswer = normalizedAnswer.slice(0, 20000);
    onConfirmAnswer({ aiQuestion: displayQuestion, responseText: confirmedAnswer });
    setPreviousAnswers((answers) => [...answers, { question: displayQuestion, answer: confirmedAnswer }]);
    setAnswerCount((count) => count + 1);
    setTranscriptDraft("");
    setTypedDraft("");
    setInterruptionNotice("");
    setUiState("ai_thinking");
  }

  function handlePause() {
    setUiState("paused");
    onPause();
  }

  function switchToTyping() {
    if (responseMode !== "typing") {
      setLastVoiceResponseMode(responseMode);
    }
    navigateToInterviewCard({ nextResponseMode: "typing", nextUiState: "student_turn" });
  }

  function switchToRecording() {
    navigateToInterviewCard({
      nextResponseMode: lastVoiceResponseMode,
      nextUiState: "student_turn"
    });
  }

  function renderMainPanel() {
    if (isNaturalRealtimeConversation) {
      const participantIsSpeaking = realtimeVoiceActivity === "participant_speaking" || microphoneLevel > speechPauseVoiceLevelThreshold;

      return (
        <InterviewStageCard eyebrow="Voice conversation" title={getNaturalConversationTitle(realtimeVoiceActivity)}>
          <div className="voice-wave-grid natural-conversation-waves">
            <div className="voice-wave-panel">
              <VoiceWave isActive={realtimeVoiceActivity === "ai_speaking"} label="OpenAI voice activity" level={0.72} />
              <span>OpenAI</span>
            </div>
            <div className="voice-wave-panel">
              <VoiceWave isActive={participantIsSpeaking} label="Your voice activity" level={microphoneLevel} />
              <span>You</span>
            </div>
            <button className="secondary-button" disabled={isActionPending} onClick={handlePause} type="button">
              Pause
            </button>
          </div>
        </InterviewStageCard>
      );
    }

    if (mode === "ready" && uiState === "onboarding") {
      return (
        <InterviewStageCard eyebrow="Voice interview" title="A few follow-up questions">
          <p>
            This interview is a follow-up to your survey. It is not a test, it is not graded, and there are no right or wrong answers.
          </p>
          <p>
            We are interested in your honest thoughts and experiences. Your perspective can help us better understand how students learn and how education can be improved.
          </p>
          <p>
            The interview may take up to {maxInterviewMinutes} minutes. You will need to stay connected to the internet during the interview.
          </p>
          <p>
            You are always in control: you can pause, skip, redo, or type your answers at any time.
          </p>
          <p>
            Thank you for taking part. Your voice matters, and we appreciate your contribution to this research.
          </p>

          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button className="primary-button" onClick={() => navigateToInterviewCard({ nextUiState: "mic_check" })} type="button">
              Let's Begin
            </button>
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    if (mode === "ready" && uiState === "mic_check") {
      return (
        <InterviewStageCard eyebrow="Voice Test" title="Testing your voice input">
          <p>Please Say: "I'm ready to begin."</p>
          <button className="mic-check-button" disabled={micCheckStatus === "checking" || micCheckStatus === "heard"} onClick={startMicCheck} type="button">
            Start mic check
          </button>
          <div className="mic-check-meter" aria-label="Microphone test level">
            <VoiceWave isActive={micCheckStatus === "checking" || micCheckStatus === "heard"} label="Microphone check" level={microphoneLevel} />
          </div>
          <p className="mic-check-transcript" aria-live="polite">
            {micCheckTranscript || (micCheckStatus === "checking" ? "Listening for your test sentence." : "\u00a0")}
          </p>
          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button className="primary-button" disabled={micCheckStatus !== "heard"} onClick={() => navigateToInterviewCard({ nextUiState: "mode_selection" })} type="button">
              Continue
            </button>
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    if (mode === "ready" && uiState === "mode_selection") {
      return (
        <InterviewStageCard eyebrow="Response mode" title="Choose how you want to answer">
          <fieldset className="interview-mode-options">
            <legend className="visually-hidden">Response mode</legend>
            {interviewResponseModes.map((option) => (
              <label className="interview-mode-option" key={option.value}>
                <input
                  checked={responseMode === option.value}
                  onChange={() => setResponseMode(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="privacy-note">Your microphone is only on during your answer.</p>
          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button className="primary-button" disabled={isActionPending} onClick={handleStartInterview} type="button">
              {isActionPending ? "Starting" : "Start interview"}
            </button>
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    if (uiState === "paused") {
      return (
        <InterviewStageCard eyebrow="Paused" title="Interview paused">
          <p>Take your time. Your microphone is paused.</p>
          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button className="primary-button" disabled={isActionPending} onClick={onResume} type="button">
              {isActionPending ? "Resuming" : "Resume interview"}
            </button>
            <button className="secondary-button" disabled={isActionPending} onClick={onComplete} type="button">
              End interview
            </button>
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    if (uiState === "ai_thinking") {
      return (
        <InterviewStageCard eyebrow="Saving your answer" title="Preparing a follow-up">
          <div className="calm-loading" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p>Thinking about your response...</p>
        </InterviewStageCard>
      );
    }

    if (uiState === "break_prompt") {
      return (
        <InterviewStageCard eyebrow="Optional break" title="Would you like a short break?">
          <p>You are doing fine. You can pause for a moment or keep going.</p>
          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button className="secondary-button" disabled={isActionPending} onClick={handlePause} type="button">
              Take a break
            </button>
            <button className="primary-button" onClick={() => navigateToInterviewCard({ nextUiState: "ai_speaking" })} type="button">
              Keep going
            </button>
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    if (uiState === "student_paused") {
      return (
        <InterviewStageCard eyebrow="Your turn" title="Want to add anything?">
          <p>We noticed a pause. You can continue, add more, redo, or type instead.</p>
          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button className="primary-button" onClick={handleFinishSpeaking} type="button">
              Continue
            </button>
            <button className="secondary-button" onClick={() => navigateToInterviewCard({ nextUiState: "student_speaking" })} type="button">
              Add more
            </button>
            <button className="secondary-button" onClick={handleRedoAnswer} type="button">
              Redo
            </button>
            <button
              className="secondary-button"
              onClick={switchToTyping}
              type="button"
            >
              Type instead
            </button>
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    if (uiState === "transcript_review") {
      return (
        <InterviewStageCard eyebrow="Transcript confirmation" title="Here's what we heard">
          <textarea
            aria-label="Transcript preview"
            maxLength={20000}
            placeholder="No transcript is available yet. You can type what you said here, or redo the answer."
            onChange={(event) => setTranscriptDraft(event.target.value)}
            value={transcriptDraft}
          />
          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button className="primary-button" disabled={!transcriptDraft.trim()} onClick={() => confirmAnswer(transcriptDraft)} type="button">
              Continue
            </button>
            <button className="secondary-button" onClick={handleRedoAnswer} type="button">
              Redo
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setTypedDraft(transcriptDraft);
                navigateToInterviewCard({ nextResponseMode: "typing", nextUiState: "student_turn" });
              }}
              type="button"
            >
              Edit by typing
            </button>
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    if (uiState === "student_turn" && responseMode === "typing") {
      return (
        <InterviewStageCard eyebrow="Your turn" title="Type your answer">
          <p className="privacy-note">Your microphone is off while you type.</p>
          <textarea
            aria-label="Typed answer"
            autoFocus
            maxLength={20000}
            onChange={(event) => setTypedDraft(event.target.value)}
            placeholder="Type your answer here."
            value={typedDraft}
          />
          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button className="primary-button" disabled={!typedDraft.trim()} onClick={() => confirmAnswer(typedDraft)} type="button">
              Continue
            </button>
            <button className="secondary-button" onClick={switchToRecording} type="button">
              Record instead
            </button>
            <button className="secondary-button" disabled={isActionPending} onClick={handlePause} type="button">
              Pause
            </button>
            {lastVoiceResponseMode !== "push_to_talk" ? (
              <button className="secondary-button" onClick={handleSkipQuestion} type="button">
              Skip
              </button>
            ) : null}
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    if (uiState === "student_speaking") {
      return (
        <InterviewStageCard eyebrow="Your turn" title="Listening">
          <VoiceWave isActive label="Your voice activity" level={microphoneLevel} />
          <p className="recording-timer">Recording {formatElapsedSeconds(elapsedSeconds)}</p>
          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button className="primary-button" onClick={handleFinishSpeaking} type="button">
              Done
            </button>
            <button className="secondary-button" disabled={isActionPending} onClick={handlePause} type="button">
              Pause
            </button>
            <button
              className="secondary-button"
              onClick={switchToTyping}
              type="button"
            >
              Type instead
            </button>
            {responseMode !== "push_to_talk" ? (
              <button className="secondary-button" onClick={handleSkipQuestion} type="button">
              Skip
              </button>
            ) : null}
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    if (uiState === "student_turn") {
      return (
        <InterviewStageCard eyebrow="Your turn" title="Your turn">
          <p>{responseMode === "push_to_talk" ? "Press record when you are ready to answer." : "Start when you are ready. We will wait briefly if you pause."}</p>
          <VoiceWave isActive={responseMode === "natural"} label="Your input meter" level={microphoneLevel} />
          <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
            <button
              className="primary-button"
              disabled={responseMode === "push_to_talk" && realtimeVoiceActivity === "ai_speaking"}
              onClick={handleStartAnswer}
              type="button"
            >
              Start Talking
            </button>
            {responseMode !== "push_to_talk" ? (
              <button className="secondary-button" onClick={handleFinishSpeaking} type="button">
                I'm done
              </button>
            ) : null}
            <button className="secondary-button" disabled={isActionPending} onClick={handlePause} type="button">
              Pause
            </button>
            <button
              className="secondary-button"
              onClick={switchToTyping}
              type="button"
            >
              Type instead
            </button>
            {responseMode !== "push_to_talk" ? (
              <button className="secondary-button" onClick={handleSkipQuestion} type="button">
              Skip
              </button>
            ) : null}
          </InterviewCardActions>
        </InterviewStageCard>
      );
    }

    return (
      <InterviewStageCard eyebrow="AI speaking" title="AI question">
        <p className="ai-question-text">{displayQuestion}</p>
        <div className="abstract-speaking-indicator" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <InterviewCardActions canGoBack={canReturnToPreviousCard} onBack={returnToPreviousInterviewCard}>
          <button className="secondary-button" onClick={handleRepeatQuestion} type="button">
            Repeat question
          </button>
          <button className="secondary-button" onClick={handleRephraseQuestion} type="button">
            Say that another way
          </button>
          <button className="primary-button" onClick={handleInterruptAi} type="button">
            I stopped - go ahead
          </button>
        </InterviewCardActions>
      </InterviewStageCard>
    );
  }

  return (
    <main className="app-shell participant-shell participant-interview-shell">
      <section className="participant-interview-surface" aria-labelledby="participant-title">
        <div className="participant-interview-topline">
          <div>
            <p className="eyebrow">AI Guided Interview</p>
          </div>
          <span>{maxInterviewMinutes} min max</span>
        </div>

        <div className="participant-reassurance" role="note">
          Share your thinking in your own words.
        </div>

        <div className={interviewLayoutClassName}>
          {shouldShowCurrentQuestion ? (
            <section className="ai-question-card" aria-label="Current AI question" aria-live="polite">
              <div className="card-heading-row">
                <p className="eyebrow">Current question</p>
                {shouldShowRepeatQuestion ? (
                  <button className="secondary-button compact-button" onClick={handleRepeatQuestion} type="button">
                    Repeat
                  </button>
                ) : null}
              </div>
              <p>{displayQuestion}</p>
            </section>
          ) : null}

          <section className="student-response-card" aria-live="polite">
            {interruptionNotice ? <p className="interruption-notice">{interruptionNotice}</p> : null}
            {renderMainPanel()}
          </section>
        </div>

        <div className="participant-voice-state" aria-live="polite">
          <span className={isRecording ? "voice-state-dot active-voice-state-dot" : "voice-state-dot"} />
          <span>{participantVoiceState}</span>
        </div>

        {hasRecoverableFailure ? (
          <div className="participant-recovery-panel" role="status">
            <p>{error || "We had trouble keeping the voice interview connected. Your responses so far are saved."}</p>
            <span>Retry {retryCount} of {maximumRecoverableRetryCount}</span>
            <div className="participant-interview-card-actions">
              <button className="primary-button" disabled={isActionPending} onClick={onRetry} type="button">
                Retry connection
              </button>
              <button className="secondary-button" disabled={isActionPending} onClick={onStopAfterFailure} type="button">
                End session
              </button>
            </div>
          </div>
        ) : error ? (
          <p className="form-error">{error}</p>
        ) : null}

        {shouldShowInterviewControls ? (
          <div className="participant-interview-controls" aria-label="Interview controls">
            <button className="secondary-button" disabled={isActionPending || isRecording} onClick={onComplete} type="button">
              End interview
            </button>
          </div>
        ) : null}

        {previousAnswers.length > 0 ? (
          <details className="previous-response-list">
            <summary>Previous responses</summary>
            {previousAnswers.map((answer, index) => (
              <article key={`${answer.question}-${index}`}>
                <strong>{answer.question}</strong>
                <p>{answer.answer}</p>
              </article>
            ))}
          </details>
        ) : null}
      </section>
    </main>
  );
}

const maximumRecoverableRetryCount = 2;

const interviewResponseModes: readonly {
  readonly value: InterviewResponseMode;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: "natural",
    label: "Talk naturally",
    description: "The microphone listens during your answer and waits briefly when you pause."
  },
  {
    value: "push_to_talk",
    label: "Press to record each answer",
    description: "You choose exactly when each answer starts and stops."
  },
  {
    value: "typing",
    label: "Type my answers",
    description: "Use the interview without speaking aloud."
  }
];

interface PendingInterviewTurn {
  readonly speaker: "ai" | "participant";
  readonly text: string;
  readonly audioStartMs?: number;
  readonly audioEndMs?: number;
}

function InterviewCardActions({
  canGoBack,
  children,
  onBack
}: {
  readonly canGoBack: boolean;
  readonly children: ReactNode;
  readonly onBack: () => void;
}) {
  return (
    <div className="participant-interview-card-actions">
      {canGoBack ? (
        <button className="secondary-button" onClick={onBack} type="button">
          Back
        </button>
      ) : null}
      {children}
    </div>
  );
}

function InterviewStageCard({
  children,
  eyebrow,
  title
}: {
  readonly children: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <div className="interview-stage-card">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

interface InterviewHistoryEntry {
  readonly index: number;
  readonly mode: InterviewMode;
  readonly responseMode: InterviewResponseMode;
  readonly uiState: InterviewUiState;
}

const participantInterviewHistoryKey = "educationResearcherParticipantInterview";

const interviewUiStates: readonly InterviewUiState[] = [
  "onboarding",
  "mic_check",
  "mode_selection",
  "ai_speaking",
  "ai_thinking",
  "student_turn",
  "student_speaking",
  "student_paused",
  "transcript_review",
  "paused",
  "break_prompt",
  "completed"
];

const interviewResponseModeValues: readonly InterviewResponseMode[] = ["natural", "push_to_talk", "typing"];

const interviewModeValues: readonly InterviewMode[] = ["ready", "active", "paused"];

function createInterviewHistoryEntry(entry: InterviewHistoryEntry): InterviewHistoryEntry {
  return entry;
}

function pushInterviewHistoryEntry(entry: InterviewHistoryEntry) {
  window.history.pushState(createBrowserHistoryState(entry), "", window.location.href);
}

function replaceInterviewHistoryEntry(entry: InterviewHistoryEntry) {
  window.history.replaceState(createBrowserHistoryState(entry), "", window.location.href);
}

function createBrowserHistoryState(entry: InterviewHistoryEntry) {
  return {
    ...getObjectHistoryState(window.history.state),
    [participantInterviewHistoryKey]: entry
  };
}

function getInterviewHistoryEntry(state: unknown): InterviewHistoryEntry | undefined {
  const entry = getObjectHistoryState(state)[participantInterviewHistoryKey];

  if (!isObjectRecord(entry)) {
    return undefined;
  }

  const { index, mode, responseMode, uiState } = entry;

  if (
    typeof index !== "number" ||
    !isInterviewMode(mode) ||
    !isInterviewResponseMode(responseMode) ||
    !isInterviewUiState(uiState)
  ) {
    return undefined;
  }

  return {
    index,
    mode,
    responseMode,
    uiState
  };
}

function getObjectHistoryState(state: unknown): Record<string, unknown> {
  return isObjectRecord(state) ? state : {};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInterviewMode(value: unknown): value is InterviewMode {
  return typeof value === "string" && interviewModeValues.includes(value as InterviewMode);
}

function isInterviewResponseMode(value: unknown): value is InterviewResponseMode {
  return typeof value === "string" && interviewResponseModeValues.includes(value as InterviewResponseMode);
}

function isInterviewUiState(value: unknown): value is InterviewUiState {
  return typeof value === "string" && interviewUiStates.includes(value as InterviewUiState);
}

function getInitialInterviewUiState(mode: InterviewMode): InterviewUiState {
  if (mode === "paused") {
    return "paused";
  }

  if (mode === "active") {
    return "ai_speaking";
  }

  return "onboarding";
}

export function shouldShowRepeatQuestionControl({
  isNaturalRealtimeConversation,
  uiState
}: {
  readonly isNaturalRealtimeConversation: boolean;
  readonly uiState: InterviewUiState;
}) {
  return !isNaturalRealtimeConversation && uiState !== "paused";
}

export function getRepeatQuestionUiState(uiState: InterviewUiState): InterviewUiState {
  return uiState === "paused" ? "paused" : "ai_speaking";
}

function useElapsedSeconds(isActive: boolean) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isActive]);

  return elapsedSeconds;
}

function useMicrophoneLevel(isActive: boolean) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!isActive || !navigator.mediaDevices?.getUserMedia) {
      setLevel(0);
      return;
    }

    let cancelled = false;
    let animationFrameId = 0;
    let audioContext: AudioContext | undefined;
    let mediaStream: MediaStream | undefined;

    async function startMeter() {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        audioContext.createMediaStreamSource(mediaStream).connect(analyser);
        const samples = new Uint8Array(analyser.frequencyBinCount);

        function updateLevel() {
          analyser.getByteFrequencyData(samples);
          const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
          setLevel(Math.min(1, average / 72));
          animationFrameId = window.requestAnimationFrame(updateLevel);
        }

        updateLevel();
      } catch {
        setLevel(0);
      }
    }

    void startMeter();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrameId);
      mediaStream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
      setLevel(0);
    };
  }, [isActive]);

  return level;
}

interface BrowserSpeechRecognitionResult {
  readonly transcript: string;
  readonly isFinal: boolean;
}

interface BrowserSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: {
      readonly length: number;
      readonly isFinal: boolean;
      readonly [index: number]: BrowserSpeechRecognitionResult;
    };
  };
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function useBrowserSpeechTranscript(isActive: boolean) {
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    if (!isActive) {
      setTranscript("");
      return;
    }

    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();

    if (!SpeechRecognitionConstructor) {
      return;
    }

    const recognition = new SpeechRecognitionConstructor();
    let finalTranscript = "";

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript ?? "";

        if (result?.isFinal) {
          finalTranscript = `${finalTranscript} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }

      setTranscript(`${finalTranscript} ${interimTranscript}`.trim());
    };
    recognition.onerror = () => undefined;
    recognition.onend = () => undefined;

    try {
      recognition.start();
    } catch {
      return;
    }

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    };
  }, [isActive]);

  return transcript;
}

function getSpeechRecognitionConstructor() {
  const browserWindow = window as Window & {
    readonly SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    readonly webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
}

function speakInterviewQuestion(question: string) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(question);
  utterance.rate = 0.94;
  utterance.pitch = 1;
  utterance.volume = 0.92;
  window.speechSynthesis.speak(utterance);
}

function cancelInterviewSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function getBestTranscriptDraft(
  transcriptDraft: string,
  speechTranscript: string,
  latestSpokenTranscript: string | undefined
) {
  return (latestSpokenTranscript?.trim() || speechTranscript.trim() || transcriptDraft.trim()).slice(0, 20000);
}

function getParticipantVoiceState(
  uiState: InterviewUiState,
  responseMode: InterviewResponseMode,
  isActive: boolean
) {
  if (responseMode === "typing") {
    return "Typed response mode";
  }

  if (!isActive || uiState === "paused") {
    return "Voice input paused";
  }

  if (uiState === "student_speaking") {
    return "Listening...";
  }

  if (uiState === "student_turn") {
    return responseMode === "push_to_talk" ? "Ready to record" : "Voice input ready";
  }

  if (uiState === "student_paused") {
    return "Pause detected";
  }

  return "Voice input off";
}

function getDisplayQuestionText(aiQuestion: string) {
  return aiQuestion.trim() || "Waiting for the AI question...";
}

function getNaturalConversationTitle(realtimeVoiceActivity: RealtimeVoiceActivity) {
  if (realtimeVoiceActivity === "ai_speaking") {
    return "OpenAI is speaking";
  }

  if (realtimeVoiceActivity === "participant_speaking") {
    return "Listening";
  }

  return "Connected";
}

export function shouldNoticeStudentPause({
  isActive,
  microphoneLevel,
  responseMode,
  uiState
}: {
  readonly isActive: boolean;
  readonly microphoneLevel: number;
  readonly responseMode: InterviewResponseMode;
  readonly uiState: InterviewUiState;
}) {
  return (
    isActive &&
    uiState === "student_speaking" &&
    responseMode === "natural" &&
    microphoneLevel <= speechPauseVoiceLevelThreshold
  );
}

export function shouldPausePushToTalkForAiSpeech({
  isActive,
  realtimeVoiceActivity,
  responseMode,
  uiState
}: {
  readonly isActive: boolean;
  readonly realtimeVoiceActivity: RealtimeVoiceActivity;
  readonly responseMode: InterviewResponseMode;
  readonly uiState: InterviewUiState;
}) {
  return isActive && responseMode === "push_to_talk" && uiState === "student_speaking" && realtimeVoiceActivity === "ai_speaking";
}

function getRephrasedQuestion(question: string) {
  if (/example/i.test(question)) {
    return "What is one specific moment or situation that shows what you mean?";
  }

  if (/uncertain|sure/i.test(question)) {
    return "What part feels clear to you, and what part still feels hard to decide?";
  }

  return question.replace(/^Earlier, you said/i, "Thinking back to your survey answer,");
}

function formatElapsedSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function VoiceWave({
  isActive,
  label,
  level = 0.45
}: {
  readonly isActive: boolean;
  readonly label: string;
  readonly level?: number;
}) {
  const barHeights = getVoiceWaveHeights(isActive ? level : 0);

  return (
    <div className={isActive ? "voice-wave active-voice-wave" : "voice-wave"} title={`${label} voice wave`}>
      {barHeights.map((height, index) => (
        <span key={index} style={{ "--voice-bar-height": `${height}px` } as CSSProperties} />
      ))}
    </div>
  );
}

function getVoiceWaveHeights(level: number) {
  const clampedLevel = Math.max(0, Math.min(1, level));
  const minimumHeights = [14, 20, 28, 20, 14];
  const maximumHeights = [34, 58, 70, 52, 38];

  return minimumHeights.map((height, index) => Math.round(height + (maximumHeights[index]! - height) * clampedLevel));
}

function ParticipantStatusScreen({
  eyebrow,
  message,
  title
}: {
  readonly eyebrow: string;
  readonly message: string;
  readonly title: string;
}) {
  return (
    <main className="app-shell participant-shell">
      <section className="workspace-panel participant-status-panel" aria-labelledby="participant-title">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="participant-title">{title}</h1>
        <p className="panel-copy">{message}</p>
      </section>
    </main>
  );
}

function getInterviewMode(status: "survey_completed" | "interview_in_progress" | "interview_paused"): InterviewMode {
  if (status === "interview_in_progress") {
    return "active";
  }

  if (status === "interview_paused") {
    return "paused";
  }

  return "ready";
}

function getParticipantTerminalScreen(status: RunStatus) {
  if (status === "interview_completed" || status === "scored") {
    return {
      eyebrow: "Study complete",
      title: "Thank you",
      message: "Your participation for this run is complete. You may close this page."
    };
  }

  if (status === "stale") {
    return {
      eyebrow: "Run unavailable",
      title: "This run can no longer continue",
      message: "This participant run is no longer active. You may close this page."
    };
  }

  if (status === "technical_interruption") {
    return {
      eyebrow: "Unable to continue",
      title: "We could not continue this session",
      message: "Your responses submitted so far have been saved. You may close this page."
    };
  }

  if (status === "partial") {
    return {
      eyebrow: "Unable to continue",
      title: "This run cannot continue",
      message: "Your responses submitted so far have been saved. You may close this page."
    };
  }

  return undefined;
}

export function ParticipantSurveyScreen({
  isConfirmationOpen,
  isSubmittingSurvey,
  layoutItems,
  onCancelSubmit,
  onChangeResponse,
  onConfirmSubmit,
  onSubmit,
  surveyError,
  surveyResponses
}: {
  readonly isConfirmationOpen: boolean;
  readonly isSubmittingSurvey: boolean;
  readonly layoutItems: readonly SurveyLayoutItem[];
  readonly onCancelSubmit: () => void;
  readonly onChangeResponse: (questionId: string, value: string) => void;
  readonly onConfirmSubmit: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly surveyError: string;
  readonly surveyResponses: Record<string, string>;
}) {
  return (
    <main className="app-shell participant-shell">
      <section className="workspace-panel participant-survey-panel" aria-labelledby="participant-title">
        <p className="eyebrow">Participant survey</p>
        <h1 id="participant-title">Study survey</h1>
        <form className="participant-survey-form" onSubmit={onSubmit}>
          <div className="participant-survey-items">
            {layoutItems.map((item) =>
              item.type === "question" ? (
                <SurveyQuestionField
                  disabled={isSubmittingSurvey}
                  key={item.question.id}
                  question={item.question}
                  value={surveyResponses[item.question.id] ?? ""}
                  onChange={(value) => onChangeResponse(item.question.id, value)}
                />
              ) : (
                <fieldset className="participant-survey-group" key={item.group.id}>
                  <legend>{item.group.title}</legend>
                  {item.group.questions
                    .slice()
                    .sort((left, right) => left.sortOrder - right.sortOrder)
                    .map((question) => (
                      <SurveyQuestionField
                        disabled={isSubmittingSurvey}
                        key={question.id}
                        question={question}
                        value={surveyResponses[question.id] ?? ""}
                        onChange={(value) => onChangeResponse(question.id, value)}
                      />
                    ))}
                </fieldset>
              )
            )}
          </div>
          {surveyError ? <p className="form-error">{surveyError}</p> : null}
          <button className="primary-button" disabled={isSubmittingSurvey} type="submit">
            {isSubmittingSurvey ? "Submitting survey" : "Submit survey"}
          </button>
        </form>
      </section>
      {isConfirmationOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <div aria-labelledby="submit-survey-title" aria-modal="true" className="confirm-dialog" role="dialog">
            <h2 id="submit-survey-title">Continue to the interview?</h2>
            <p>
              Once you continue, your survey answers will be submitted and can no longer be edited. You will move on to the
              interview next.
            </p>
            <div className="form-actions">
              <button className="primary-button" disabled={isSubmittingSurvey} onClick={onConfirmSubmit} type="button">
                {isSubmittingSurvey ? "Submitting survey" : "Continue to interview"}
              </button>
              <button className="secondary-button" disabled={isSubmittingSurvey} onClick={onCancelSubmit} type="button">
                Keep editing
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SurveyQuestionField({
  disabled,
  onChange,
  question,
  value
}: {
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly question: SurveyQuestion;
  readonly value: string;
}) {
  return (
    <label className="participant-survey-question">
      <span>{question.prompt}</span>
      <textarea
        disabled={disabled}
        maxLength={20000}
        onChange={(event) => onChange(event.target.value)}
        required
        value={value}
      />
    </label>
  );
}

async function fetchParticipantAccess(accessToken: string) {
  const response = await fetch(`${serviceBaseUrl}/participant/runs/${accessToken}`);
  const payload = (await response.json()) as {
    run?: { id: string; status: RunStatus; freshnessDeadlineAt: string; maxInterviewMinutes: number };
    consentVersion?: ConsentVersion;
    surveyVersion?: SurveyVersion;
    message?: string;
  };

  if (!response.ok || !payload.run) {
    throw new Error(payload.message ?? "This participant link is not available.");
  }

  return {
    run: payload.run,
    consentVersion: payload.consentVersion,
    surveyVersion: payload.surveyVersion
  };
}

async function fetchRealtimeVoiceSession(accessToken: string) {
  const response = await fetch(`${serviceBaseUrl}/participant/runs/${accessToken}/interview/realtime-session`, {
    method: "POST"
  });
  const payload = (await response.json()) as {
    realtimeSession?: RealtimeVoiceSession;
    message?: string;
  };

  if (!response.ok || !payload.realtimeSession) {
    throw new Error(payload.message ?? "Unable to prepare the voice interview.");
  }

  return payload.realtimeSession;
}

async function reportAudioConnectionState(
  accessToken: string,
  serviceRequestId: string,
  audioConnectionState: Exclude<RealtimeConnectionState, "idle">,
  metadata: {
    readonly retryCount?: number;
    readonly latencyMs?: number;
    readonly technicalFailureCategory?: TechnicalFailureCategory;
  } = {}
) {
  await fetch(`${serviceBaseUrl}/participant/runs/${accessToken}/interview/connection-state`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      serviceRequestId,
      audioConnectionState,
      ...metadata
    })
  }).catch(() => undefined);
}

async function connectOpenAiRealtimeVoice(
  realtimeSession: RealtimeVoiceSession,
  onTranscriptTurn: (turn: PendingInterviewTurn) => void,
  onVoiceActivity: (activity: RealtimeVoiceActivity) => void,
  onAiQuestionTranscriptChange: (transcript: string) => void
) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not available in this browser.");
  }

  const peerConnection = new RTCPeerConnection();
  const remoteAudio = document.createElement("audio");
  remoteAudio.autoplay = true;
  remoteAudio.hidden = true;
  document.body.append(remoteAudio);
  peerConnection.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0] ?? null;
  };

  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of mediaStream.getAudioTracks()) {
    track.enabled = false;
    peerConnection.addTrack(track, mediaStream);
  }

  const dataChannel = peerConnection.createDataChannel("oai-events");
  let activeAiTranscriptItemId: string | undefined;
  let activeAiTranscript = "";
  dataChannel.addEventListener("open", () => {
    sendRealtimeEvent(dataChannel, { type: "response.create" });
  });
  dataChannel.addEventListener("message", (event) => {
    const realtimeEvent = parseRealtimeServerEvent(event.data);
    const activity = getRealtimeVoiceActivity(realtimeEvent);

    if (activity) {
      onVoiceActivity(activity);
    }

    const aiTranscriptUpdate = parseRealtimeAiTranscriptUpdate(realtimeEvent);

    if (aiTranscriptUpdate?.type === "started") {
      activeAiTranscriptItemId = undefined;
      activeAiTranscript = "";
      onAiQuestionTranscriptChange("");
    }

    if (aiTranscriptUpdate?.type === "delta") {
      if (aiTranscriptUpdate.itemId && aiTranscriptUpdate.itemId !== activeAiTranscriptItemId) {
        activeAiTranscriptItemId = aiTranscriptUpdate.itemId;
        activeAiTranscript = "";
      }

      activeAiTranscript = `${activeAiTranscript}${aiTranscriptUpdate.text}`;
      onAiQuestionTranscriptChange(activeAiTranscript.trimStart());
    }

    if (aiTranscriptUpdate?.type === "done") {
      activeAiTranscriptItemId = aiTranscriptUpdate.itemId;
      activeAiTranscript = aiTranscriptUpdate.text;
      onAiQuestionTranscriptChange(activeAiTranscript.trim());
    }

    const turn = parseRealtimeTranscriptTurn(realtimeEvent);

    if (turn) {
      onTranscriptTurn(turn);
    }
  });
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  if (!offer.sdp) {
    throw new Error("Unable to prepare the realtime voice connection.");
  }

  const sdpResponse = await fetch(realtimeSession.realtimeUrl, {
    method: "POST",
    body: offer.sdp,
    headers: {
      authorization: `Bearer ${realtimeSession.clientSecret}`,
      "content-type": "application/sdp"
    }
  });

  if (!sdpResponse.ok) {
    throw new Error("Unable to connect the voice interview.");
  }

  await peerConnection.setRemoteDescription({
    type: "answer",
    sdp: await sdpResponse.text()
  });

  return {
    peerConnection,
    dataChannel,
    mediaStream,
    remoteAudio
  };
}

function sendRealtimeEvent(dataChannel: RTCDataChannel, event: Record<string, unknown>) {
  if (dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify(event));
  }
}

function parseRealtimeServerEvent(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  let event: Record<string, unknown>;

  try {
    event = JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  return event;
}

export function parseRealtimeAiTranscriptUpdate(
  event: Record<string, unknown> | undefined
):
  | { readonly type: "started"; readonly itemId?: string }
  | { readonly type: "delta"; readonly itemId?: string; readonly text: string }
  | { readonly type: "done"; readonly itemId?: string; readonly text: string }
  | undefined {
  if (!event) {
    return undefined;
  }

  const itemId = typeof event.item_id === "string" ? event.item_id : undefined;

  if (event.type === "response.created") {
    return { type: "started", itemId };
  }

  if (event.type === "response.output_audio_transcript.delta" || event.type === "response.audio_transcript.delta") {
    const delta = typeof event.delta === "string" ? event.delta : "";

    return delta ? { type: "delta", itemId, text: delta } : undefined;
  }

  if (event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") {
    const text = getRealtimeTranscriptText(event);

    return text ? { type: "done", itemId, text } : undefined;
  }

  return undefined;
}

function parseRealtimeTranscriptTurn(event: Record<string, unknown> | undefined): PendingInterviewTurn | undefined {
  if (!event) {
    return undefined;
  }

  const transcript = getRealtimeTranscriptText(event);

  if (!transcript) {
    return undefined;
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    return {
      speaker: "participant",
      text: transcript
    };
  }

  if (event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") {
    return {
      speaker: "ai",
      text: transcript
    };
  }

  return undefined;
}

function getRealtimeTranscriptText(event: Record<string, unknown>) {
  const transcript = typeof event.transcript === "string" ? event.transcript : typeof event.text === "string" ? event.text : "";

  return transcript.trim();
}

function getRealtimeVoiceActivity(event: Record<string, unknown> | undefined): RealtimeVoiceActivity | undefined {
  if (!event) {
    return undefined;
  }

  if (event.type === "input_audio_buffer.speech_started") {
    return "participant_speaking";
  }

  if (event.type === "input_audio_buffer.speech_stopped") {
    return "idle";
  }

  if (event.type === "response.created" || event.type === "response.output_audio.delta") {
    return "ai_speaking";
  }

  if (
    event.type === "response.output_audio.done" ||
    event.type === "response.done" ||
    event.type === "response.cancelled" ||
    event.type === "error"
  ) {
    return "idle";
  }

  return undefined;
}

function categorizeTechnicalFailure(error: unknown): TechnicalFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("microphone") || message.includes("permission") || message.includes("getusermedia")) {
    return "microphone_unavailable";
  }

  if (message.includes("transcription") || message.includes("transcript")) {
    return "transcription_unavailable";
  }

  if (message.includes("disconnect") || message.includes("connection")) {
    return "disconnect";
  }

  if (message.includes("model") || message.includes("api")) {
    return "model_api_unavailable";
  }

  return "voice_provider_unavailable";
}

function getSurveyLayoutItems(surveyVersion: SurveyVersion): readonly SurveyLayoutItem[] {
  return (
    surveyVersion.layoutItems ??
    [
      ...surveyVersion.ungroupedQuestions.map((question) => ({
        type: "question" as const,
        sortOrder: question.sortOrder,
        question
      })),
      ...surveyVersion.groups.map((group) => ({
        type: "group" as const,
        sortOrder: group.sortOrder,
        group
      }))
    ].sort((left, right) => left.sortOrder - right.sortOrder)
  );
}

function getSurveyQuestions(surveyVersion: SurveyVersion) {
  return getSurveyLayoutItems(surveyVersion).flatMap((item) =>
    item.type === "question"
      ? [item.question]
      : item.group.questions.slice().sort((left, right) => left.sortOrder - right.sortOrder)
  );
}

function getParticipantAccessTokenFromPath() {
  const match = /^\/participant\/runs\/([^/]+)$/.exec(window.location.pathname);

  return match ? decodeURIComponent(match[1]!) : undefined;
}
