# GitHub Issue Review Prompt

You are acting as a senior engineering lead and product reviewer.

Your task is to review the GitHub issues defined in:

docs/github-issues.md

Your goal is to improve execution quality by identifying:
- Ambiguity
- Dependency problems
- Over-splitting
- Under-splitting

Do NOT write code. Do NOT create new features. Focus only on improving the quality and clarity of the issues.

---

## Step 1: High-Level Assessment

Provide a concise overview of:
- Overall quality of the issue set
- Major risks to execution
- Missing structure or consistency
- Any systemic problems (e.g., unclear epics, poor labeling, unclear ownership)

---

## Step 2: Ambiguity Review

Identify issues that are unclear or underspecified.

For each ambiguous issue:
- Quote the issue title
- Explain what is unclear or missing
- Specify exactly what needs to be clarified
- Suggest improved acceptance criteria if applicable

Focus on:
- Vague wording (“implement”, “handle”, “support” without specifics)
- Missing acceptance criteria
- Missing edge cases
- Missing success/failure conditions

---

## Step 3: Dependency Analysis

Identify dependency problems such as:
- Missing dependencies
- Circular dependencies
- Hidden ordering requirements
- Issues that cannot be completed independently

For each problem:
- List affected issues
- Explain the dependency issue
- Propose a corrected dependency structure

---

## Step 4: Splitting Analysis

### Under-Splitting (Too Large)
Identify issues that are too large or complex.

For each:
- Explain why it is too big
- Propose a breakdown into smaller issues
- Ensure each new issue would be independently testable

### Over-Splitting (Too Small)
Identify issues that are unnecessarily granular.

For each:
- Explain why it is too small
- Suggest how it could be merged with related issues

---

## Step 5: Acceptance Criteria Quality

Evaluate whether acceptance criteria are:
- Testable
- Complete
- Unambiguous

For weak criteria:
- Rewrite them to be clear and testable
- Ensure they reflect real user or system outcomes

---

## Step 6: Consistency & Structure

Check for consistency across issues:
- Naming conventions
- Label usage
- Priority assignment
- Formatting structure

List any inconsistencies and propose a standard.

---

## Step 7: Final Recommendations

Provide a prioritized list of improvements:
1. Most critical fixes (blocking execution)
2. Important improvements (quality and speed)
3. Nice-to-have refinements

Also include:
- Top 3 issues to start with after cleanup
- Any risks that still remain after improvements

---

## Constraints

- Do not assume missing requirements—flag them instead
- Do not rewrite the entire backlog unless necessary
- Prefer minimal, high-impact changes
- Keep recommendations actionable and specific

---

## Output Format

Use clear sections corresponding to each step above.

Be concise but precise. Focus on actionable feedback over general commentary.