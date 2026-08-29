---
name: dev-workflow
description: Use when starting any code change, bug fix, feature, or refactoring task. Enforces branch-first workflow and commit conventions. Trigger on keywords like fix, add, refactor, implement, change, update, modify, edit, improve.
---

# Development Workflow

Standard workflow for all code changes in this project.

## Step 1: Worktree + Branch First (强制)

主 worktree 为只读基准，禁止直接在其上开发。必须先创建独立 worktree：

```
git stash                          # save any uncommitted work in main if needed
git fetch origin
git worktree add ../opencode-manager-<feature> -b <branch> origin/main
# 例：git worktree add ../opencode-manager-multi-bridge -b feat/multi-bridge-pool origin/main
cd ../opencode-manager-<feature>
```

分支/worktree 命名：
- `feat/<short-description>` / `fix/<issue>` / `refactor/<scope>`
- worktree 目录 `../opencode-manager-<feature>` 与分支一一对应

后续所有编辑、构建、测试均在该 worktree 内执行；主 worktree 保持 `git status --porcelain` 为空。

## Step 2: Make Changes (在 worktree 内)

- Follow AGENTS.md 规则（文件规模、模块职责、Worktree 约束等）
- 保持改动最小且聚焦
- 所有 `npm run validate` / `npm run build` / `npm test` 必须在 worktree 内执行，严禁在主 worktree 执行

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

## Step 4: Verify (在 worktree 内)

Always run before commit/push **inside the worktree**:

```bash
npm run validate
git diff --check
# workdir 必须为 ../opencode-manager-<feature>，而非主 worktree
```

## Step 5: Cleanup After Merge

合并后及时清理：

```bash
git worktree remove ../opencode-manager-<feature>
git branch -d <branch>
git push origin --delete <branch>
git fetch --prune
```

## Rules

- Never commit directly to `main`
- Never develop, build, or test in the main worktree — use a dedicated worktree
- Main worktree must stay `git status --porcelain` empty during development
- Never force-push or rewrite shared history
- Each commit = one logical change
- Tests + implementation belong in the same commit when they share one behavior change
- Do not mix unrelated lockfile drift, dependency bumps, or formatting into feature commits
