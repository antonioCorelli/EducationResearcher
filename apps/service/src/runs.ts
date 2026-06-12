import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ConsentMethod, ConsentVersion, ConsentVersionStore } from "./consent.js";
import type { ObjectiveVersionStore } from "./objectives.js";
import type { ParticipantSlotStore } from "./participant-slots.js";
import { V1_DEFAULT_PERSONA_STYLE_PROMPT, type StudyShell } from "./study-shell.js";
import type { SurveyQuestion, SurveyVersion, SurveyVersionStore } from "./survey.js";
import {
  REALTIME_INTERVIEW_PROMPT_VERSION,
  buildRealtimeInterviewInstructions,
  type RealtimeInterviewContextTurn,
  type RealtimeVoiceProvider
} from "./voice-provider.js";
import {
  createConfiguredInterviewAudioStorage,
  type InterviewAudioStorage
} from "./interview-audio-storage.js";

export const RUN_STATUSES = [
  "created",
  "consented",
  "survey_in_progress",
  "survey_completed",
  "interview_in_progress",
  "interview_paused",
  "interview_completed",
  "stale",
  "partial",
  "technical_interruption",
  "scored"
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_TRANSITIONS = {
  created: ["consented"],
  consented: ["survey_in_progress"],
  survey_in_progress: ["survey_completed", "stale"],
  survey_completed: ["interview_in_progress", "stale", "partial"],
  interview_in_progress: ["interview_completed", "interview_paused", "stale", "technical_interruption"],
  interview_paused: ["interview_in_progress", "interview_completed", "stale", "partial"],
  interview_completed: ["scored"],
  stale: ["scored"],
  partial: ["scored"],
  technical_interruption: ["scored", "partial"],
  scored: []
} as const satisfies Record<RunStatus, readonly RunStatus[]>;

export const STALE_SWEEP_SOURCE_STATUSES = [
  "survey_in_progress",
  "survey_completed",
  "interview_in_progress",
  "interview_paused"
] as const satisfies readonly RunStatus[];

export interface Run {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly consentVersionId: string;
  readonly surveyVersionId: string;
  readonly personaVersionId: string;
  readonly objectiveVersionIds: readonly string[];
  readonly interviewerInstructions?: string;
  readonly allowWrittenInterviewResponses: boolean;
  readonly freshnessDeadlineAt: string;
  readonly maxInterviewMinutes: number;
  readonly status: RunStatus;
  readonly currentRunForSlot: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResearcherRun extends Run {
  readonly participantAccessUrl?: string;
  readonly participantAccessTokenId?: string;
}

export type ParticipantAccessTokenStatus = "active" | "revoked";

export interface ParticipantAccessToken {
  readonly id: string;
  readonly tokenId: string;
  readonly tokenHash: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly status: ParticipantAccessTokenStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ParticipantRunAccess {
  readonly run: {
    readonly id: string;
    readonly studyId: string;
    readonly participantSlotId: string;
    readonly status: RunStatus;
    readonly freshnessDeadlineAt: string;
    readonly maxInterviewMinutes: number;
    readonly allowWrittenInterviewResponses: boolean;
    readonly remainingInterviewSeconds: number;
  };
  readonly consentVersion?: ConsentVersion;
  readonly surveyVersion?: SurveyVersion;
}

export interface CreateRunsInput {
  readonly participantSlotIds: unknown;
}

export interface CaptureParticipantConsentInput {
  readonly accepted?: unknown;
  readonly signatureText?: unknown;
}

export interface SubmitParticipantSurveyInput {
  readonly responses?: unknown;
}

export interface SaveInterviewArtifactsInput {
  readonly turns?: unknown;
  readonly audioAsset?: unknown;
  readonly transcriptTokenCount?: unknown;
}

export interface CreateRealtimeVoiceSessionInput {
  readonly currentTurns?: unknown;
}

export interface SaveInterviewAudioUploadInput {
  readonly content: Uint8Array;
  readonly durationSeconds?: unknown;
  readonly mimeType?: unknown;
}

export const INTERVIEW_SESSION_STATUSES = ["active", "paused", "completed", "interrupted"] as const;

export type InterviewSessionStatus = (typeof INTERVIEW_SESSION_STATUSES)[number];

export type InterviewInterruptionSafeStatus = "technical_interruption" | "unable_to_complete_interview";
export type InterviewTurnSpeaker = "ai" | "participant";
export type InterviewAudioAssetStatus = "available" | "pending" | "failed";

export interface InterruptInterviewInput {
  readonly safeStatus?: unknown;
}

export interface ConsentRecord {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly consentVersionId: string;
  readonly consentMethod: ConsentMethod;
  readonly signatureText?: string;
  readonly renderedConsentSnapshot: string;
  readonly acceptedAt: string;
  readonly createdAt: string;
}

export interface SurveyResponse {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly surveyVersionId: string;
  readonly surveyQuestionId: string;
  readonly responseText: string;
  readonly submittedAt: string;
  readonly createdAt: string;
}

export interface InterviewSession {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly sessionNumber: number;
  readonly status: InterviewSessionStatus;
  readonly safeStatus?: InterviewInterruptionSafeStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly audioDurationSeconds?: number;
  readonly transcriptTokenCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InterviewTurn {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly interviewSessionId: string;
  readonly sequenceNumber?: number;
  readonly speaker: InterviewTurnSpeaker;
  readonly text: string;
  readonly audioStartMs?: number;
  readonly audioEndMs?: number;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly createdAt: string;
}

export interface InterviewAudioAsset {
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly interviewSessionId: string;
  readonly storageUri: string;
  readonly durationSeconds: number;
  readonly mimeType?: string;
  readonly byteSize?: number;
  readonly status: InterviewAudioAssetStatus;
  readonly createdAt: string;
}

export interface RunStore {
  getById(runId: string): Promise<Run | undefined>;
  listByStudy(studyId: string): Promise<Run[]>;
  listByParticipantSlot(participantSlotId: string): Promise<Run[]>;
  listStaleCandidatesByStudy(studyId: string, now: Date): Promise<Run[]>;
  listConsentRecordsByRun(runId: string): Promise<ConsentRecord[]>;
  listSurveyResponsesByRun(runId: string): Promise<SurveyResponse[]>;
  listInterviewSessionsByRun(runId: string): Promise<InterviewSession[]>;
  listInterviewTurnsByRun(runId: string): Promise<InterviewTurn[]>;
  listInterviewAudioAssetsByRun(runId: string): Promise<InterviewAudioAsset[]>;
  create(run: Run, previousCurrentRuns: readonly Run[]): Promise<Run>;
  updateStatus(run: Run, previousStatus: RunStatus): Promise<Run>;
  captureConsent(record: ConsentRecord, run: Run, previousStatus: RunStatus): Promise<{
    consentRecord: ConsentRecord;
    run: Run;
  }>;
  submitSurvey(responses: readonly SurveyResponse[], run: Run, previousStatus: RunStatus): Promise<{
    surveyResponses: readonly SurveyResponse[];
    run: Run;
  }>;
  createInterviewSession(session: InterviewSession, run: Run, previousStatus: RunStatus): Promise<{
    interviewSession: InterviewSession;
    run: Run;
  }>;
  updateInterviewSession(
    session: InterviewSession,
    run: Run,
    previousRunStatus: RunStatus,
    previousSessionStatus: InterviewSessionStatus
  ): Promise<{
    interviewSession: InterviewSession;
    run: Run;
  }>;
  saveInterviewArtifacts(input: {
    readonly interviewSession: InterviewSession;
    readonly turns: readonly InterviewTurn[];
    readonly audioAsset?: InterviewAudioAsset;
  }): Promise<{
    readonly interviewSession: InterviewSession;
    readonly turns: readonly InterviewTurn[];
    readonly audioAsset?: InterviewAudioAsset;
  }>;
}

export interface ParticipantAccessTokenStore {
  getByTokenId(tokenId: string): Promise<ParticipantAccessToken | undefined>;
  listByRun(runId: string): Promise<ParticipantAccessToken[]>;
  create(token: ParticipantAccessToken): Promise<ParticipantAccessToken>;
}

export interface StaleRunScoringTriggerInput {
  readonly run: Run;
  readonly previousStatus: (typeof STALE_SWEEP_SOURCE_STATUSES)[number];
  readonly triggeredAt: string;
  readonly context: {
    readonly staleRun: true;
    readonly partialRun: true;
  };
}

export interface StaleRunScoringTrigger {
  triggerStaleRunScoring(input: StaleRunScoringTriggerInput): Promise<void>;
}

export interface AutomaticRunScoringTriggerInput {
  readonly run: Run;
  readonly previousStatus: RunStatus;
  readonly triggeredAt: string;
  readonly context?: {
    readonly staleRun?: boolean;
    readonly partialRun?: boolean;
    readonly technicalInterruption?: boolean;
  };
}

export interface AutomaticRunScoringTrigger {
  triggerAutomaticScoring(input: AutomaticRunScoringTriggerInput): Promise<unknown>;
}

interface RunItem {
  readonly entity: "run";
  readonly pk: string;
  readonly sk: "PROFILE";
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly gsi2pk: string;
  readonly gsi2sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly consentVersionId: string;
  readonly surveyVersionId: string;
  readonly personaVersionId: string;
  readonly objectiveVersionIds?: readonly string[];
  readonly interviewerInstructions?: string;
  readonly interviewerGoals?: string;
  readonly allowWrittenInterviewResponses?: boolean;
  readonly freshnessDeadlineAt: string;
  readonly maxInterviewMinutes: number;
  readonly status: RunStatus;
  readonly currentRunForSlot: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ParticipantAccessTokenItem {
  readonly entity: "participant_access_token";
  readonly pk: string;
  readonly sk: string;
  readonly gsi1pk: string;
  readonly gsi1sk: string;
  readonly gsi2pk: string;
  readonly gsi2sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly tokenId: string;
  readonly tokenHash: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly status: ParticipantAccessTokenStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ConsentRecordItem {
  readonly entity: "consent_record";
  readonly pk: string;
  readonly sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly consentVersionId: string;
  readonly consentMethod: ConsentMethod;
  readonly signatureText?: string;
  readonly renderedConsentSnapshot: string;
  readonly acceptedAt: string;
  readonly createdAt: string;
}

interface SurveyResponseItem {
  readonly entity: "survey_response";
  readonly pk: string;
  readonly sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly surveyVersionId: string;
  readonly surveyQuestionId: string;
  readonly responseText: string;
  readonly submittedAt: string;
  readonly createdAt: string;
}

interface InterviewSessionItem {
  readonly entity: "interview_session";
  readonly pk: string;
  readonly sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly sessionNumber: number;
  readonly status: InterviewSessionStatus;
  readonly safeStatus?: InterviewInterruptionSafeStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly audioDurationSeconds?: number;
  readonly transcriptTokenCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface InterviewTurnItem {
  readonly entity: "interview_turn";
  readonly pk: string;
  readonly sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly interviewSessionId: string;
  readonly sequenceNumber?: number;
  readonly speaker: InterviewTurnSpeaker;
  readonly text: string;
  readonly audioStartMs?: number;
  readonly audioEndMs?: number;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly createdAt: string;
}

interface InterviewAudioAssetItem {
  readonly entity: "interview_audio_asset";
  readonly pk: string;
  readonly sk: string;
  readonly gsi3pk: string;
  readonly gsi3sk: string;
  readonly id: string;
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly interviewSessionId: string;
  readonly storageUri: string;
  readonly durationSeconds: number;
  readonly mimeType?: string;
  readonly byteSize?: number;
  readonly status: InterviewAudioAssetStatus;
  readonly createdAt: string;
}

export class RunValidationError extends Error {
  readonly statusCode = 400;

  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "RunValidationError";
  }
}

export class ParticipantAccessError extends Error {
  readonly statusCode = 403;

  constructor(readonly safeMessage = "This participant link is not available.") {
    super(safeMessage);
    this.name = "ParticipantAccessError";
  }
}

export interface RunServiceOptions {
  readonly now?: () => Date;
  readonly createRunId?: () => string;
  readonly createConsentRecordId?: () => string;
  readonly createInterviewAudioAssetId?: () => string;
  readonly createInterviewSessionId?: () => string;
  readonly createInterviewTurnId?: () => string;
  readonly createSurveyResponseId?: () => string;
  readonly createParticipantAccessTokenId?: () => string;
  readonly interviewAudioStorage?: InterviewAudioStorage;
  readonly maxInterviewAudioUploadBytes?: number;
  readonly participantAccessBaseUrl?: string;
  readonly participantAccessTokenSecret?: string;
  readonly staleRunScoringTrigger?: StaleRunScoringTrigger;
  readonly automaticScoringTrigger?: AutomaticRunScoringTrigger;
}

export class RunService {
  private readonly now: () => Date;
  private readonly createRunId: () => string;
  private readonly createConsentRecordId: () => string;
  private readonly createInterviewAudioAssetId: () => string;
  private readonly createInterviewSessionId: () => string;
  private readonly createInterviewTurnId: () => string;
  private readonly createSurveyResponseId: () => string;
  private readonly createParticipantAccessTokenId: () => string;
  private readonly interviewAudioStorage: InterviewAudioStorage;
  private readonly maxInterviewAudioUploadBytes: number;
  private readonly participantAccessBaseUrl: string;
  private readonly participantAccessTokenSecret: string;
  private readonly staleRunScoringTrigger?: StaleRunScoringTrigger;
  private readonly automaticScoringTrigger?: AutomaticRunScoringTrigger;

  constructor(
    private readonly runStore: RunStore,
    private readonly participantAccessTokenStore: ParticipantAccessTokenStore,
    private readonly participantSlotStore: Pick<ParticipantSlotStore, "listByStudy">,
    private readonly objectiveVersionStore: Pick<ObjectiveVersionStore, "listByStudy">,
    private readonly consentVersionStore: Pick<ConsentVersionStore, "listByStudy">,
    private readonly surveyVersionStore: Pick<SurveyVersionStore, "listByStudy">,
    options: RunServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createRunId = options.createRunId ?? (() => `run_${randomUUID()}`);
    this.createConsentRecordId = options.createConsentRecordId ?? (() => `consent_record_${randomUUID()}`);
    this.createInterviewAudioAssetId =
      options.createInterviewAudioAssetId ?? (() => `interview_audio_asset_${randomUUID()}`);
    this.createInterviewSessionId = options.createInterviewSessionId ?? (() => `interview_session_${randomUUID()}`);
    this.createInterviewTurnId = options.createInterviewTurnId ?? (() => `interview_turn_${randomUUID()}`);
    this.createSurveyResponseId = options.createSurveyResponseId ?? (() => `survey_response_${randomUUID()}`);
    this.createParticipantAccessTokenId =
      options.createParticipantAccessTokenId ?? (() => createSecureRandomTokenId());
    this.interviewAudioStorage = options.interviewAudioStorage ?? createConfiguredInterviewAudioStorage();
    this.maxInterviewAudioUploadBytes = options.maxInterviewAudioUploadBytes ?? 100 * 1024 * 1024;
    this.participantAccessBaseUrl =
      options.participantAccessBaseUrl ?? process.env.PARTICIPANT_ACCESS_BASE_URL ?? "http://localhost:5173";
    this.participantAccessTokenSecret =
      options.participantAccessTokenSecret ?? getConfiguredParticipantAccessTokenSecret();
    this.staleRunScoringTrigger = options.staleRunScoringTrigger;
    this.automaticScoringTrigger = options.automaticScoringTrigger;
  }

  async listForStudy(studyId: string) {
    const runs = await this.runStore.listByStudy(studyId);

    return {
      runs: await Promise.all(runs.map((run) => this.toResearcherRun(run)))
    };
  }

  async createRuns(study: StudyShell, input: CreateRunsInput) {
    const participantSlotIds = parseParticipantSlotIds(input.participantSlotIds);
    const participantSlots = await this.participantSlotStore.listByStudy(study.id);
    const slotsById = new Map(participantSlots.map((slot) => [slot.id, slot]));
    const activeObjectiveVersionIds = (await this.objectiveVersionStore.listByStudy(study.id))
      .filter((version) => version.isActive && version.isEnabled !== false)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((version) => version.id);

    if (!study.activeConsentVersionId) {
      throw new RunValidationError("Active consent is required before creating runs.");
    }

    if (!study.activeSurveyVersionId) {
      throw new RunValidationError("Active survey is required before creating runs.");
    }

    if (activeObjectiveVersionIds.length === 0) {
      throw new RunValidationError("At least one enabled scoring objective is required before creating runs.");
    }

    const createdRuns: ResearcherRun[] = [];

    for (const participantSlotId of participantSlotIds) {
      const slot = slotsById.get(participantSlotId);

      if (!slot || slot.studyId !== study.id) {
        throw new RunValidationError("Participant slot was not found.");
      }

      if (slot.status !== "active") {
        throw new RunValidationError("Runs can only be created for active participant slots.");
      }

      const createdAt = this.now().toISOString();
      const previousCurrentRuns = (await this.runStore.listByParticipantSlot(participantSlotId)).filter(
        (run) => run.currentRunForSlot
      );
      const run: Run = {
        id: this.createRunId(),
        studyId: study.id,
        participantSlotId,
        consentVersionId: study.activeConsentVersionId,
        surveyVersionId: study.activeSurveyVersionId,
        personaVersionId: study.activePersonaVersionId,
        objectiveVersionIds: activeObjectiveVersionIds,
        interviewerInstructions: study.interviewerInstructions,
        allowWrittenInterviewResponses: study.allowWrittenInterviewResponses,
        freshnessDeadlineAt: addDays(this.now(), study.defaultFreshnessDays).toISOString(),
        maxInterviewMinutes: study.defaultMaxInterviewMinutes,
        status: "created",
        currentRunForSlot: true,
        createdAt,
        updatedAt: createdAt
      };

      const createdRun = await this.runStore.create(run, previousCurrentRuns);
      const tokenId = this.createParticipantAccessTokenId();
      const rawToken = createParticipantAccessTokenValue({
        tokenId,
        runId: createdRun.id,
        participantSlotId: createdRun.participantSlotId,
        secret: this.participantAccessTokenSecret
      });

      await this.participantAccessTokenStore.create({
        id: `participant_access_token_${randomUUID()}`,
        tokenId,
        tokenHash: hashParticipantAccessToken(rawToken),
        studyId: createdRun.studyId,
        participantSlotId: createdRun.participantSlotId,
        runId: createdRun.id,
        status: "active",
        createdAt,
        updatedAt: createdAt
      });

      createdRuns.push(await this.toResearcherRun(createdRun, rawToken));
    }

    return {
      createdRuns
    };
  }

  async validateParticipantAccess(rawToken: string): Promise<ParticipantRunAccess> {
    const run = await this.resolveParticipantRun(rawToken);
    const consentVersion = run.status === "created" ? await this.getRunConsentVersion(run) : undefined;
    const surveyVersion = isParticipantSurveyRenderableRunStatus(run.status)
      ? await this.getRunSurveyVersion(run)
      : undefined;

    return {
      run: await this.toParticipantRunSummary(run),
      ...(consentVersion ? { consentVersion } : {}),
      ...(surveyVersion ? { surveyVersion } : {})
    };
  }

  async captureParticipantConsent(rawToken: string, input: CaptureParticipantConsentInput) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status !== "created") {
      throw new ParticipantAccessError("Consent cannot be submitted for this run.");
    }

    const consentVersion = await this.getRunConsentVersion(run);
    const acceptedAt = this.now().toISOString();
    const record: ConsentRecord = {
      id: this.createConsentRecordId(),
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      consentVersionId: consentVersion.id,
      consentMethod: consentVersion.consentMethod,
      ...parseConsentAcceptance(consentVersion.consentMethod, input),
      renderedConsentSnapshot: consentVersion.consentText,
      acceptedAt,
      createdAt: acceptedAt
    };
    const consentedRun = applyRunStatusTransition(run, "consented", this.now());

    return this.runStore.captureConsent(record, consentedRun, run.status);
  }

  async submitParticipantSurvey(rawToken: string, input: SubmitParticipantSurveyInput) {
    const run = await this.resolveParticipantRun(rawToken);

    if (!isParticipantSurveySubmittableRunStatus(run.status)) {
      throw new ParticipantAccessError("Survey cannot be submitted for this run.");
    }

    const existingResponses = await this.runStore.listSurveyResponsesByRun(run.id);

    if (existingResponses.length > 0) {
      throw new ParticipantAccessError("Survey has already been submitted for this run.");
    }

    const surveyVersion = await this.getRunSurveyVersion(run);
    const submittedAt = this.now().toISOString();
    const surveyResponses = parseSurveyResponses(input, surveyVersion).map((response) => ({
      id: this.createSurveyResponseId(),
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      surveyVersionId: run.surveyVersionId,
      surveyQuestionId: response.surveyQuestionId,
      responseText: response.responseText,
      submittedAt,
      createdAt: submittedAt
    }));
    const startedRun =
      run.status === "consented" ? applyRunStatusTransition(run, "survey_in_progress", this.now()) : run;
    const submittedRun = applyRunStatusTransition(startedRun, "survey_completed", this.now());

    const result = await this.runStore.submitSurvey(surveyResponses, submittedRun, run.status);

    return this.withRemainingInterviewTime(result);
  }

  async startParticipantInterview(rawToken: string) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status === "interview_in_progress") {
      const activeSession = await this.getActiveInterviewSession(run.id);

      if (activeSession) {
        return this.withRemainingInterviewTime({
          interviewSession: activeSession,
          run
        });
      }
    }

    if (run.status !== "survey_completed") {
      throw new ParticipantAccessError("Interview cannot be started for this run.");
    }

    await this.requireInterviewTimeRemaining(run);

    return this.createInterviewSessionForRun(run);
  }

  async pauseParticipantInterview(rawToken: string) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status === "interview_paused") {
      const pausedSession = await this.getLatestInterviewSession(run.id, "paused");

      if (pausedSession) {
        return this.withRemainingInterviewTime({
          interviewSession: pausedSession,
          run
        });
      }
    }

    if (run.status !== "interview_in_progress") {
      throw new ParticipantAccessError("Interview cannot be paused for this run.");
    }

    const activeSession = await this.requireActiveInterviewSession(run.id);
    const pausedAt = this.now().toISOString();
    const pausedSession: InterviewSession = {
      ...activeSession,
      status: "paused",
      endedAt: pausedAt,
      updatedAt: pausedAt
    };
    const pausedRun = applyRunStatusTransition(run, "interview_paused", this.now());

    return this.withRemainingInterviewTime(
      await this.runStore.updateInterviewSession(pausedSession, pausedRun, run.status, activeSession.status)
    );
  }

  async resumeParticipantInterview(rawToken: string) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status === "interview_in_progress") {
      const activeSession = await this.getActiveInterviewSession(run.id);

      if (activeSession) {
        return this.withRemainingInterviewTime({
          interviewSession: activeSession,
          run
        });
      }
    }

    if (run.status !== "interview_paused") {
      throw new ParticipantAccessError("Interview cannot be resumed for this run.");
    }

    await this.requireInterviewTimeRemaining(run);

    return this.createInterviewSessionForRun(run);
  }

  async completeParticipantInterview(rawToken: string) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status === "interview_completed") {
      const completedSession = await this.getLatestInterviewSession(run.id, "completed");

      if (completedSession) {
        return this.withRemainingInterviewTime({
          interviewSession: completedSession,
          run
        });
      }
    }

    if (run.status !== "interview_in_progress" && run.status !== "interview_paused") {
      throw new ParticipantAccessError("Interview cannot be completed for this run.");
    }

    const sessionToComplete =
      run.status === "interview_in_progress"
        ? await this.requireActiveInterviewSession(run.id)
        : await this.getLatestInterviewSession(run.id, "paused");

    if (!sessionToComplete) {
      throw new ParticipantAccessError("Interview cannot be completed for this run.");
    }

    const completedAt = this.now().toISOString();
    const completedSession: InterviewSession = {
      ...sessionToComplete,
      status: "completed",
      endedAt: sessionToComplete.endedAt ?? completedAt,
      updatedAt: completedAt
    };
    const completedRun = applyRunStatusTransition(run, "interview_completed", this.now());

    const result = await this.runStore.updateInterviewSession(
      completedSession,
      completedRun,
      run.status,
      sessionToComplete.status
    );

    await this.triggerAutomaticScoring({
      run: result.run,
      previousStatus: run.status,
      context: {}
    });

    return this.withRemainingInterviewTime(result);
  }

  async interruptParticipantInterview(rawToken: string, input: InterruptInterviewInput = {}) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status === "technical_interruption") {
      const interruptedSession = await this.getLatestInterviewSession(run.id, "interrupted");

      if (interruptedSession) {
        return this.withRemainingInterviewTime({
          interviewSession: interruptedSession,
          run
        });
      }
    }

    if (run.status !== "interview_in_progress") {
      throw new ParticipantAccessError("Interview cannot be interrupted for this run.");
    }

    const activeSession = await this.requireActiveInterviewSession(run.id);
    const interruptedAt = this.now().toISOString();
    const interruptedSession: InterviewSession = {
      ...activeSession,
      status: "interrupted",
      safeStatus: parseInterviewInterruptionSafeStatus(input.safeStatus),
      endedAt: interruptedAt,
      updatedAt: interruptedAt
    };
    const interruptedRun = applyRunStatusTransition(run, "technical_interruption", this.now());

    const result = await this.runStore.updateInterviewSession(interruptedSession, interruptedRun, run.status, activeSession.status);

    await this.triggerAutomaticScoring({
      run: result.run,
      previousStatus: run.status,
      context: {
        technicalInterruption: true,
        partialRun: true
      }
    });

    return this.withRemainingInterviewTime(result);
  }

  async createParticipantRealtimeVoiceSession(
    rawToken: string,
    voiceProvider: RealtimeVoiceProvider,
    input: CreateRealtimeVoiceSessionInput = {}
  ) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status !== "interview_in_progress") {
      throw new ParticipantAccessError("Realtime voice is only available during an active interview.");
    }

    const interviewSession = await this.requireActiveInterviewSession(run.id);
    const remainingSeconds = await this.requireInterviewTimeRemaining(run);
    const surveyVersion = await this.getRunSurveyVersion(run);
    const surveyResponses = await this.runStore.listSurveyResponsesByRun(run.id);
    const persistedInterviewTurns = await this.runStore.listInterviewTurnsByRun(run.id);
    const currentInterviewTurns = parseRealtimeSessionCurrentTurns(input.currentTurns);
    const interviewTurns = mergeRealtimeInterviewContextTurns(persistedInterviewTurns, currentInterviewTurns);
    const promptInput = {
      run,
      interviewSession,
      surveyVersion,
      surveyResponses,
      interviewTurns,
      ...(run.interviewerInstructions ? { interviewerInstructions: run.interviewerInstructions } : {}),
      personaStylePrompt: V1_DEFAULT_PERSONA_STYLE_PROMPT,
      remainingSeconds,
      nowIso: this.now().toISOString()
    };
    const instructions = buildRealtimeInterviewInstructions(promptInput);
    const realtimeSession = await voiceProvider.createSession({
      promptInput,
      instructions,
      promptVersion: REALTIME_INTERVIEW_PROMPT_VERSION
    });

    return {
      realtimeSession,
      run: await this.toParticipantRunSummary(run),
      interviewSession
    };
  }

  async saveParticipantInterviewArtifacts(rawToken: string, input: SaveInterviewArtifactsInput) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status !== "interview_in_progress") {
      throw new ParticipantAccessError("Interview artifacts can only be saved during an active interview.");
    }

    const activeSession = await this.requireActiveInterviewSession(run.id);
    const createdAt = this.now().toISOString();
    const parsedArtifacts = parseInterviewArtifactsInput(input);
    const existingTurnSequenceNumber = Math.max(
      0,
      ...(await this.runStore.listInterviewTurnsByRun(run.id)).map((turn) => turn.sequenceNumber ?? 0)
    );
    const turns = parsedArtifacts.turns.map((turn, index) => ({
      id: this.createInterviewTurnId(),
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      interviewSessionId: activeSession.id,
      sequenceNumber: existingTurnSequenceNumber + index + 1,
      speaker: turn.speaker,
      text: turn.text,
      ...("audioStartMs" in turn ? { audioStartMs: turn.audioStartMs } : {}),
      ...("audioEndMs" in turn ? { audioEndMs: turn.audioEndMs } : {}),
      ...("startedAt" in turn ? { startedAt: turn.startedAt } : {}),
      ...("endedAt" in turn ? { endedAt: turn.endedAt } : {}),
      createdAt
    }));
    const audioAsset = parsedArtifacts.audioAsset
      ? {
          id: this.createInterviewAudioAssetId(),
          studyId: run.studyId,
          participantSlotId: run.participantSlotId,
          runId: run.id,
          interviewSessionId: activeSession.id,
          storageUri: parsedArtifacts.audioAsset.storageUri,
          durationSeconds: parsedArtifacts.audioAsset.durationSeconds,
          ...("mimeType" in parsedArtifacts.audioAsset ? { mimeType: parsedArtifacts.audioAsset.mimeType } : {}),
          ...("byteSize" in parsedArtifacts.audioAsset ? { byteSize: parsedArtifacts.audioAsset.byteSize } : {}),
          status: parsedArtifacts.audioAsset.status,
          createdAt
        }
      : undefined;
    const interviewSession: InterviewSession = {
      ...activeSession,
      ...(audioAsset ? { audioDurationSeconds: audioAsset.durationSeconds } : {}),
      ...(parsedArtifacts.transcriptTokenCount !== undefined
        ? { transcriptTokenCount: (activeSession.transcriptTokenCount ?? 0) + parsedArtifacts.transcriptTokenCount }
        : {}),
      updatedAt: createdAt
    };

    return this.runStore.saveInterviewArtifacts({
      interviewSession,
      turns,
      ...(audioAsset ? { audioAsset } : {})
    });
  }

  async saveParticipantInterviewAudioUpload(rawToken: string, input: SaveInterviewAudioUploadInput) {
    const run = await this.resolveParticipantRun(rawToken);

    if (run.status !== "interview_in_progress") {
      throw new ParticipantAccessError("Interview audio can only be saved during an active interview.");
    }

    const activeSession = await this.requireActiveInterviewSession(run.id);
    const parsedUpload = parseInterviewAudioUpload(input, this.maxInterviewAudioUploadBytes);
    const createdAt = this.now().toISOString();
    const audioAssetId = this.createInterviewAudioAssetId();
    const storageKey = createInterviewAudioStorageKey({
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      interviewSessionId: activeSession.id,
      audioAssetId,
      mimeType: parsedUpload.mimeType
    });
    const storedAudio = await this.interviewAudioStorage.save({
      storageKey,
      content: parsedUpload.content,
      mimeType: parsedUpload.mimeType
    });
    const audioAsset: InterviewAudioAsset = {
      id: audioAssetId,
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      interviewSessionId: activeSession.id,
      storageUri: storedAudio.storageUri,
      durationSeconds: parsedUpload.durationSeconds,
      mimeType: parsedUpload.mimeType,
      byteSize: parsedUpload.content.byteLength,
      status: "available",
      createdAt
    };
    const interviewSession: InterviewSession = {
      ...activeSession,
      audioDurationSeconds: (activeSession.audioDurationSeconds ?? 0) + audioAsset.durationSeconds,
      updatedAt: createdAt
    };

    return this.runStore.saveInterviewArtifacts({
      interviewSession,
      turns: [],
      audioAsset
    });
  }

  async transitionRunStatus(runId: string, status: RunStatus) {
    const run = await this.runStore.getById(runId);

    if (!run) {
      throw new RunValidationError("Run was not found.");
    }

    const transitionedRun = applyRunStatusTransition(run, status, this.now());

    if (transitionedRun === run) {
      return run;
    }

    return this.runStore.updateStatus(transitionedRun, run.status);
  }

  async sweepStaleRunsForStudy(studyId: string) {
    const sweepTime = this.now();
    const triggeredAt = sweepTime.toISOString();
    const candidates = await this.runStore.listStaleCandidatesByStudy(studyId, sweepTime);
    const staleRuns: Run[] = [];

    for (const candidate of candidates) {
      if (!isStaleSweepSourceStatus(candidate.status)) {
        continue;
      }

      const staleRun = applyRunStatusTransition(candidate, "stale", sweepTime);

      if (staleRun === candidate) {
        continue;
      }

      const persistedRun = await this.runStore.updateStatus(staleRun, candidate.status);
      staleRuns.push(persistedRun);

      await this.triggerAutomaticScoring({
        run: persistedRun,
        previousStatus: candidate.status,
        context: {
          staleRun: true,
          partialRun: true
        }
      });

      await this.staleRunScoringTrigger?.triggerStaleRunScoring({
        run: persistedRun,
        previousStatus: candidate.status,
        triggeredAt,
        context: {
          staleRun: true,
          partialRun: true
        }
      });
    }

    return {
      staleRuns
    };
  }

  private async triggerAutomaticScoring(input: {
    readonly run: Run;
    readonly previousStatus: RunStatus;
    readonly context?: AutomaticRunScoringTriggerInput["context"];
  }) {
    if (!this.automaticScoringTrigger) {
      return;
    }

    await this.automaticScoringTrigger.triggerAutomaticScoring({
      ...input,
      triggeredAt: this.now().toISOString()
    });
  }

  private async createInterviewSessionForRun(run: Run) {
    const startedAt = this.now().toISOString();
    const sessionNumber = (await this.runStore.listInterviewSessionsByRun(run.id)).reduce(
      (highestSessionNumber, session) => Math.max(highestSessionNumber, session.sessionNumber),
      0
    ) + 1;
    const session: InterviewSession = {
      id: this.createInterviewSessionId(),
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      runId: run.id,
      sessionNumber,
      status: "active",
      startedAt,
      createdAt: startedAt,
      updatedAt: startedAt
    };
    const activeRun = applyRunStatusTransition(run, "interview_in_progress", this.now());

    return this.withRemainingInterviewTime(await this.runStore.createInterviewSession(session, activeRun, run.status));
  }

  private async requireInterviewTimeRemaining(run: Run) {
    const remainingSeconds = await this.calculateRemainingInterviewSeconds(run);

    if (remainingSeconds <= 0) {
      throw new ParticipantAccessError("Interview time has ended for this run.");
    }

    return remainingSeconds;
  }

  private async calculateRemainingInterviewSeconds(run: Run) {
    return calculateRemainingInterviewSeconds(run, await this.runStore.listInterviewSessionsByRun(run.id), this.now());
  }

  private async toParticipantRunSummary(run: Run): Promise<ParticipantRunAccess["run"]> {
    return {
      id: run.id,
      studyId: run.studyId,
      participantSlotId: run.participantSlotId,
      status: run.status,
      freshnessDeadlineAt: run.freshnessDeadlineAt,
      maxInterviewMinutes: run.maxInterviewMinutes,
      allowWrittenInterviewResponses: run.allowWrittenInterviewResponses,
      remainingInterviewSeconds: await this.calculateRemainingInterviewSeconds(run)
    };
  }

  private async withRemainingInterviewTime<T extends { readonly run: Run }>(result: T) {
    return {
      ...result,
      run: {
        ...result.run,
        remainingInterviewSeconds: await this.calculateRemainingInterviewSeconds(result.run)
      }
    };
  }

  private async toResearcherRun(run: Run, rawToken?: string): Promise<ResearcherRun> {
    let token = rawToken;
    let tokenId: string | undefined;

    if (!token) {
      const activeTokenRecord = (await this.participantAccessTokenStore.listByRun(run.id)).find(
        (record) => record.status === "active"
      );

      if (activeTokenRecord) {
        tokenId = activeTokenRecord.tokenId;
        token = createParticipantAccessTokenValue({
          tokenId: activeTokenRecord.tokenId,
          runId: run.id,
          participantSlotId: run.participantSlotId,
          secret: this.participantAccessTokenSecret
        });
      }
    }

    return {
      ...run,
      ...(token
        ? {
            participantAccessUrl: createParticipantAccessUrl(this.participantAccessBaseUrl, token),
            participantAccessTokenId: tokenId ?? parseParticipantAccessTokenValue(token)?.tokenId
          }
      : {})
    };
  }

  private async resolveParticipantRun(rawToken: string) {
    const parsedToken = parseParticipantAccessTokenValue(rawToken);

    if (!parsedToken) {
      throw new ParticipantAccessError();
    }

    const tokenRecord = await this.participantAccessTokenStore.getByTokenId(parsedToken.tokenId);

    if (!tokenRecord || tokenRecord.status !== "active") {
      throw new ParticipantAccessError();
    }

    const expectedToken = createParticipantAccessTokenValue({
      tokenId: tokenRecord.tokenId,
      runId: tokenRecord.runId,
      participantSlotId: tokenRecord.participantSlotId,
      secret: this.participantAccessTokenSecret
    });

    if (
      !safeEqual(hashParticipantAccessToken(rawToken), tokenRecord.tokenHash) ||
      !safeEqual(hashParticipantAccessToken(expectedToken), tokenRecord.tokenHash)
    ) {
      throw new ParticipantAccessError();
    }

    const run = await this.runStore.getById(tokenRecord.runId);

    if (
      !run ||
      run.studyId !== tokenRecord.studyId ||
      run.participantSlotId !== tokenRecord.participantSlotId ||
      !isParticipantAccessibleRunStatus(run.status) ||
      (isParticipantActiveRunStatus(run.status) && new Date(run.freshnessDeadlineAt).getTime() <= this.now().getTime())
    ) {
      throw new ParticipantAccessError();
    }

    const participantSlot = (await this.participantSlotStore.listByStudy(run.studyId)).find(
      (slot) => slot.id === run.participantSlotId
    );

    if (!participantSlot || participantSlot.status !== "active") {
      throw new ParticipantAccessError();
    }

    return run;
  }

  private async getRunConsentVersion(run: Run) {
    const consentVersion = (await this.consentVersionStore.listByStudy(run.studyId)).find(
      (version) => version.id === run.consentVersionId
    );

    if (!consentVersion) {
      throw new ParticipantAccessError();
    }

    return consentVersion;
  }

  private async getRunSurveyVersion(run: Run) {
    const surveyVersion = (await this.surveyVersionStore.listByStudy(run.studyId)).find(
      (version) => version.id === run.surveyVersionId
    );

    if (!surveyVersion) {
      throw new ParticipantAccessError();
    }

    return surveyVersion;
  }

  private async getActiveInterviewSession(runId: string) {
    return (await this.runStore.listInterviewSessionsByRun(runId)).find((session) => session.status === "active");
  }

  private async getLatestInterviewSession(runId: string, status: InterviewSessionStatus) {
    return (await this.runStore.listInterviewSessionsByRun(runId)).find((session) => session.status === status);
  }

  private async requireActiveInterviewSession(runId: string) {
    const activeSession = await this.getActiveInterviewSession(runId);

    if (!activeSession) {
      throw new RunValidationError("Active interview session was not found.");
    }

    return activeSession;
  }
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, Run>();

  constructor(initialRuns: readonly Run[] = []) {
    for (const run of initialRuns) {
      this.runs.set(run.id, run);
    }
  }

  async getById(runId: string) {
    return this.runs.get(runId);
  }

  async listByStudy(studyId: string) {
    return [...this.runs.values()]
      .filter((run) => run.studyId === studyId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listByParticipantSlot(participantSlotId: string) {
    return [...this.runs.values()]
      .filter((run) => run.participantSlotId === participantSlotId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listStaleCandidatesByStudy(studyId: string, now: Date) {
    const nowTime = now.getTime();

    return [...this.runs.values()]
      .filter(
        (run) =>
          run.studyId === studyId &&
          isStaleSweepSourceStatus(run.status) &&
          new Date(run.freshnessDeadlineAt).getTime() <= nowTime
      )
      .sort((left, right) => left.freshnessDeadlineAt.localeCompare(right.freshnessDeadlineAt));
  }

  async listConsentRecordsByRun(runId: string) {
    return [...this.runs.values()]
      .filter((run) => run.id === runId)
      .flatMap(() => [...this.consentRecords.values()].filter((record) => record.runId === runId))
      .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt));
  }

  async listSurveyResponsesByRun(runId: string) {
    return [...this.surveyResponses.values()]
      .filter((response) => response.runId === runId)
      .sort((left, right) => left.surveyQuestionId.localeCompare(right.surveyQuestionId));
  }

  async listInterviewSessionsByRun(runId: string) {
    return [...this.interviewSessions.values()]
      .filter((session) => session.runId === runId)
      .sort((left, right) => right.sessionNumber - left.sessionNumber);
  }

  async listInterviewTurnsByRun(runId: string) {
    return [...this.interviewTurns.values()]
      .filter((turn) => turn.runId === runId)
      .sort(compareInterviewTurns);
  }

  async listInterviewAudioAssetsByRun(runId: string) {
    return [...this.interviewAudioAssets.values()]
      .filter((asset) => asset.runId === runId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(run: Run, previousCurrentRuns: readonly Run[]) {
    for (const previousRun of previousCurrentRuns) {
      this.runs.set(previousRun.id, {
        ...previousRun,
        currentRunForSlot: false,
        updatedAt: run.createdAt
      });
    }

    this.runs.set(run.id, run);
    return run;
  }

  async updateStatus(run: Run, previousStatus: RunStatus) {
    const currentRun = this.runs.get(run.id);

    if (!currentRun) {
      throw new RunValidationError("Run was not found.");
    }

    if (currentRun.status !== previousStatus) {
      throw new RunValidationError(`Run cannot transition from ${currentRun.status} to ${run.status}.`);
    }

    this.runs.set(run.id, run);
    return run;
  }

  private readonly consentRecords = new Map<string, ConsentRecord>();
  private readonly surveyResponses = new Map<string, SurveyResponse>();
  private readonly interviewSessions = new Map<string, InterviewSession>();
  private readonly interviewTurns = new Map<string, InterviewTurn>();
  private readonly interviewAudioAssets = new Map<string, InterviewAudioAsset>();

  async captureConsent(record: ConsentRecord, run: Run, previousStatus: RunStatus) {
    const currentRun = this.runs.get(run.id);

    if (!currentRun) {
      throw new RunValidationError("Run was not found.");
    }

    if (currentRun.status !== previousStatus) {
      throw new RunValidationError(`Run cannot transition from ${currentRun.status} to ${run.status}.`);
    }

    this.consentRecords.set(record.id, record);
    this.runs.set(run.id, run);

    return {
      consentRecord: record,
      run
    };
  }

  async submitSurvey(responses: readonly SurveyResponse[], run: Run, previousStatus: RunStatus) {
    const currentRun = this.runs.get(run.id);

    if (!currentRun) {
      throw new RunValidationError("Run was not found.");
    }

    if (currentRun.status !== previousStatus) {
      throw new RunValidationError(`Run cannot transition from ${currentRun.status} to ${run.status}.`);
    }

    if ((await this.listSurveyResponsesByRun(run.id)).length > 0) {
      throw new RunValidationError("Survey has already been submitted for this run.");
    }

    for (const response of responses) {
      this.surveyResponses.set(response.id, response);
    }

    this.runs.set(run.id, run);

    return {
      surveyResponses: responses,
      run
    };
  }

  async createInterviewSession(session: InterviewSession, run: Run, previousStatus: RunStatus) {
    const currentRun = this.runs.get(run.id);

    if (!currentRun) {
      throw new RunValidationError("Run was not found.");
    }

    if (currentRun.status !== previousStatus) {
      throw new RunValidationError(`Run cannot transition from ${currentRun.status} to ${run.status}.`);
    }

    if ((await this.listInterviewSessionsByRun(run.id)).some((existingSession) => existingSession.status === "active")) {
      throw new RunValidationError("An active interview session already exists for this run.");
    }

    this.interviewSessions.set(session.id, session);
    this.runs.set(run.id, run);

    return {
      interviewSession: session,
      run
    };
  }

  async updateInterviewSession(
    session: InterviewSession,
    run: Run,
    previousRunStatus: RunStatus,
    previousSessionStatus: InterviewSessionStatus
  ) {
    const currentRun = this.runs.get(run.id);
    const currentSession = this.interviewSessions.get(session.id);

    if (!currentRun) {
      throw new RunValidationError("Run was not found.");
    }

    if (!currentSession) {
      throw new RunValidationError("Interview session was not found.");
    }

    if (currentRun.status !== previousRunStatus) {
      throw new RunValidationError(`Run cannot transition from ${currentRun.status} to ${run.status}.`);
    }

    if (currentSession.status !== previousSessionStatus) {
      throw new RunValidationError(`Interview session cannot transition from ${currentSession.status} to ${session.status}.`);
    }

    this.interviewSessions.set(session.id, session);
    this.runs.set(run.id, run);

    return {
      interviewSession: session,
      run
    };
  }

  async saveInterviewArtifacts(input: {
    readonly interviewSession: InterviewSession;
    readonly turns: readonly InterviewTurn[];
    readonly audioAsset?: InterviewAudioAsset;
  }) {
    const currentSession = this.interviewSessions.get(input.interviewSession.id);

    if (!currentSession) {
      throw new RunValidationError("Interview session was not found.");
    }

    if (currentSession.runId !== input.interviewSession.runId) {
      throw new RunValidationError("Interview session does not belong to this run.");
    }

    for (const turn of input.turns) {
      if (turn.runId !== input.interviewSession.runId || turn.interviewSessionId !== input.interviewSession.id) {
        throw new RunValidationError("Interview turn does not belong to this session.");
      }
    }

    if (
      input.audioAsset &&
      (input.audioAsset.runId !== input.interviewSession.runId ||
        input.audioAsset.interviewSessionId !== input.interviewSession.id)
    ) {
      throw new RunValidationError("Interview audio asset does not belong to this session.");
    }

    this.interviewSessions.set(input.interviewSession.id, input.interviewSession);

    for (const turn of input.turns) {
      this.interviewTurns.set(turn.id, turn);
    }

    if (input.audioAsset) {
      this.interviewAudioAssets.set(input.audioAsset.id, input.audioAsset);
    }

    return input;
  }
}

export class InMemoryParticipantAccessTokenStore implements ParticipantAccessTokenStore {
  private readonly tokens = new Map<string, ParticipantAccessToken>();

  constructor(initialTokens: readonly ParticipantAccessToken[] = []) {
    for (const token of initialTokens) {
      this.tokens.set(token.id, token);
    }
  }

  async getByTokenId(tokenId: string) {
    return [...this.tokens.values()].find((token) => token.tokenId === tokenId);
  }

  async listByRun(runId: string) {
    return [...this.tokens.values()]
      .filter((token) => token.runId === runId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(token: ParticipantAccessToken) {
    this.tokens.set(token.id, token);
    return token;
  }
}

export interface DynamoDbRunStoreOptions {
  readonly tableName?: string;
  readonly environment?: string;
  readonly region?: string;
  readonly endpoint?: string;
}

export class DynamoDbRunStore implements RunStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbRunStoreOptions = {}) {
    const region = options.region ?? process.env.AWS_REGION ?? "us-east-1";
    const client = new DynamoDBClient({
      region,
      ...(options.endpoint || process.env.DYNAMODB_ENDPOINT
        ? {
            endpoint: options.endpoint ?? process.env.DYNAMODB_ENDPOINT,
            credentials: {
              accessKeyId: "local",
              secretAccessKey: "local"
            }
          }
        : {})
    });

    this.documentClient = DynamoDBDocumentClient.from(client);
    this.tableName = options.tableName ?? getRunLifecycleTableName(options.environment);
  }

  async getById(runId: string) {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `RUN#${runId}`,
          sk: "PROFILE"
        }
      })
    );

    if (!response.Item || response.Item.entity !== "run") {
      return undefined;
    }

    return toRun(response.Item as RunItem);
  }

  async listByStudy(studyId: string) {
    const resultSets = await Promise.all(
      RUN_STATUSES.map((status) =>
        this.documentClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: "byStudyRunStatus",
            KeyConditionExpression: "gsi1pk = :status",
            ExpressionAttributeValues: {
              ":status": studyRunStatusPk(studyId, status)
            }
          })
        )
      )
    );

    return resultSets
      .flatMap((response) => response.Items ?? [])
      .filter((item) => item.entity === "run")
      .map((item) => toRun(item as RunItem))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listByParticipantSlot(participantSlotId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "byParticipantSlot",
        KeyConditionExpression: "gsi2pk = :slot",
        ExpressionAttributeValues: {
          ":slot": `SLOT#${participantSlotId}`
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "run")
      .map((item) => toRun(item as RunItem))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listStaleCandidatesByStudy(studyId: string, now: Date) {
    const deadlineSk = `FRESHNESS#${now.toISOString()}~`;
    const resultSets = await Promise.all(
      STALE_SWEEP_SOURCE_STATUSES.map((status) =>
        this.documentClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: "byStudyRunStatus",
            KeyConditionExpression: "gsi1pk = :status AND gsi1sk <= :deadline",
            ExpressionAttributeValues: {
              ":status": studyRunStatusPk(studyId, status),
              ":deadline": deadlineSk
            }
          })
        )
      )
    );

    return resultSets
      .flatMap((response) => response.Items ?? [])
      .filter((item) => item.entity === "run")
      .map((item) => toRun(item as RunItem))
      .filter((run) => new Date(run.freshnessDeadlineAt).getTime() <= now.getTime())
      .sort((left, right) => left.freshnessDeadlineAt.localeCompare(right.freshnessDeadlineAt));
  }

  async listConsentRecordsByRun(runId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :run AND begins_with(sk, :recordPrefix)",
        ExpressionAttributeValues: {
          ":run": `RUN#${runId}`,
          ":recordPrefix": "CONSENT_RECORD#"
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "consent_record")
      .map((item) => toConsentRecord(item as ConsentRecordItem))
      .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt));
  }

  async listSurveyResponsesByRun(runId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :run AND begins_with(sk, :responsePrefix)",
        ExpressionAttributeValues: {
          ":run": `RUN#${runId}`,
          ":responsePrefix": "SURVEY_RESPONSE#"
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "survey_response")
      .map((item) => toSurveyResponse(item as SurveyResponseItem))
      .sort((left, right) => left.surveyQuestionId.localeCompare(right.surveyQuestionId));
  }

  async listInterviewSessionsByRun(runId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :run AND begins_with(sk, :sessionPrefix)",
        ExpressionAttributeValues: {
          ":run": `RUN#${runId}`,
          ":sessionPrefix": "INTERVIEW_SESSION#"
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "interview_session")
      .map((item) => toInterviewSession(item as InterviewSessionItem))
      .sort((left, right) => right.sessionNumber - left.sessionNumber);
  }

  async listInterviewTurnsByRun(runId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "byParticipantAccessToken",
        KeyConditionExpression: "gsi3pk = :artifact",
        ExpressionAttributeValues: {
          ":artifact": `RUN#${runId}#ARTIFACT#interview_turn`
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "interview_turn")
      .map((item) => toInterviewTurn(item as InterviewTurnItem))
      .sort(compareInterviewTurns);
  }

  async listInterviewAudioAssetsByRun(runId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "byParticipantAccessToken",
        KeyConditionExpression: "gsi3pk = :artifact",
        ExpressionAttributeValues: {
          ":artifact": `RUN#${runId}#ARTIFACT#interview_audio_asset`
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "interview_audio_asset")
      .map((item) => toInterviewAudioAsset(item as InterviewAudioAssetItem))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(run: Run, previousCurrentRuns: readonly Run[]) {
    for (const previousRun of previousCurrentRuns) {
      await this.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `RUN#${previousRun.id}`,
            sk: "PROFILE"
          },
          UpdateExpression: "SET currentRunForSlot = :currentRunForSlot, updatedAt = :updatedAt",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: {
            ":currentRunForSlot": false,
            ":updatedAt": run.createdAt
          }
        })
      );
    }

    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toRunItem(run),
        ConditionExpression: "attribute_not_exists(pk)"
      })
    );

    return run;
  }

  async updateStatus(run: Run, previousStatus: RunStatus) {
    const response = await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `RUN#${run.id}`,
          sk: "PROFILE"
        },
        UpdateExpression:
          "SET #status = :status, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
        ConditionExpression: "attribute_exists(pk) AND #status = :previousStatus",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": run.status,
          ":previousStatus": previousStatus,
          ":updatedAt": run.updatedAt,
          ":gsi1pk": studyRunStatusPk(run.studyId, run.status),
          ":gsi1sk": studyRunStatusSk(run)
        },
        ReturnValues: "ALL_NEW"
      })
    );

    return toRun(response.Attributes as RunItem);
  }

  async captureConsent(record: ConsentRecord, run: Run, previousStatus: RunStatus) {
    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: toConsentRecordItem(record),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          },
          {
            Update: {
              TableName: this.tableName,
              Key: {
                pk: `RUN#${run.id}`,
                sk: "PROFILE"
              },
              UpdateExpression:
                "SET #status = :status, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
              ConditionExpression: "attribute_exists(pk) AND #status = :previousStatus",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":status": run.status,
                ":previousStatus": previousStatus,
                ":updatedAt": run.updatedAt,
                ":gsi1pk": studyRunStatusPk(run.studyId, run.status),
                ":gsi1sk": studyRunStatusSk(run)
              }
            }
          }
        ]
      })
    );

    return {
      consentRecord: record,
      run
    };
  }

  async submitSurvey(responses: readonly SurveyResponse[], run: Run, previousStatus: RunStatus) {
    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          ...responses.map((response) => ({
            Put: {
              TableName: this.tableName,
              Item: toSurveyResponseItem(response),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          })),
          {
            Update: {
              TableName: this.tableName,
              Key: {
                pk: `RUN#${run.id}`,
                sk: "PROFILE"
              },
              UpdateExpression:
                "SET #status = :status, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
              ConditionExpression: "attribute_exists(pk) AND #status = :previousStatus",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":status": run.status,
                ":previousStatus": previousStatus,
                ":updatedAt": run.updatedAt,
                ":gsi1pk": studyRunStatusPk(run.studyId, run.status),
                ":gsi1sk": studyRunStatusSk(run)
              }
            }
          }
        ]
      })
    );

    return {
      surveyResponses: responses,
      run
    };
  }

  async createInterviewSession(session: InterviewSession, run: Run, previousStatus: RunStatus) {
    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: toInterviewSessionItem(session),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          },
          {
            Update: {
              TableName: this.tableName,
              Key: {
                pk: `RUN#${run.id}`,
                sk: "PROFILE"
              },
              UpdateExpression:
                "SET #status = :status, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
              ConditionExpression: "attribute_exists(pk) AND #status = :previousStatus",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":status": run.status,
                ":previousStatus": previousStatus,
                ":updatedAt": run.updatedAt,
                ":gsi1pk": studyRunStatusPk(run.studyId, run.status),
                ":gsi1sk": studyRunStatusSk(run)
              }
            }
          }
        ]
      })
    );

    return {
      interviewSession: session,
      run
    };
  }

  async updateInterviewSession(
    session: InterviewSession,
    run: Run,
    previousRunStatus: RunStatus,
    previousSessionStatus: InterviewSessionStatus
  ) {
    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: {
                pk: `RUN#${run.id}`,
                sk: `INTERVIEW_SESSION#${session.sessionNumber.toString().padStart(6, "0")}#${session.id}`
              },
              UpdateExpression:
                "SET #status = :status, safeStatus = :safeStatus, endedAt = :endedAt, updatedAt = :updatedAt",
              ConditionExpression: "attribute_exists(pk) AND #status = :previousSessionStatus",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":status": session.status,
                ":safeStatus": session.safeStatus ?? null,
                ":endedAt": session.endedAt,
                ":updatedAt": session.updatedAt,
                ":previousSessionStatus": previousSessionStatus
              }
            }
          },
          {
            Update: {
              TableName: this.tableName,
              Key: {
                pk: `RUN#${run.id}`,
                sk: "PROFILE"
              },
              UpdateExpression:
                "SET #status = :status, updatedAt = :updatedAt, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
              ConditionExpression: "attribute_exists(pk) AND #status = :previousRunStatus",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":status": run.status,
                ":previousRunStatus": previousRunStatus,
                ":updatedAt": run.updatedAt,
                ":gsi1pk": studyRunStatusPk(run.studyId, run.status),
                ":gsi1sk": studyRunStatusSk(run)
              }
            }
          }
        ]
      })
    );

    return {
      interviewSession: session,
      run
    };
  }

  async saveInterviewArtifacts(input: {
    readonly interviewSession: InterviewSession;
    readonly turns: readonly InterviewTurn[];
    readonly audioAsset?: InterviewAudioAsset;
  }) {
    const sessionUpdateExpression = ["updatedAt = :updatedAt"];
    const sessionExpressionAttributeValues: Record<string, unknown> = {
      ":updatedAt": input.interviewSession.updatedAt
    };

    if (input.interviewSession.audioDurationSeconds !== undefined) {
      sessionUpdateExpression.push("audioDurationSeconds = :audioDurationSeconds");
      sessionExpressionAttributeValues[":audioDurationSeconds"] = input.interviewSession.audioDurationSeconds;
    }

    if (input.interviewSession.transcriptTokenCount !== undefined) {
      sessionUpdateExpression.push("transcriptTokenCount = :transcriptTokenCount");
      sessionExpressionAttributeValues[":transcriptTokenCount"] = input.interviewSession.transcriptTokenCount;
    }

    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: {
                pk: `RUN#${input.interviewSession.runId}`,
                sk: `INTERVIEW_SESSION#${input.interviewSession.sessionNumber.toString().padStart(6, "0")}#${input.interviewSession.id}`
              },
              UpdateExpression: `SET ${sessionUpdateExpression.join(", ")}`,
              ConditionExpression: "attribute_exists(pk)",
              ExpressionAttributeValues: sessionExpressionAttributeValues
            }
          },
          ...input.turns.map((turn) => ({
            Put: {
              TableName: this.tableName,
              Item: toInterviewTurnItem(turn),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          })),
          ...(input.audioAsset
            ? [
                {
                  Put: {
                    TableName: this.tableName,
                    Item: toInterviewAudioAssetItem(input.audioAsset),
                    ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
                  }
                }
              ]
            : [])
        ]
      })
    );

    return input;
  }
}

