# Deploy Awareness Newsletter to GitHub Pages

This app is a **static site** (HTML + JavaScript, no production build). GitHub Pages hosts the files produced by `scripts/prepare-github-pages.mjs` into the `_site/` folder.

## What gets published

The deploy script copies:

- Root pages: `index.html`, `preview.html`, `editor.html`, `send.html`, `projects.html`, `keywords.html`, `config.html`, `curation-lab.html`, `builder.html`, etc.
- `js/` — all runtime modules
- `assets/` — images and static assets
- `templates/imported-email-safe/` and `templates/imported-standalone/` — template references

It **does not** publish `node_modules/`, `tests/`, Playwright reports, backup `*.bak` files, or local audit JSON.

## Prerequisites

1. A **GitHub account** and a repository for this project (empty or existing).
2. **Git** installed locally.
3. (Optional) **Node.js 20+** if you want to preview the Pages bundle locally.

## One-time GitHub setup

### 1. Push the repository

If the project is not on GitHub yet:

```bash
cd /path/to/awareness
git init
git add .
git commit -m "Initial commit: awareness newsletter app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub user/org and repository name.

### 2. Enable GitHub Pages (Actions source)

1. Open the repo on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**:
   - **Source:** select **GitHub Actions** (not “Deploy from a branch”).
3. Save. No branch/folder selection is needed when using the workflow in `.github/workflows/deploy-pages.yml`.

The first successful workflow run will publish the site.

### 3. Confirm the workflow ran

1. Go to **Actions** → **Deploy GitHub Pages**.
2. Open the latest run; both **build** and **deploy** jobs should be green.
3. On the **deploy** job, open the environment link or check **Settings → Pages** for the live URL.

## Live URL

| Pages type | URL pattern |
|------------|-------------|
| **Project site** (repo `awareness`) | `https://YOUR_USERNAME.github.io/awareness/` |
| **User/org site** (repo `YOUR_USERNAME.github.io`) | `https://YOUR_USERNAME.github.io/` |

Open **`index.html`** via the directory URL (GitHub serves `index.html` automatically):

- Project site: `https://YOUR_USERNAME.github.io/awareness/`
- User site: `https://YOUR_USERNAME.github.io/`

Entry route for the home workflow: `index.html#section-home` (same as local `npm run serve`).

## Automatic deploys

Every **push to `main` or `master`** triggers:

1. `node scripts/prepare-github-pages.mjs` → writes `_site/`
2. Upload artifact → **Deploy to GitHub Pages**

To deploy manually: **Actions** → **Deploy GitHub Pages** → **Run workflow**.

## Preview the Pages bundle locally

```bash
npm run pages:build
npx serve _site -l 4173
```

Then open `http://127.0.0.1:4173` (same port as `npm run serve`, but serves only deployable files).

## Custom domain (optional)

1. **Settings → Pages → Custom domain** — enter your domain (e.g. `awareness.example.com`).
2. At your DNS provider, add the records GitHub shows (usually `CNAME` to `YOUR_USERNAME.github.io`).
3. Enable **Enforce HTTPS** when available.

No code changes are required for a custom domain; relative links in the app still work.

## Important behavior on GitHub Pages

- **No backend:** RSS proxies, AI APIs, and SMTP run from the **browser** only. Users configure API keys in **Config**; data stays in **localStorage** and **IndexedDB** per browser.
- **HTTPS:** GitHub Pages is HTTPS; mixed-content blocking may affect some HTTP-only feed URLs.
- **Private repo:** GitHub Pages on free private repos may require GitHub Pro; public repos publish Pages for free.
- **Paths:** Navigation uses relative HTML files (`preview.html`, `editor.html`, …), so the app works on project URLs like `/awareness/` without extra base-path configuration.

## Troubleshooting

| Problem | What to do |
|---------|------------|
| **404 on Pages** | Ensure **Source = GitHub Actions**, workflow completed, and you use the URL from **Settings → Pages** (include repo name for project sites). |
| **Workflow not listed** | Push `.github/workflows/deploy-pages.yml` to `main`/`master`. |
| **Blank page / scripts missing** | Re-run `npm run pages:build` locally and confirm `_site/js/` exists; check browser devtools **Network** for 404s. |
| **Old content after push** | Wait 1–2 minutes; hard-refresh (Ctrl+Shift+R). Check latest Actions run succeeded. |
| **Permission errors on deploy** | Repo **Settings → Actions → General → Workflow permissions** should allow read/write (default for Pages with `id-token: write`). |

## Files involved in deployment

| File | Role |
|------|------|
| [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) | CI: build `_site` and deploy to Pages |
| [scripts/prepare-github-pages.mjs](scripts/prepare-github-pages.mjs) | Copies deployable static files |
| `_site/` | Generated output (gitignored; created in CI) |
| `.nojekyll` | Written into `_site/` so GitHub does not run Jekyll |

## Updating the live site

1. Change code locally and test: `npm run serve` or `npm run pages:build` + serve `_site`.
2. Commit and push to `main`:

```bash
git add .
git commit -m "Describe your change"
git push origin main
```

3. Watch **Actions** until **Deploy GitHub Pages** finishes.

## Security reminder

Do not commit API keys, SMTP passwords, or browser storage dumps. The app stores secrets only in the visitor’s browser (`localStorage` / IndexedDB). GitHub Pages only hosts public static files.
