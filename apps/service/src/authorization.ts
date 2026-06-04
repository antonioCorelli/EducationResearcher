import type { ResearcherRole, SessionUser } from "./auth.js";

export type StudyAuthorizationAction = "read" | "write" | "read_raw_artifact";

export type StudyAuthorizationEntity =
  | "study"
  | "participant_slot"
  | "run"
  | "consent_version"
  | "survey_version"
  | "objective_version"
  | "consent_record"
  | "survey_response"
  | "interview_session"
  | "interview_turn"
  | "interview_audio_asset"
  | "scoring_run"
  | "objective_score"
  | "evidence_citation";

export type RawArtifactEntity =
  | "consent_record"
  | "survey_response"
  | "interview_session"
  | "interview_turn"
  | "interview_audio_asset";

export interface StudyAccessRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly memberUserIds?: readonly string[];
}

export interface AdminOverrideRequest {
  readonly reason: string;
  readonly serviceRequestId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuthorizedStudyAccess {
  readonly actorUserId: string;
  readonly actorRole: ResearcherRole;
  readonly studyId: string;
  readonly action: StudyAuthorizationAction;
  readonly accessPath: "owner" | "member" | "admin_override";
}

export interface StudyAccessQueryScope {
  readonly ownerUserId: string;
  readonly memberUserId: string;
}

export interface AuditLogWrite {
  readonly id: string;
  readonly actorUserId: string;
  readonly actorRole: ResearcherRole;
  readonly studyId: string;
  readonly entityType: StudyAuthorizationEntity;
  readonly entityId: string;
  readonly action: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export type AuditLogAction =
  | "create"
  | "update"
  | "restore"
  | "archive"
  | "export"
  | "manual_rescore"
  | StudyAuthorizationAction
  | `admin_override_${StudyAuthorizationAction}`;

export interface StudyAuthorizationStore {
  getStudyAccess(studyId: string): Promise<StudyAccessRecord | undefined>;
  getStudyIdForParticipantSlot(participantSlotId: string): Promise<string | undefined>;
  getStudyIdForRun(runId: string): Promise<string | undefined>;
  getRunIdForRawArtifact(entityType: RawArtifactEntity, entityId: string): Promise<string | undefined>;
  getRunIdForScoringRun(scoringRunId: string): Promise<string | undefined>;
  getScoringRunIdForObjectiveScore(objectiveScoreId: string): Promise<string | undefined>;
  getRunIdForEvidenceCitation(evidenceCitationId: string): Promise<string | undefined>;
  writeAuditLog(entry: AuditLogWrite): Promise<void>;
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;
  readonly safeMessage = "You are not authorized to access this study resource.";

  constructor() {
    super("Study resource access denied.");
    this.name = "AuthorizationError";
  }
}

export class AdminOverrideError extends Error {
  readonly statusCode = 403;
  readonly safeMessage = "Admin override access requires an authorized role and reason.";

  constructor() {
    super("Admin override access denied.");
    this.name = "AdminOverrideError";
  }
}

export class AuditLogUnavailableError extends Error {
  readonly statusCode = 500;
  readonly safeMessage = "Audit logging is unavailable.";

  constructor() {
    super("Audit logging is unavailable.");
    this.name = "AuditLogUnavailableError";
  }
}

export interface StudyAuthorizationServiceOptions {
  readonly now?: () => Date;
  readonly createAuditLogId?: () => string;
}

export class StudyAuthorizationService {
  private readonly now: () => Date;
  private readonly createAuditLogId: () => string;

  constructor(
    private readonly store: StudyAuthorizationStore,
    options: StudyAuthorizationServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createAuditLogId = options.createAuditLogId ?? (() => crypto.randomUUID());
  }