export class DynamoDbParticipantAccessTokenStore implements ParticipantAccessTokenStore {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options: DynamoDbRunStoreOptions = {}) {
    const region = options.region ?? process.env.AWS_REGION ?? "us-east-1";
    const client = new DynamoDBClient({
      region,
      ...(options.endpoint || process.env.DYNAMODB_ENDPOINT
        ? {
            endpoint: options.endpoint ?? process.env.DYNAMODB_ENDPOINT,
            credentials: {
              accessKeyId: "local",
              secretAccessKey: "local"
            }
          }
        : {})
    });

    this.documentClient = DynamoDBDocumentClient.from(client);
    this.tableName = options.tableName ?? getRunLifecycleTableName(options.environment);
  }

  async getByTokenId(tokenId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "byParticipantAccessToken",
        KeyConditionExpression: "gsi3pk = :token",
        ExpressionAttributeValues: {
          ":token": participantAccessTokenLookupPk(tokenId)
        },
        Limit: 1
      })
    );
    const item = response.Items?.find((candidate) => candidate.entity === "participant_access_token");

    return item ? toParticipantAccessToken(item as ParticipantAccessTokenItem) : undefined;
  }

  async listByRun(runId: string) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :run AND begins_with(sk, :tokenPrefix)",
        ExpressionAttributeValues: {
          ":run": `RUN#${runId}`,
          ":tokenPrefix": "PARTICIPANT_ACCESS_TOKEN#"
        }
      })
    );

    return (response.Items ?? [])
      .filter((item) => item.entity === "participant_access_token")
      .map((item) => toParticipantAccessToken(item as ParticipantAccessTokenItem))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(token: ParticipantAccessToken) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toParticipantAccessTokenItem(token),
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
      })
    );

    return token;
  }
}

