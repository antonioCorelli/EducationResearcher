export const DATA_SCHEMA_VERSION = "2026-05-04-issue-4";

export const ENVIRONMENT_PLACEHOLDER = "{environment}";

export type DataDomainTableKey =
  | "identityAccess"
  | "studySetup"
  | "versionedConfiguration"
  | "runLifecycle"
  | "evidenceScoring"
  | "operations";

export type DataDomainEntity =
  | "user"
  | "study"
  | "participant_slot"
  | "consent_version"
  | "survey_version"
  | "survey_group"
  | "survey_question"
  | "objective_version"
  | "objective_grade_example"
  | "interviewer_persona_version"
  | "run"
  | "consent_record"
  | "survey_response"
  | "gap_map"
  | "interview_session"
  | "interview_turn"
  | "interview_audio_asset"
  | "scoring_run"
  | "objective_score"
  | "evidence_citation"
  | "operational_event"
  | "audit_log";

export type AttributeType = "string" | "number" | "boolean" | "json" | "string[]";

export interface GlobalSecondaryIndexDefinition {
  readonly name: string;
  readonly partitionKey: string;
  readonly sortKey: string;
  readonly purpose: string;
}

export interface EntityReferenceDefinition {
  readonly attribute: string;
  readonly references: DataDomainEntity;
  readonly relationship: string;
}

export interface EntityDefinition {
  readonly entity: DataDomainEntity;
  readonly description: string;
  readonly partitionKeyPattern: string;
  readonly sortKeyPattern: string;
  readonly requiredAttributes: readonly string[];
  readonly statusAttributes: readonly string[];
  readonly timestampAttributes: readonly string[];
  readonly references: readonly EntityReferenceDefinition[];
  readonly immutableAfterReference?: boolean;
}

export interface DataDomainTableDefinition {
  readonly key: DataDomainTableKey;
  readonly sharedLanguageName: string;
  readonly cdkConstructId: string;
  readonly tableNameSuffix: string;
  readonly description: string;
  readonly partitionKey: "pk";
  readonly sortKey: "sk";
  readonly indexes: readonly GlobalSecondaryIndexDefinition[];
  readonly entities: readonly EntityDefinition[];
}

export function tableNameForEnvironment(table: DataDomainTableDefinition, environment: string) {
  return `education-researcher-${environment}-${table.tableNameSuffix}`;
}

