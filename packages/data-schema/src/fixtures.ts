import type { DataDomainEntity, DataDomainTableKey } from "./schema.js";

export interface FixtureRecord {
  readonly tableKey: DataDomainTableKey;
  readonly entity: DataDomainEntity;
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk?: string;
  readonly gsi1sk?: string;
  readonly gsi2pk?: string;
  readonly gsi2sk?: string;
  readonly gsi3pk?: string;
  readonly gsi3sk?: string;
  readonly attributes: Record<string, unknown>;
}

const createdAt = "2026-05-04T12:00:00.000Z";
const updatedAt = "2026-05-04T12:10:00.000Z";
const scoredAt = "2026-05-04T13:00:00.000Z";
const v1DefaultPersonaStylePrompt = [
  "You are the fixed V1 interviewer for formative education research studies.",
  "Act like a calm, warm, neutral, curious, and non-evaluative research interviewer. Preserve natural conversation, acknowledge briefly, ask one question at a time, and invite concrete examples or clarification when an answer is vague.",
  "Use the participant's survey responses, the gap map, and the study objectives only to choose high-value follow-up questions. Steer gently toward unresolved gaps, ambiguities, contradictions, and missing evidence without making the participant feel tested or graded.",
  "Do not reveal scoring objectives, rubrics, grades, scores, confidence, hidden progress, or gap map internals. Do not tell the participant how they are performing or imply that the interview is an assessment.",
  "Keep questions participant-safe and focused on the study topic. If the participant seems uncomfortable, give them room to pause or stop."
].join("\n\n");