export function createConfiguredRunStore() {
  const storeMode = process.env.RUN_LIFECYCLE_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbRunStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemoryRunStore();
  }

  return new DynamoDbRunStore();
}

export function createConfiguredParticipantAccessTokenStore() {
  const storeMode = process.env.RUN_LIFECYCLE_STORE;

  if (storeMode === "dynamodb") {
    return new DynamoDbParticipantAccessTokenStore();
  }

  if (process.env.NODE_ENV !== "production" || storeMode === "memory") {
    return new InMemoryParticipantAccessTokenStore();
  }

  return new DynamoDbParticipantAccessTokenStore();
}

export function toSafeRunValidationResponse(error: unknown) {
  if (error instanceof RunValidationError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: "Bad Request",
        message: error.safeMessage
      }
    };
  }

  return undefined;
}

export function toSafeParticipantAccessResponse(error: unknown) {
  if (error instanceof ParticipantAccessError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: "Forbidden",
        message: error.safeMessage
      }
    };
  }

  return undefined;
}

export function createParticipantAccessTokenForTest(input: {
  readonly tokenId: string;
  readonly runId: string;
  readonly participantSlotId: string;
  readonly secret: string;
}) {
  return createParticipantAccessTokenValue(input);
}

export function hashParticipantAccessTokenForTest(token: string) {
  return hashParticipantAccessToken(token);
}