export const DATA_DOMAIN_TABLES = [
  {
    key: "identityAccess",
    sharedLanguageName: "Identity Access Table",
    cdkConstructId: "IdentityAccessTable",
    tableNameSuffix: "identity-access",
    description: "Researcher and admin identity records owned by the service.",
    partitionKey: "pk",
    sortKey: "sk",
    indexes: [
      {
        name: "byEmail",
        partitionKey: "gsi1pk",
        sortKey: "gsi1sk",
        purpose: "Lookup a researcher or authorized admin engineer by normalized email."
      },
      {
        name: "byRole",
        partitionKey: "gsi2pk",
        sortKey: "gsi2sk",
        purpose: "List users by role for privileged operational workflows."
      }
    ],
    entities: [
      {
        entity: "user",
        description: "Authenticated researcher or authorized admin engineer.",
        partitionKeyPattern: "USER#<user_id>",
        sortKeyPattern: "PROFILE",
        requiredAttributes: ["id", "email", "normalizedEmail", "displayName", "role"],
        statusAttributes: ["status"],
        timestampAttributes: ["createdAt", "updatedAt"],
        references: []
      }
    ]
  },
  {
    key: "studySetup",
    sharedLanguageName: "Study Setup Table",
    cdkConstructId: "StudySetupTable",
    tableNameSuffix: "study-setup",
    description: "Study shells and participant slots.",
    partitionKey: "pk",
    sortKey: "sk",
    indexes: [
      {
        name: "byOwner",
        partitionKey: "gsi1pk",
        sortKey: "gsi1sk",
        purpose: "List study shells owned by a researcher."
      },
      {
        name: "byParticipantCode",
        partitionKey: "gsi2pk",
        sortKey: "gsi2sk",
        purpose: "Find a participant slot by study-scoped participant code."
      },
      {
        name: "bySlotStatus",
        partitionKey: "gsi3pk",
        sortKey: "gsi3sk",
        purpose: "List participant slots in a study by status."
      }
    ],
    entities: [
      {
        entity: "study",
        description: "Researcher-owned container for configuration, runs, artifacts, scoring, and exports.",
        partitionKeyPattern: "STUDY#<study_id>",
        sortKeyPattern: "PROFILE",
        requiredAttributes: [
          "id",
          "ownerUserId",
          "title",
          "defaultFreshnessDays",
          "defaultMaxInterviewMinutes",
          "activePersonaVersionId"
        ],
        statusAttributes: ["status"],
        timestampAttributes: ["createdAt", "updatedAt"],
        references: [
          {
            attribute: "ownerUserId",
            references: "user",
            relationship: "Study owner."
          },
          {
            attribute: "activeConsentVersionId",
            references: "consent_version",
            relationship: "Latest active consent version for new runs."
          },
          {
            attribute: "activeSurveyVersionId",
            references: "survey_version",
            relationship: "Latest active survey version for new runs."
          },
          {
            attribute: "activePersonaVersionId",
            references: "interviewer_persona_version",
            relationship: "Default persona version for new runs."
          }
        ]
      },
      {
        entity: "participant_slot",
        description: "Study-scoped participant identity without an account.",
        partitionKeyPattern: "STUDY#<study_id>",
        sortKeyPattern: "SLOT#<participant_slot_id>",
        requiredAttributes: ["id", "studyId", "participantCode", "codeSource"],
        statusAttributes: ["status"],
        timestampAttributes: ["createdAt", "updatedAt"],
        references: [
          {
            attribute: "studyId",
            references: "study",
            relationship: "Parent study."
          }
        ]
      }
    ]
  },
  {
    key: "versionedConfiguration",
    sharedLanguageName: "Versioned Configuration Table",
    cdkConstructId: "VersionedConfigurationTable",
    tableNameSuffix: "versioned-configuration",
    description: "Immutable configuration versions referenced by runs.",
    partitionKey: "pk",
    sortKey: "sk",
    indexes: [
      {
        name: "byStudyActiveConfiguration",
        partitionKey: "gsi1pk",
        sortKey: "gsi1sk",
        purpose: "Find active configuration versions for a study."
      },
      {
        name: "byObjectiveKey",
        partitionKey: "gsi2pk",
        sortKey: "gsi2sk",
        purpose: "List versions of a scoring objective."
      },
      {
        name: "byPersonaDefault",
        partitionKey: "gsi3pk",
        sortKey: "gsi3sk",
        purpose: "Find the default V1 interviewer persona."
      }
    ],
    entities: [
      {
        entity: "consent_version",
        description: "Versioned consent text and method for a study.",
        partitionKeyPattern: "STUDY#<study_id>",
        sortKeyPattern: "CONSENT_VERSION#<version_number>",
        requiredAttributes: ["id", "studyId", "versionNumber", "consentText", "consentMethod", "isActive"],
        statusAttributes: ["isActive"],
        timestampAttributes: ["createdAt"],
        immutableAfterReference: true,
        references: [
          {
            attribute: "studyId",
            references: "study",
            relationship: "Parent study."
          }
        ]
      },
      {
        entity: "survey_version",
        description: "Versioned set of long-form survey groups and questions.",
        partitionKeyPattern: "STUDY#<study_id>",
        sortKeyPattern: "SURVEY_VERSION#<version_number>",
        requiredAttributes: ["id", "studyId", "versionNumber", "isActive"],
        statusAttributes: ["isActive"],
        timestampAttributes: ["createdAt"],
        immutableAfterReference: true,
        references: [
          {
            attribute: "studyId",
            references: "study",
            relationship: "Parent study."
          }
        ]
      },
      {
        entity: "survey_group",
        description: "Optional visible grouping label for survey questions.",
        partitionKeyPattern: "SURVEY_VERSION#<survey_version_id>",
        sortKeyPattern: "GROUP#<sort_order>#<survey_group_id>",
        requiredAttributes: ["id", "surveyVersionId", "title", "sortOrder"],
        statusAttributes: [],
        timestampAttributes: ["createdAt"],
        immutableAfterReference: true,
        references: [
          {
            attribute: "surveyVersionId",
            references: "survey_version",
            relationship: "Parent survey version."
          }
        ]
      },
      {
        entity: "survey_question",
        description: "Required long-form free-text question.",
        partitionKeyPattern: "SURVEY_VERSION#<survey_version_id>",
        sortKeyPattern: "QUESTION#<sort_order>#<survey_question_id>",
        requiredAttributes: ["id", "surveyVersionId", "prompt", "required", "questionType", "sortOrder"],
        statusAttributes: [],
        timestampAttributes: ["createdAt"],
        immutableAfterReference: true,
        references: [
          {
            attribute: "surveyVersionId",
            references: "survey_version",
            relationship: "Parent survey version."
          },
          {
            attribute: "surveyGroupId",
            references: "survey_group",
            relationship: "Optional parent survey group."
          }
        ]
      },
      {
        entity: "objective_version",
        description: "Versioned scoring objective and rubric guidance.",
        partitionKeyPattern: "STUDY#<study_id>",
        sortKeyPattern: "OBJECTIVE#<objective_key>#VERSION#<version_number>",
        requiredAttributes: [
          "id",
          "studyId",
          "objectiveKey",
          "versionNumber",
          "title",
          "description",
          "gradeScale",
          "evidenceRequirements",
          "sortOrder",
          "isEnabled",
          "isActive"
        ],
        statusAttributes: ["isEnabled", "isActive"],
        timestampAttributes: ["createdAt"],
        immutableAfterReference: true,
        references: [
          {
            attribute: "studyId",
            references: "study",
            relationship: "Parent study."
          }
        ]
      },
      {
        entity: "objective_grade_example",
        description: "Example work for a grade label in an objective version.",
        partitionKeyPattern: "OBJECTIVE_VERSION#<objective_version_id>",
        sortKeyPattern: "GRADE_EXAMPLE#<sort_order>#<objective_grade_example_id>",
        requiredAttributes: ["id", "objectiveVersionId", "gradeLabel", "exampleText", "sortOrder"],
        statusAttributes: [],
        timestampAttributes: ["createdAt"],
        immutableAfterReference: true,
        references: [
          {
            attribute: "objectiveVersionId",
            references: "objective_version",
            relationship: "Parent objective version."
          }
        ]
      },
      {
        entity: "interviewer_persona_version",
        description: "Versioned V1 interviewer style prompt.",
        partitionKeyPattern: "PERSONA#<persona_name>",
        sortKeyPattern: "VERSION#<version_number>",
        requiredAttributes: ["id", "name", "versionNumber", "stylePrompt", "isDefault"],
        statusAttributes: ["isDefault"],
        timestampAttributes: ["createdAt"],
        immutableAfterReference: true,
        references: []
      }
    ]
  },
  {
    key: "runLifecycle",
    sharedLanguageName: "Run Lifecycle Table",
    cdkConstructId: "RunLifecycleTable",
    tableNameSuffix: "run-lifecycle",
    description: "Runs, consent records, survey responses, gap maps, interview sessions, turns, and audio metadata.",
    partitionKey: "pk",
    sortKey: "sk",
    indexes: [
      {
        name: "byStudyRunStatus",
        partitionKey: "gsi1pk",
        sortKey: "gsi1sk",
        purpose: "List runs in a study by participant-safe status and freshness deadline."
      },
      {
        name: "byParticipantSlot",
        partitionKey: "gsi2pk",
        sortKey: "gsi2sk",
        purpose: "List runs for a participant slot."
      },
      {
        name: "byRunArtifactType",
        partitionKey: "gsi3pk",
        sortKey: "gsi3sk",
        purpose: "List run artifacts by type for scoring and evidence drilldown."
      }
    ],
    entities: [
      {
        entity: "run",
        description: "Fresh survey/interview cycle for a participant slot.",
        partitionKeyPattern: "RUN#<run_id>",
        sortKeyPattern: "PROFILE",
        requiredAttributes: [
          "id",
          "studyId",
          "participantSlotId",
          "surveyVersionId",
          "consentVersionId",
          "personaVersionId",
          "objectiveVersionIds",
          "freshnessDeadlineAt",
          "maxInterviewMinutes",
          "currentRunForSlot"
        ],
        statusAttributes: ["status"],
        timestampAttributes: ["createdAt", "updatedAt"],
        references: [
          {
            attribute: "studyId",
            references: "study",
            relationship: "Parent study."
          },
          {
            attribute: "participantSlotId",
            references: "participant_slot",
            relationship: "Participant slot authorized for the run."
          },
          {
            attribute: "surveyVersionId",
            references: "survey_version",
            relationship: "Immutable survey version used by the run."
          },
          {
            attribute: "consentVersionId",
            references: "consent_version",
            relationship: "Immutable consent version used by the run."
          },
          {
            attribute: "personaVersionId",
            references: "interviewer_persona_version",
            relationship: "Immutable persona version used by the run."
          },
          {
            attribute: "objectiveVersionIds",
            references: "objective_version",
            relationship: "Immutable objective version set used by the run."
          }
        ]
      },
      {
        entity: "consent_record",
        description: "Captured participant consent for a run.",
        partitionKeyPattern: "RUN#<run_id>",
        sortKeyPattern: "CONSENT_RECORD#<consent_record_id>",
        requiredAttributes: [
          "id",
          "studyId",
          "participantSlotId",
          "runId",
          "consentVersionId",
          "consentMethod",
          "renderedConsentSnapshot"
        ],
        statusAttributes: [],
        timestampAttributes: ["acceptedAt", "createdAt"],
        references: [
          {
            attribute: "studyId",
            references: "study",
            relationship: "Study where consent was accepted."
          },
          {
            attribute: "participantSlotId",
            references: "participant_slot",
            relationship: "Participant slot that accepted consent."
          },
          {
            attribute: "runId",
            references: "run",
            relationship: "Parent run."
          },
          {
            attribute: "consentVersionId",
            references: "consent_version",
            relationship: "Accepted consent version."
          }
        ]
      },
      {
        entity: "survey_response",
        description: "Participant answer to one survey question.",
        partitionKeyPattern: "RUN#<run_id>",
        sortKeyPattern: "SURVEY_RESPONSE#<survey_question_id>",
        requiredAttributes: ["id", "runId", "surveyQuestionId", "responseText"],
        statusAttributes: [],
        timestampAttributes: ["submittedAt", "createdAt"],
        references: [
          {
            attribute: "runId",
            references: "run",
            relationship: "Parent run."
          },
          {
            attribute: "surveyQuestionId",
            references: "survey_question",
            relationship: "Survey question answered."
          }
        ]
      },
      {
        entity: "gap_map",
        description: "Persisted AI output identifying answered areas, ambiguities, contradictions, missing evidence, and probes.",
        partitionKeyPattern: "RUN#<run_id>",
        sortKeyPattern: "GAP_MAP#<gap_map_id>",
        requiredAttributes: [
          "id",
          "runId",
          "modelName",
          "modelVersion",
          "alreadyAnswered",
          "ambiguities",
          "contradictions",
          "missingEvidence",
          "recommendedProbes"
        ],
        statusAttributes: ["status"],
        timestampAttributes: ["generatedAt", "createdAt"],
        references: [
          {
            attribute: "runId",
            references: "run",
            relationship: "Parent run."
          }
        ]
      },
      {
        entity: "interview_session",
        description: "One active, paused, completed, or interrupted interview segment.",
        partitionKeyPattern: "RUN#<run_id>",
        sortKeyPattern: "INTERVIEW_SESSION#<session_number>#<interview_session_id>",
        requiredAttributes: ["id", "runId", "sessionNumber"],
        statusAttributes: ["status"],
        timestampAttributes: ["startedAt", "endedAt", "createdAt"],
        references: [
          {
            attribute: "runId",
            references: "run",
            relationship: "Parent run."
          }
        ]
      },
      {
        entity: "interview_turn",
        description: "One AI or participant transcript turn with timing metadata.",
        partitionKeyPattern: "INTERVIEW_SESSION#<interview_session_id>",
        sortKeyPattern: "TURN#<created_at>#<interview_turn_id>",
        requiredAttributes: ["id", "runId", "interviewSessionId", "speaker", "text"],
        statusAttributes: [],
        timestampAttributes: ["createdAt"],
        references: [
          {
            attribute: "runId",
            references: "run",
            relationship: "Parent run."
          },
          {
            attribute: "interviewSessionId",
            references: "interview_session",
            relationship: "Parent interview session."
          }
        ]
      },
      {
        entity: "interview_audio_asset",
        description: "S3 audio reference and timing metadata for a run/session.",
        partitionKeyPattern: "RUN#<run_id>",
        sortKeyPattern: "AUDIO_ASSET#<interview_audio_asset_id>",
        requiredAttributes: ["id", "runId", "interviewSessionId", "storageUri", "durationSeconds"],
        statusAttributes: ["status"],
        timestampAttributes: ["createdAt"],
        references: [
          {
            attribute: "runId",
            references: "run",
            relationship: "Parent run."
          },
          {
            attribute: "interviewSessionId",
            references: "interview_session",
            relationship: "Parent interview session."
          }
        ]
      }
    ]
  },
  {
    key: "evidenceScoring",
    sharedLanguageName: "Evidence Scoring Table",
    cdkConstructId: "EvidenceScoringTable",
    tableNameSuffix: "evidence-scoring",
    description: "Scoring runs, objective scores, and stable evidence citations.",
    partitionKey: "pk",
    sortKey: "sk",
    indexes: [
      {
        name: "byRunScoring",
        partitionKey: "gsi1pk",
        sortKey: "gsi1sk",
        purpose: "List scoring runs for a run in score order."
      },
      {
        name: "byObjectiveVersion",
        partitionKey: "gsi2pk",
        sortKey: "gsi2sk",
        purpose: "Find scores by objective version for rescoring comparison."
      },
      {
        name: "byCitationTarget",
        partitionKey: "gsi3pk",
        sortKey: "gsi3sk",
        purpose: "Resolve scores that cite a survey response, interview turn, or audio span."
      }
    ],
    entities: [
      {
        entity: "scoring_run",
        description: "Automatic or manual scoring attempt for a run.",
        partitionKeyPattern: "RUN#<run_id>",
        sortKeyPattern: "SCORING_RUN#<scored_at>#<scoring_run_id>",
        requiredAttributes: ["id", "runId", "trigger", "modelName", "modelVersion", "objectiveVersionSetHash"],
        statusAttributes: ["status"],
        timestampAttributes: ["createdAt", "scoredAt"],
        references: [
          {
            attribute: "runId",
            references: "run",
            relationship: "Parent run."
          }
        ]
      },
      {
        entity: "objective_score",
        description: "Per-objective score output for a scoring run.",
        partitionKeyPattern: "SCORING_RUN#<scoring_run_id>",
        sortKeyPattern: "OBJECTIVE_SCORE#<objective_version_id>",
        requiredAttributes: ["id", "scoringRunId", "objectiveVersionId", "gradeLabel", "confidence", "rationale", "flags"],
        statusAttributes: ["flags"],
        timestampAttributes: ["createdAt"],
        references: [
          {
            attribute: "scoringRunId",
            references: "scoring_run",
            relationship: "Parent scoring run."
          },
          {
            attribute: "objectiveVersionId",
            references: "objective_version",
            relationship: "Objective version scored."
          }
        ]
      },
      {
        entity: "evidence_citation",
        description: "Stable reference from a score to raw evidence or an audio span.",
        partitionKeyPattern: "OBJECTIVE_SCORE#<objective_score_id>",
        sortKeyPattern: "CITATION#<source_type>#<evidence_citation_id>",
        requiredAttributes: ["id", "objectiveScoreId", "runId", "sourceType", "sourceId", "quote"],
        statusAttributes: [],
        timestampAttributes: ["createdAt"],
        references: [
          {
            attribute: "objectiveScoreId",
            references: "objective_score",
            relationship: "Parent objective score."
          },
          {
            attribute: "runId",
            references: "run",
            relationship: "Run that owns the cited evidence."
          }
        ]
      }
    ]
  },
  {
    key: "operations",
    sharedLanguageName: "Operations Table",
    cdkConstructId: "OperationsTable",
    tableNameSuffix: "operations",
    description: "Operational telemetry and audit logs separated from researcher-facing data.",
    partitionKey: "pk",
    sortKey: "sk",
    indexes: [
      {
        name: "byRunOperationalEvent",
        partitionKey: "gsi1pk",
        sortKey: "gsi1sk",
        purpose: "List operational events for a run."
      },
      {
        name: "byStudyAudit",
        partitionKey: "gsi2pk",
        sortKey: "gsi2sk",
        purpose: "List audit logs for a study."
      },
      {
        name: "byActorAudit",
        partitionKey: "gsi3pk",
        sortKey: "gsi3sk",
        purpose: "List audit logs for an actor."
      }
    ],
    entities: [
      {
        entity: "operational_event",
        description: "Engineering telemetry for run-related failures, retries, audio state, and provider categories.",
        partitionKeyPattern: "RUN#<run_id>",
        sortKeyPattern: "OPERATIONAL_EVENT#<created_at>#<operational_event_id>",
        requiredAttributes: ["id", "runId", "participantSlotId", "eventType", "serviceRequestId"],
        statusAttributes: ["eventType", "audioConnectionState", "modelApiErrorCategory"],
        timestampAttributes: ["createdAt"],
        references: [
          {
            attribute: "runId",
            references: "run",
            relationship: "Run associated with the event."
          },
          {
            attribute: "participantSlotId",
            references: "participant_slot",
            relationship: "Participant slot associated with the event."
          }
        ]
      },
      {
        entity: "audit_log",
        description: "Audited record of sensitive access or mutation.",
        partitionKeyPattern: "STUDY#<study_id>",
        sortKeyPattern: "AUDIT#<created_at>#<audit_log_id>",
        requiredAttributes: ["id", "actorUserId", "actorRole", "studyId", "entityType", "entityId", "action"],
        statusAttributes: ["action"],
        timestampAttributes: ["createdAt"],
        references: [
          {
            attribute: "actorUserId",
            references: "user",
            relationship: "Actor who performed the audited action."
          },
          {
            attribute: "studyId",
            references: "study",
            relationship: "Study affected by the audited action."
          }
        ]
      }
    ]
  }
] as const satisfies readonly DataDomainTableDefinition[];

export const DEFERRED_SCHEMA_ENTITIES = [
  {
    entity: "study_membership",
    reason: "Study collaborator support is not part of the first physical schema."
  },
  {
    entity: "participant_access_token",
    reason: "Participant access token/link behavior is intentionally deferred."
  },
  {
    entity: "retention_policy",
    reason: "Retention and deletion fields are deferred until retention behavior is designed."
  }
] as const;

export function getTableByKey(key: DataDomainTableKey) {
  return DATA_DOMAIN_TABLES.find((table) => table.key === key);
}

export function getEntityDefinition(
  entity: DataDomainEntity
): { table: DataDomainTableDefinition; definition: EntityDefinition } | undefined {
  for (const table of DATA_DOMAIN_TABLES) {
    const definition = (table.entities as readonly EntityDefinition[]).find((candidate) => candidate.entity === entity);
    if (definition) {
      return {
        table,
        definition
      };
    }
  }

  return undefined;
}
