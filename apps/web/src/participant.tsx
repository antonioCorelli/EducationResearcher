import { useEffect, useState, type FormEvent } from "react";

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

interface ParticipantProps {
  readonly onNavigateToResearcherSignIn: () => void;
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
  | { readonly status: "demo" }
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

export function Participant({ onNavigateToResearcherSignIn }: ParticipantProps) {
  const [accepted, setAccepted] = useState(false);
  const [signatureText, setSignatureText] = useState("");
  const [consentError, setConsentError] = useState("");
  const [isSubmittingConsent, setIsSubmittingConsent] = useState(false);
  const [surveyResponses, setSurveyResponses] = useState<Record<string, string>>({});
  const [surveyError, setSurveyError] = useState("");
  const [isSubmittingSurvey, setIsSubmittingSurvey] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [interviewError, setInterviewError] = useState("");
  const [isSubmittingInterviewAction, setIsSubmittingInterviewAction] = useState(false);
  const [simulatedAiQuestionIndex, setSimulatedAiQuestionIndex] = useState(0);
  const [accessState, setAccessState] = useState<ParticipantAccessState>(() => {
    const accessToken = getParticipantAccessTokenFromPath();

    return accessToken ? { status: "checking" } : { status: "demo" };
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
    }
  }, [accessState]);