export function isRunStatusTransitionAllowed(from: RunStatus, to: RunStatus) {
  const allowedStatuses: readonly RunStatus[] = RUN_STATUS_TRANSITIONS[from];

  return from === to || allowedStatuses.includes(to);
}

export function applyRunStatusTransition(run: Run, status: RunStatus, now: Date): Run {
  if (run.status === status) {
    return run;
  }

  if (!isRunStatusTransitionAllowed(run.status, status)) {
    throw new RunValidationError(`Run cannot transition from ${run.status} to ${status}.`);
  }

  return {
    ...run,
    status,
    updatedAt: now.toISOString()
  };
}

function parseParticipantSlotIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new RunValidationError("Select at least one participant slot.");
  }

  if (value.length < 1) {
    throw new RunValidationError("Select at least one participant slot.");
  }

  if (value.length > 200) {
    throw new RunValidationError("Create runs for 200 or fewer slots at a time.");
  }

  const participantSlotIds = value.map((participantSlotId) => {
    if (typeof participantSlotId !== "string" || !participantSlotId.trim()) {
      throw new RunValidationError("Participant slot selection is invalid.");
    }

    return participantSlotId.trim();
  });
  const uniqueParticipantSlotIds = new Set(participantSlotIds);

  if (uniqueParticipantSlotIds.size !== participantSlotIds.length) {
    throw new RunValidationError("Each participant slot can only be selected once.");
  }

  return participantSlotIds;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function createSecureRandomTokenId() {
  return randomBytes(18).toString("base64url");
}

