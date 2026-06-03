# Project Context

## Product

This is a phishing and security awareness newsletter generator. It turns curated security news into employee-ready newsletter HTML that can be previewed, edited, exported, and optionally sent from the browser.

The project is designed to run without a backend. Live network features call third-party RSS proxies and optional AI APIs directly from the browser.

## Runtime Architecture

The app is a multi-page static site with root HTML entrypoints:

- `index.html`: primary **Home** page (feed fetch, article curation, newsletter generation). The shell **Home** link opens this page; toolbars and Projects deep-link to `#section-home` for the compose workflow.
- `builder.html`: optional bookmark; redirects to `index.html#section-home` (legacy `#section-builder` still scrolls to the same block). Handoff in `localStorage` is preserved.
- `keywords.html`: keyword allow/block list management.
- `preview.html`: generated newsletter preview, language selection, project save/versioning, and post-build actions.
- `editor.html`: rich editor and workspace guard behavior.
- `send.html`: SMTP profile, test send, newsletter send, and delivery log UI.
- `projects.html`: project listing and restore workflow.
- `config.html`: central organization, AI, and feed-source settings.

JavaScript files live in `js` and attach modules to `window.App`. There is no bundler, so page script order matters.

Important modules:

- `js/ux_contract.js`: global menu, flow stepper, route guards, and state cards.
- `js/db.js`: IndexedDB persistence for articles, metadata, drafts, projects, SMTP profiles, and delivery logs.
- `js/router_nav.js`: cross-page handoff through `localStorage`.
- `js/rss_fetcher.js`: RSS source list, CORS/proxy fetches, parsing, filtering, and classification.
- `js/keyword_store.js`: allow/block keyword persistence in `localStorage`.
- `js/project_store.js`: project CRUD, version snapshots, and migration helpers.
- `js/newsletter_builder.js`: newsletter HTML generation. Canonical visual reference HTML for most layouts lives in `templates/imported-standalone/` (copied from the standalone email-safe pack); run `node scripts/normalize-imported-templates.mjs` to emit email-font–sanitized copies under `templates/imported-email-safe/` for side-by-side QA. Templates are defined as JS functions returning HTML with `{{TOKEN}}` placeholders that are HTML-escaped during substitution; `TEMPLATE_CATALOG` registers each id (e.g. `phishingbrief` and `bankpage1_static` share the 11-token contract: `INTRO` + `SECTION{1,2,3}_BULLET{1..N}` sourced from `arts[]` titles/summaries). `bankpage1_dynamic` extends that contract with four card tokens (`CARD1_HEADING`, `CARD1_URL`, `CARD2_HEADING`, `CARD2_URL`) sourced from `arts[0..1]` titles and links. To onboard a new template, follow [TEMPLATE_ONBOARDING.md](TEMPLATE_ONBOARDING.md).
- `js/editor.js`: editor iframe and editing controls.
- `js/ui_controller.js`: main orchestration for the home/build workflow.
- `js/responsive_layout.js`: viewport tier metadata.

## Data Flow

1. RSS feeds are fetched through browser-accessible proxies.
2. Articles are filtered and classified using keyword rules and source metadata.
3. Articles and enriched summaries are stored in IndexedDB.
4. Selected articles, organization settings, and generated variants form the newsletter workspace.
5. Cross-page navigation uses a local handoff payload, and guarded pages recover users to Projects or Home.
6. Newsletter HTML is previewed by language, saved as versioned projects, edited, exported, copied, printed, or passed to the send flow.

## Storage

IndexedDB database: `SecurityAwareness`, version `4`.

Stores:

- `articles`
- `meta`
- `drafts`
- `projects`
- `smtpProfiles`
- `deliveryLogs`

Important browser storage keys:

- `awareness_newsletter_workspace_v1`
- `awareness_nav_handoff_v1`
- `awareness_custom_feed_sources_v1`
- `awareness_keywords_v1`
- `awareness_smtp_profile_v1`
- `awareness_ai_settings_v1`
- `awareness_ai_experiment_control_v1`
- `awareness_central_config_v1`

Treat these keys as potentially sensitive. API keys and SMTP details are user-owned browser data.

## Current Risks

- Public RSS proxies can fail with CORS, 403, 404, 408, 500, or 520 responses.
- A live feed failure can block article curation unless deterministic fixtures or fallback data are used for tests.
- `js/ui_controller.js` is broad and high-risk for regressions.
- Duplicate/stale folders can drift from the root implementation.
- IndexedDB schema changes require explicit migration notes and regression tests.

## Testing Strategy

Local deterministic tests should use fixtures and route mocks. Live feed behavior should be tested separately as an audit that can report blocked external dependencies without failing deterministic correctness checks.

