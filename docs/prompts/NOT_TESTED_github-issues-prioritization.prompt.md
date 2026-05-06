# GitHub Issue Prioritization & Triage Prompt

You are acting as a senior engineering manager responsible for backlog health and execution readiness.

Your task is to:

1. Review all current GitHub issues
2. Assign or correct priority labels
3. Ensure issues are properly structured
4. Update issues in GitHub using the CLI

Repository:

antonioCorelli/EducationResearcher

---

## Priority Schema

Use the following priority labels:

- priority:P0 → Critical (blocks core functionality or MVP)
- priority:P1 → High (important for near-term delivery)
- priority:P2 → Medium (valuable but not urgent)
- priority:P3 → Low (nice-to-have, polish, or future work)

Every issue MUST have exactly one priority label.

---

## Step 1: Fetch Issues

Use GitHub CLI:

```bash
gh issue list --repo antonioCorelli/EducationResearcher --state open --json number,title,body,labels,createdAt,updatedAt,url
````

If needed, fetch additional details per issue:

```bash
gh issue view <number> --repo antonioCorelli/EducationResearcher --json number,title,body
```

---

## Step 2: Analyze Each Issue

For each issue:

Determine:

* What user or system capability does this represent?
* Is it blocking other work?
* Is it required for MVP?
* Does it affect security, data integrity, or core flows?
* Is it incomplete, vague, or underspecified?

---

## Step 3: Assign Priority

Use these rules:

### P0 (Critical)

* Blocks MVP or core user flow
* Required for system to function
* Security-critical
* Data loss/corruption risk
* Other issues depend on it

### P1 (High)

* Important feature needed soon
* Strong user impact
* Not blocking system entirely

### P2 (Medium)

* Useful but not urgent
* Can be deferred without major impact

### P3 (Low)

* Nice-to-have
* Cleanup, polish, refactor
* Future enhancements

---

## Step 4: Detect Issues

Also identify:

### Missing Priority

* No priority label

### Conflicting Priority

* Multiple priority labels

### Poor Quality Issues

* Vague titles
* Missing acceptance criteria
* Overly large or too small
* Missing dependencies

Do not rewrite issues yet—just note problems.

---

## Step 5: Present Review Summary

Before making changes, present:

* Total issues reviewed
* Priority distribution (P0–P3)
* Issues missing priority
* Issues with conflicting priority
* Any surprising classifications (e.g., something upgraded to P0)
* Any risks or concerns

Then propose:

* Priority assignments per issue
* Any label changes

Wait for user approval before modifying GitHub.

---

## Step 6: Apply Changes (After Approval)

For each issue:

### Remove existing priority labels

```bash
gh issue edit <number> --repo antonioCorelli/EducationResearcher --remove-label "priority:P0"
```

### Add correct priority label

```bash
gh issue edit <number> --repo antonioCorelli/EducationResearcher --add-label "priority:P1"
```

Only one priority label should remain.

---

## Step 7: Optional Improvements

If issues are clearly broken (only after approval), suggest:

* Title improvements
* Missing acceptance criteria
* Splitting or merging

Do NOT automatically rewrite issues unless explicitly instructed.

---

## Step 8: Final Summary

After updates, provide:

* Updated issue list with priorities
* Final distribution (P0–P3)
* Any remaining concerns
* Recommended next 3 issues to work on

---

## Constraints

* Do not create new issues unless explicitly asked
* Do not delete issues
* Do not change issue bodies without approval
* Do not assign arbitrary priorities—justify decisions
* Prefer conservative prioritization if uncertain
* Always review with the user before applying changes

---

## Output Style

Be structured, concise, and actionable.

Focus on decisions and reasoning, not verbosity.