function createParticipantAccessTokenValue({
  tokenId,
  runId,
  participantSlotId,
  secret
}: {
  readonly tokenId: string;
  readonly runId: string;
  readonly participantSlotId: string;
  readonly secret: string;
}) {
  const signature = createHmac("sha256", secret).update(`${tokenId}.${runId}.${participantSlotId}`).digest("base64url");

  return `pat_${tokenId}_${signature}`;
}

function parseParticipantAccessTokenValue(token: string) {
  const match = /^pat_([A-Za-z0-9_-]{12,})_([A-Za-z0-9_-]{43})$/.exec(token);

  if (!match) {
    return undefined;
  }

  return {
    tokenId: match[1]!,
    signature: match[2]!
  };
}

function hashParticipantAccessToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isParticipantAccessibleRunStatus(status: RunStatus) {
  return [
    "created",
    "consented",
    "survey_in_progress",
    "survey_completed",
    "interview_in_progress",
    "interview_paused",
    "interview_completed",
    "stale",
    "partial",
    "technical_interruption",
    "scored"
  ].includes(status);
}

function isParticipantActiveRunStatus(status: RunStatus) {
  return [
    "created",
    "consented",
    "survey_in_progress",
    "survey_completed",
    "interview_in_progress",
    "interview_paused"
  ].includes(status);
}