  async function submitInterviewAction(action: "start" | "pause" | "resume" | "complete") {
    setInterviewError("");

    const accessToken = getParticipantAccessTokenFromPath();

    if (!accessToken || accessState.status !== "ready") {
      setInterviewError("This participant link is not available.");
      return;
    }

    setIsSubmittingInterviewAction(true);

    try {
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
        setSimulatedAiQuestionIndex(0);
      }
    } catch (error) {
      setInterviewError(error instanceof Error ? error.message : "Unable to update the interview.");
    } finally {
      setIsSubmittingInterviewAction(false);
    }
  }

  function toggleRecording() {
    setInterviewError("");
    setIsRecording((currentValue) => {
      if (currentValue) {
        setSimulatedAiQuestionIndex((currentIndex) =>
          Math.min(currentIndex + 1, simulatedAiQuestions.length - 1)
        );
      }

      return !currentValue;
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

  async function submitSurvey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSurveyError("");

    const accessToken = getParticipantAccessTokenFromPath();

    if (!accessToken || accessState.status !== "ready" || !accessState.surveyVersion) {
      setSurveyError("This participant link is not available.");
      return;
    }

    const questions = getSurveyQuestions(accessState.surveyVersion);
    const missingResponse = questions.find((question) => !surveyResponses[question.id]?.trim());

    if (missingResponse) {
      setSurveyError("Please answer every survey question before continuing.");
      return;
    }

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

      setAccessState({ status: "ready", run: payload.run });
    } catch (error) {
      setSurveyError(error instanceof Error ? error.message : "Unable to submit survey.");
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
      const layoutItems = getSurveyLayoutItems(accessState.surveyVersion);

      return (
        <main className="app-shell participant-shell">
          <section className="workspace-panel participant-survey-panel" aria-labelledby="participant-title">
            <p className="eyebrow">Participant survey</p>
            <h1 id="participant-title">Study survey</h1>
            <form className="participant-survey-form" onSubmit={submitSurvey}>
              <div className="participant-survey-items">
                {layoutItems.map((item) =>
                  item.type === "question" ? (
                    <SurveyQuestionField
                      disabled={isSubmittingSurvey}
                      key={item.question.id}
                      question={item.question}
                      value={surveyResponses[item.question.id] ?? ""}
                      onChange={(value) =>
                        setSurveyResponses((currentResponses) => ({
                          ...currentResponses,
                          [item.question.id]: value
                        }))
                      }
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
                            onChange={(value) =>
                              setSurveyResponses((currentResponses) => ({
                                ...currentResponses,
                                [question.id]: value
                              }))
                            }
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
        </main>
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
          aiQuestion={simulatedAiQuestions[simulatedAiQuestionIndex] ?? simulatedAiQuestions[0]}
          error={interviewError}
          isActionPending={isSubmittingInterviewAction}
          isRecording={isRecording}
          maxInterviewMinutes={accessState.run.maxInterviewMinutes}
          mode={interviewMode}
          onComplete={() => void submitInterviewAction("complete")}
          onPause={() => void submitInterviewAction("pause")}
          onRecordToggle={toggleRecording}
          onResume={() => void submitInterviewAction("resume")}
          onStart={() => void submitInterviewAction("start")}
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
    <main className="app-shell participant-shell">
      <section className="workspace-panel" aria-labelledby="participant-title">
        <p className="eyebrow">Participant access</p>
        <h1 id="participant-title">Participant demo route</h1>
        <p className="panel-copy">This route is intentionally public and does not require researcher sign-in.</p>
        <button className="secondary-button" type="button" onClick={onNavigateToResearcherSignIn}>
          Researcher sign-in
        </button>
      </section>
    </main>
  );
}

export function ParticipantInterviewScreen({
  aiQuestion,
  error,
  isActionPending,
  isRecording,
  maxInterviewMinutes,
  mode,
  onComplete,
  onPause,
  onRecordToggle,
  onResume,
  onStart
}: {
  readonly aiQuestion: string;
  readonly error: string;
  readonly isActionPending: boolean;
  readonly isRecording: boolean;
  readonly maxInterviewMinutes: number;
  readonly mode: InterviewMode;
  readonly onComplete: () => void;
  readonly onPause: () => void;
  readonly onRecordToggle: () => void;
  readonly onResume: () => void;
  readonly onStart: () => void;
}) {
  const isActive = mode === "active";
  const participantVoiceState = isRecording ? "Recording" : isActive ? "Ready" : "Paused";

  return (
    <main className="app-shell participant-shell participant-interview-shell">
      <section className="participant-interview-surface" aria-labelledby="participant-title">
        <div className="participant-interview-topline">
          <p className="eyebrow">Voice interview</p>
          <span>{maxInterviewMinutes} min max</span>
        </div>
        <div className="ai-caption-panel" aria-live="polite">
          <h1 id="participant-title">{mode === "paused" ? "Interview paused" : "Interview"}</h1>
          <p>{mode === "paused" ? "When you are ready, we can continue with the next question." : aiQuestion}</p>
        </div>

        <div className="voice-wave-grid" aria-hidden="true">
          <VoiceWave isActive={isActive && !isRecording} label="AI" />
          <VoiceWave isActive={isRecording} label="You" />
        </div>

        <div className="participant-voice-state" aria-live="polite">
          <span className={isRecording ? "voice-state-dot active-voice-state-dot" : "voice-state-dot"} />
          <span>Voice input {participantVoiceState.toLowerCase()}</span>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="participant-interview-controls">
          {mode === "ready" ? (
            <button className="primary-button record-control-button" disabled={isActionPending} onClick={onStart} type="button">
              {isActionPending ? "Starting" : "Start interview"}
            </button>
          ) : null}
          {mode === "paused" ? (
            <button className="primary-button record-control-button" disabled={isActionPending} onClick={onResume} type="button">
              {isActionPending ? "Resuming" : "Resume interview"}
            </button>
          ) : null}
          {isActive ? (
            <>
              <button
                className={isRecording ? "danger-button record-control-button" : "primary-button record-control-button"}
                disabled={isActionPending}
                onClick={onRecordToggle}
                type="button"
              >
                {isRecording ? "Stop recording" : "Record"}
              </button>
              <button className="secondary-button" disabled={isActionPending || isRecording} onClick={onPause} type="button">
                Pause
              </button>
              <button className="secondary-button" disabled={isActionPending || isRecording} onClick={onComplete} type="button">
                Complete
              </button>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function VoiceWave({ isActive, label }: { readonly isActive: boolean; readonly label: string }) {
  return (
    <div className={isActive ? "voice-wave active-voice-wave" : "voice-wave"} title={`${label} voice wave`}>
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
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

const simulatedAiQuestions = [
  "To begin, tell me more about the main idea from your survey response.",
  "Thank you. Could you share a concrete example that helps explain that?",
  "What felt uncertain or worth thinking about more?"
] as const;

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