  async requireStudyAccess(
    actor: SessionUser,
    studyId: string,
    action: StudyAuthorizationAction,
    adminOverride?: AdminOverrideRequest
  ): Promise<AuthorizedStudyAccess> {
    const study = await this.store.getStudyAccess(studyId);

    if (!study) {
      throw new AuthorizationError();
    }

    if (adminOverride) {
      return this.requireAdminOverride(actor, study.id, "study", study.id, action, adminOverride);
    }

    if (study.ownerUserId === actor.id) {
      return this.toAccess(actor, study.id, action, "owner");
    }

    if (study.memberUserIds?.includes(actor.id)) {
      return this.toAccess(actor, study.id, action, "member");
    }

    throw new AuthorizationError();
  }

  getStudyAccessQueryScope(actor: SessionUser): StudyAccessQueryScope {
    if (actor.role !== "researcher") {
      throw new AdminOverrideError();
    }

    return {
      ownerUserId: actor.id,
      memberUserId: actor.id
    };
  }

  async requireParticipantSlotAccess(
    actor: SessionUser,
    participantSlotId: string,
    action: StudyAuthorizationAction,
    adminOverride?: AdminOverrideRequest
  ) {
    const studyId = await this.store.getStudyIdForParticipantSlot(participantSlotId);
    return this.requireResolvedStudyAccess(actor, studyId, "participant_slot", participantSlotId, action, adminOverride);
  }

  async requireRunAccess(
    actor: SessionUser,
    runId: string,
    action: StudyAuthorizationAction,
    adminOverride?: AdminOverrideRequest
  ) {
    const studyId = await this.store.getStudyIdForRun(runId);
    return this.requireResolvedStudyAccess(actor, studyId, "run", runId, action, adminOverride);
  }

  async requireRawArtifactAccess(
    actor: SessionUser,
    entityType: RawArtifactEntity,
    entityId: string,
    adminOverride?: AdminOverrideRequest
  ) {
    const runId = await this.store.getRunIdForRawArtifact(entityType, entityId);

    if (!runId) {
      throw new AuthorizationError();
    }

    const studyId = await this.store.getStudyIdForRun(runId);
    return this.requireResolvedStudyAccess(
      actor,
      studyId,
      entityType,
      entityId,
      "read_raw_artifact",
      adminOverride
    );
  }

  async requireScoringRunAccess(
    actor: SessionUser,
    scoringRunId: string,
    action: StudyAuthorizationAction,
    adminOverride?: AdminOverrideRequest
  ) {
    const runId = await this.store.getRunIdForScoringRun(scoringRunId);

    if (!runId) {
      throw new AuthorizationError();
    }

    const studyId = await this.store.getStudyIdForRun(runId);
    return this.requireResolvedStudyAccess(actor, studyId, "scoring_run", scoringRunId, action, adminOverride);
  }

  async requireObjectiveScoreAccess(
    actor: SessionUser,
    objectiveScoreId: string,
    action: StudyAuthorizationAction,
    adminOverride?: AdminOverrideRequest
  ) {
    const scoringRunId = await this.store.getScoringRunIdForObjectiveScore(objectiveScoreId);

    if (!scoringRunId) {
      throw new AuthorizationError();
    }

    const runId = await this.store.getRunIdForScoringRun(scoringRunId);

    if (!runId) {
      throw new AuthorizationError();
    }

    const studyId = await this.store.getStudyIdForRun(runId);
    return this.requireResolvedStudyAccess(actor, studyId, "objective_score", objectiveScoreId, action, adminOverride);
  }

  async requireEvidenceCitationAccess(
    actor: SessionUser,
    evidenceCitationId: string,
    action: StudyAuthorizationAction,
    adminOverride?: AdminOverrideRequest
  ) {
    const runId = await this.store.getRunIdForEvidenceCitation(evidenceCitationId);

    if (!runId) {
      throw new AuthorizationError();
    }

    const studyId = await this.store.getStudyIdForRun(runId);
    return this.requireResolvedStudyAccess(actor, studyId, "evidence_citation", evidenceCitationId, action, adminOverride);
  }