function isStaleSweepSourceStatus(status: RunStatus): status is (typeof STALE_SWEEP_SOURCE_STATUSES)[number] {
  return STALE_SWEEP_SOURCE_STATUSES.includes(status as (typeof STALE_SWEEP_SOURCE_STATUSES)[number]);
}

function isParticipantSurveyRenderableRunStatus(status: RunStatus) {
  return status === "consented" || status === "survey_in_progress";
}

function isParticipantSurveySubmittableRunStatus(status: RunStatus) {
  return status === "consented" || status === "survey_in_progress";
}

function parseConsentAcceptance(method: ConsentMethod, input: CaptureParticipantConsentInput) {
  if (method === "checkmark") {
    if (input.accepted !== true) {
      throw new RunValidationError("Consent must be accepted before continuing.");
    }

    return {};
  }

  return {
    signatureText: parseSignatureText(input.signatureText)
  };
}

function parseSignatureText(value: unknown) {
  if (typeof value !== "string") {
    throw new RunValidationError("Signature text is required.");
  }

  const signatureText = value.trim();

  if (!signatureText) {
    throw new RunValidationError("Signature text is required.");
  }

  if (signatureText.length > 200) {
    throw new RunValidationError("Signature text must be 200 characters or fewer.");
  }

  return signatureText;
}