export const FIRST_BUILD_SLICE_FIXTURE = [
  {
    tableKey: "identityAccess",
    entity: "user",
    pk: "USER#user_researcher_001",
    sk: "PROFILE",
    gsi1pk: "EMAIL#researcher@example.test",
    gsi1sk: "USER#user_researcher_001",
    gsi2pk: "ROLE#researcher",
    gsi2sk: "USER#user_researcher_001",
    attributes: {
      id: "user_researcher_001",
      email: "researcher@example.test",
      normalizedEmail: "researcher@example.test",
      displayName: "Fixture Researcher",
      role: "researcher",
      status: "active",
      createdAt,
      updatedAt
    }
  },
  {
    tableKey: "studySetup",
    entity: "study",
    pk: "STUDY#study_formative_001",
    sk: "PROFILE",
    gsi1pk: "OWNER#user_researcher_001",
    gsi1sk: "STUDY#2026-05-04T12:00:00.000Z#study_formative_001",
    attributes: {
      id: "study_formative_001",
      ownerUserId: "user_researcher_001",
      title: "Fixture Formative Study",
      description: "Fixture study for formative education research workflows.",
      defaultFreshnessDays: 14,
      defaultMaxInterviewMinutes: 45,
      activeConsentVersionId: "consent_version_001",
      activeSurveyVersionId: "survey_version_001",
      activePersonaVersionId: "persona_version_v1_default_001",
      status: "active",
      createdAt,
      updatedAt
    }
  },
  {
    tableKey: "studySetup",
    entity: "participant_slot",
    pk: "STUDY#study_formative_001",
    sk: "SLOT#slot_fixture_001",
    gsi2pk: "STUDY#study_formative_001#PARTICIPANT_CODE#P001",
    gsi2sk: "SLOT#slot_fixture_001",
    gsi3pk: "STUDY#study_formative_001#SLOT_STATUS#active",
    gsi3sk: "SLOT#P001#slot_fixture_001",
    attributes: {
      id: "slot_fixture_001",
      studyId: "study_formative_001",
      participantCode: "P001",
      codeSource: "researcher_supplied",
      status: "active",
      createdAt,
      updatedAt
    }
  },
  {
    tableKey: "versionedConfiguration",
    entity: "consent_version",
    pk: "STUDY#study_formative_001",
    sk: "CONSENT_VERSION#1",
    gsi1pk: "STUDY#study_formative_001#ACTIVE_CONFIG",
    gsi1sk: "CONSENT_VERSION#1#consent_version_001",
    attributes: {
      id: "consent_version_001",
      studyId: "study_formative_001",
      versionNumber: 1,
      consentText: "Fixture consent text for local development only.",
      consentMethod: "checkmark",
      isActive: true,
      createdAt
    }
  },
  {
    tableKey: "versionedConfiguration",
    entity: "survey_version",
    pk: "STUDY#study_formative_001",
    sk: "SURVEY_VERSION#1",
    gsi1pk: "STUDY#study_formative_001#ACTIVE_CONFIG",
    gsi1sk: "SURVEY_VERSION#1#survey_version_001",
    attributes: {
      id: "survey_version_001",
      studyId: "study_formative_001",
      versionNumber: 1,
      isActive: true,
      createdAt
    }
  },
  {
    tableKey: "versionedConfiguration",
    entity: "survey_group",
    pk: "SURVEY_VERSION#survey_version_001",
    sk: "GROUP#001#survey_group_001",
    attributes: {
      id: "survey_group_001",
      surveyVersionId: "survey_version_001",
      title: "Learning Reflection",
      sortOrder: 1,
      createdAt
    }
  },
  {
    tableKey: "versionedConfiguration",
    entity: "survey_question",
    pk: "SURVEY_VERSION#survey_version_001",
    sk: "QUESTION#001#survey_question_001",
    attributes: {
      id: "survey_question_001",
      surveyVersionId: "survey_version_001",
      surveyGroupId: "survey_group_001",
      prompt: "Describe a moment when the lesson changed your thinking.",
      required: true,
      questionType: "long_text",
      sortOrder: 1,
      createdAt
    }
  },
  {
    tableKey: "versionedConfiguration",
    entity: "objective_version",
    pk: "STUDY#study_formative_001",
    sk: "OBJECTIVE#reasoning_quality#VERSION#1",
    gsi1pk: "STUDY#study_formative_001#ACTIVE_CONFIG",
    gsi1sk: "OBJECTIVE_VERSION#reasoning_quality#1#objective_version_001",
    gsi2pk: "OBJECTIVE#reasoning_quality",
    gsi2sk: "VERSION#1#objective_version_001",
    attributes: {
      id: "objective_version_001",
      studyId: "study_formative_001",
      objectiveKey: "reasoning_quality",
      versionNumber: 1,
      title: "Reasoning Quality",
      description: "Assesses how clearly the participant explains their reasoning.",
      customScoringPrompt: "Prioritize evidence of explanation and examples.",
      gradeScale: ["1", "2", "3", "4"],
      evidenceRequirements: "Cite at least one survey response or interview turn.",
      sortOrder: 1,
      isEnabled: true,
      isActive: true,
      createdAt
    }
  },
  {
    tableKey: "versionedConfiguration",
    entity: "objective_grade_example",
    pk: "OBJECTIVE_VERSION#objective_version_001",
    sk: "GRADE_EXAMPLE#001#objective_grade_example_001",
    attributes: {
      id: "objective_grade_example_001",
      objectiveVersionId: "objective_version_001",
      gradeLabel: "4",
      exampleText: "Gives a specific claim, example, and explanation.",
      sortOrder: 1,
      createdAt
    }
  },
  {
    tableKey: "versionedConfiguration",
    entity: "interviewer_persona_version",
    pk: "PERSONA#v1_default",
    sk: "VERSION#1",
    gsi3pk: "PERSONA_DEFAULT#true",
    gsi3sk: "PERSONA#v1_default#VERSION#1",
    attributes: {
      id: "persona_version_v1_default_001",
      name: "v1_default",
      versionNumber: 1,
      label: "V1 default research interviewer",
      stylePrompt: v1DefaultPersonaStylePrompt,
      isDefault: true,
      createdAt
    }
  },
  {
    tableKey: "runLifecycle",
    entity: "run",
    pk: "RUN#run_fixture_001",
    sk: "PROFILE",
    gsi1pk: "STUDY#study_formative_001#RUN_STATUS#scored",
    gsi1sk: "FRESHNESS#2026-05-18T12:00:00.000Z#RUN#run_fixture_001",
    gsi2pk: "SLOT#slot_fixture_001",
    gsi2sk: "RUN#2026-05-04T12:00:00.000Z#run_fixture_001",
    attributes: {
      id: "run_fixture_001",
      studyId: "study_formative_001",
      participantSlotId: "slot_fixture_001",
      surveyVersionId: "survey_version_001",
      consentVersionId: "consent_version_001",
      personaVersionId: "persona_version_v1_default_001",
      objectiveVersionIds: ["objective_version_001"],
      freshnessDeadlineAt: "2026-05-18T12:00:00.000Z",
      maxInterviewMinutes: 45,
      status: "scored",
      currentRunForSlot: true,
      createdAt,
      updatedAt,
      surveyCompletedAt: "2026-05-04T12:20:00.000Z",
      interviewStartedAt: "2026-05-04T12:30:00.000Z",
      interviewCompletedAt: "2026-05-04T12:50:00.000Z"
    }
  },
  {
    tableKey: "runLifecycle",
    entity: "participant_access_token",
    pk: "RUN#run_fixture_001",
    sk: "PARTICIPANT_ACCESS_TOKEN#2026-05-04T12:00:00.000Z#participant_access_token_001",
    gsi1pk: "STUDY#study_formative_001#PARTICIPANT_ACCESS_TOKEN#active",
    gsi1sk: "RUN#run_fixture_001#TOKEN#token_fixture_001",
    gsi2pk: "SLOT#slot_fixture_001",
    gsi2sk: "TOKEN#2026-05-04T12:00:00.000Z#token_fixture_001",
    gsi3pk: "PARTICIPANT_ACCESS_TOKEN#token_fixture_001",
    gsi3sk: "RUN#run_fixture_001",
    attributes: {
      id: "participant_access_token_001",
      tokenId: "token_fixture_001",
      tokenHash: "sha256-fixture-token-hash",
      studyId: "study_formative_001",
      participantSlotId: "slot_fixture_001",
      runId: "run_fixture_001",
      status: "active",
      createdAt,
      updatedAt: createdAt
    }
  },
  {
    tableKey: "runLifecycle",
    entity: "consent_record",
    pk: "RUN#run_fixture_001",
    sk: "CONSENT_RECORD#consent_record_001",
    gsi3pk: "RUN#run_fixture_001#ARTIFACT#consent_record",
    gsi3sk: "CONSENT_RECORD#2026-05-04T12:05:00.000Z#consent_record_001",
    attributes: {
      id: "consent_record_001",
      studyId: "study_formative_001",
      participantSlotId: "slot_fixture_001",
      runId: "run_fixture_001",
      consentVersionId: "consent_version_001",
      consentMethod: "checkmark",
      renderedConsentSnapshot: "Fixture consent text for local development only.",
      acceptedAt: "2026-05-04T12:05:00.000Z",
      createdAt: "2026-05-04T12:05:00.000Z"
    }
  },
  {
    tableKey: "runLifecycle",
    entity: "survey_response",
    pk: "RUN#run_fixture_001",
    sk: "SURVEY_RESPONSE#survey_question_001",
    gsi3pk: "RUN#run_fixture_001#ARTIFACT#survey_response",
    gsi3sk: "QUESTION#survey_question_001#survey_response_001",
    attributes: {
      id: "survey_response_001",
      runId: "run_fixture_001",
      surveyQuestionId: "survey_question_001",
      responseText: "I changed my mind after comparing two examples.",
      submittedAt: "2026-05-04T12:20:00.000Z",
      createdAt: "2026-05-04T12:20:00.000Z"
    }
  },
  {
    tableKey: "runLifecycle",
    entity: "gap_map",
    pk: "RUN#run_fixture_001",
    sk: "GAP_MAP#gap_map_001",
    gsi3pk: "RUN#run_fixture_001#ARTIFACT#gap_map",
    gsi3sk: "GAP_MAP#2026-05-04T12:25:00.000Z#gap_map_001",
    attributes: {
      id: "gap_map_001",
      studyId: "study_formative_001",
      participantSlotId: "slot_fixture_001",
      runId: "run_fixture_001",
      surveyVersionId: "survey_version_001",
      objectiveVersionIds: ["objective_version_001"],
      status: "generated",
      modelName: "fake-gap-map",
      modelVersion: "local-1",
      serviceRequestId: "req_gap_map_fixture_001",
      promptVersion: "gap-map-v1",
      alreadyAnswered: ["The participant noticed a change in thinking."],
      ambiguities: ["The reason for the change is underspecified."],
      contradictions: [],
      missingEvidence: ["Need an example of the comparison."],
      recommendedProbes: ["What were the two examples you compared?"],
      generatedAt: "2026-05-04T12:25:00.000Z",
      createdAt: "2026-05-04T12:25:00.000Z"
    }
  },
  {
    tableKey: "runLifecycle",
    entity: "interview_session",
    pk: "RUN#run_fixture_001",
    sk: "INTERVIEW_SESSION#001#interview_session_001",
    gsi3pk: "RUN#run_fixture_001#ARTIFACT#interview_session",
    gsi3sk: "SESSION#001#interview_session_001",
    attributes: {
      id: "interview_session_001",
      runId: "run_fixture_001",
      sessionNumber: 1,
      status: "completed",
      startedAt: "2026-05-04T12:30:00.000Z",
      endedAt: "2026-05-04T12:50:00.000Z",
      audioDurationSeconds: 1200,
      transcriptTokenCount: 450,
      createdAt: "2026-05-04T12:30:00.000Z"
    }
  },
  {
    tableKey: "runLifecycle",
    entity: "interview_turn",
    pk: "INTERVIEW_SESSION#interview_session_001",
    sk: "TURN#2026-05-04T12:31:00.000Z#interview_turn_001",
    gsi3pk: "RUN#run_fixture_001#ARTIFACT#interview_turn",
    gsi3sk: "TURN#2026-05-04T12:31:00.000Z#interview_turn_001",
    attributes: {
      id: "interview_turn_001",
      runId: "run_fixture_001",
      interviewSessionId: "interview_session_001",
      speaker: "participant",
      text: "The second example made the pattern much clearer.",
      audioStartMs: 60000,
      audioEndMs: 68000,
      createdAt: "2026-05-04T12:31:00.000Z"
    }
  },
  {
    tableKey: "runLifecycle",
    entity: "interview_audio_asset",
    pk: "RUN#run_fixture_001",
    sk: "AUDIO_ASSET#interview_audio_asset_001",
    gsi3pk: "RUN#run_fixture_001#ARTIFACT#interview_audio_asset",
    gsi3sk: "AUDIO_ASSET#2026-05-04T12:50:00.000Z#interview_audio_asset_001",
    attributes: {
      id: "interview_audio_asset_001",
      runId: "run_fixture_001",
      interviewSessionId: "interview_session_001",
      storageUri: "s3://education-researcher-local-fixtures/study_formative_001/run_fixture_001/audio.wav",
      durationSeconds: 1200,
      status: "available",
      createdAt: "2026-05-04T12:50:00.000Z"
    }
  },
  {
    tableKey: "evidenceScoring",
    entity: "scoring_run",
    pk: "RUN#run_fixture_001",
    sk: "SCORING_RUN#2026-05-04T13:00:00.000Z#scoring_run_001",
    gsi1pk: "RUN#run_fixture_001",
    gsi1sk: "SCORING_RUN#2026-05-04T13:00:00.000Z#scoring_run_001",
    attributes: {
      id: "scoring_run_001",
      runId: "run_fixture_001",
      status: "completed",
      trigger: "automatic",
      modelName: "fake-scoring",
      modelVersion: "local-1",
      serviceRequestId: "req_scoring_fixture_001",
      promptVersion: "scoring-v1",
      objectiveVersionSetHash: "sha256:fixture-objective-version-set",
      scoredAt,
      createdAt: scoredAt
    }
  },
  {
    tableKey: "evidenceScoring",
    entity: "objective_score",
    pk: "SCORING_RUN#scoring_run_001",
    sk: "OBJECTIVE_SCORE#objective_version_001",
    gsi2pk: "OBJECTIVE_VERSION#objective_version_001",
    gsi2sk: "SCORE#2026-05-04T13:00:00.000Z#objective_score_001",
    attributes: {
      id: "objective_score_001",
      scoringRunId: "scoring_run_001",
      objectiveVersionId: "objective_version_001",
      gradeLabel: "3",
      confidence: 0.82,
      rationale: "The participant gave a concrete explanation but limited detail.",
      flags: [],
      createdAt: scoredAt
    }
  },
  {
    tableKey: "evidenceScoring",
    entity: "evidence_citation",
    pk: "OBJECTIVE_SCORE#objective_score_001",
    sk: "CITATION#interview_turn#evidence_citation_001",
    gsi3pk: "CITATION_TARGET#interview_turn#interview_turn_001",
    gsi3sk: "OBJECTIVE_SCORE#objective_score_001#CITATION#evidence_citation_001",
    attributes: {
      id: "evidence_citation_001",
      objectiveScoreId: "objective_score_001",
      runId: "run_fixture_001",
      sourceType: "interview_turn",
      sourceId: "interview_turn_001",
      quote: "The second example made the pattern much clearer.",
      audioStartMs: 60000,
      audioEndMs: 68000,
      createdAt: scoredAt
    }
  },
  {
    tableKey: "operations",
    entity: "operational_event",
    pk: "RUN#run_fixture_001",
    sk: "OPERATIONAL_EVENT#2026-05-04T12:30:00.000Z#operational_event_001",
    gsi1pk: "RUN#run_fixture_001",
    gsi1sk: "OPERATIONAL_EVENT#2026-05-04T12:30:00.000Z#operational_event_001",
    attributes: {
      id: "operational_event_001",
      runId: "run_fixture_001",
      participantSlotId: "slot_fixture_001",
      eventType: "interview_started",
      browserDevice: {
        browser: "fixture-browser",
        device: "desktop"
      },
      audioConnectionState: "connected",
      modelApiErrorCategory: "service_unavailable",
      technicalFailureCategory: "model_api_unavailable",
      latencyMs: 120,
      retryCount: 0,
      serviceRequestId: "req_fixture_001",
      createdAt: "2026-05-04T12:30:00.000Z"
    }
  },
  {
    tableKey: "operations",
    entity: "audit_log",
    pk: "STUDY#study_formative_001",
    sk: "AUDIT#2026-05-04T13:05:00.000Z#audit_log_001",
    gsi2pk: "STUDY#study_formative_001",
    gsi2sk: "AUDIT#2026-05-04T13:05:00.000Z#audit_log_001",
    gsi3pk: "ACTOR#user_researcher_001",
    gsi3sk: "AUDIT#2026-05-04T13:05:00.000Z#audit_log_001",
    attributes: {
      id: "audit_log_001",
      actorUserId: "user_researcher_001",
      actorRole: "researcher",
      studyId: "study_formative_001",
      entityType: "scoring_run",
      entityId: "scoring_run_001",
      action: "viewed",
      metadata: {
        reason: "fixture review"
      },
      createdAt: "2026-05-04T13:05:00.000Z"
    }
  }
] as const satisfies readonly FixtureRecord[];
