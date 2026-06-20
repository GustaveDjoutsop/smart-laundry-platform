# GitHub Agent Context (JavaScript/TypeScript)

This file provides context and guidelines for GitHub Copilot (and other AI agents) to generate code that matches this JavaScript/TypeScript codebase.

## Project Description

This is a JavaScript/TypeScript project (Node.js and/or browser).
If available, infer the project purpose by scanning `README.md` and files under `/documentation`.
If documentation is insufficient, respond with a request for more information.
If documentation folder is missing create the folder and add a design.md an error-handling.md and functionality.md file with relevant project information.

## Guidelines

### General Guidelines

- Be direct and critical. If a request is unclear, inconsistent, or overcomplicated, say so and propose a simpler alternative.
- Prefer maintainability over cleverness.
- Avoid unnecessary abstractions. If it’s not reused, don’t abstract it.
- Avoid boilerplate and duplicated code blocks; keep code reusable and concise.
- Don’t leave commented-out code in the repository.
- Use constants from dedicated constants/config modules (instead of hard-coded values) when a value appears more than once.

### Tooling

- Follow the repo’s `.editorconfig` formatting rules.
- Respect existing lint/format configs (ESLint, Prettier) and TypeScript `tsconfig` settings.
- Don’t introduce new dependencies unless there’s a clear, measurable benefit.

### TypeScript / JavaScript Rules

- Prefer TypeScript when the codebase supports it.
- Avoid `any`. Prefer `unknown` and explicitly validate/parse external input.
- Prefer `const` by default. Use `let` only when reassignment is required.
- Use descriptive names. Avoid shorthands.
- Keep functions small and focused.
- Prefer pure functions for business logic. Isolate I/O (HTTP/DB/FS) into boundary modules.

#### Types

- **Interfaces are allowed and recommended** for public contracts and object shapes.
- Use `type` for unions, primitives, mapped/utility types, and function types.
- Prefer literal unions (`'a' | 'b'`) over enums unless there’s a strong reason for enums.
- Use `readonly` for data that must not mutate.

#### Error Handling

- Throw/return real `Error` objects, not strings.
- Include actionable messages.
- Don’t swallow errors; either handle them or propagate them.

#### Logging

- Never log secrets (tokens, passwords, API keys) or sensitive/PII data.
- Prefer structured logging (objects) over string concatenation.
- Avoid printing massive payloads. Log IDs and key fields instead.

### Code Organization

- Keep module boundaries clear.
- Prefer explicit exports.
- Avoid deep relative imports if path aliases are available.

### Formatting

- Let Prettier/ESLint decide formatting.
- Use blank lines only to separate meaningful logical blocks.
- Ensure exactly one newline at the end of each file.

### Testing Rules (Jest/Vitest)

- Tests are required for non-trivial business logic.
- Test method naming pattern:
  - `should<DoSomething>When<Condition>` (e.g., `shouldReturn401WhenTokenIsMissing`).
- Structure tests using comments:
  - `// given`
  - *(blank line)*
  - `// when`
  - *(blank line)*
  - `// then`
- Prefer parameterized tests for repeated scenarios.
- Avoid flaky tests:
  - Make time deterministic (mock time).
  - Make randomness deterministic (seed or mock).
- Assert precisely (status codes, counts, key fields), not “something truthy”.

### Security

- Validate and sanitize external input.
- Never inject unescaped user input into queries or templates.
- Don’t commit secrets.

### Copilot Output Constraints

- Don’t paste copyrighted code from external sources.
- When generating changes:
  - Prefer minimal diffs.
  - Keep naming consistent with the existing codebase.
  - Add tests for changed behavior.
