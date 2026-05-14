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

type ParticipantAccessState =
  | { readonly status: "demo" }
  | { readonly status: "checking" }
  | {
      readonly status: "ready";
      readonly run: {
        readonly id: string;
        readonly status: string;
        readonly freshnessDeadlineAt: string;
      };
      readonly consentVersion?: ConsentVersion;
      readonly surveyVersion?: SurveyVersion;
    }
  | { readonly status: "blocked"; readonly message: string };

export function Participant({ onNavigateToResearcherSignIn }: ParticipantProps) {
  const [accepted, setAccepted] = useState(false);
  const [signatureText, setSignatureText] = useState("");
  const [consentError, setConsentError] = useState("");
  const [isSubmittingConsent, setIsSubmittingConsent] = useState(false);
  const [surveyResponses, setSurveyResponses] = useState<Record<string, string>>({});
  const [surveyError, setSurveyError] = useState("");
  const [isSubmittingSurvey, setIsSubmittingSurvey] = useState(false);
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
        run?: { id: string; status: string; freshnessDeadlineAt: string };
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
        run?: { id: string; status: string; freshnessDeadlineAt: string };
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
      <main className="app-shell participant-shell">
        <section className="workspace-panel" aria-labelledby="participant-title">
          <p className="eyebrow">Participant access</p>
          <h1 id="participant-title">Checking link</h1>
          <p className="panel-copy">Please wait while we confirm this run is available.</p>
        </section>
      </main>
    );
  }

  if (accessState.status === "blocked") {
    return (
      <main className="app-shell participant-shell">
        <section className="workspace-panel" aria-labelledby="participant-title">
          <p className="eyebrow">Participant access</p>
          <h1 id="participant-title">This link is not available</h1>
          <p className="panel-copy">{accessState.message}</p>
        </section>
      </main>
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

    if (accessState.run.status === "survey_completed") {
      return (
        <main className="app-shell participant-shell">
          <section className="workspace-panel" aria-labelledby="participant-title">
            <p className="eyebrow">Participant survey</p>
            <h1 id="participant-title">Survey submitted</h1>
            <p className="panel-copy">Your study run is ready for the interview.</p>
          </section>
        </main>
      );
    }

    return (
      <main className="app-shell participant-shell">
        <section className="workspace-panel" aria-labelledby="participant-title">
          <p className="eyebrow">Participant access</p>
          <h1 id="participant-title">This step is not available</h1>
          <p className="panel-copy">This participant link cannot continue from the current run state.</p>
        </section>
      </main>
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
    run?: { id: string; status: string; freshnessDeadlineAt: string };
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
