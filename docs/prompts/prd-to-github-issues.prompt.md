You are acting as a senior product-minded engineering lead.

Your task is to read the PRD at:

docs/v1-prd-and-data-model.md

Then create a complete GitHub-ready execution plan from it.

Do not implement code yet. Your job is to convert product intent into clear engineering artifacts.

Create or update the following files:

1. docs/prd-analysis.md
Summarize the PRD in engineering terms:
- Product goal
- Target users
- Core user journeys
- Main capabilities
- Explicit requirements
- Implied requirements
- Open questions
- Risks and ambiguities
- Non-goals

2. docs/architecture-plan.md
Propose a practical implementation architecture:
- Major components
- Frontend responsibilities
- Service responsibilities
- Data/storage needs
- External integrations
- Security considerations
- Error handling approach
- Observability/logging needs
- Testing strategy
- Deployment assumptions

Use the existing repo structure and conventions when possible. If the repo already has an AGENTS.md, README, package files, app structure, or existing patterns, inspect them and align with them.

3. docs/github-issues.md
Create GitHub-ready issues from the PRD.

Organize them as:
- Epics
- Child issues under each epic
- Dependencies between issues
- Suggested labels
- Suggested priority
- Acceptance criteria
- Testing notes

Each issue should be small enough to complete in roughly 1–2 focused engineering sessions.

Avoid vague issues like “Implement authentication.” Break them into concrete, testable tasks.

Use this issue format:

### [Epic/Area] Issue title

**Type:** feature | bug | chore | docs | test | spike  
**Priority:** P0 | P1 | P2 | P3  
**Labels:** frontend, service, data, security, testing, docs, etc.  
**Depends on:** issue titles or “None”

**Problem**
Describe the user or engineering problem.

**Scope**
What should be built.

**Acceptance Criteria**
- [ ] Clear testable criterion
- [ ] Clear testable criterion
- [ ] Clear testable criterion

**Out of Scope**
What should not be included.

**Implementation Notes**
Relevant architecture hints, files likely involved, API contracts, or constraints.

**Testing Notes**
How this should be verified.

4. docs/milestones.md
Group issues into milestones:
- MVP
- Beta/polish
- Post-MVP

For each milestone include:
- Goal
- Included issues
- What “done” means
- Risks

5. docs/open-questions.md
List questions that must be answered before or during implementation.
Separate them into:
- Product questions
- Technical questions
- UX questions
- Security/privacy questions
- Operational/deployment questions

6. docs/agent-workflow.md
Create guidance for future Codex/agent sessions:
- How to choose the next issue
- How to inspect relevant files before coding
- How to update docs after implementation
- How to verify work before opening a PR
- What not to do without confirmation

Important constraints:
- Do not write code.
- Do not create actual GitHub issues through the API unless explicitly asked.
- Do not invent product requirements silently. If something is unclear, mark it as an open question.
- Prefer vertical user-facing slices over purely technical layers.
- Prefer service-first planning where the service expresses the core product behavior and the frontend provides a view/control surface for it.
- Keep issues concrete, testable, and dependency-aware.
- Use existing repo terminology. If the repo uses “service” instead of “backend,” use “service.”
- If there are multiple reasonable architectures, recommend one and briefly explain why.
- If the PRD is too vague, still produce a best-effort plan, but clearly mark assumptions.

Before writing files, briefly inspect:
- AGENTS.md
- README.md
- package files
- existing docs
- src/app/service structure if present

At the end, provide a concise summary:
- Files created or updated
- Number of epics
- Number of issues
- Biggest risks
- First 3 issues to start with