  async recordSensitiveRead(
    access: AuthorizedStudyAccess,
    entityType: StudyAuthorizationEntity,
    entityId: string,
    metadata: Record<string, unknown> = {}
  ) {
    await this.recordSensitiveAction(access, entityType, entityId, access.action, metadata);
  }

  async recordSensitiveAction(
    access: AuthorizedStudyAccess,
    entityType: StudyAuthorizationEntity,
    entityId: string,
    action: AuditLogAction,
    metadata: Record<string, unknown> = {}
  ) {
    await this.store.writeAuditLog({
      id: this.createAuditLogId(),
      actorUserId: access.actorUserId,
      actorRole: access.actorRole,
      studyId: access.studyId,
      entityType,
      entityId,
      action,
      metadata: {
        accessPath: access.accessPath,
        ...metadata
      },
      createdAt: this.now().toISOString()
    });
  }

  async recordStudyAction(
    actor: SessionUser,
    studyId: string,
    entityType: StudyAuthorizationEntity,
    entityId: string,
    action: AuditLogAction,
    metadata: Record<string, unknown> = {}
  ) {
    await this.store.writeAuditLog({
      id: this.createAuditLogId(),
      actorUserId: actor.id,
      actorRole: actor.role,
      studyId,
      entityType,
      entityId,
      action,
      metadata,
      createdAt: this.now().toISOString()
    });
  }

  private async requireResolvedStudyAccess(
    actor: SessionUser,
    studyId: string | undefined,
    entityType: StudyAuthorizationEntity,
    entityId: string,
    action: StudyAuthorizationAction,
    adminOverride?: AdminOverrideRequest
  ) {
    if (!studyId) {
      throw new AuthorizationError();
    }

    if (adminOverride) {
      const study = await this.store.getStudyAccess(studyId);

      if (!study) {
        throw new AuthorizationError();
      }

      return this.requireAdminOverride(actor, study.id, entityType, entityId, action, adminOverride);
    }

    return this.requireStudyAccess(actor, studyId, action);
  }

  private async requireAdminOverride(
    actor: SessionUser,
    studyId: string,
    entityType: StudyAuthorizationEntity,
    entityId: string,
    action: StudyAuthorizationAction,
    adminOverride: AdminOverrideRequest
  ) {
    if (actor.role !== "admin" || adminOverride.reason.trim().length === 0) {
      throw new AdminOverrideError();
    }

    await this.writeAdminOverrideAudit(actor, studyId, entityType, entityId, action, adminOverride);

    return this.toAccess(actor, studyId, action, "admin_override");
  }

  private async writeAdminOverrideAudit(
    actor: SessionUser,
    studyId: string,
    entityType: StudyAuthorizationEntity,
    entityId: string,
    action: StudyAuthorizationAction,
    adminOverride: AdminOverrideRequest
  ) {
    const metadata: Record<string, unknown> = {
      ...adminOverride.metadata,
      reason: adminOverride.reason.trim()
    };

    if (adminOverride.serviceRequestId) {
      metadata.serviceRequestId = adminOverride.serviceRequestId;
    }

    await this.store.writeAuditLog({
      id: this.createAuditLogId(),
      actorUserId: actor.id,
      actorRole: actor.role,
      studyId,
      entityType,
      entityId,
      action: `admin_override_${action}`,
      metadata,
      createdAt: this.now().toISOString()
    });
  }

  private toAccess(
    actor: SessionUser,
    studyId: string,
    action: StudyAuthorizationAction,
    accessPath: AuthorizedStudyAccess["accessPath"]
  ): AuthorizedStudyAccess {
    return {
      actorUserId: actor.id,
      actorRole: actor.role,
      studyId,
      action,
      accessPath
    };
  }
}

export function toSafeAuthorizationResponse(error: unknown) {
  if (error instanceof AuthorizationError || error instanceof AdminOverrideError || error instanceof AuditLogUnavailableError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.statusCode === 500 ? "Internal Server Error" : "Forbidden",
        message: error.safeMessage
      }
    };
  }

  return undefined;
}
