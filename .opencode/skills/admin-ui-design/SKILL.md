---
name: admin-ui-design
description: Use when reviewing, redesigning, or implementing the opencode-manager admin UI. Trigger on UI, UX, CSS, layout, responsive, accessibility, dashboard, visual, design, sidebar, table, modal, proxy page, worker page.
---

# opencode-manager Admin UI Design

Design and review the local admin console as a calm, dense, high-quality
infrastructure/developer tool.

## Required context

Before editing, read:

1. `AGENTS.md`
2. `.opencode/skills/dev-workflow/SKILL.md`
3. `tests/admin-ux-ui.test.ts`
4. Relevant files under `src/server/admin/` (`documentHead.ts`, `featureStyles.ts`,
   `markup.ts`, `clientCore.ts`, `clientProxyViews.ts`, `clientWorkerViews.ts`,
   `clientI18n.ts`, `clientTooltips.ts`)

Do not start implementation before understanding the current UX contracts.
`tests/admin-ux-ui.test.ts` is the behavior contract: proxy tabs, action
hierarchy, gateway basic/advanced split, guide, touch targets, tooltip layer,
mobile card tables, accent-vs-status separation.

## Product direction

The interface should feel:

- precise
- calm
- compact
- operational
- developer-focused
- trustworthy
- fast

Prefer a Linear/Vercel-like infrastructure console over a generic SaaS dashboard.
Target: 3s to judge health, 5s to locate the abnormal object, 10s to finish a
common operation.

## Architecture constraints

- Preserve the self-contained HTML/CSS/JS architecture assembled in
  `src/server/adminHtml.ts` (`ADMIN_HTML = [...].join("")`).
- Do not introduce React/Vue/Svelte or a new frontend build system unless
  explicitly requested.
- Do not add runtime UI dependencies merely for styling.
- Keep Admin API behavior unchanged for visual-only changes.
- Follow project worktree rules: develop only in a dedicated worktree, never in
  the main worktree.
- Keep all visible copy bilingual through the existing `clientI18n.ts` system.
- Local admin must render fully offline: no external font/CDN dependencies.

## Visual rules

- Dark-first, but light theme must receive equal care.
- Use solid content surfaces (`panel`, `metric`, table body, worker/proxy cards).
- Reserve blur/translucency for chrome only: topbar, sidebar, dropdowns,
  tooltips, modals, floating confirmations.
- Accent means interactive/selected, never health.
- Green = healthy, amber = warning, red = error.
- Avoid purple-gradient AI dashboard aesthetics.
- Avoid excessive cards, pills, glow, shadows, and hover lift.
- Keep radius compact (4-10px).
- Prefer alignment, spacing, typography, and contrast over decoration.
- Do not use text below 12px except very short metadata/badges.
- Mono font is for IDs, IPs, ports, URLs, model names, and code.

## Interaction rules

- Each page has no more than 1 primary action.
- Prefer no more than 1 obvious secondary action in the page header.
- Move utility and destructive actions into contextual toolbars or `More` menus.
- Destructive actions require explicit confirmation (prefer modal dialog over
  floating confirm for truly destructive operations).
- Tables optimize scanning first; use a detail sheet/inspector for secondary row
  information instead of adding columns.
- Preserve useful state across refresh (page, proxy tab, collapses).
- Navigation should support deep links (`/#overview`, `/#proxy`, ...).
- Keep common actions keyboard accessible.
- Prefer Cmd/Ctrl+K for global commands only if global actions keep growing.

## Accessibility

- Maintain visible focus (`:focus-visible`).
- Support full keyboard navigation (tabs, menus, modal/sheet focus trap + return).
- Honor `prefers-reduced-motion`.
- Mobile controls keep at least 44px touch targets.
- Status must never be communicated by color alone.
- Tooltips cannot contain required actions; use the shared `ui-tooltip` layer.
- Modals/sheets must manage focus correctly; loading uses `aria-busy`.

## Responsive rules

Desktop:

- Preserve high information density.
- Prefer tables and side inspectors.

Tablet:

- Collapse secondary columns before shrinking text.

Mobile:

- Convert dense tables into semantic cards.
- Use bottom sheets for filters/details where appropriate.
- Keep primary actions reachable (sticky action bar on dirty forms).

## Workflow

1. Audit the current user task.
2. State the hierarchy problem before changing visuals.
3. Propose the smallest structural improvement.
4. For complex pages (Proxy Pool, Workers): prototype as a standalone HTML
   mockup first, confirm direction, then implement in `src/server/admin/`.
5. Update or add design tokens.
6. Implement using existing architecture.
7. Update UX contract tests in `tests/admin-ux-ui.test.ts`.
8. Run in the worktree:
   - `npm run validate`
   - `git diff --check`
9. Perform desktop + mobile browser checks (dark + light).
10. Report before/after behavior and remaining risks.

## Anti-patterns

Do not:

- redesign only by changing colors;
- add glass blur to every card;
- convert every section into a card;
- place 5+ peer actions in a page header;
- use animation to compensate for unclear hierarchy;
- hide critical state inside hover-only UI;
- sacrifice density to imitate a marketing website;
- refactor backend behavior as part of a visual-only change.