function parseSurveyResponses(input: SubmitParticipantSurveyInput, surveyVersion: SurveyVersion) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RunValidationError("Survey responses are required.");
  }

  if (!Array.isArray(input.responses)) {
    throw new RunValidationError("Survey responses must be a list.");
  }

  const questions = getSurveyQuestions(surveyVersion);
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const responseByQuestionId = new Map<string, { surveyQuestionId: string; responseText: string }>();

  for (const [index, response] of input.responses.entries()) {
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new RunValidationError(`Survey response ${index + 1} is invalid.`);
    }

    const record = response as Record<string, unknown>;

    if (typeof record.surveyQuestionId !== "string" || !questionsById.has(record.surveyQuestionId)) {
      throw new RunValidationError("Survey response references an unknown question.");
    }

    if (responseByQuestionId.has(record.surveyQuestionId)) {
      throw new RunValidationError("Each survey question can only be answered once.");
    }

    responseByQuestionId.set(record.surveyQuestionId, {
      surveyQuestionId: record.surveyQuestionId,
      responseText: parseSurveyResponseText(record.responseText, questionsById.get(record.surveyQuestionId)!)
    });
  }

  const missingQuestion = questions.find((question) => !responseByQuestionId.has(question.id));

  if (missingQuestion) {
    throw new RunValidationError("All required survey questions must be answered.");
  }

  if (responseByQuestionId.size !== questions.length) {
    throw new RunValidationError("Survey responses do not match the run survey version.");
  }

  return questions.map((question) => responseByQuestionId.get(question.id)!);
}

function parseSurveyResponseText(value: unknown, question: SurveyQuestion) {
  if (typeof value !== "string") {
    throw new RunValidationError("All required survey questions must be answered.");
  }

  const responseText = value.trim();

  if (!responseText) {
    throw new RunValidationError("All required survey questions must be answered.");
  }

  if (responseText.length > 20000) {
    throw new RunValidationError(`Response to "${question.prompt}" must be 20,000 characters or fewer.`);
  }

  return responseText;
}

function calculateRemainingInterviewSeconds(run: Run, sessions: readonly InterviewSession[], now: Date) {
  const elapsedMilliseconds = sessions.reduce((total, session) => {
    const startedAt = new Date(session.startedAt).getTime();
    const endedAt = session.endedAt ? new Date(session.endedAt).getTime() : now.getTime();

    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
      return total;
    }

    return total + (endedAt - startedAt);
  }, 0);
  const capSeconds = run.maxInterviewMinutes * 60;

  return Math.max(0, capSeconds - Math.floor(elapsedMilliseconds / 1000));
}

function parseInterviewInterruptionSafeStatus(value: unknown): InterviewInterruptionSafeStatus {
  if (value === undefined) {
    return "technical_interruption";
  }

  if (value === "technical_interruption" || value === "unable_to_complete_interview") {
    return value;
  }

  throw new RunValidationError("Interview interruption status is invalid.");
}

function parseInterviewArtifactsInput(input: SaveInterviewArtifactsInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RunValidationError("Interview artifacts are required.");
  }

  const turns = parseInterviewTurns(input.turns);
  const audioAsset = parseInterviewAudioAsset(input.audioAsset);
  const transcriptTokenCount = parseOptionalNonNegativeInteger(input.transcriptTokenCount, "Transcript token count");

  if (turns.length === 0 && !audioAsset && transcriptTokenCount === undefined) {
    throw new RunValidationError("At least one interview artifact is required.");
  }

  return {
    turns,
    ...(audioAsset ? { audioAsset } : {}),
    ...(transcriptTokenCount !== undefined ? { transcriptTokenCount } : {})
  };
}

function parseInterviewTurns(value: unknown) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new RunValidationError("Interview turns must be a list.");
  }

  if (value.length > 50) {
    throw new RunValidationError("Save 50 or fewer interview turns at a time.");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RunValidationError(`Interview turn ${index + 1} is invalid.`);
    }

    const record = item as Record<string, unknown>;
    const speaker = parseInterviewTurnSpeaker(record.speaker, index);
    const text = parseBoundedText(record.text, `Interview turn ${index + 1} text`, 20000);
    const audioStartMs = parseOptionalNonNegativeNumber(record.audioStartMs, `Interview turn ${index + 1} audio start`);
    const audioEndMs = parseOptionalNonNegativeNumber(record.audioEndMs, `Interview turn ${index + 1} audio end`);

    if (audioStartMs !== undefined && audioEndMs !== undefined && audioEndMs < audioStartMs) {
      throw new RunValidationError("Interview turn audio end must be after audio start.");
    }

    return {
      speaker,
      text,
      ...(audioStartMs !== undefined ? { audioStartMs } : {}),
      ...(audioEndMs !== undefined ? { audioEndMs } : {}),
      ...parseOptionalIsoTimestamp(record.startedAt, `Interview turn ${index + 1} start`),
      ...parseOptionalIsoTimestamp(record.endedAt, `Interview turn ${index + 1} end`)
    };
  });
}

function parseInterviewTurnSpeaker(value: unknown, index: number): InterviewTurnSpeaker {
  if (value === "ai" || value === "participant") {
    return value;
  }

  throw new RunValidationError(`Interview turn ${index + 1} speaker is invalid.`);
}

function parseInterviewAudioAsset(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunValidationError("Interview audio asset is invalid.");
  }

  const record = value as Record<string, unknown>;

  return {
    storageUri: parseStorageUri(record.storageUri),
    durationSeconds: parseNonNegativeNumber(record.durationSeconds, "Audio duration"),
    ...(record.mimeType !== undefined ? { mimeType: parseBoundedText(record.mimeType, "Audio MIME type", 120) } : {}),
    ...(record.byteSize !== undefined ? { byteSize: parseOptionalNonNegativeInteger(record.byteSize, "Audio byte size") } : {}),
    status: parseInterviewAudioAssetStatus(record.status)
  };
}

function parseRealtimeSessionCurrentTurns(value: unknown): RealtimeInterviewContextTurn[] {
  return parseInterviewTurns(value).map((turn) => ({
    speaker: turn.speaker,
    text: turn.text
  }));
}

function mergeRealtimeInterviewContextTurns(
  persistedTurns: readonly Pick<InterviewTurn, "sequenceNumber" | "speaker" | "text">[],
  currentTurns: readonly RealtimeInterviewContextTurn[]
): RealtimeInterviewContextTurn[] {
  const persistedContextTurns = persistedTurns.map((turn, index) => ({
    speaker: turn.speaker,
    text: turn.text,
    sequenceNumber: turn.sequenceNumber ?? index + 1
  }));
  const highestPersistedSequenceNumber = persistedContextTurns.reduce(
    (highest, turn) => Math.max(highest, turn.sequenceNumber),
    0
  );
  const currentContextTurns = currentTurns.map((turn, index) => ({
    ...turn,
    sequenceNumber: highestPersistedSequenceNumber + index + 1
  }));

  return [...persistedContextTurns, ...currentContextTurns];
}

function parseInterviewAudioUpload(input: SaveInterviewAudioUploadInput, maxInterviewAudioUploadBytes: number) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RunValidationError("Interview audio upload is required.");
  }

  if (!(input.content instanceof Uint8Array) || input.content.byteLength === 0) {
    throw new RunValidationError("Interview audio upload must include audio bytes.");
  }

  if (input.content.byteLength > maxInterviewAudioUploadBytes) {
    throw new RunValidationError("Interview audio upload is too large.");
  }

  return {
    content: input.content,
    durationSeconds: parsePositiveNumber(input.durationSeconds, "Audio duration"),
    mimeType: parseInterviewAudioMimeType(input.mimeType)
  };
}

function parseInterviewAudioMimeType(value: unknown) {
  const mimeType = value === undefined ? "application/octet-stream" : parseBoundedText(value, "Audio MIME type", 120);

  if (mimeType !== "application/octet-stream" && !/^audio\/[-+.\w]+(?:;\s*[-\w]+=[-+.\w]+)*$/i.test(mimeType)) {
    throw new RunValidationError("Interview audio MIME type is invalid.");
  }

  return mimeType.toLowerCase();
}

function createInterviewAudioStorageKey(input: {
  readonly studyId: string;
  readonly participantSlotId: string;
  readonly runId: string;
  readonly interviewSessionId: string;
  readonly audioAssetId: string;
  readonly mimeType: string;
}) {
  const extension = getAudioFileExtension(input.mimeType);

  return [
    sanitizeStorageKeyPart(input.studyId),
    sanitizeStorageKeyPart(input.participantSlotId),
    sanitizeStorageKeyPart(input.runId),
    "interview-audio",
    sanitizeStorageKeyPart(input.interviewSessionId),
    `${sanitizeStorageKeyPart(input.audioAssetId)}.${extension}`
  ].join("/");
}

function sanitizeStorageKeyPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function getAudioFileExtension(mimeType: string) {
  if (mimeType.includes("webm")) {
    return "webm";
  }

  if (mimeType.includes("mp4")) {
    return "m4a";
  }

  if (mimeType.includes("mpeg")) {
    return "mp3";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  return "bin";
}

function parseStorageUri(value: unknown) {
  const storageUri = parseBoundedText(value, "Audio storage URI", 2000);

  if (!/^s3:\/\/[^/]+\/.+/.test(storageUri)) {
    throw new RunValidationError("Audio storage URI must be an S3 URI.");
  }

  return storageUri;
}

function parseInterviewAudioAssetStatus(value: unknown): InterviewAudioAssetStatus {
  if (value === undefined) {
    return "available";
  }

  if (value === "available" || value === "pending" || value === "failed") {
    return value;
  }

  throw new RunValidationError("Interview audio asset status is invalid.");
}

function parseBoundedText(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== "string") {
    throw new RunValidationError(`${label} must be text.`);
  }

  const text = value.trim();

  if (!text) {
    throw new RunValidationError(`${label} is required.`);
  }

  if (text.length > maximumLength) {
    throw new RunValidationError(`${label} must be ${maximumLength.toLocaleString("en-US")} characters or fewer.`);
  }

  return text;
}

function parseNonNegativeNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RunValidationError(`${label} must be a non-negative number.`);
  }

  return value;
}

function parsePositiveNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RunValidationError(`${label} must be a positive number.`);
  }

  return value;
}

function parseOptionalNonNegativeNumber(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  return parseNonNegativeNumber(value, label);
}

function parseOptionalNonNegativeInteger(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RunValidationError(`${label} must be a non-negative integer.`);
  }

  return value;
}

function parseOptionalIsoTimestamp(value: unknown, label: string) {
  if (value === undefined) {
    return {};
  }

  const timestamp = parseBoundedText(value, label, 80);

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new RunValidationError(`${label} must be a valid timestamp.`);
  }

  return label.endsWith("start") ? { startedAt: timestamp } : { endedAt: timestamp };
}

function getSurveyQuestions(surveyVersion: SurveyVersion) {
  return surveyVersion.layoutItems.flatMap((item) => {
    if (item.type === "question") {
      return [item.question];
    }

    return item.group.questions;
  });
}

function createParticipantAccessUrl(baseUrl: string, token: string) {
  const url = new URL(`/participant/runs/${encodeURIComponent(token)}`, normalizeBaseUrl(baseUrl));

  return url.toString();
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function getConfiguredParticipantAccessTokenSecret() {
  const secret = process.env.PARTICIPANT_ACCESS_TOKEN_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("PARTICIPANT_ACCESS_TOKEN_SECRET is required in production.");
  }

  return "local-development-participant-access-token-secret";
}

function studyRunStatusPk(studyId: string, status: RunStatus) {
  return `STUDY#${studyId}#RUN_STATUS#${status}`;
}

function participantAccessTokenLookupPk(tokenId: string) {
  return `PARTICIPANT_ACCESS_TOKEN#${tokenId}`;
}

