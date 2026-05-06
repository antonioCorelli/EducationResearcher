import { FormEvent, useEffect, useState } from "react";

const serviceBaseUrl = import.meta.env.VITE_SERVICE_BASE_URL ?? "http://localhost:4000";
const accessTokenStorageKey = "educationResearcher.accessToken";

interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: "researcher";
}

interface AuthTokens {
  readonly accessToken: string;
  readonly idToken: string;
  readonly refreshToken?: string;
  readonly expiresIn: number;
  readonly tokenType: string;
}

interface StudyShell {
  readonly id: string;
  readonly title: string;
  readonly defaultFreshnessDays: number;
  readonly defaultMaxInterviewMinutes: number;
  readonly activeConsentVersionId?: string;
  readonly activeSurveyVersionId?: string;
  readonly activePersonaVersionId: string;
  readonly persona: {
    readonly label: string;
    readonly stylePrompt: string;
    readonly locked: true;
  };
}

type ConsentMethod = "checkmark" | "electronic_signature";

interface ConsentVersion {
  readonly id: string;
  readonly studyId: string;
  readonly versionNumber: number;
  readonly consentText: string;
  readonly consentMethod: ConsentMethod;
  readonly isActive: boolean;
  readonly createdAt: string;
}

interface SurveyQuestion {
  readonly id: string;
  readonly surveyVersionId: string;
  readonly surveyGroupId?: string;
  readonly prompt: string;
  readonly required: true;
  readonly questionType: "long_text";
  readonly sortOrder: number;
  readonly createdAt: string;
}

interface SurveyGroup {
  readonly id: string;
  readonly surveyVersionId: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly questions: readonly SurveyQuestion[];
  readonly createdAt: string;
}

interface SurveyVersion {
  readonly id: string;
  readonly studyId: string;
  readonly versionNumber: number;
  readonly isActive: boolean;
  readonly layoutItems?: readonly SurveyLayoutItem[];
  readonly groups: readonly SurveyGroup[];
  readonly ungroupedQuestions: readonly SurveyQuestion[];
  readonly createdAt: string;
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

type SessionState =
  | { readonly status: "checking" }
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly user: SessionUser };

type StudiesState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly studies: StudyShell[] }
  | { readonly status: "error"; readonly message: string };

type ConsentState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly activeConsentVersion?: ConsentVersion; readonly consentVersions: ConsentVersion[] }
  | { readonly status: "error"; readonly message: string };

type SurveyState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly activeSurveyVersion?: SurveyVersion; readonly surveyVersions: SurveyVersion[] }
  | { readonly status: "error"; readonly message: string };

type SurveyDraftItem =
  | {
      readonly type: "question";
      readonly prompt: string;
    }
  | {
      readonly type: "group";
      readonly title: string;
      readonly questions: readonly string[];
    };

function getCurrentPath() {
  return window.location.pathname;
}

async function fetchSession(accessToken: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/session`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Session is not valid.");
  }

  return (await response.json()) as { user: SessionUser };
}

async function fetchStudies(accessToken: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load studies.");
  }

  return (await response.json()) as { studies: StudyShell[] };
}

async function fetchConsent(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/consent`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load consent.");
  }

  return (await response.json()) as {
    activeConsentVersion?: ConsentVersion;
    consentVersions: ConsentVersion[];
  };
}

