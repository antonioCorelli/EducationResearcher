import { describe, expect, it } from "vitest";
import type { SessionUser } from "./auth.js";
import {
  AdminOverrideError,
  AuthorizationError,
  type AuditLogWrite,
  type RawArtifactEntity,
  StudyAuthorizationService,
  type StudyAuthorizationStore,
  type StudyAccessRecord,
  toSafeAuthorizationResponse
} from "./authorization.js";

const researcherOne: SessionUser = {
  id: "user_researcher_001",
  email: "researcher-one@example.test",
  displayName: "Researcher One",
  role: "researcher"
};

const researcherTwo: SessionUser = {
  id: "user_researcher_002",
  email: "researcher-two@example.test",
  displayName: "Researcher Two",
  role: "researcher"
};

const admin: SessionUser = {
  id: "user_admin_001",
  email: "admin@example.test",
  displayName: "Admin Engineer",
  role: "admin"
};

class FakeStudyAuthorizationStore implements StudyAuthorizationStore {
  readonly auditLogs: AuditLogWrite[] = [];

  private readonly studies = new Map<string, StudyAccessRecord>([
    ["study_alpha", { id: "study_alpha", ownerUserId: researcherOne.id, memberUserIds: ["user_member_001"] }],
    ["study_beta", { id: "study_beta", ownerUserId: researcherTwo.id }]
  ]);

  private readonly slots = new Map([
    ["slot_alpha", "study_alpha"],
    ["slot_beta", "study_beta"]
  ]);

  private readonly runs = new Map([
    ["run_alpha", "study_alpha"],
    ["run_beta", "study_beta"]
  ]);

  private readonly rawArtifacts = new Map<string, string>([
    ["survey_response:survey_response_alpha", "run_alpha"],
    ["survey_response:survey_response_beta", "run_beta"],
    ["interview_turn:interview_turn_alpha", "run_alpha"],
    ["interview_audio_asset:audio_alpha", "run_alpha"]
  ]);

  private readonly scoringRuns = new Map([
    ["scoring_alpha", "run_alpha"],
    ["scoring_beta", "run_beta"]
  ]);

  private readonly objectiveScores = new Map([
    ["objective_score_alpha", "scoring_alpha"],
    ["objective_score_beta", "scoring_beta"]
  ]);

  private readonly evidenceCitations = new Map([
    ["citation_alpha", "run_alpha"],
    ["citation_beta", "run_beta"]
  ]);

  async getStudyAccess(studyId: string) {
    return this.studies.get(studyId);
  }

  async getStudyIdForParticipantSlot(participantSlotId: string) {
    return this.slots.get(participantSlotId);
  }

  async getStudyIdForRun(runId: string) {
    return this.runs.get(runId);
  }

  async getRunIdForRawArtifact(entityType: RawArtifactEntity, entityId: string) {
    return this.rawArtifacts.get(`${entityType}:${entityId}`);
  }

  async getRunIdForScoringRun(scoringRunId: string) {
    return this.scoringRuns.get(scoringRunId);
  }

  async getScoringRunIdForObjectiveScore(objectiveScoreId: string) {
    return this.objectiveScores.get(objectiveScoreId);
  }

  async getRunIdForEvidenceCitation(evidenceCitationId: string) {
    return this.evidenceCitations.get(evidenceCitationId);
  }

  async writeAuditLog(entry: AuditLogWrite) {
    this.auditLogs.push(entry);
  }
}

function createAuthorizationService(store = new FakeStudyAuthorizationStore()) {
  return {
    store,
    authorization: new StudyAuthorizationService(store, {
      now: () => new Date("2026-05-06T15:00:00.000Z"),
      createAuditLogId: () => "audit_log_test_001"
    })
  };
}