function getRunLifecycleTableName(environment = process.env.EDUCATION_RESEARCHER_ENV ?? "local") {
  return `education-researcher-${environment}-run-lifecycle`;
}

function toRunItem(run: Run): RunItem {
  return {
    entity: "run",
    pk: `RUN#${run.id}`,
    sk: "PROFILE",
    gsi1pk: studyRunStatusPk(run.studyId, run.status),
    gsi1sk: studyRunStatusSk(run),
    gsi2pk: `SLOT#${run.participantSlotId}`,
    gsi2sk: `RUN#${run.createdAt}#${run.id}`,
    id: run.id,
    studyId: run.studyId,
    participantSlotId: run.participantSlotId,
    consentVersionId: run.consentVersionId,
    surveyVersionId: run.surveyVersionId,
    personaVersionId: run.personaVersionId,
    objectiveVersionIds: run.objectiveVersionIds,
    ...(run.interviewerInstructions ? { interviewerInstructions: run.interviewerInstructions } : {}),
    allowWrittenInterviewResponses: run.allowWrittenInterviewResponses,
    freshnessDeadlineAt: run.freshnessDeadlineAt,
    maxInterviewMinutes: run.maxInterviewMinutes,
    status: run.status,
    currentRunForSlot: run.currentRunForSlot,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function studyRunStatusSk(run: Run) {
  return `FRESHNESS#${run.freshnessDeadlineAt}#RUN#${run.id}`;
}

function toRun(item: RunItem): Run {
  return {
    id: item.id,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    consentVersionId: item.consentVersionId,
    surveyVersionId: item.surveyVersionId,
    personaVersionId: item.personaVersionId,
    objectiveVersionIds: item.objectiveVersionIds ?? [],
    interviewerInstructions: item.interviewerInstructions ?? item.interviewerGoals,
    allowWrittenInterviewResponses: item.allowWrittenInterviewResponses ?? true,
    freshnessDeadlineAt: item.freshnessDeadlineAt,
    maxInterviewMinutes: item.maxInterviewMinutes,
    status: item.status,
    currentRunForSlot: item.currentRunForSlot,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function toParticipantAccessTokenItem(token: ParticipantAccessToken): ParticipantAccessTokenItem {
  return {
    entity: "participant_access_token",
    pk: `RUN#${token.runId}`,
    sk: `PARTICIPANT_ACCESS_TOKEN#${token.createdAt}#${token.id}`,
    gsi1pk: `STUDY#${token.studyId}#PARTICIPANT_ACCESS_TOKEN#${token.status}`,
    gsi1sk: `RUN#${token.runId}#TOKEN#${token.tokenId}`,
    gsi2pk: `SLOT#${token.participantSlotId}`,
    gsi2sk: `TOKEN#${token.createdAt}#${token.tokenId}`,
    gsi3pk: participantAccessTokenLookupPk(token.tokenId),
    gsi3sk: `RUN#${token.runId}`,
    id: token.id,
    tokenId: token.tokenId,
    tokenHash: token.tokenHash,
    studyId: token.studyId,
    participantSlotId: token.participantSlotId,
    runId: token.runId,
    status: token.status,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt
  };
}

function toParticipantAccessToken(item: ParticipantAccessTokenItem): ParticipantAccessToken {
  return {
    id: item.id,
    tokenId: item.tokenId,
    tokenHash: item.tokenHash,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    runId: item.runId,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function toConsentRecordItem(record: ConsentRecord): ConsentRecordItem {
  return {
    entity: "consent_record",
    pk: `RUN#${record.runId}`,
    sk: `CONSENT_RECORD#${record.id}`,
    gsi3pk: `RUN#${record.runId}#ARTIFACT#consent_record`,
    gsi3sk: `CONSENT_RECORD#${record.acceptedAt}#${record.id}`,
    id: record.id,
    studyId: record.studyId,
    participantSlotId: record.participantSlotId,
    runId: record.runId,
    consentVersionId: record.consentVersionId,
    consentMethod: record.consentMethod,
    ...(record.signatureText ? { signatureText: record.signatureText } : {}),
    renderedConsentSnapshot: record.renderedConsentSnapshot,
    acceptedAt: record.acceptedAt,
    createdAt: record.createdAt
  };
}

function toConsentRecord(item: ConsentRecordItem): ConsentRecord {
  return {
    id: item.id,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    runId: item.runId,
    consentVersionId: item.consentVersionId,
    consentMethod: item.consentMethod,
    ...(item.signatureText ? { signatureText: item.signatureText } : {}),
    renderedConsentSnapshot: item.renderedConsentSnapshot,
    acceptedAt: item.acceptedAt,
    createdAt: item.createdAt
  };
}

function toSurveyResponseItem(response: SurveyResponse): SurveyResponseItem {
  return {
    entity: "survey_response",
    pk: `RUN#${response.runId}`,
    sk: `SURVEY_RESPONSE#${response.surveyQuestionId}`,
    gsi3pk: `RUN#${response.runId}#ARTIFACT#survey_response`,
    gsi3sk: `QUESTION#${response.surveyQuestionId}#${response.id}`,
    id: response.id,
    studyId: response.studyId,
    participantSlotId: response.participantSlotId,
    runId: response.runId,
    surveyVersionId: response.surveyVersionId,
    surveyQuestionId: response.surveyQuestionId,
    responseText: response.responseText,
    submittedAt: response.submittedAt,
    createdAt: response.createdAt
  };
}

function toSurveyResponse(item: SurveyResponseItem): SurveyResponse {
  return {
    id: item.id,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    runId: item.runId,
    surveyVersionId: item.surveyVersionId,
    surveyQuestionId: item.surveyQuestionId,
    responseText: item.responseText,
    submittedAt: item.submittedAt,
    createdAt: item.createdAt
  };
}

function toInterviewSessionItem(session: InterviewSession): InterviewSessionItem {
  return {
    entity: "interview_session",
    pk: `RUN#${session.runId}`,
    sk: `INTERVIEW_SESSION#${session.sessionNumber.toString().padStart(6, "0")}#${session.id}`,
    gsi3pk: `RUN#${session.runId}#ARTIFACT#interview_session`,
    gsi3sk: `INTERVIEW_SESSION#${session.sessionNumber.toString().padStart(6, "0")}#${session.id}`,
    id: session.id,
    studyId: session.studyId,
    participantSlotId: session.participantSlotId,
    runId: session.runId,
    sessionNumber: session.sessionNumber,
    status: session.status,
    ...(session.safeStatus ? { safeStatus: session.safeStatus } : {}),
    startedAt: session.startedAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    ...(session.audioDurationSeconds !== undefined ? { audioDurationSeconds: session.audioDurationSeconds } : {}),
    ...(session.transcriptTokenCount !== undefined ? { transcriptTokenCount: session.transcriptTokenCount } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function toInterviewSession(item: InterviewSessionItem): InterviewSession {
  return {
    id: item.id,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    runId: item.runId,
    sessionNumber: item.sessionNumber,
    status: item.status,
    ...(item.safeStatus ? { safeStatus: item.safeStatus } : {}),
    startedAt: item.startedAt,
    ...(item.endedAt ? { endedAt: item.endedAt } : {}),
    ...(item.audioDurationSeconds !== undefined ? { audioDurationSeconds: item.audioDurationSeconds } : {}),
    ...(item.transcriptTokenCount !== undefined ? { transcriptTokenCount: item.transcriptTokenCount } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function toInterviewTurnItem(turn: InterviewTurn): InterviewTurnItem {
  return {
    entity: "interview_turn",
    pk: `INTERVIEW_SESSION#${turn.interviewSessionId}`,
    sk: `TURN#${(turn.sequenceNumber ?? 0).toString().padStart(8, "0")}#${turn.createdAt}#${turn.id}`,
    gsi3pk: `RUN#${turn.runId}#ARTIFACT#interview_turn`,
    gsi3sk: `TURN#${(turn.sequenceNumber ?? 0).toString().padStart(8, "0")}#${turn.createdAt}#${turn.id}`,
    id: turn.id,
    studyId: turn.studyId,
    participantSlotId: turn.participantSlotId,
    runId: turn.runId,
    interviewSessionId: turn.interviewSessionId,
    sequenceNumber: turn.sequenceNumber,
    speaker: turn.speaker,
    text: turn.text,
    ...(turn.audioStartMs !== undefined ? { audioStartMs: turn.audioStartMs } : {}),
    ...(turn.audioEndMs !== undefined ? { audioEndMs: turn.audioEndMs } : {}),
    ...(turn.startedAt ? { startedAt: turn.startedAt } : {}),
    ...(turn.endedAt ? { endedAt: turn.endedAt } : {}),
    createdAt: turn.createdAt
  };
}

function toInterviewTurn(item: InterviewTurnItem): InterviewTurn {
  return {
    id: item.id,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    runId: item.runId,
    interviewSessionId: item.interviewSessionId,
    sequenceNumber: item.sequenceNumber ?? 0,
    speaker: item.speaker,
    text: item.text,
    ...(item.audioStartMs !== undefined ? { audioStartMs: item.audioStartMs } : {}),
    ...(item.audioEndMs !== undefined ? { audioEndMs: item.audioEndMs } : {}),
    ...(item.startedAt ? { startedAt: item.startedAt } : {}),
    ...(item.endedAt ? { endedAt: item.endedAt } : {}),
    createdAt: item.createdAt
  };
}

function compareInterviewTurns(left: InterviewTurn, right: InterviewTurn) {
  const leftSequenceNumber = left.sequenceNumber ?? 0;
  const rightSequenceNumber = right.sequenceNumber ?? 0;

  if (leftSequenceNumber !== rightSequenceNumber) {
    return leftSequenceNumber - rightSequenceNumber;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);

  return createdAtComparison || left.id.localeCompare(right.id);
}

function toInterviewAudioAssetItem(asset: InterviewAudioAsset): InterviewAudioAssetItem {
  return {
    entity: "interview_audio_asset",
    pk: `RUN#${asset.runId}`,
    sk: `AUDIO_ASSET#${asset.id}`,
    gsi3pk: `RUN#${asset.runId}#ARTIFACT#interview_audio_asset`,
    gsi3sk: `AUDIO_ASSET#${asset.createdAt}#${asset.id}`,
    id: asset.id,
    studyId: asset.studyId,
    participantSlotId: asset.participantSlotId,
    runId: asset.runId,
    interviewSessionId: asset.interviewSessionId,
    storageUri: asset.storageUri,
    durationSeconds: asset.durationSeconds,
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    ...(asset.byteSize !== undefined ? { byteSize: asset.byteSize } : {}),
    status: asset.status,
    createdAt: asset.createdAt
  };
}

function toInterviewAudioAsset(item: InterviewAudioAssetItem): InterviewAudioAsset {
  return {
    id: item.id,
    studyId: item.studyId,
    participantSlotId: item.participantSlotId,
    runId: item.runId,
    interviewSessionId: item.interviewSessionId,
    storageUri: item.storageUri,
    durationSeconds: item.durationSeconds,
    ...(item.mimeType ? { mimeType: item.mimeType } : {}),
    ...(item.byteSize !== undefined ? { byteSize: item.byteSize } : {}),
    status: item.status,
    createdAt: item.createdAt
  };
}