async function fetchSurvey(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/survey`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load survey.");
  }

  return (await response.json()) as {
    activeSurveyVersion?: SurveyVersion;
    surveyVersions: SurveyVersion[];
  };
}

export function App() {
  const [path, setPath] = useState(getCurrentPath);
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem(accessTokenStorageKey));
  const [studiesState, setStudiesState] = useState<StudiesState>({ status: "idle" });
  const [consentState, setConsentState] = useState<ConsentState>({ status: "idle" });
  const [surveyState, setSurveyState] = useState<SurveyState>({ status: "idle" });
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [studyTitle, setStudyTitle] = useState("");
  const [freshnessDays, setFreshnessDays] = useState(14);
  const [maxInterviewMinutes, setMaxInterviewMinutes] = useState(45);
  const [studyError, setStudyError] = useState("");
  const [isSavingStudy, setIsSavingStudy] = useState(false);
  const [consentText, setConsentText] = useState("");
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>("checkmark");
  const [consentError, setConsentError] = useState("");
  const [isSavingConsent, setIsSavingConsent] = useState(false);
  const [selectedConsentVersionNumber, setSelectedConsentVersionNumber] = useState<number | null>(null);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [surveyItems, setSurveyItems] = useState<readonly SurveyDraftItem[]>([{ type: "question", prompt: "" }]);
  const [surveyError, setSurveyError] = useState("");
  const [isSavingSurvey, setIsSavingSurvey] = useState(false);

  const isParticipantRoute = path.startsWith("/participant");

  useEffect(() => {
    if (isParticipantRoute) {
      setSession({ status: "signed-out" });
      return;
    }

    if (!accessToken) {
      setSession({ status: "signed-out" });
      return;
    }

    fetchSession(accessToken)
      .then(({ user }) => setSession({ status: "signed-in", user }))
      .catch(() => {
        localStorage.removeItem(accessTokenStorageKey);
        setAccessToken(null);
        setSession({ status: "signed-out" });
      });
  }, [accessToken, isParticipantRoute]);

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken) {
      setStudiesState({ status: "idle" });
      return;
    }

    setStudiesState({ status: "loading" });
    fetchStudies(accessToken)
      .then(({ studies }) => {
        setStudiesState({ status: "ready", studies });
        const selectedStudy = studies.find((study) => study.id === selectedStudyId) ?? studies[0];

        if (selectedStudy) {
          loadStudyForm(selectedStudy);
        }
      })
      .catch(() => setStudiesState({ status: "error", message: "Unable to load studies." }));
  }, [accessToken, session.status]);

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken || !selectedStudyId) {
      setConsentState({ status: "idle" });
      return;
    }

    setConsentState({ status: "loading" });
    fetchConsent(accessToken, selectedStudyId)
      .then((consent) => {
        setConsentState({ status: "ready", ...consent });
        loadConsentForm(consent.activeConsentVersion);
      })
      .catch(() => setConsentState({ status: "error", message: "Unable to load consent." }));
  }, [accessToken, selectedStudyId, session.status]);

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken || !selectedStudyId) {
      setSurveyState({ status: "idle" });
      return;
    }

    setSurveyState({ status: "loading" });
    fetchSurvey(accessToken, selectedStudyId)
      .then((survey) => {
        setSurveyState({ status: "ready", ...survey });
        loadSurveyForm(survey.activeSurveyVersion);
      })
      .catch(() => setSurveyState({ status: "error", message: "Unable to load survey." }));
  }, [accessToken, selectedStudyId, session.status]);

  function navigate(nextPath: string) {
    window.history.pushState(null, "", nextPath);
    setPath(nextPath);
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/auth/sign-in`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      });

      if (!response.ok) {
        throw new Error("Email or password is incorrect.");
      }

      const { tokens } = (await response.json()) as { tokens: AuthTokens };
      localStorage.setItem(accessTokenStorageKey, tokens.accessToken);
      setAccessToken(tokens.accessToken);
      const { user } = await fetchSession(tokens.accessToken);
      setSession({ status: "signed-in", user });
      setPassword("");
      navigate("/researcher");
    } catch {
      setAuthError("Email or password is incorrect.");
      setSession({ status: "signed-out" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    const accessToken = localStorage.getItem(accessTokenStorageKey);

    if (accessToken) {
      await fetch(`${serviceBaseUrl}/auth/sign-out`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      }).catch(() => undefined);
    }

    localStorage.removeItem(accessTokenStorageKey);
    setAccessToken(null);
    setSession({ status: "signed-out" });
    setSelectedStudyId(null);
    resetStudyForm();
    navigate("/");
  }

  function resetStudyForm() {
    setSelectedStudyId(null);
    setStudyTitle("");
    setFreshnessDays(14);
    setMaxInterviewMinutes(45);
    setStudyError("");
    setConsentText("");
    setConsentMethod("checkmark");
    setConsentError("");
    setConsentState({ status: "idle" });
    setSelectedConsentVersionNumber(null);
    setIsRestoreDialogOpen(false);
    setSurveyState({ status: "idle" });
    setSurveyItems([{ type: "question", prompt: "" }]);
    setSurveyError("");
  }

  function loadStudyForm(study: StudyShell) {
    setSelectedStudyId(study.id);
    setStudyTitle(study.title);
    setFreshnessDays(study.defaultFreshnessDays);
    setMaxInterviewMinutes(study.defaultMaxInterviewMinutes);
    setStudyError("");
  }

  function loadConsentForm(consentVersion: ConsentVersion | undefined) {
    setConsentText(consentVersion?.consentText ?? "");
    setConsentMethod(consentVersion?.consentMethod ?? "checkmark");
    setConsentError("");
    setSelectedConsentVersionNumber(consentVersion?.versionNumber ?? null);
    setIsRestoreDialogOpen(false);
  }

  function loadSurveyForm(surveyVersion: SurveyVersion | undefined) {
    const layoutItems =
      surveyVersion?.layoutItems ??
      [
        ...(surveyVersion?.ungroupedQuestions.map(
          (question): SurveyLayoutItem => ({
            type: "question",
            sortOrder: question.sortOrder,
            question
          })
        ) ?? []),
        ...(surveyVersion?.groups.map(
          (group): SurveyLayoutItem => ({
            type: "group",
            sortOrder: group.sortOrder,
            group
          })
        ) ?? [])
      ].sort((left, right) => left.sortOrder - right.sortOrder);

    setSurveyItems(
      layoutItems.length > 0
        ? layoutItems.map((item): SurveyDraftItem =>
            item.type === "question"
              ? {
                  type: "question",
                  prompt: item.question.prompt
                }
              : {
                  type: "group",
                  title: item.group.title,
                  questions:
                    item.group.questions.length > 0 ? item.group.questions.map((question) => question.prompt) : [""]
                }
          )
        : [{ type: "question", prompt: "" }]
    );
    setSurveyError("");
  }

  async function reloadStudies(token: string, nextSelectedStudyId: string) {
    const { studies } = await fetchStudies(token);
    setStudiesState({ status: "ready", studies });
    const selectedStudy = studies.find((study) => study.id === nextSelectedStudyId);

    if (selectedStudy) {
      loadStudyForm(selectedStudy);
    }
  }

  async function handleSaveStudy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStudyError("");

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token) {
      setStudyError("Researcher sign-in is required.");
      return;
    }

    setIsSavingStudy(true);

    try {
      const response = await fetch(
        selectedStudyId ? `${serviceBaseUrl}/researcher/studies/${selectedStudyId}` : `${serviceBaseUrl}/researcher/studies`,
        {
          method: selectedStudyId ? "PATCH" : "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            title: studyTitle,
            defaultFreshnessDays: freshnessDays,
            defaultMaxInterviewMinutes: maxInterviewMinutes
          })
        }
      );
      const payload = (await response.json()) as { study?: StudyShell; message?: string };

      if (!response.ok || !payload.study) {
        throw new Error(payload.message ?? "Unable to save study.");
      }

      await reloadStudies(token, payload.study.id);
    } catch (error) {
      setStudyError(error instanceof Error ? error.message : "Unable to save study.");
    } finally {
      setIsSavingStudy(false);
    }
  }

  async function handleSaveConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConsentError("");

    const selectedConsentVersion =
      consentState.status === "ready"
        ? consentState.consentVersions.find((version) => version.versionNumber === selectedConsentVersionNumber)
        : undefined;

    if (selectedConsentVersion && !selectedConsentVersion.isActive) {
      setIsRestoreDialogOpen(true);
      return;
    }

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setConsentError("Select a study before configuring consent.");
      return;
    }

    setIsSavingConsent(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/consent`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          consentText,
          consentMethod
        })
      });
      const payload = (await response.json()) as { consentVersion?: ConsentVersion; message?: string };

      if (!response.ok || !payload.consentVersion) {
        throw new Error(payload.message ?? "Unable to save consent.");
      }

      const consent = await fetchConsent(token, selectedStudyId);
      setConsentState({ status: "ready", ...consent });
      loadConsentForm(consent.activeConsentVersion);
      await reloadStudies(token, selectedStudyId);
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : "Unable to save consent.");
    } finally {
      setIsSavingConsent(false);
    }
  }

  function addSurveyQuestion() {
    setSurveyItems((items) => [...items, { type: "question", prompt: "" }]);
  }

  function addSurveyGroup() {
    setSurveyItems((items) => [...items, { type: "group", title: "", questions: [""] }]);
  }

  function moveSurveyItem(index: number, direction: -1 | 1) {
    setSurveyItems((items) => {
      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex >= items.length) {
        return items;
      }

      const nextItems = [...items];
      [nextItems[index], nextItems[nextIndex]] = [nextItems[nextIndex], nextItems[index]];
      return nextItems;
    });
  }

  function updateSurveyQuestion(index: number, value: string) {
    setSurveyItems((items) =>
      items.map((item, itemIndex) => (itemIndex === index && item.type === "question" ? { ...item, prompt: value } : item))
    );
  }

  function removeSurveyItem(index: number) {
    setSurveyItems((items) => {
      const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
      return nextItems.length > 0 ? nextItems : [{ type: "question", prompt: "" }];
    });
  }

  function updateSurveyGroupTitle(index: number, title: string) {
    setSurveyItems((items) =>
      items.map((item, itemIndex) => (itemIndex === index && item.type === "group" ? { ...item, title } : item))
    );
  }

  function updateGroupedQuestion(itemIndex: number, questionIndex: number, prompt: string) {
    setSurveyItems((items) =>
      items.map((item, currentItemIndex) =>
        currentItemIndex === itemIndex && item.type === "group"
          ? {
              ...item,
              questions: item.questions.map((question, currentQuestionIndex) =>
                currentQuestionIndex === questionIndex ? prompt : question
              )
            }
          : item
      )
    );
  }

  function addGroupedQuestion(itemIndex: number) {
    setSurveyItems((items) =>
      items.map((item, currentItemIndex) =>
        currentItemIndex === itemIndex && item.type === "group"
          ? { ...item, questions: [...item.questions, ""] }
          : item
      )
    );
  }

  function removeGroupedQuestion(itemIndex: number, questionIndex: number) {
    setSurveyItems((items) =>
      items.map((item, currentItemIndex) => {
        if (currentItemIndex !== itemIndex || item.type !== "group") {
          return item;
        }

        const nextQuestions = item.questions.filter((_, currentQuestionIndex) => currentQuestionIndex !== questionIndex);

        return {
          ...item,
          questions: nextQuestions.length > 0 ? nextQuestions : [""]
        };
      })
    );
  }

  async function handleSaveSurvey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSurveyError("");

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setSurveyError("Select a study before configuring the survey.");
      return;
    }

    setIsSavingSurvey(true);

    try {
      const items = surveyItems
        .map((item) =>
          item.type === "question"
            ? ({
                type: "question",
                question: {
                  prompt: item.prompt.trim()
                }
              } as const)
            : ({
                type: "group",
                group: {
                  title: item.title.trim(),
                  questions: item.questions
                    .map((prompt) => prompt.trim())
                    .filter(Boolean)
                    .map((prompt) => ({ prompt }))
                }
              } as const)
        )
        .filter((item) =>
          item.type === "question" ? item.question.prompt : item.group.title || item.group.questions.length > 0
        );
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/survey`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          items
        })
      });
      const payload = (await response.json()) as { surveyVersion?: SurveyVersion; message?: string };

      if (!response.ok || !payload.surveyVersion) {
        throw new Error(payload.message ?? "Unable to save survey.");
      }

      const survey = await fetchSurvey(token, selectedStudyId);
      setSurveyState({ status: "ready", ...survey });
      loadSurveyForm(survey.activeSurveyVersion);
      await reloadStudies(token, selectedStudyId);
    } catch (error) {
      setSurveyError(error instanceof Error ? error.message : "Unable to save survey.");
    } finally {
      setIsSavingSurvey(false);
    }
  }

  function handleSelectConsentVersion(consentVersion: ConsentVersion) {
    setSelectedConsentVersionNumber(consentVersion.versionNumber);
    setConsentText(consentVersion.consentText);
    setConsentMethod(consentVersion.consentMethod);
    setConsentError("");
    setIsRestoreDialogOpen(false);
  }

  async function handleConfirmRestoreConsent() {
    setConsentError("");

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId || selectedConsentVersionNumber === null) {
      setConsentError("Select a previous consent version before restoring.");
      setIsRestoreDialogOpen(false);
      return;
    }

    setIsSavingConsent(true);

    try {
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/consent/restore`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          versionNumber: selectedConsentVersionNumber
        })
      });
      const payload = (await response.json()) as { consentVersion?: ConsentVersion; message?: string };

      if (!response.ok || !payload.consentVersion) {
        throw new Error(payload.message ?? "Unable to restore consent.");
      }

      const consent = await fetchConsent(token, selectedStudyId);
      setConsentState({ status: "ready", ...consent });
      loadConsentForm(consent.activeConsentVersion);
      await reloadStudies(token, selectedStudyId);
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : "Unable to restore consent.");
    } finally {
      setIsSavingConsent(false);
      setIsRestoreDialogOpen(false);
    }
  }

  if (isParticipantRoute) {
    return (
      <main className="app-shell participant-shell">
        <section className="workspace-panel" aria-labelledby="participant-title">
          <p className="eyebrow">Participant access</p>
          <h1 id="participant-title">Participant demo route</h1>
          <p className="panel-copy">This route is intentionally public and does not require researcher sign-in.</p>
          <button className="secondary-button" type="button" onClick={() => navigate("/")}>
            Researcher sign-in
          </button>
        </section>
      </main>
    );
  }

  if (session.status === "checking") {
    return (
      <main className="app-shell">
        <section className="workspace-panel compact-panel" aria-live="polite">
          <p className="eyebrow">EducationResearcher</p>
          <h1>Checking session</h1>
        </section>
      </main>
    );
  }

  if (session.status === "signed-in") {
    const studies = studiesState.status === "ready" ? studiesState.studies : [];
    const selectedStudy = studies.find((study) => study.id === selectedStudyId);
    const selectedConsentVersion =
      consentState.status === "ready"
        ? consentState.consentVersions.find((version) => version.versionNumber === selectedConsentVersionNumber)
        : undefined;
    const isPreviewingPreviousConsent = Boolean(selectedConsentVersion && !selectedConsentVersion.isActive);
    const activeSurveyVersion = surveyState.status === "ready" ? surveyState.activeSurveyVersion : undefined;

    return (
      <main className="app-shell researcher-shell">
        <section className="workspace-panel researcher-workspace" aria-labelledby="researcher-title">
          <div className="topline">
            <p className="eyebrow">Researcher workspace</p>
            <button className="secondary-button" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
          <h1 id="researcher-title">Welcome, {session.user.displayName}</h1>
          <div className="study-workspace">
            <div className="study-list-panel">
              <div className="section-heading">
                <h2>Studies</h2>
                <button className="secondary-button compact-button" type="button" onClick={resetStudyForm}>
                  New
                </button>
              </div>
              {studiesState.status === "loading" ? <p className="muted-copy">Loading studies</p> : null}
              {studiesState.status === "error" ? <p className="form-error">{studiesState.message}</p> : null}
              {studies.length === 0 && studiesState.status === "ready" ? <p className="muted-copy">No studies yet</p> : null}
              <div className="study-list" aria-label="Studies">
                {studies.map((study) => (
                  <button
                    className={study.id === selectedStudyId ? "study-row selected-study-row" : "study-row"}
                    key={study.id}
                    type="button"
                    onClick={() => loadStudyForm(study)}
                  >
                    <span>{study.title}</span>
                    <small>
                      {study.defaultFreshnessDays} days - {study.defaultMaxInterviewMinutes} min
                    </small>
                  </button>
                ))}
              </div>
            </div>
            <div className="setup-stack">
              <form className="study-form" onSubmit={handleSaveStudy}>
                <div className="section-heading">
                  <h2>{selectedStudy ? "Edit study shell" : "Create study shell"}</h2>
                </div>
                <label>
                  Study title
                  <input
                    maxLength={160}
                    name="study-title"
                    onChange={(event) => setStudyTitle(event.target.value)}
                    required
                    type="text"
                    value={studyTitle}
                  />
                </label>
                <div className="settings-grid">
                  <label>
                    Freshness days
                    <input
                      max={365}
                      min={1}
                      name="freshness-days"
                      onChange={(event) => setFreshnessDays(event.target.valueAsNumber)}
                      required
                      type="number"
                      value={freshnessDays}
                    />
                  </label>
                  <label>
                    Interview cap minutes
                    <input
                      max={180}
                      min={1}
                      name="max-interview-minutes"
                      onChange={(event) => setMaxInterviewMinutes(event.target.valueAsNumber)}
                      required
                      type="number"
                      value={maxInterviewMinutes}
                    />
                  </label>
                </div>
                <label>
                  Interviewer persona
                  <textarea readOnly value={selectedStudy?.persona.stylePrompt ?? "Ask calm, neutral, one-at-a-time follow-up questions."} />
                </label>
                <div className="locked-row">
                  <span>{selectedStudy?.persona.label ?? "V1 default research interviewer"}</span>
                  <strong>Locked</strong>
                </div>
                {studyError ? <p className="form-error">{studyError}</p> : null}
                <div className="form-actions">
                  <button className="primary-button" disabled={isSavingStudy} type="submit">
                    {isSavingStudy ? "Saving" : selectedStudy ? "Save changes" : "Create study"}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => navigate("/participant/demo")}>
                    Participant demo
                  </button>
                </div>
              </form>
              <form className="study-form consent-form" onSubmit={handleSaveConsent}>
                <div className="section-heading">
                  <h2>Consent</h2>
                  {selectedConsentVersion ? (
                    <span className={isPreviewingPreviousConsent ? "version-pill preview-version-pill" : "version-pill"}>
                      Version {selectedConsentVersion.versionNumber}
                    </span>
                  ) : null}
                </div>
                <p className="muted-copy">
                  Capture the text and acceptance method shown to participants. Confirm legal or institutional requirements outside this tool.
                </p>
                <fieldset className="method-fieldset" disabled={!selectedStudy}>
                  <legend>Consent method</legend>
                  <label className="radio-option">
                    <input
                      checked={consentMethod === "checkmark"}
                      disabled={isPreviewingPreviousConsent}
                      name="consent-method"
                      onChange={() => setConsentMethod("checkmark")}
                      type="radio"
                      value="checkmark"
                    />
                    Checkmark
                  </label>
                  <label className="radio-option">
                    <input
                      checked={consentMethod === "electronic_signature"}
                      disabled={isPreviewingPreviousConsent}
                      name="consent-method"
                      onChange={() => setConsentMethod("electronic_signature")}
                      type="radio"
                      value="electronic_signature"
                    />
                    Electronic signature
                  </label>
                </fieldset>
                <label>
                  Consent text
                  <textarea
                    disabled={!selectedStudy || isPreviewingPreviousConsent}
                    maxLength={12000}
                    name="consent-text"
                    onChange={(event) => setConsentText(event.target.value)}
                    placeholder={selectedStudy ? "Enter participant-facing consent text" : "Create or select a study first"}
                    required={Boolean(selectedStudy)}
                    value={consentText}
                  />
                </label>
                {consentState.status === "loading" ? <p className="muted-copy">Loading consent</p> : null}
                {consentState.status === "error" ? <p className="form-error">{consentState.message}</p> : null}
                {consentState.status === "ready" && consentState.consentVersions.length > 0 ? (
                  <div className="version-history" aria-label="Consent versions">
                    {consentState.consentVersions.map((version) => (
                      <button
                        className={[
                          "version-chip",
                          version.isActive ? "active-version-chip" : "",
                          version.versionNumber === selectedConsentVersionNumber ? "selected-version-chip" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={version.id}
                        onClick={() => handleSelectConsentVersion(version)}
                        type="button"
                      >
                        v{version.versionNumber}
                      </button>
                    ))}
                  </div>
                ) : null}
                {consentError ? <p className="form-error">{consentError}</p> : null}
                <div className="form-actions">
                  <button
                    className={isPreviewingPreviousConsent ? "danger-button" : "primary-button"}
                    disabled={!selectedStudy || isSavingConsent}
                    type="submit"
                  >
                    {isSavingConsent
                      ? isPreviewingPreviousConsent
                        ? "Restoring version"
                        : "Saving consent"
                      : isPreviewingPreviousConsent
                        ? "Restore Version"
                        : consentState.status === "ready" && consentState.activeConsentVersion
                          ? "Create new version"
                          : "Save consent"}
                  </button>
                </div>
              </form>
              <form className="study-form survey-form" onSubmit={handleSaveSurvey}>
                <div className="section-heading">
                  <h2>Survey</h2>
                  {activeSurveyVersion ? <span className="version-pill">Version {activeSurveyVersion.versionNumber}</span> : null}
                </div>
                <p className="muted-copy">
                  Configure required long-form prompts. Standalone questions and titled groups can be ordered together.
                </p>
                <div className="survey-item-list">
                  {surveyItems.map((item, itemIndex) =>
                    item.type === "question" ? (
                      <div className="survey-item-editor" key={`survey-question-${itemIndex}`}>
                        <div className="survey-item-toolbar">
                          <h3>Question {itemIndex + 1}</h3>
                          <div className="survey-item-actions">
                            <button
                              aria-label={`Move question ${itemIndex + 1} up`}
                              className="secondary-button compact-button"
                              disabled={!selectedStudy || itemIndex === 0}
                              onClick={() => moveSurveyItem(itemIndex, -1)}
                              type="button"
                            >
                              Up
                            </button>
                            <button
                              aria-label={`Move question ${itemIndex + 1} down`}
                              className="secondary-button compact-button"
                              disabled={!selectedStudy || itemIndex === surveyItems.length - 1}
                              onClick={() => moveSurveyItem(itemIndex, 1)}
                              type="button"
                            >
                              Down
                            </button>
                            <button
                              aria-label={`Remove question ${itemIndex + 1}`}
                              className="secondary-button compact-button"
                              disabled={!selectedStudy || surveyItems.length === 1}
                              onClick={() => removeSurveyItem(itemIndex)}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        <label>
                          Prompt
                          <textarea
                            disabled={!selectedStudy}
                            maxLength={1000}
                            onChange={(event) => updateSurveyQuestion(itemIndex, event.target.value)}
                            placeholder={selectedStudy ? "Ask for a sentence-to-paragraph response" : "Create or select a study first"}
                            value={item.prompt}
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="survey-item-editor survey-group-editor" key={`survey-group-${itemIndex}`}>
                        <div className="survey-item-toolbar">
                          <h3>Group {itemIndex + 1}</h3>
                          <div className="survey-item-actions">
                            <button
                              aria-label={`Move group ${itemIndex + 1} up`}
                              className="secondary-button compact-button"
                              disabled={!selectedStudy || itemIndex === 0}
                              onClick={() => moveSurveyItem(itemIndex, -1)}
                              type="button"
                            >
                              Up
                            </button>
                            <button
                              aria-label={`Move group ${itemIndex + 1} down`}
                              className="secondary-button compact-button"
                              disabled={!selectedStudy || itemIndex === surveyItems.length - 1}
                              onClick={() => moveSurveyItem(itemIndex, 1)}
                              type="button"
                            >
                              Down
                            </button>
                            <button
                              aria-label={`Remove group ${itemIndex + 1}`}
                              className="secondary-button compact-button"
                              disabled={!selectedStudy}
                              onClick={() => removeSurveyItem(itemIndex)}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        <label>
                          Group title
                          <input
                            disabled={!selectedStudy}
                            maxLength={120}
                            onChange={(event) => updateSurveyGroupTitle(itemIndex, event.target.value)}
                            placeholder="Visible group title"
                            type="text"
                            value={item.title}
                          />
                        </label>
                        {item.questions.map((prompt, questionIndex) => (
                          <div className="question-row" key={`group-${itemIndex}-question-${questionIndex}`}>
                            <label>
                              Group question {questionIndex + 1}
                              <textarea
                                disabled={!selectedStudy}
                                maxLength={1000}
                                onChange={(event) => updateGroupedQuestion(itemIndex, questionIndex, event.target.value)}
                                placeholder="Ask for a long-form response"
                                value={prompt}
                              />
                            </label>
                            <button
                              aria-label={`Remove group ${itemIndex + 1} question ${questionIndex + 1}`}
                              className="secondary-button compact-button"
                              disabled={!selectedStudy || item.questions.length === 1}
                              onClick={() => removeGroupedQuestion(itemIndex, questionIndex)}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button
                          className="secondary-button compact-button"
                          disabled={!selectedStudy}
                          onClick={() => addGroupedQuestion(itemIndex)}
                          type="button"
                        >
                          Add group question
                        </button>
                      </div>
                    )
                  )}
                </div>
                <div className="survey-add-row">
                  <button className="secondary-button compact-button" disabled={!selectedStudy} onClick={addSurveyQuestion} type="button">
                    Add question
                  </button>
                  <button className="secondary-button compact-button" disabled={!selectedStudy} onClick={addSurveyGroup} type="button">
                    Add group
                  </button>
                </div>
                {surveyState.status === "loading" ? <p className="muted-copy">Loading survey</p> : null}
                {surveyState.status === "error" ? <p className="form-error">{surveyState.message}</p> : null}
                {surveyState.status === "ready" && surveyState.surveyVersions.length > 0 ? (
                  <div className="version-history" aria-label="Survey versions">
                    {surveyState.surveyVersions.map((version) => (
                      <span className={version.isActive ? "version-chip active-version-chip" : "version-chip"} key={version.id}>
                        v{version.versionNumber}
                      </span>
                    ))}
                  </div>
                ) : null}
                {surveyError ? <p className="form-error">{surveyError}</p> : null}
                <div className="form-actions">
                  <button className="primary-button" disabled={!selectedStudy || isSavingSurvey} type="submit">
                    {isSavingSurvey
                      ? "Saving survey"
                      : surveyState.status === "ready" && surveyState.activeSurveyVersion
                        ? "Create new version"
                        : "Save survey"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </section>
        {isRestoreDialogOpen && selectedConsentVersion ? (
          <div className="dialog-backdrop" role="presentation">
            <div aria-labelledby="restore-consent-title" aria-modal="true" className="confirm-dialog" role="dialog">
              <h2 id="restore-consent-title">Restore consent version {selectedConsentVersion.versionNumber}?</h2>
              <p>
                You cannot undo this action. Versions after version {selectedConsentVersion.versionNumber} will be removed, and this version will become current.
              </p>
              <div className="form-actions">
                <button className="danger-button" disabled={isSavingConsent} onClick={handleConfirmRestoreConsent} type="button">
                  Restore Version
                </button>
                <button className="secondary-button" disabled={isSavingConsent} onClick={() => setIsRestoreDialogOpen(false)} type="button">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="auth-layout" aria-labelledby="signin-title">
        <div className="auth-copy">
          <p className="eyebrow">EducationResearcher</p>
          <h1 id="signin-title">Researcher sign-in</h1>
          <p>Use your researcher account to configure studies and review evidence.</p>
        </div>
        <form className="login-form" onSubmit={handleSignIn}>
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {authError ? <p className="form-error">{authError}</p> : null}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Signing in" : "Sign in"}
          </button>
          <button className="secondary-button" type="button" onClick={() => navigate("/participant/demo")}>
            Participant demo
          </button>
        </form>
      </section>
    </main>
  );
}
