@AGENTS.md

# LendLoop

## Language

- Everything written into the repository is in English: code, comments, commit messages, PR titles and descriptions, and docs, this file included. This holds even when the conversation happens in another language.

## Commits and PRs

- Before opening a PR, organize the branch into a few logical commits, one per part of the feature (for example signing, notifications, endpoints, infra, docs). Do not leave one commit per work step.
- Fixes that come from a review go into the commit they fix, not into separate commits.
- Every commit must pass `npm test`, `npm run typecheck` and `npm run lint` on its own.
- Commit messages and PR descriptions use plain prose that explains why, in the style of PR #3.
- Never commit directly to `main`. Work on a `feat/...` or `fix/...` branch.
- Rewrite the history of a pushed branch (force-push) only after I approve it, and always with `--force-with-lease`.

## Environment

- Use Node 22 from `.nvmrc`. The terminal's default Node is older and breaks `npx convex` and `vitest`.
