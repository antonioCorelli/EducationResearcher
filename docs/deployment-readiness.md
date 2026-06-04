# Deployment Readiness And Participant-Data Gate

Issue: [#61](https://github.com/antonioCorelli/EducationResearcher/issues/61)  
Parent tracker: [#60](https://github.com/antonioCorelli/EducationResearcher/issues/60)

This document is the launch-mode decision record and go/no-go gate for collecting participant data.

## Launch Mode Decision

Selected launch mode: `private_pilot_with_real_data`.

The first launch is a private pilot, not a public production launch. The pilot is allowed to collect real participant data only after every required item in the go/no-go checklist is complete.

Other launch modes considered:

- `private_demo`: non-real demonstration data only.
- `private_pilot_with_synthetic_data`: private pilot workflow using synthetic or non-real participant data only.
- `production_with_real_data`: public or production-scale availability with real participant data.

## First Launch Scope

- Launch date target: June 5, 2026.
- Study: one private pilot study.
- Survey: one survey.
- Researcher: one named researcher account for the initial pilot researcher. Credentials must be created and managed outside the repository through the selected auth/secret-management workflow.
- Participants: about 40 students in one class.
- Participant accounts: none. Participants must use run-scoped access links or tokens only.
- Public access: no public sign-up, no public researcher onboarding, no open participant access.

## Environment Access And Data Rules

Allowed access:

- The pilot researcher may access only the pilot study and its participant data.
- Authorized admin engineers may access the environment only for deployment, support, maintenance, and incident response.
- Participants may access only their assigned active run through a run-scoped participant link or token.

Data allowed after this gate passes:

- Consent records.
- Survey responses.
- Interview transcripts and audio.
- Scores, rationales, flags, citations, and exports.
- Operational telemetry and audit logs that avoid raw sensitive content.

Data not allowed before this gate passes:

- Real student or classroom participant data.
- Real consent records from students.
- Real interview audio or transcript data.
- Real scoring outputs derived from participant evidence.

Data handling constraints:

- Do not commit credentials, participant identifiers, real survey responses, transcripts, audio, scores, exports, or operational logs.
- Do not use fake credentials, local default secrets, local filesystem artifact storage, or test-only provider settings for the real-data pilot.
- Do not send real participant data to AI or voice providers until provider data-processing decisions are documented and approved for this pilot.

## Real Participant Data Blockers

The following gaps block real participant data collection:

- S3-backed artifact storage is implemented, deployed, access-controlled, and used for interview audio and generated exports. Local filesystem storage is not acceptable for real participant data.
- Production secrets and environment variables are managed outside the repository, including auth, participant token signing, audio link signing, service, storage, AI, voice, and observability secrets.
- Provider data-processing decisions are documented for AI scoring and realtime voice, including what participant data is sent, whether provider retention or training applies, and who approved the pilot use.
- Retention and researcher deletion behavior is documented and operable across DynamoDB records, S3 objects, generated exports, audit logs, operational telemetry, and backups.
- Backup and restore expectations are documented and tested enough for the pilot, including DynamoDB point-in-time recovery and object-storage recovery behavior.
- Production observability is configured with structured logs, metrics, traces or equivalent diagnostics, alert thresholds, and alert ownership.
- Incident response steps are documented, including who triages, how to pause participant access, how to preserve evidence, and how to communicate participant-safe status.
- Researcher and admin access are production auth-backed, role-scoped, and auditable. The pilot researcher account must not be a shared test account.
- Participant access links or tokens are unguessable, run-scoped, expire or become unusable when the run is completed/stale/deleted, and are validated before consent, survey, interview, and upload operations.
- A production smoke test with non-real participant data completes consent, survey, interview, scoring, review, raw evidence access, signed audio access, and CSV export before any real participant link is shared.

## Go/No-Go Checklist

Real participant data collection is **no-go** until every required checkbox below is complete.

| Required | Status | Gate item |
| --- | --- | --- |
| Yes | Done | Launch mode selected: `private_pilot_with_real_data`. |
| Yes | Done | First launch scope confirmed: one pilot study, one survey, one pilot researcher account, about 40 students, June 5, 2026 target. |
| Yes | Done | Production Cognito researcher auth and DynamoDB data-domain stacks are deployed in `us-east-1`; see `docs/production-deployment-runbook.md`. |
| Yes | Done | The pilot researcher account is created outside the repository. |
| Yes | Not done | Production service and web hosting are deployed with managed production secrets. |
| Yes | Deployment pending | S3-backed audio/export artifact storage is implemented in the repository; deploy `EducationResearcherArtifacts-prod`, attach S3 IAM, and run the non-real upload/playback smoke test before marking done. |
| Yes | Not done | AI and realtime voice provider data-processing decisions are documented and approved for real pilot data. |
| Yes | Not done | Retention and researcher deletion operations are documented for database records, S3 objects, exports, logs, telemetry, and backups. |
| Yes | Not done | Backup and restore expectations are documented and validated for pilot-critical data. |
| Yes | Not done | Production observability and alert ownership are configured. |
| Yes | Not done | Incident response and rollback steps are documented. |
| Yes | Not done | Participant links/tokens are verified as run-scoped, unguessable, and blocked after stale/completed/deleted states. |
| Yes | Not done | A non-real production smoke test completes the full pilot path before real participant links are distributed. |

## Current Gate Result

Current result: **No-go for real participant data**.

The intended pilot mode is decided, but the repository and deployment path still have required blockers for real participant data. If the June 5, 2026 date arrives before the checklist is complete, the pilot must either move to `private_pilot_with_synthetic_data` or be delayed until the gate passes.

