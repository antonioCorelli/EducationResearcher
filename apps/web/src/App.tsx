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

type StudySetupTab = "shell" | "consent" | "survey" | "objectives";

const studySetupTabs: readonly { readonly id: StudySetupTab; readonly label: string }[] = [
  { id: "shell", label: "Study shell" },
  { id: "consent", label: "Consent information" },
  { id: "survey", label: "Survey information" },
  { id: "objectives", label: "Scoring objectives" }
];

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

interface ObjectiveGradeExample {
  readonly id: string;
  readonly objectiveVersionId: string;
  readonly gradeLabel: string;
  readonly exampleText: string;
  readonly sortOrder: number;
  readonly createdAt: string;
}

interface ObjectiveVersion {
  readonly id: string;
  readonly studyId: string;
  readonly objectiveKey: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly description: string;
  readonly customScoringPrompt?: string;
  readonly gradeScale: readonly string[];
  readonly gradeExamples: readonly ObjectiveGradeExample[];
  readonly evidenceRequirements: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
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

type ObjectiveState =
  | { readonly status: "idle" | "loading" }
  | {
      readonly status: "ready";
      readonly activeObjectiveVersions: ObjectiveVersion[];
      readonly objectiveVersions: ObjectiveVersion[];
    }
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

interface ObjectiveDraft {
  readonly objectiveKey?: string;
  readonly title: string;
  readonly description: string;
  readonly customScoringPrompt: string;
  readonly gradeLabels: readonly string[];
  readonly gradeExamples: readonly {
    readonly gradeLabel: string;
    readonly exampleText: string;
  }[];
  readonly evidenceRequirements: string;
}

function getCurrentPath() {
  return window.location.pathname;
}

function createEmptyObjectiveDraft(): ObjectiveDraft {
  return {
    title: "",
    description: "",
    customScoringPrompt: "",
    gradeLabels: ["1", "2", "3", "4"],
    gradeExamples: [],
    evidenceRequirements: ""
  };
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

async function fetchObjectives(accessToken: string, studyId: string) {
  const response = await fetch(`${serviceBaseUrl}/researcher/studies/${studyId}/objectives`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load objectives.");
  }

  return (await response.json()) as {
    activeObjectiveVersions: ObjectiveVersion[];
    objectiveVersions: ObjectiveVersion[];
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
  const [objectiveState, setObjectiveState] = useState<ObjectiveState>({ status: "idle" });
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [studyTitle, setStudyTitle] = useState("");
  const [freshnessDays, setFreshnessDays] = useState(14);
  const [maxInterviewMinutes, setMaxInterviewMinutes] = useState(45);
  const [studyError, setStudyError] = useState("");
  const [isSavingStudy, setIsSavingStudy] = useState(false);
  const [activeStudySetupTab, setActiveStudySetupTab] = useState<StudySetupTab>("shell");
  const [consentText, setConsentText] = useState("");
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>("checkmark");
  const [consentError, setConsentError] = useState("");
  const [isSavingConsent, setIsSavingConsent] = useState(false);
  const [selectedConsentVersionNumber, setSelectedConsentVersionNumber] = useState<number | null>(null);
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [surveyItems, setSurveyItems] = useState<readonly SurveyDraftItem[]>([{ type: "question", prompt: "" }]);
  const [surveyError, setSurveyError] = useState("");
  const [isSavingSurvey, setIsSavingSurvey] = useState(false);
  const [objectiveDrafts, setObjectiveDrafts] = useState<readonly ObjectiveDraft[]>([
    {
      title: "",
      description: "",
      customScoringPrompt: "",
      gradeLabels: ["1", "2", "3", "4"],
      gradeExamples: [],
      evidenceRequirements: ""
    }
  ]);
  const [objectiveError, setObjectiveError] = useState("");
  const [isSavingObjectives, setIsSavingObjectives] = useState(false);

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

  useEffect(() => {
    if (session.status !== "signed-in" || !accessToken || !selectedStudyId) {
      setObjectiveState({ status: "idle" });
      return;
    }

    setObjectiveState({ status: "loading" });
    fetchObjectives(accessToken, selectedStudyId)
      .then((objectives) => {
        setObjectiveState({ status: "ready", ...objectives });
        loadObjectiveForm(objectives.activeObjectiveVersions);
      })
      .catch(() => setObjectiveState({ status: "error", message: "Unable to load objectives." }));
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
    setActiveStudySetupTab("shell");
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
    setObjectiveState({ status: "idle" });
    setObjectiveDrafts([createEmptyObjectiveDraft()]);
    setObjectiveError("");
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

  function loadObjectiveForm(objectiveVersions: readonly ObjectiveVersion[]) {
    setObjectiveDrafts(
      objectiveVersions.length > 0
        ? [...objectiveVersions]
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((objective): ObjectiveDraft => ({
              objectiveKey: objective.objectiveKey,
              title: objective.title,
              description: objective.description,
              customScoringPrompt: objective.customScoringPrompt ?? "",
              gradeLabels: objective.gradeScale,
              gradeExamples: objective.gradeExamples.map((example) => ({
                gradeLabel: example.gradeLabel,
                exampleText: example.exampleText
              })),
              evidenceRequirements: objective.evidenceRequirements
            }))
        : [createEmptyObjectiveDraft()]
    );
    setObjectiveError("");
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

  function addObjective() {
    setObjectiveDrafts((objectives) => [...objectives, createEmptyObjectiveDraft()]);
  }

  function removeObjective(index: number) {
    setObjectiveDrafts((objectives) => {
      const nextObjectives = objectives.filter((_, objectiveIndex) => objectiveIndex !== index);
      return nextObjectives.length > 0 ? nextObjectives : [createEmptyObjectiveDraft()];
    });
  }

  function moveObjective(index: number, direction: -1 | 1) {
    setObjectiveDrafts((objectives) => {
      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex >= objectives.length) {
        return objectives;
      }

      const nextObjectives = [...objectives];
      [nextObjectives[index], nextObjectives[nextIndex]] = [nextObjectives[nextIndex], nextObjectives[index]];
      return nextObjectives;
    });
  }

  function updateObjective(index: number, patch: Partial<ObjectiveDraft>) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, objectiveIndex) => (objectiveIndex === index ? { ...objective, ...patch } : objective))
    );
  }

  function updateObjectiveGradeLabel(objectiveIndex: number, gradeIndex: number, label: string) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? {
              ...objective,
              gradeLabels: objective.gradeLabels.map((gradeLabel, currentGradeIndex) =>
                currentGradeIndex === gradeIndex ? label : gradeLabel
              )
            }
          : objective
      )
    );
  }

  function addObjectiveGradeLabel(objectiveIndex: number) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? { ...objective, gradeLabels: [...objective.gradeLabels, ""] }
          : objective
      )
    );
  }

  function removeObjectiveGradeLabel(objectiveIndex: number, gradeIndex: number) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) => {
        if (currentObjectiveIndex !== objectiveIndex) {
          return objective;
        }

        const removedLabel = objective.gradeLabels[gradeIndex];
        const nextGradeLabels = objective.gradeLabels.filter((_, currentGradeIndex) => currentGradeIndex !== gradeIndex);

        return {
          ...objective,
          gradeLabels: nextGradeLabels.length > 0 ? nextGradeLabels : [""],
          gradeExamples: objective.gradeExamples.filter((example) => example.gradeLabel !== removedLabel)
        };
      })
    );
  }

  function addObjectiveGradeExample(objectiveIndex: number) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? {
              ...objective,
              gradeExamples: [
                ...objective.gradeExamples,
                {
                  gradeLabel: objective.gradeLabels[0] ?? "",
                  exampleText: ""
                }
              ]
            }
          : objective
      )
    );
  }

  function updateObjectiveGradeExample(
    objectiveIndex: number,
    exampleIndex: number,
    patch: Partial<ObjectiveDraft["gradeExamples"][number]>
  ) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? {
              ...objective,
              gradeExamples: objective.gradeExamples.map((example, currentExampleIndex) =>
                currentExampleIndex === exampleIndex ? { ...example, ...patch } : example
              )
            }
          : objective
      )
    );
  }

  function removeObjectiveGradeExample(objectiveIndex: number, exampleIndex: number) {
    setObjectiveDrafts((objectives) =>
      objectives.map((objective, currentObjectiveIndex) =>
        currentObjectiveIndex === objectiveIndex
          ? {
              ...objective,
              gradeExamples: objective.gradeExamples.filter((_, currentExampleIndex) => currentExampleIndex !== exampleIndex)
            }
          : objective
      )
    );
  }

  async function handleSaveObjectives(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setObjectiveError("");

    const token = localStorage.getItem(accessTokenStorageKey);

    if (!token || !selectedStudyId) {
      setObjectiveError("Select a study before configuring objectives.");
      return;
    }

    setIsSavingObjectives(true);

    try {
      const objectives = objectiveDrafts
        .map((objective) => ({
          ...(objective.objectiveKey ? { objectiveKey: objective.objectiveKey } : {}),
          title: objective.title.trim(),
          description: objective.description.trim(),
          customScoringPrompt: objective.customScoringPrompt.trim(),
          gradeLabels: objective.gradeLabels.map((label) => label.trim()).filter(Boolean),
          gradeExamples: objective.gradeExamples
            .map((example) => ({
              gradeLabel: example.gradeLabel.trim(),
              exampleText: example.exampleText.trim()
            }))
            .filter((example) => example.gradeLabel || example.exampleText),
          evidenceRequirements: objective.evidenceRequirements.trim()
        }))
        .filter(
          (objective) =>
            objective.title ||
            objective.description ||
            objective.gradeLabels.length > 0 ||
            objective.gradeExamples.length > 0 ||
            objective.evidenceRequirements
        );
      const response = await fetch(`${serviceBaseUrl}/researcher/studies/${selectedStudyId}/objectives`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          objectives
        })
      });
      const payload = (await response.json()) as { objectiveVersions?: ObjectiveVersion[]; message?: string };

      if (!response.ok || !payload.objectiveVersions) {
        throw new Error(payload.message ?? "Unable to save objectives.");
      }

      const objectivesPayload = await fetchObjectives(token, selectedStudyId);
      setObjectiveState({ status: "ready", ...objectivesPayload });
      loadObjectiveForm(objectivesPayload.activeObjectiveVersions);
    } catch (error) {
      setObjectiveError(error instanceof Error ? error.message : "Unable to save objectives.");
    } finally {
      setIsSavingObjectives(false);
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
    const activeObjectiveVersions = objectiveState.status === "ready" ? objectiveState.activeObjectiveVersions : [];

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
              <div className="study-setup-tabs" aria-label="Study setup sections" role="tablist">
                {studySetupTabs.map((tab) => (
                  <button
                    aria-controls={`study-setup-panel-${tab.id}`}
                    aria-selected={activeStudySetupTab === tab.id}
                    className={activeStudySetupTab === tab.id ? "setup-tab active-setup-tab" : "setup-tab"}
                    id={`study-setup-tab-${tab.id}`}
                    key={tab.id}
                    onClick={() => setActiveStudySetupTab(tab.id)}
                    role="tab"
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <form
                aria-labelledby="study-setup-tab-shell"
                className="study-form study-setup-panel"
                hidden={activeStudySetupTab !== "shell"}
                id="study-setup-panel-shell"
                onSubmit={handleSaveStudy}
                role="tabpanel"
              >
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
              <form
                aria-labelledby="study-setup-tab-consent"
                className="study-form study-setup-panel"
                hidden={activeStudySetupTab !== "consent"}
                id="study-setup-panel-consent"
                onSubmit={handleSaveConsent}
                role="tabpanel"
              >
                <div className="section-heading">
                  <h2>Consent information</h2>
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
              <form
                aria-labelledby="study-setup-tab-survey"
                className="study-form study-setup-panel"
                hidden={activeStudySetupTab !== "survey"}
                id="study-setup-panel-survey"
                onSubmit={handleSaveSurvey}
                role="tabpanel"
              >
                <div className="section-heading">
                  <h2>Survey information</h2>
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
              <form
                aria-labelledby="study-setup-tab-objectives"
                className="study-form study-setup-panel"
                hidden={activeStudySetupTab !== "objectives"}
                id="study-setup-panel-objectives"
                onSubmit={handleSaveObjectives}
                role="tabpanel"
              >
                <div className="section-heading">
                  <h2>Scoring objectives</h2>
                  {activeObjectiveVersions.length > 0 ? (
                    <span className="version-pill">{activeObjectiveVersions.length} active</span>
                  ) : null}
                </div>
                <div className="objective-list">
                  {objectiveDrafts.map((objective, objectiveIndex) => (
                    <div className="objective-editor" key={`objective-${objective.objectiveKey ?? objectiveIndex}`}>
                      <div className="survey-item-toolbar">
                        <h3>Objective {objectiveIndex + 1}</h3>
                        <div className="survey-item-actions">
                          <button
                            aria-label={`Move objective ${objectiveIndex + 1} up`}
                            className="secondary-button compact-button"
                            disabled={!selectedStudy || objectiveIndex === 0}
                            onClick={() => moveObjective(objectiveIndex, -1)}
                            type="button"
                          >
                            Up
                          </button>
                          <button
                            aria-label={`Move objective ${objectiveIndex + 1} down`}
                            className="secondary-button compact-button"
                            disabled={!selectedStudy || objectiveIndex === objectiveDrafts.length - 1}
                            onClick={() => moveObjective(objectiveIndex, 1)}
                            type="button"
                          >
                            Down
                          </button>
                          <button
                            aria-label={`Remove objective ${objectiveIndex + 1}`}
                            className="secondary-button compact-button"
                            disabled={!selectedStudy || objectiveDrafts.length === 1}
                            onClick={() => removeObjective(objectiveIndex)}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <label>
                        Title
                        <input
                          disabled={!selectedStudy}
                          maxLength={160}
                          onChange={(event) => updateObjective(objectiveIndex, { title: event.target.value })}
                          placeholder={selectedStudy ? "Reasoning quality" : "Create or select a study first"}
                          type="text"
                          value={objective.title}
                        />
                      </label>
                      <label>
                        Description
                        <textarea
                          disabled={!selectedStudy}
                          maxLength={2000}
                          onChange={(event) => updateObjective(objectiveIndex, { description: event.target.value })}
                          placeholder="What this objective should measure"
                          value={objective.description}
                        />
                      </label>
                      <label>
                        Evidence requirements
                        <textarea
                          disabled={!selectedStudy}
                          maxLength={2000}
                          onChange={(event) => updateObjective(objectiveIndex, { evidenceRequirements: event.target.value })}
                          placeholder="What evidence should support the score"
                          value={objective.evidenceRequirements}
                        />
                      </label>
                      <label>
                        Custom scoring prompt
                        <textarea
                          disabled={!selectedStudy}
                          maxLength={4000}
                          onChange={(event) => updateObjective(objectiveIndex, { customScoringPrompt: event.target.value })}
                          placeholder="Optional objective-specific scoring guidance"
                          value={objective.customScoringPrompt}
                        />
                      </label>
                      <div className="rubric-grid">
                        <div className="rubric-panel">
                          <div className="section-heading">
                            <h3>Grade labels</h3>
                            <button
                              className="secondary-button compact-button"
                              disabled={!selectedStudy}
                              onClick={() => addObjectiveGradeLabel(objectiveIndex)}
                              type="button"
                            >
                              Add label
                            </button>
                          </div>
                          <div className="grade-label-list">
                            {objective.gradeLabels.map((gradeLabel, gradeIndex) => (
                              <div className="grade-label-row" key={`objective-${objectiveIndex}-grade-${gradeIndex}`}>
                                <input
                                  aria-label={`Objective ${objectiveIndex + 1} grade label ${gradeIndex + 1}`}
                                  disabled={!selectedStudy}
                                  maxLength={40}
                                  onChange={(event) =>
                                    updateObjectiveGradeLabel(objectiveIndex, gradeIndex, event.target.value)
                                  }
                                  type="text"
                                  value={gradeLabel}
                                />
                                <button
                                  aria-label={`Remove objective ${objectiveIndex + 1} grade label ${gradeIndex + 1}`}
                                  className="secondary-button compact-button"
                                  disabled={!selectedStudy || objective.gradeLabels.length <= 2}
                                  onClick={() => removeObjectiveGradeLabel(objectiveIndex, gradeIndex)}
                                  type="button"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rubric-panel">
                          <div className="section-heading">
                            <h3>Grade examples</h3>
                            <button
                              className="secondary-button compact-button"
                              disabled={!selectedStudy}
                              onClick={() => addObjectiveGradeExample(objectiveIndex)}
                              type="button"
                            >
                              Add example
                            </button>
                          </div>
                          <div className="grade-example-list">
                            {objective.gradeExamples.length === 0 ? <p className="muted-copy">No examples yet</p> : null}
                            {objective.gradeExamples.map((example, exampleIndex) => (
                              <div className="grade-example-row" key={`objective-${objectiveIndex}-example-${exampleIndex}`}>
                                <select
                                  aria-label={`Objective ${objectiveIndex + 1} example ${exampleIndex + 1} grade label`}
                                  disabled={!selectedStudy}
                                  onChange={(event) =>
                                    updateObjectiveGradeExample(objectiveIndex, exampleIndex, {
                                      gradeLabel: event.target.value
                                    })
                                  }
                                  value={example.gradeLabel}
                                >
                                  {objective.gradeLabels.filter(Boolean).map((gradeLabel) => (
                                    <option key={gradeLabel} value={gradeLabel}>
                                      {gradeLabel}
                                    </option>
                                  ))}
                                </select>
                                <textarea
                                  aria-label={`Objective ${objectiveIndex + 1} example ${exampleIndex + 1} text`}
                                  disabled={!selectedStudy}
                                  maxLength={2000}
                                  onChange={(event) =>
                                    updateObjectiveGradeExample(objectiveIndex, exampleIndex, {
                                      exampleText: event.target.value
                                    })
                                  }
                                  placeholder="Example evidence or response for this label"
                                  value={example.exampleText}
                                />
                                <button
                                  aria-label={`Remove objective ${objectiveIndex + 1} example ${exampleIndex + 1}`}
                                  className="secondary-button compact-button"
                                  disabled={!selectedStudy}
                                  onClick={() => removeObjectiveGradeExample(objectiveIndex, exampleIndex)}
                                  type="button"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="survey-add-row">
                  <button className="secondary-button compact-button" disabled={!selectedStudy} onClick={addObjective} type="button">
                    Add objective
                  </button>
                </div>
                {objectiveState.status === "loading" ? <p className="muted-copy">Loading objectives</p> : null}
                {objectiveState.status === "error" ? <p className="form-error">{objectiveState.message}</p> : null}
                {objectiveState.status === "ready" && objectiveState.objectiveVersions.length > 0 ? (
                  <div className="version-history" aria-label="Objective versions">
                    {objectiveState.objectiveVersions.map((version) => (
                      <span className={version.isActive ? "version-chip active-version-chip" : "version-chip"} key={version.id}>
                        {version.title} v{version.versionNumber}
                      </span>
                    ))}
                  </div>
                ) : null}
                {objectiveError ? <p className="form-error">{objectiveError}</p> : null}
                <div className="form-actions">
                  <button className="primary-button" disabled={!selectedStudy || isSavingObjectives} type="submit">
                    {isSavingObjectives
                      ? "Saving objectives"
                      : objectiveState.status === "ready" && objectiveState.activeObjectiveVersions.length > 0
                        ? "Create new versions"
                        : "Save objectives"}
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
