# Open Questions

Source PRD: `docs/v1-prd-and-data-model.md`

## Decisions Made

- Frontend framework: React, TypeScript, and Vite.
- Package manager and repo layout: npm workspaces with `apps/web` and `apps/service`.
- Frontend hosting/deploy: AWS Amplify.
- Researcher/admin auth provider: Amazon Cognito.
- Service API stack: Node.js, TypeScript, and Fastify.
- Service API hosting/deploy: AWS App Runner.
- Primary AWS storage direction: DynamoDB for application data/state and S3 for audio assets and generated exports.
- Fake providers are required from day one for local development and deterministic tests, including auth/session, AI gap map/scoring, voice interview behavior, and storage-like behavior.
- DynamoDB physical data model: table per data domain.
- Local database mode: DynamoDB Local with create, reset, and seed commands.
- Migration workflow: AWS CDK table/index definitions plus a versioned schema contract and fixture workflow.
- Infrastructure-as-code approach: AWS CDK.
- First launch mode: `private_pilot_with_real_data`, gated by `docs/deployment-readiness.md`.
- First pilot user segment: one private classroom pilot with a single researcher account, one survey, and about 40 student participants.

## Product Questions

- Should V1 support study collaborators through `study_memberships`, or only one owner plus admin engineers?
- How should researchers distribute participant access: copied links, access codes, email, CSV export of links, or another workflow?
- What CSV import format should participant slots accept?
- Are participant codes unique only within a study, or should the platform prevent global collisions too?
- What default consent template, if any, should ship with the product?
- What exact copy should communicate that consent capture is not legal or institutional sufficiency determination?
- What grade scales are allowed in V1: free-form labels, ordered labels, numeric ranges, letter grades, or a constrained subset?
- Should every active objective be included in interview/scoring context, or can researchers choose objective visibility per run?
- How should manual rescoring choose objective versions: latest active only, selected historical versions, or a saved scoring profile?
- Does MVP require audio playback in the researcher UI, or are signed download links enough for the first slice?
- Should researchers be able to extend a freshness deadline, or must they create a new run?

## Technical Questions

- Should background workers live in `apps/service` initially or become a separate workspace package?
- What key and index refinements are needed as service access patterns become concrete?
- What CDK stack boundaries should define Amplify, Cognito, App Runner, S3, and IAM?
- How should signed S3 access be generated, scoped, expired, and audited for audio and exports?
- Which AI model provider should handle gap map and scoring passes?
- Which realtime voice provider should handle voice-to-voice interviews?
- How should background jobs be implemented for gap maps, scoring, stale sweeps, exports, retention, and deletion?
- What schema validation library should be used for AI structured outputs?
- How should service request IDs be generated and propagated across frontend, service, workers, and providers?
- What backup and restore strategy applies to sensitive study artifacts?

## UX Questions

- What should the researcher study setup flow look like: wizard, tabs, or editable sections?
- Should the participant survey support draft saving or only final submission?
- How should the participant UI indicate "gap map is being generated" between survey and interview?
- What exact participant recovery states should be shown for microphone permission denial, disconnect, voice unavailable, and stale run?
- Should the sparse interview UI include a pause button, or is stop/resume represented through the record control?
- How should the AI thank-you be presented after interview completion: spoken, captioned, static screen, or all three?
- How should researchers drill from a citation to an audio span if transcript timing is approximate?
- What confidence threshold should visually flag low-confidence scores?
- How much scoring history should be visible after manual rescoring?

## Security/Privacy Questions

- What data classification applies to survey responses, transcripts, audio, scores, and telemetry?
- What exact admin engineer roles are allowed to access all data?
- Should admin access require additional confirmation, reason capture, or just-in-time elevation?
- What audit events are required for compliance or institutional review expectations?
- How long should participant run tokens remain valid after completion or staleness?
- Should participant links be revocable per run?
- How should researcher-initiated deletion affect audit logs and operational telemetry?
- Are audio transcripts considered raw participant data for retention/deletion in all cases?
- What protections are required for CSV exports after download?
- What data, if any, can be sent to AI/voice providers under expected pilot agreements?

## Operational/Deployment Questions

- Where will V1 be hosted?
- What environments are needed: local, staging, production, demo?
- What CI checks are required before PR merge?
- What observability platform should collect logs, metrics, traces, and alerts?
- Who receives alerts for interview failure spikes, scoring failures, retention job failures, and export failures?
- What service-level expectations are realistic for small formative studies?
- How should provider outages be communicated to researchers and participants?
- What operational tooling is needed before real pilot data is collected?
- How should 2-year retention interact with backups, logs, and generated exports?
- What manual support runbooks should exist for failed interviews, failed scoring jobs, stale runs, and deletion requests?
