# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Companion Docs

These files are authoritative and should be read before non-trivial work:

- `AGENTS.md` — multi-agent workflow, local quality gate, test-first rules, safety rules.
- `CONTEXT.md` — runtime architecture, module responsibilities, data flow, IndexedDB schema, sensitive storage keys.
- `foundation_ux_contract.md` — page-to-flow mapping, route guard rules, state-card API. Every major page must conform.
- `TESTING.md` — local commands, deterministic vs. live checks, manual QA checklist.
- `MEMORY.md` — durable goals, recurring cautions, latest verification snapshot.

Treat `foundation_ux_contract.md` as a hard contract: changes to navigation labels, flow steps, guards, or `App.UXContract.init` callers must update the contract alongside the code.

## Commands

```bash
npm install              # one-time
npm run serve            # static server at http://127.0.0.1:4173
npm run lint
npm run test:unit        # node --test, all files under tests/unit/
npm run test:e2e         # Playwright (Chromium only); auto-starts npm run serve
npm run audit:baseline   # boots static server, then runs scripts/run_baseline_critical_path_audit.js
npm run verify           # lint + unit + e2e + audit (the full local gate)
npm run templates:normalize-imports  # regenerate templates/imported-email-safe/ from templates/imported-standalone/
```

Run a single unit test file:

```bash
node --test tests/unit/utils-clipboard.test.js
```

Run a single E2E spec (or filter by title):

```bash
npx playwright test tests/e2e/critical-flow.spec.js
npx playwright test -g "fetch fallback"
```

The Playwright config (`playwright.config.js`) auto-starts `npm run serve` and reuses an existing server locally. E2E specs assume `http://127.0.0.1:4173`.

## Architecture Notes Not Obvious From Files

- **No build step.** This is a static vanilla-JS multi-page app. `index.html`, `preview.html`, `editor.html`, `send.html`, `projects.html`, `keywords.html`, `curation-lab.html`, `config.html` are root entrypoints. `builder.html` is a legacy redirect to `index.html#section-home`.
- **`window.App` is the module surface.** Scripts in `js/` attach to `window.App.*` (e.g. `App.UXContract`, `App.UI`, `App.DB`, `App.RouterNav`). **HTML script order is part of the runtime contract** — do not reorder `<script>` tags casually.
- **Every major page must call `App.UXContract.init({ pageId, flowStepId, guard? })` before page-level UI init** to get the shared menu, flow stepper, and guard behavior. Required pages (`preview`, `editor`, `send`) rely on its guard to enforce a workspace.
- **Workspace state lives in `localStorage` (`awareness_newsletter_workspace_v1`) plus IndexedDB.** Cross-page handoff goes through `js/router_nav.js` (`awareness_nav_handoff_v1`). The **Home** link clears `projectId` / `projectSnapshotVersion` / `activeDraftId` from the handoff; other toolbars may deep-link to `#section-home`. Optional `projectSnapshotVersion` loads a saved snapshot instead of the live row.
- **IndexedDB:** database `SecurityAwareness`, version `4`, stores `articles`, `meta`, `drafts`, `projects`, `smtpProfiles`, `deliveryLogs`. Schema bumps require migration notes and regression tests (see `CONTEXT.md`).
- **`js/ui_controller.js` is broad and high-risk for regressions** — prefer small test-backed fixes here over refactors.
- **Templates pipeline:** canonical visual references live in `templates/imported-standalone/`. The script `scripts/normalize-imported-templates.mjs` emits email-font–sanitized copies under `templates/imported-email-safe/` for side-by-side QA. Don't hand-edit the email-safe folder.

## Testing Discipline

- **Deterministic E2E tests must use fixtures or route mocks** (`tests/fixtures/articles.js`). They must pass even when public RSS proxies and AI APIs are unreachable.
- **The baseline audit (`scripts/run_baseline_critical_path_audit.js`) may touch live integrations.** Treat upstream failures as `blocked` evidence — never rewrite a deterministic test to paper over a proxy/AI outage. Real `fail` checks exit non-zero; `blocked` is explicit and non-fatal.
- **Test-first for behavior changes.** Add or update a test, watch it fail for the expected reason, make the smallest scoped fix, then rerun the targeted test plus the relevant quality gate.
- **Preserve the empty-fetch and empty-DB fallback paths** in the curate/build flow — these unblock the workflow when feeds or storage are empty and are covered by deterministic E2E.

## Safety

- Don't commit `baseline-critical-path-audit-results.json`, `playwright-report/`, or `test-results/` unless the task explicitly updates audit evidence (these are gitignored).
- Never log or commit values from the sensitive `localStorage` keys listed in `CONTEXT.md` (API keys, SMTP profile, AI settings, workspace dumps, delivery logs).
- Preserve the static, no-backend app model unless the user explicitly approves a larger architecture change.


