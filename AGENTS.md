# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

For product and feature context, read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md). It distills the V1 PRD and data model and should be used when planning feature tasks.

For the shared glossary of product and technical concept names, read [SHARED_LANGUAGE.md](SHARED_LANGUAGE.md).

Github repo is antonioCorelli/EducationResearcher

## Project Mindset

Build high-quality, maintainable software. Prefer simple, explicit solutions over clever ones. Make changes that are easy for a human developer to review, test, and extend.

When working in this repo, assume the goal is production-quality code unless the task clearly says it is a throwaway prototype.

## Core Principles

- Prioritize correctness, clarity, security, and maintainability.
- Make the smallest change that fully solves the problem.
- Preserve existing architecture and conventions unless there is a clear reason to improve them.
- Avoid large rewrites unless explicitly requested or clearly necessary.
- Prefer readable code over overly abstract code.
- Keep business logic separated from framework, UI, transport, and persistence details where practical.
- Do not introduce new dependencies unless they are justified and useful.
- Treat user data, credentials, tokens, logs, and configuration as sensitive by default.

## Before Making Changes

Before editing code:

1. Understand the task and the relevant files.
2. Inspect the existing patterns in the repository.
3. Identify the smallest safe implementation path.
4. Consider tests before implementation.
5. Check for security, validation, and error-handling concerns.

If requirements are ambiguous, make a reasonable assumption and document it in the final response. Do not block progress unless the ambiguity makes the work unsafe or impossible.

## Code Quality Defaults

Write code that is:

- Clear and self-explanatory.
- Strongly typed where the language supports it.
- Modular, but not unnecessarily fragmented.
- Easy to test.
- Defensive at system boundaries.
- Consistent with existing formatting, naming, and structure.

Avoid:

- Duplicated logic.
- Hidden side effects.
- Overly broad catch blocks.
- Silent failures.
- Hardcoded secrets or environment-specific values.
- Unvalidated external input.
- Mixing unrelated concerns in a single module.

## Architecture Defaults

Prefer a clean separation between:

- Input adapters, such as HTTP, email, CLI, UI, or voice.
- Application/service logic.
- Domain logic.
- Persistence and external integrations.
- Output adapters, such as email, API responses, UI rendering, or notifications.

Business rules should live outside framework-specific code when practical.

External services should be wrapped behind small interfaces or adapter modules so they can be tested and replaced.

## Security Defaults

Security is part of the implementation, not a cleanup step.

For every meaningful change, consider:

- Input validation and normalization.
- Authentication and authorization boundaries.
- Secret handling.
- Logging of sensitive data.
- Injection risks.
- Unsafe file, network, shell, or database access.
- Rate limiting or abuse potential where applicable.
- Safe error messages that do not leak internals.

Never commit secrets, API keys, tokens, private certificates, passwords, or real personal data.

Use environment variables or the project’s existing secret-management approach for configuration.

## Testing Expectations

Use test-driven development whenever practical.

Default workflow:

1. Write or update a failing test that describes the desired behavior.
2. Implement the smallest change that makes the test pass.
3. Refactor while keeping tests green.
4. Add additional tests for important edge cases.

Tests should cover:

- Happy paths.
- Error paths.
- Boundary cases.
- Invalid input.
- Security-sensitive behavior.
- Authorization or permission checks where relevant.
- External service failures, timeouts, malformed responses, and retries where applicable.

Do not only test successful behavior. Every feature should include tests for expected failures and unsafe inputs when relevant.

Prefer fast, deterministic tests. Mock or fake external systems unless the repository already has an established integration-test pattern.

When fixing a bug, add a regression test that would have failed before the fix.

## Test Commands

Use the repository’s existing test commands. Look for scripts or documentation such as:

- `package.json`
- `README.md`
- `Makefile`
- CI configuration
- Existing test folders

Common examples may include:

```bash
npm test
npm run test
npm run lint
npm run typecheck
npm run build
```

Do not assume these commands exist. Verify against the repository before using or recommending them.

## Error Handling

Handle errors intentionally.

Good error handling should:

- Preserve useful debugging information.
- Avoid exposing secrets or internal implementation details to users.
- Return actionable messages at system boundaries.
- Fail safely.
- Avoid swallowing errors silently.

Use typed or structured errors where the project supports them.

## Logging

Logs should help diagnose issues without leaking sensitive data.

Avoid logging:

- Passwords.
- Tokens.
- API keys.
- Full request bodies containing user data.
- Personal or sensitive information unless explicitly safe and necessary.

Prefer structured logs when the existing project supports them.

## Dependency Policy

Before adding a dependency:

- Check whether the project already has a suitable utility or package.
- Consider the maintenance, security, and bundle-size impact.
- Prefer well-maintained, widely used libraries.
- Avoid adding dependencies for trivial functionality.

If a dependency is added, ensure it is reflected in the correct package/configuration files.

## Documentation

Update documentation when behavior, setup, commands, environment variables, architecture, or public APIs change.

Keep documentation practical and close to the code it describes.

Prefer concise explanations with examples when helpful.

## API and Contract Changes

When changing an API, schema, event, function contract, or data model:

- Check call sites.
- Update tests.
- Preserve backward compatibility where practical.
- Document breaking changes clearly.
- Validate inputs and outputs at boundaries.

## Refactoring

Refactor only when it supports the task or significantly improves clarity/safety.

Good refactors are:

- Small.
- Tested.
- Easy to review.
- Behavior-preserving unless explicitly intended otherwise.

Avoid mixing large refactors with feature work unless necessary.

## Git and Commit Hygiene

Keep changes focused. Avoid unrelated edits.

Do not modify generated files, lockfiles, formatting, or broad project structure unless required by the task.

Before finishing, inspect the diff and verify that every changed file is intentional.

## Agent Workflow

For each task:

1. Inspect relevant files.
2. Identify existing patterns.
3. Plan the smallest safe change.
4. Write or update tests first when practical.
5. Implement the change.
6. Run focused tests.
7. Run broader validation when reasonable.
8. Review the diff.
9. Summarize what changed, what was tested, and any remaining risks.

## Final Response Expectations

When reporting back, include:

- What changed.
- What tests or checks were run.
- Any assumptions made.
- Any follow-up work that may be useful.

Be honest if tests could not be run or if something remains uncertain.

## Default Standard

Leave the codebase better than you found it, but do not turn a focused task into an unnecessary rewrite.