describe("study authorization helpers", () => {
  it("creates an owner-or-member query scope for researcher study lists", () => {
    const { authorization } = createAuthorizationService();

    expect(authorization.getStudyAccessQueryScope(researcherOne)).toEqual({
      ownerUserId: researcherOne.id,
      memberUserId: researcherOne.id
    });
    expect(() => authorization.getStudyAccessQueryScope(admin)).toThrow(AdminOverrideError);
  });

  it("allows study owners and members to access a study", async () => {
    const { authorization } = createAuthorizationService();
    const member: SessionUser = {
      id: "user_member_001",
      email: "member@example.test",
      displayName: "Study Member",
      role: "researcher"
    };

    await expect(authorization.requireStudyAccess(researcherOne, "study_alpha", "read")).resolves.toMatchObject({
      accessPath: "owner",
      studyId: "study_alpha"
    });
    await expect(authorization.requireStudyAccess(member, "study_alpha", "write")).resolves.toMatchObject({
      accessPath: "member",
      studyId: "study_alpha"
    });
  });

  it("denies cross-study reads and writes with safe errors", async () => {
    const { authorization } = createAuthorizationService();

    await expect(authorization.requireStudyAccess(researcherOne, "study_beta", "read")).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await expect(authorization.requireStudyAccess(researcherOne, "study_beta", "write")).rejects.toBeInstanceOf(
      AuthorizationError
    );

    const safeResponse = toSafeAuthorizationResponse(new AuthorizationError());

    expect(safeResponse).toEqual({
      statusCode: 403,
      body: {
        error: "Forbidden",
        message: "You are not authorized to access this study resource."
      }
    });
  });

  it("resolves participant slots and runs back to their owning study", async () => {
    const { authorization } = createAuthorizationService();

    await expect(authorization.requireParticipantSlotAccess(researcherOne, "slot_alpha", "read")).resolves.toMatchObject({
      studyId: "study_alpha"
    });
    await expect(authorization.requireRunAccess(researcherOne, "run_alpha", "write")).resolves.toMatchObject({
      studyId: "study_alpha"
    });
    await expect(authorization.requireParticipantSlotAccess(researcherOne, "slot_beta", "read")).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await expect(authorization.requireRunAccess(researcherOne, "run_beta", "write")).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("denies cross-study raw artifact access through run ownership", async () => {
    const { authorization } = createAuthorizationService();

    await expect(
      authorization.requireRawArtifactAccess(researcherOne, "survey_response", "survey_response_alpha")
    ).resolves.toMatchObject({
      action: "read_raw_artifact",
      studyId: "study_alpha"
    });
    await expect(
      authorization.requireRawArtifactAccess(researcherOne, "interview_turn", "interview_turn_alpha")
    ).resolves.toMatchObject({
      studyId: "study_alpha"
    });
    await expect(
      authorization.requireRawArtifactAccess(researcherOne, "survey_response", "survey_response_beta")
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("denies cross-study scoring and citation access through run ownership", async () => {
    const { authorization } = createAuthorizationService();

    await expect(authorization.requireScoringRunAccess(researcherOne, "scoring_alpha", "read")).resolves.toMatchObject({
      studyId: "study_alpha"
    });
    await expect(
      authorization.requireObjectiveScoreAccess(researcherOne, "objective_score_alpha", "read")
    ).resolves.toMatchObject({
      studyId: "study_alpha"
    });
    await expect(
      authorization.requireEvidenceCitationAccess(researcherOne, "citation_alpha", "read")
    ).resolves.toMatchObject({
      studyId: "study_alpha"
    });
    await expect(authorization.requireScoringRunAccess(researcherOne, "scoring_beta", "read")).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await expect(
      authorization.requireObjectiveScoreAccess(researcherOne, "objective_score_beta", "read")
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(authorization.requireEvidenceCitationAccess(researcherOne, "citation_beta", "read")).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("requires admin overrides to be explicit and audited", async () => {
    const { authorization, store } = createAuthorizationService();

    await expect(
      authorization.requireRunAccess(admin, "run_beta", "read", {
        reason: "Investigating support ticket EDU-123",
        serviceRequestId: "req_admin_001",
        metadata: {
          ticketId: "EDU-123"
        }
      })
    ).resolves.toMatchObject({
      accessPath: "admin_override",
      studyId: "study_beta"
    });

    expect(store.auditLogs).toEqual([
      {
        id: "audit_log_test_001",
        actorUserId: admin.id,
        actorRole: "admin",
        studyId: "study_beta",
        entityType: "run",
        entityId: "run_beta",
        action: "admin_override_read",
        metadata: {
          ticketId: "EDU-123",
          reason: "Investigating support ticket EDU-123",
          serviceRequestId: "req_admin_001"
        },
        createdAt: "2026-05-06T15:00:00.000Z"
      }
    ]);
  });

  it("rejects missing admin override reasons and researcher override attempts", async () => {
    const { authorization } = createAuthorizationService();

    await expect(
      authorization.requireStudyAccess(admin, "study_beta", "read", {
        reason: " "
      })
    ).rejects.toBeInstanceOf(AdminOverrideError);
    await expect(
      authorization.requireStudyAccess(researcherOne, "study_beta", "read", {
        reason: "Trying to bypass tenant isolation"
      })
    ).rejects.toBeInstanceOf(AdminOverrideError);
  });
});
