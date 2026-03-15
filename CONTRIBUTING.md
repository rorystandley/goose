# Contributing to Goose

Thanks for your interest in contributing.

Goose is designed to be local-first, interface-agnostic, and safe by default. Contributions that keep those principles intact are especially welcome.

## Ways to Contribute

- Report bugs and regressions
- Propose or implement new tools and interfaces
- Improve tests, docs, and examples
- Review pull requests

## Ground Rules

- Be respectful and constructive (see `CODE_OF_CONDUCT.md`)
- Keep changes focused and easy to review
- Include tests for behavioral changes
- Update docs when behavior or public APIs change

## Development Setup

1. Fork and clone the repository.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

4. Run tests and lint before opening a PR:

   ```bash
   npm run lint
   npm test
   ```

## Recommended Workflow

1. Create a branch from `develop`:

   ```bash
   git checkout develop
   git pull
   git checkout -b feat/short-description
   ```

2. Make your change in small, reviewable commits.
3. Add or update tests under `src/__tests__/`.
4. Run:

   ```bash
   npm run lint
   npm run test:coverage
   ```

5. Open a pull request against `develop`.

## Coding and Testing Notes

- Runtime is Node.js 20
- Codebase uses ES Modules (`"type": "module"`)
- Keep interface code under `src/interfaces/<name>/`
- Keep core agent and tools interface-independent
- For new tools, define clear `riskLevel` and parameter schema

## Pull Request Checklist

- [ ] My change is scoped and documented
- [ ] I added or updated tests where needed
- [ ] I ran lint and tests locally
- [ ] I did not include secrets or sensitive data
- [ ] I updated docs if user-facing behavior changed

## Reporting Security Issues

Please do not open public issues for security vulnerabilities. See `SECURITY.md` for responsible disclosure instructions.
