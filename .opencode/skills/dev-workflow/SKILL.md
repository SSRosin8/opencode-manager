---
name: dev-workflow
description: Use when starting any code change, bug fix, feature, or refactoring task. Enforces branch-first workflow and commit conventions. Trigger on keywords like fix, add, refactor, implement, change, update, modify, edit, improve.
---

# Development Workflow

Standard workflow for all code changes in this project.

## Step 1: Branch First

Before ANY code change, always switch to a dev branch:

```
git stash                          # save any uncommitted work
git checkout main && git pull       # sync with upstream
git checkout -b dev/<short-desc>    # create feature branch
git stash pop                      # restore work if any
```

Branch naming convention:
- `dev/<short-description>` for features and fixes
- `fix/<issue-or-bug>` for bug fixes
- `refactor/<scope>` for refactoring

## Step 2: Make Changes

- Follow AGENTS.md rules (file size limits, module responsibilities, etc.)
- Keep changes minimal and focused
- Run `npm run validate` before considering work done

## Step 3: Commit

Only commit when explicitly asked. Commit message format:

```
<type>: <concise description>

type: feat, fix, refactor, docs, test, chore
```

Examples:
- `fix: remove egressIp dedup from worker creation`
- `feat: add proxy pool health dashboard`
- `refactor: split admin routes into domain handlers`

## Step 4: Verify

Always run before commit:

```bash
npm run validate
git diff --check
```

## Rules

- Never commit directly to `main`
- Never force-push or rewrite shared history
- Each commit = one logical change
- Tests + implementation belong in the same commit when they share one behavior change
- Do not mix unrelated lockfile drift, dependency bumps, or formatting into feature commits
