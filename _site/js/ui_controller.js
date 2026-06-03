/* ═══════════════════════════════════════════════════════════
   ui_controller.js — Single-page UI controller
   Streamlined workflow: pick template → fetch → select → generate
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

App.UI = (() => {
  'use strict';
  const {
    log, clearLog, fmtDate, daysAgo, isWithinDays, copyHTML, showToast, skeleton, wait,
    downloadHTML, htmlToSvgExport, downloadBlob, injectNlQrImageIntoHtml, stripTags
  } = App.Utils;
  const G = App.Graphics;
  const TranslationMetrics = App.TranslationMetrics;
  const WORKSPACE_STORAGE_KEY = 'awareness_newsletter_workspace_v1';
  const WORKSPACE_CHECKPOINT_KEY = 'awareness_newsletter_workspace_checkpoint_v1';
  const WORKSPACE_CHECKPOINT_BACKUP_KEY = 'awareness_newsletter_workspace_checkpoint_backup_v1';
  const SMTP_STORAGE_KEY = 'awareness_smtp_profile_v1';
  const AI_SETTINGS_STORAGE_KEY = 'awareness_ai_settings_v1';
  const AI_EXPERIMENT_CONTROL_STORAGE_KEY = 'awareness_ai_experiment_control_v1';
  const CENTRAL_CONFIG_STORAGE_KEY = 'awareness_central_config_v1';
  const WORKFLOW_STATES = ['draft', 'review', 'approved', 'sent', 'archived'];
  const WORKFLOW_LABELS = {
    draft: 'Draft',
    review: 'Review',
    approved: 'Approved',
    sent: 'Sent',
    archived: 'Archived'
  };
  const WORKFLOW_TRANSITIONS = {
    draft: ['review', 'archived'],
    review: ['draft', 'approved', 'archived'],
    approved: ['review', 'sent', 'archived'],
    sent: ['archived'],
    archived: []
  };
  const NEWSLETTER_LANGUAGES = [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Spanish' },
    { id: 'pt-BR', label: 'Portuguese (Brazil)' },
    { id: 'zh-CN', label: 'Chinese (Simplified)' },
    { id: 'ko', label: 'Korean' },
    { id: 'uk', label: 'Ukrainian' },
    { id: 'de', label: 'German' },
    { id: 'fr', label: 'French' },
    { id: 'nl', label: 'Dutch' },
    { id: 'it', label: 'Italian' }
  ];

  const state = {
    selectedFormat: 'poster',
    selectedArticleIndices: [],
    allArticles: [],
    activeFilter: 'All',
    articleSort: 'date_desc',
    /** Instant filter above article list (title, summary, source, type, URL). */
    articleKeywordQuery: '',
    filterDays: 7,
    feedStats: {},
    fetchTelemetry: null,
    curationMode: 'balanced',
    curationFeedback: {},
    loading: false,
    currentPreviewLanguage: 'en',
    newsletterWorkspace: null,
    activeProjectId: null,
    activeDraftId: null,
    drafts: [],
    smtpProfile: null,
    aiExperimentControl: null,
    selectedDraftToLoad: null,
    translationCache: {},
    translationLastFailure: null,
    translationPendingLang: null,
    unsavedChanges: false,
    suppressUnsavedPrompt: false,
    /** When set, workspace was loaded from `project.snapshots` (not the live row). */
    projectSnapshotVersion: null
  };

  function stableStringify(value) {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return '';
    }
  }

  function hashContent(input = '') {
    const str = String(input || '');
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return `${str.length}:${Math.abs(hash)}`;
  }

  const TRANSLATION_PIPELINE_VERSION = 'v2-lead-split';

  function translationSignature(langId, html, css = '') {
    return `${TRANSLATION_PIPELINE_VERSION}:${langId}:${hashContent(html)}:${hashContent(css)}`;
  }

  function flagUnsavedChanges(isDirty = true) {
    state.unsavedChanges = !!isDirty;
  }

  function clearUnsavedChanges() {
    state.unsavedChanges = false;
  }

  function writeWorkspaceCheckpoint(reason = 'autosave') {
    if (!state.newsletterWorkspace) return;
    try {
      const checkpoint = {
        reason,
        savedAt: new Date().toISOString(),
        activeDraftId: state.activeDraftId || null,
        workspace: state.newsletterWorkspace
      };
      const currentRaw = localStorage.getItem(WORKSPACE_CHECKPOINT_KEY);
      if (currentRaw) localStorage.setItem(WORKSPACE_CHECKPOINT_BACKUP_KEY, currentRaw);
      localStorage.setItem(WORKSPACE_CHECKPOINT_KEY, JSON.stringify(checkpoint));
    } catch (e) {}
  }

  function recoverWorkspaceFromCheckpoint() {
    const tryLoad = (raw) => {
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.workspace?.variants) return null;
      return parsed;
    };
    try {
      const fromPrimary = tryLoad(localStorage.getItem(WORKSPACE_CHECKPOINT_KEY));
      if (fromPrimary) return fromPrimary;
    } catch (e) {}
    try {
      const fromBackup = tryLoad(localStorage.getItem(WORKSPACE_CHECKPOINT_BACKUP_KEY));
      if (fromBackup) return fromBackup;
    } catch (e) {}
    return null;
  }

  function updateDebugState(patch = {}) {
    const el = document.getElementById('debug-state');
    if (el) {
      // Keep debug panel fully disabled in production UI.
      el.style.display = 'none';
      el.innerHTML = '';
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function fetchWithTranslationRetry(url, init, options = {}) {
    const attempts = options.attempts ?? 4;
    const baseMs = options.baseMs ?? 400;
    let lastResp = null;
    for (let i = 0; i < attempts; i += 1) {
      lastResp = await fetch(url, init);
      if (lastResp.ok) return lastResp;
      const status = lastResp.status;
      const retryable = status === 429 || (status >= 500 && status <= 599);
      if (retryable && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseMs * (2 ** i)));
        continue;
      }
      return lastResp;
    }
    return lastResp;
  }

  function getLanguageLabel(langId) {
    return NEWSLETTER_LANGUAGES.find(l => l.id === langId)?.label || langId;
  }

  function setLanguageTranslating(isOn, langId = '') {
    const el = document.getElementById('lang-translating');
    const sel = document.getElementById('preview-lang');
    const text = langId === 'multi'
      ? 'Translating all languages...'
      : `Translating ${getLanguageLabel(langId || (sel?.value || ''))}...`;
    if (!el) {
      if (isOn) {
        clearTranslationPipelineState();
        setTranslationPipelineState('loading', 'Translation in progress', text);
      }
      return;
    }
    if (isOn) {
      clearTranslationPipelineState();
      el.classList.add('active');
      el.textContent = text;
      setTranslationPipelineState('loading', 'Translation in progress', text);
    } else {
      el.classList.remove('active');
      el.textContent = 'Translating...';
    }
  }

  function setTranslateProgress(active, current = 0, total = 0, label = 'Preparing...', pipelineTitle = 'Translation in progress') {
    const modal = document.getElementById('translate-modal');
    const stepLabel = document.getElementById('translate-step-label');
    const stepCount = document.getElementById('translate-step-count');
    const bar = document.getElementById('translate-bar-fill');
    if (!modal || !stepLabel || !stepCount || !bar) {
      const lt = document.getElementById('lang-translating');
      if (lt) {
        if (!active) {
          lt.classList.remove('active');
          lt.textContent = 'Translating...';
        } else {
          clearTranslationPipelineState();
          lt.classList.add('active');
          lt.textContent = label || 'Translating...';
          setTranslationPipelineState('loading', pipelineTitle, label || 'Translating...');
        }
      } else if (active) {
        clearTranslationPipelineState();
        setTranslationPipelineState('loading', pipelineTitle, label || 'Translating...');
      }
      return;
    }
    if (!active) {
      modal.classList.remove('active');
      stepLabel.textContent = 'Preparing...';
      stepCount.textContent = '0 / 0';
      bar.style.width = '0%';
      return;
    }
    modal.classList.add('active');
    clearTranslationPipelineState();
    const safeTotal = Math.max(1, total);
    const safeCurrent = Math.max(0, Math.min(current, safeTotal));
    stepLabel.textContent = label || 'Translating...';
    stepCount.textContent = `${safeCurrent} / ${safeTotal}`;
    bar.style.width = `${Math.round((safeCurrent / safeTotal) * 100)}%`;
    setTranslationPipelineState('loading', pipelineTitle, `${stepLabel.textContent} (${stepCount.textContent})`);
  }

  function clearTranslationPipelineState() {
    const stateWrap = document.getElementById('translation-pipeline-state');
    if (stateWrap) stateWrap.innerHTML = '';
  }

  function setTranslationPipelineState(variant, title, message, actions = '') {
    const stateWrap = document.getElementById('translation-pipeline-state');
    if (!stateWrap) return;
    App.UXContract?.injectStyles?.();
    App.UXContract?.renderStateCard?.('translation-pipeline-state', variant, title, message);
    if (actions) {
      stateWrap.insertAdjacentHTML('beforeend', `<div style="display:flex;gap:.4rem;flex-wrap:wrap">${actions}</div>`);
    }
  }

  function recordTranslationFailure(patch = {}) {
    state.translationLastFailure = {
      at: new Date().toISOString(),
      ...state.translationLastFailure,
      ...patch
    };
    TranslationMetrics.persistTranslationDiag(state.translationLastFailure);
  }

  function renderTranslationFailureState(message) {
    const safeMessage = escapeHtml(message || 'Unknown error');
    const diagLine = state.translationLastFailure
      ? escapeHtml(TranslationMetrics.formatDiagSummary(state.translationLastFailure))
      : '';
    const detail = diagLine ? `${safeMessage} — ${diagLine}` : safeMessage;
    setTranslationPipelineState(
      'error',
      'Translation blocked',
      `All languages must pass QA before preview. ${detail}`,
      `<button class="btn" onclick="App.UI.retryTranslationPipeline()">Retry translation</button>
       <button class="btn" onclick="window.location.href='config.html'">Open Config</button>`
    );
  }

  async function retryTranslationPipeline() {
    if (!state.newsletterWorkspace?.variants?.en?.html) {
      showToast('Generate newsletter first, then retry translation.', true);
      return;
    }
    try {
      setLanguageTranslating(true, 'multi');
      await translateWorkspaceFromEnglish({ overwrite: true, progressLabel: 'Retrying translations' });
      state.translationLastFailure = null;
      clearTranslationPipelineState();
      showToast('Translation completed. Continue to Preview.');
    } catch (e) {
      showToast(`Translation failed: ${e.message}`, true);
      if (!state.translationLastFailure) {
        recordTranslationFailure({
          message: e.message,
          kind: TranslationMetrics.classifyTranslationFailureKind(e.message)
        });
      }
      renderTranslationFailureState(e.message);
    } finally {
      setLanguageTranslating(false);
    }
  }

  function makeVariant(html = '', css = '', projectData = null) {
    return { html: html || '', css: css || '', projectData: projectData || null, updatedAt: new Date().toISOString() };
  }

  function hasRenderableHtml(variantsLike) {
    if (!variantsLike || typeof variantsLike !== 'object') return false;
    return Object.keys(variantsLike).some(langId => {
      const v = normalizeVariant(variantsLike[langId]);
      return !!(v && typeof v.html === 'string' && v.html.trim());
    });
  }

  function normalizeWorkflow(workflowLike) {
    const now = new Date().toISOString();
    const currentState = WORKFLOW_STATES.includes(workflowLike?.state) ? workflowLike.state : 'draft';
    const lastEditedBy = (workflowLike?.lastEditedBy || 'Local User').trim() || 'Local User';
    const history = Array.isArray(workflowLike?.history)
      ? workflowLike.history.filter(item => item && WORKFLOW_STATES.includes(item.to) && item.changedAt)
      : [];
    if (!history.length) {
      history.push({
        from: null,
        to: currentState,
        changedAt: now,
        changedBy: lastEditedBy,
        note: 'Initial workflow state'
      });
    }
    return { state: currentState, lastEditedBy, history };
  }

  function normalizeVariant(variantLike) {
    const stripLegacy = (html) =>
      (App.Utils && typeof App.Utils.stripLegacyFooterClassification === 'function')
        ? App.Utils.stripLegacyFooterClassification(html)
        : html;
    if (!variantLike) return makeVariant();
    if (typeof variantLike === 'string') {
      const tmp = document.createElement('div');
      tmp.innerHTML = stripLegacy(variantLike);
      let css = '';
      tmp.querySelectorAll('style').forEach(st => { css += `${st.textContent || ''}\n`; st.remove(); });
      return makeVariant(tmp.innerHTML, css.trim(), null);
    }
    if (typeof variantLike === 'object' && typeof variantLike.html === 'string') {
      return makeVariant(stripLegacy(variantLike.html), variantLike.css || '', variantLike.projectData || null);
    }
    return makeVariant();
  }

  function renderVariantHtml(variant) {
    if (!variant) return '';
    return `${variant.css ? `<style data-nl-variant-style>${variant.css}</style>` : ''}${variant.html || ''}`;
  }

  function defaultProjectTitle() {
    const issueDate = document.getElementById('meta-issue-date')?.value || new Date().toISOString().split('T')[0];
    return `newsletter_${issueDate}`;
  }

  function getProjectTitle() {
    const projectTitle = document.getElementById('project-title');
    const title = (projectTitle?.value || document.getElementById('meta-title')?.value || '').trim() || defaultProjectTitle();
    if (projectTitle) projectTitle.value = title;
    const metaTitle = document.getElementById('meta-title');
    if (metaTitle) metaTitle.value = title;
    return title;
  }

  function updateProjectChrome(project = null) {
    const titleEl = document.getElementById('project-title');
    if (titleEl && !titleEl.value.trim()) titleEl.value = document.getElementById('meta-title')?.value?.trim() || defaultProjectTitle();
    const versionEl = document.getElementById('project-version-label');
    if (versionEl) {
      const tip = project?.version ? `Latest saved: v${project.version}` : 'Unsaved project';
      if (state.projectSnapshotVersion != null) {
        versionEl.textContent = `Viewing snapshot v${state.projectSnapshotVersion} · ${tip}`;
      } else {
        versionEl.textContent = project?.version ? `Version ${project.version}` : 'Unsaved project';
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // NL EDITOR — thin wrapper; all editor logic is in editor.js
  // ═══════════════════════════════════════════════════════

  function openEditor() {
    if (!state.newsletterWorkspace) return showToast('Generate newsletter first.', true);
    syncVariantFromPreviewDom(state.currentPreviewLanguage);
    const variant = currentPreviewVariant();
    const langId = state.currentPreviewLanguage;
    App.Editor.open({
      html: variant.html,
      css: variant.css,
      langId,
      langLabel: getLanguageLabel(langId),
      portalUrl: (() => {
        const cfg = state.newsletterWorkspace?.cfg || {};
        const p = App.Utils.normalizeWebUrl(String(cfg.portal || cfg.portalUrl || '').trim());
        if (p) return p;
        const s = cfg.soc;
        return (s && String(s).trim()) ? `mailto:${String(s).trim()}` : 'https://security.example.com';
      })(),
      onSave: function ({ html, css }) {
        state.newsletterWorkspace.variants[langId] = makeVariant(html, css, null);
        persistWorkspace();
        renderPreviewForLanguage(langId);
        showToast(`${getLanguageLabel(langId)} version saved.`);
      },
      onGetResetData: function () {
        if (langId === 'en') { showToast('English is the base template.', true); return null; }
        if (!confirm(`Reset ${getLanguageLabel(langId)} to the English base template?`)) return null;
        const en = normalizeVariant(state.newsletterWorkspace?.variants?.en);
        if (!en || !en.html) return null;
        state.newsletterWorkspace.variants[langId] = makeVariant(en.html, en.css, null);
        persistWorkspace();
        renderPreviewForLanguage(langId);
        return { html: en.html, css: en.css };
      },
      onDeleteInAllLanguages: async function ({ path, relPath }) {
        if (!state.newsletterWorkspace?.variants || !App.Utils.removeNewsletterNodeByMirrorPath) {
          return { ok: false };
        }
        let n = 0;
        for (const { id } of NEWSLETTER_LANGUAGES) {
          const v = normalizeVariant(state.newsletterWorkspace.variants[id]);
          const raw = (v.html || '').trim();
          if (!raw) continue;
          const r = App.Utils.removeNewsletterNodeByMirrorPath(raw, path, relPath, 5);
          if (r.removed) {
            state.newsletterWorkspace.variants[id] = makeVariant(r.html, v.css, null);
            n += 1;
          }
        }
        persistWorkspace();
        const lid = state.currentPreviewLanguage || 'en';
        renderPreviewForLanguage(lid);
        const cur = normalizeVariant(state.newsletterWorkspace.variants[lid]);
        if (n === 0) {
          showToast('Could not match this block in any language version (structure may differ).', true);
          return { ok: false };
        }
        showToast(`Removed from ${n} language version(s).`);
        return { ok: true, html: cur.html, css: cur.css, updated: n };
      }
    });
  }

  // ── Workspace persistence ──
  function getLivePreviewHtml() {
    const out = document.getElementById('nl-out');
    return out ? out.innerHTML : '';
  }

  function syncVariantFromPreviewDom(langId = state.currentPreviewLanguage) {
    if (!state.newsletterWorkspace?.variants?.[langId]) return;
    const liveHtml = getLivePreviewHtml();
    if (!liveHtml) return;
    const v = normalizeVariant(state.newsletterWorkspace.variants[langId]);
    const tmp = document.createElement('div');
    tmp.innerHTML = liveHtml;
    let extractedCss = '';
    tmp.querySelectorAll('style').forEach(st => { extractedCss += `${st.textContent || ''}\n`; st.remove(); });
    // QRCode.js inserts both a <canvas> (pixel data not serializable to HTML) and an <img>
    // (base64 data-URI). Strip the canvas so only the img survives in the saved snapshot.
    tmp.querySelectorAll('#nl-qr canvas').forEach(el => el.remove());
    const css = (v.css || extractedCss || '').trim();
    state.newsletterWorkspace.variants[langId] = makeVariant(tmp.innerHTML, css, null);
    persistWorkspace();
  }

  function persistWorkspace() {
    if (!state.newsletterWorkspace) return;
    try { localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state.newsletterWorkspace)); } catch (e) {}
    writeWorkspaceCheckpoint('workspace-persist');
    clearUnsavedChanges();
  }

  function normalizeLoadedWorkspace(ws) {
    if (!ws || !ws.variants) return;
    Object.keys(ws.variants).forEach(langId => {
      ws.variants[langId] = normalizeVariant(ws.variants[langId]);
    });
    const fallback = ws.variants.en || makeVariant();
    NEWSLETTER_LANGUAGES.forEach(lang => {
      if (!ws.variants[lang.id]) {
        ws.variants[lang.id] = makeVariant(fallback.html, fallback.css);
      }
    });
    if (!ws.currentLanguage) ws.currentLanguage = 'en';
    ws.workflow = normalizeWorkflow(ws.workflow);
  }

  function emptyNewsletterWorkspaceShell() {
    const cfg = { ...getConfig(), ...getMetadata() };
    const variants = {};
    NEWSLETTER_LANGUAGES.forEach(l => {
      variants[l.id] = makeVariant('', '', { translatedFrom: l.id === 'en' ? null : 'en' });
    });
    return {
      id: `nw_${Date.now()}`,
      createdAt: new Date().toISOString(),
      format: state.selectedFormat,
      cfg,
      opts: {},
      articles: [],
      variants,
      currentLanguage: state.currentPreviewLanguage || 'en',
      workflow: normalizeWorkflow(null)
    };
  }

  function applyIndexedProjectToWorkspace(project, options = {}) {
    if (!project || !state.newsletterWorkspace) return;
    const handoff = App.RouterNav?.getHandoff?.() || {};
    let snapVer = options.snapshotVersion !== undefined ? options.snapshotVersion : handoff.projectSnapshotVersion;
    if (snapVer === '' || snapVer === 'current') snapVer = null;
    if (snapVer != null) snapVer = Number(snapVer);
    if (Number.isNaN(snapVer)) snapVer = null;

    const snaps = Array.isArray(project.snapshots) ? project.snapshots : [];
    const snap = snapVer != null ? snaps.find(s => Number(s.version) === snapVer) : null;

    if (snap?.workspace && snap.workspace.variants) {
      state.projectSnapshotVersion = snapVer;
      state.translationCache = {};
      state.newsletterWorkspace = JSON.parse(JSON.stringify(snap.workspace));
      normalizeLoadedWorkspace(state.newsletterWorkspace);
      state.currentPreviewLanguage = state.newsletterWorkspace.currentLanguage || 'en';
      if (state.newsletterWorkspace.cfg) {
        applyMainConfig(state.newsletterWorkspace.cfg);
        applyMetadata({
          title: project.title || state.newsletterWorkspace.cfg.title || '',
          issueDate: project.metadata?.issueDate || state.newsletterWorkspace.cfg.issueDate,
          status: project.status || 'draft',
          campaignName: project.metadata?.campaignName || state.newsletterWorkspace.cfg.campaignName,
          audience: project.metadata?.audience || state.newsletterWorkspace.cfg.audience,
          owner: project.owner || state.newsletterWorkspace.cfg.owner
        });
      } else if (project.metadata) {
        applyMetadata({
          title: project.title,
          issueDate: project.metadata.issueDate,
          status: project.status || 'draft',
          campaignName: project.metadata.campaignName,
          audience: project.metadata.audience,
          owner: project.owner
        });
      }
      state.selectedFormat = state.newsletterWorkspace.format || state.selectedFormat;
      persistWorkspace();
      refreshLanguageControls();
      renderWorkflowControls();
      renderPreviewForLanguage(state.newsletterWorkspace.currentLanguage || 'en');
      updateProjectChrome(project);
      if (currentPageId() === 'editor') {
        queueMicrotask(() => { refreshEditorProjectVersionOptions().catch(() => {}); });
      }
      return;
    }

    if (snapVer != null && !snap?.workspace) {
      showToast(`Snapshot v${snapVer} has no workspace payload; showing latest instead.`, true);
    }

    state.projectSnapshotVersion = null;
    state.translationCache = {};

    const projectHasContent = hasRenderableHtml(project.languageVariants);
    if (projectHasContent) {
      state.newsletterWorkspace.variants = project.languageVariants;
    }
    state.newsletterWorkspace.workflow = normalizeWorkflow(project.workflow || state.newsletterWorkspace.workflow);
    state.newsletterWorkspace.currentLanguage = state.currentPreviewLanguage || 'en';
    if (project.metadata) {
      applyMetadata({
        title: project.title,
        issueDate: project.metadata.issueDate,
        status: project.status || 'draft',
        campaignName: project.metadata.campaignName,
        audience: project.metadata.audience,
        owner: project.owner
      });
    }
    if (projectHasContent) {
      persistWorkspace();
      refreshLanguageControls();
      renderWorkflowControls();
      renderPreviewForLanguage(state.newsletterWorkspace.currentLanguage);
    }
    updateProjectChrome(project);
    if (currentPageId() === 'editor') {
      queueMicrotask(() => { refreshEditorProjectVersionOptions().catch(() => {}); });
    }
  }

  function hydrateActiveProjectFromHandoff(projectId) {
    if (!projectId || !App.ProjectStore?.get) return;
    state.activeProjectId = projectId;
    App.ProjectStore.get(projectId).then(project => {
      if (!project) return;
      applyIndexedProjectToWorkspace(project);
    }).catch(() => {});
  }

  function loadWorkspace() {
    try {
      const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (!raw) {
        const handoff = App.RouterNav?.getHandoff?.();
        if (handoff?.projectId) {
          state.newsletterWorkspace = emptyNewsletterWorkspaceShell();
          state.currentPreviewLanguage = state.newsletterWorkspace.currentLanguage || 'en';
          state.translationCache = {};
          hydrateActiveProjectFromHandoff(handoff.projectId);
        }
        updateProjectChrome();
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        const recovered = recoverWorkspaceFromCheckpoint();
        if (!recovered?.workspace) throw parseErr;
        parsed = recovered.workspace;
        showToast('Recovered workspace from autosave checkpoint after storage corruption.', true);
      }
      if (!parsed || !parsed.variants) return;
      state.newsletterWorkspace = parsed;
      Object.keys(state.newsletterWorkspace.variants).forEach(langId => {
        state.newsletterWorkspace.variants[langId] = normalizeVariant(state.newsletterWorkspace.variants[langId]);
      });
      const fallback = state.newsletterWorkspace.variants.en || makeVariant();
      NEWSLETTER_LANGUAGES.forEach(lang => {
        if (!state.newsletterWorkspace.variants[lang.id]) {
          state.newsletterWorkspace.variants[lang.id] = makeVariant(fallback.html, fallback.css);
        }
      });
      if (!state.newsletterWorkspace.currentLanguage) state.newsletterWorkspace.currentLanguage = 'en';
      state.newsletterWorkspace.workflow = normalizeWorkflow(state.newsletterWorkspace.workflow);
      state.currentPreviewLanguage = state.newsletterWorkspace.currentLanguage;
      state.translationCache = {};
      if (state.newsletterWorkspace.cfg) {
        applyMainConfig(state.newsletterWorkspace.cfg);
        applyMetadata({
          title: state.newsletterWorkspace.cfg.title,
          issueDate: state.newsletterWorkspace.cfg.issueDate,
          status: state.newsletterWorkspace.cfg.status,
          campaignName: state.newsletterWorkspace.cfg.campaignName,
          audience: state.newsletterWorkspace.cfg.audience,
          owner: state.newsletterWorkspace.cfg.owner
        });
      }
      const handoff = App.RouterNav?.getHandoff?.();
      if (handoff?.projectId) hydrateActiveProjectFromHandoff(handoff.projectId);
      updateProjectChrome();
    } catch (e) {}
  }

  function getMergedConfigForExport() {
    return { ...getConfig(), ...(state.newsletterWorkspace?.cfg || {}) };
  }

  function getQrTextForExport(cfg) {
    const c = cfg || getMergedConfigForExport();
    const portal = App.Utils.normalizeWebUrl(String(c.portal || c.portalUrl || '').trim());
    return portal || ((c.soc && String(c.soc).trim()) ? `mailto:${String(c.soc).trim()}` : 'mailto:security@example.com');
  }

  function findVisitPortalHref(qrEl) {
    if (!qrEl) return '';
    let scope = qrEl;
    for (let depth = 0; depth < 10 && scope; depth++) {
      scope = scope.parentElement;
      if (!scope) break;
      const links = scope.querySelectorAll('a[href]');
      for (const a of links) {
        const text = (a.textContent || '').trim().toLowerCase();
        if (text.includes('visit portal')) {
          const href = a.getAttribute('href') || '';
          if (/^https?:\/\//i.test(href)) return href;
        }
      }
    }
    return '';
  }

  function shouldInjectQrInExport() {
    const el = document.getElementById('feat-qr');
    if (el) return !!el.checked;
    return true;
  }

  function generateQrDataUriSync(text) {
    if (!text || typeof document === 'undefined' || typeof QRCode === 'undefined') return '';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden';
    document.body.appendChild(holder);
    try {
      new QRCode(holder, {
        text,
        width: 144,
        height: 144,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
      const canvas = holder.querySelector('canvas');
      if (canvas) {
        try {
          return canvas.toDataURL('image/png');
        } catch (e) {
          /* canvas may not export */
        }
      }
      const img = holder.querySelector('img');
      const src = img && img.getAttribute('src');
      return src || '';
    } catch (e) {
      return '';
    } finally {
      holder.remove();
    }
  }

  function withEmbeddedQrInBodyHtml(bodyHtml, cfg) {
    if (!shouldInjectQrInExport()) return bodyHtml;
    const raw = String(bodyHtml || '');
    if (!raw.includes('nl-qr')) return raw;
    let portalFromDom = '';
    try {
      const probe = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${raw}</body></html>`,
        'text/html'
      );
      const qrEl = probe.body.querySelector('#nl-qr');
      if (!qrEl) return raw;
      const existing = qrEl.querySelector('img[src^="data:"]');
      if (existing && existing.getAttribute('src')) return raw;
      portalFromDom = findVisitPortalHref(qrEl);
    } catch (e) {
      return raw;
    }
    const qrText = portalFromDom || getQrTextForExport(cfg);
    const uri = generateQrDataUriSync(qrText);
    if (!uri) return raw;
    return injectNlQrImageIntoHtml(raw, uri);
  }

  function toStandaloneHtml(variant, langId) {
    const v = normalizeVariant(variant);
    const cfg = getMergedConfigForExport();
    const bodyHtml = withEmbeddedQrInBodyHtml(v.html, cfg);
    const bodyStyle =
      'margin:0;padding:20px;background-color:#B8C3D4;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;';
    return `<!DOCTYPE html><html lang="${langId}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Newsletter - ${getLanguageLabel(langId)}</title></head><body style="${bodyStyle}">${bodyHtml}</body></html>`;
  }

  function refreshLanguageControls() {
    const previewLang = document.getElementById('preview-lang');
    if (!previewLang) return;
    previewLang.innerHTML = NEWSLETTER_LANGUAGES.map(l => `<option value="${l.id}">${l.label}</option>`).join('');
    previewLang.value = state.currentPreviewLanguage || 'en';
  }

  function getLanguageVariant(langId) {
    if (!state.newsletterWorkspace?.variants) return '';
    return normalizeVariant(state.newsletterWorkspace.variants[langId]);
  }

  function renderPreviewForLanguage(langId) {
    const variant = getLanguageVariant(langId);
    if (!variant?.html) return;
    state.newsletterWorkspace.variants[langId] = variant;
    state.currentPreviewLanguage = langId;
    if (state.newsletterWorkspace) state.newsletterWorkspace.currentLanguage = langId;
    persistWorkspace();
    const out = document.getElementById('nl-out');
    if (!out) return;
    out.innerHTML = renderVariantHtml(variant);
    const previewLang = document.getElementById('preview-lang');
    if (previewLang) previewLang.value = langId;
    renderWorkflowControls();
    const renderQr = (attempt = 0) => {
      try {
        const q = document.getElementById('nl-qr');
        if (!q) return;
        if (typeof QRCode === 'undefined') {
          if (attempt < 20) return setTimeout(() => renderQr(attempt + 1), 100);
          console.warn('QRCode library never loaded — preview QR skipped.');
          return;
        }
        const cfg = state.newsletterWorkspace?.cfg || getConfig();
        const portalFromDom = findVisitPortalHref(q);
        const portalFromCfg = App.Utils.normalizeWebUrl(String(cfg.portal || cfg.portalUrl || '').trim());
        const qrText = portalFromDom || portalFromCfg ||
          ((cfg.soc && String(cfg.soc).trim()) ? `mailto:${String(cfg.soc).trim()}` : 'mailto:security@example.com');
        const uri = generateQrDataUriSync(qrText);
        q.innerHTML = '';
        if (uri) {
          const img = document.createElement('img');
          img.setAttribute('src', uri);
          img.setAttribute('alt', 'QR code');
          img.setAttribute('width', '144');
          img.setAttribute('height', '144');
          img.style.display = 'block';
          q.appendChild(img);
        } else {
          new QRCode(q, { text: qrText, width: 144, height: 144, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.H });
        }
      } catch (e) {
        try { console.warn('QR render failed:', e); } catch (_) {}
      }
    };
    setTimeout(() => renderQr(0), 150);
  }

  function getNextWorkflowStates(currentState) {
    return WORKFLOW_TRANSITIONS[currentState] || [];
  }

  function renderWorkflowControls() {
    const stateChip = document.getElementById('wf-state-chip');
    const nextSelect = document.getElementById('wf-next-state');
    if (!stateChip || !nextSelect) return;

    const wf = normalizeWorkflow(state.newsletterWorkspace?.workflow);
    if (state.newsletterWorkspace) state.newsletterWorkspace.workflow = wf;

    stateChip.dataset.state = wf.state;
    stateChip.textContent = WORKFLOW_LABELS[wf.state] || wf.state;
    stateChip.title = `Last edited by ${wf.lastEditedBy}`;

    const nextStates = getNextWorkflowStates(wf.state);
    if (!nextStates.length) {
      nextSelect.innerHTML = '<option value="">No next state</option>';
      nextSelect.disabled = true;
      return;
    }
    nextSelect.disabled = false;
    nextSelect.innerHTML = nextStates
      .map(next => `<option value="${next}">${WORKFLOW_LABELS[next] || next}</option>`)
      .join('');
  }

  function transitionWorkflow() {
    if (!state.newsletterWorkspace) return showToast('Generate newsletter first.', true);
    const wf = normalizeWorkflow(state.newsletterWorkspace.workflow);
    const next = document.getElementById('wf-next-state')?.value || '';
    if (!next) return showToast('No workflow transition available.', true);
    const allowed = getNextWorkflowStates(wf.state);
    if (!allowed.includes(next)) return showToast('Invalid workflow transition.', true);

    wf.history.push({
      from: wf.state,
      to: next,
      changedAt: new Date().toISOString(),
      changedBy: wf.lastEditedBy || 'Local User',
      note: `Moved to ${WORKFLOW_LABELS[next] || next}`
    });
    wf.state = next;
    state.newsletterWorkspace.workflow = wf;
    persistWorkspace();
    renderWorkflowControls();
    showToast(`Workflow updated: ${WORKFLOW_LABELS[next] || next}`);
  }

  function openWorkflowHistory() {
    if (!state.newsletterWorkspace?.workflow) return showToast('No workflow history yet.', true);
    const wf = normalizeWorkflow(state.newsletterWorkspace.workflow);
    const rows = wf.history.slice(-12).reverse().map(item => {
      const from = item.from ? (WORKFLOW_LABELS[item.from] || item.from) : 'None';
      const to = WORKFLOW_LABELS[item.to] || item.to;
      const who = item.changedBy || 'Local User';
      return `${fmtDate(item.changedAt)} • ${from} → ${to} • ${who}`;
    });
    alert(`Workflow history (${WORKFLOW_LABELS[wf.state] || wf.state}):\n\n${rows.join('\n') || 'No entries yet.'}`);
  }

  // ── Sidebar collapsible sections ──
  function toggleSec(headerEl) {
    const body = headerEl.nextElementSibling;
    const isOpen = headerEl.classList.contains('open');
    if (isOpen) { headerEl.classList.remove('open'); body.classList.remove('open'); }
    else { headerEl.classList.add('open'); body.classList.add('open'); }
  }

  function pickFormat(el, fmt) {
    document.querySelectorAll('.fmt-card').forEach(c => c.classList.remove('sel'));
    el.classList.add('sel');
    state.selectedFormat = fmt;
  }

  function setDuration(el, days) {
    document.querySelectorAll('.dur-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    state.filterDays = days;
    renderArticles(filteredArticles());
  }

  function closePreview() {
    syncVariantFromPreviewDom(state.currentPreviewLanguage);
    document.getElementById('preview-panel')?.classList.remove('active');
  }

  function isVariantUntranslated(langId) {
    if (langId === 'en') return false;
    const en = normalizeVariant(state.newsletterWorkspace?.variants?.en);
    const target = normalizeVariant(state.newsletterWorkspace?.variants?.[langId]);
    if (!target?.html) return true;
    const explicitlyTranslated = target?.projectData?.translatedFrom === 'en';
    if (explicitlyTranslated) return false;
    return (target.html || '').trim() === (en.html || '').trim() && (target.css || '').trim() === (en.css || '').trim();
  }

  async function ensureLanguageTranslated(langId) {
    if (langId === 'en') return true;
    if (!state.newsletterWorkspace?.variants?.en?.html) return false;
    if (!isVariantUntranslated(langId)) return true;

    const provider = document.getElementById('ai-provider')?.value || 'claude';
    const aiKey = document.getElementById('ai-key')?.value?.trim() || '';
    if (!aiKey) {
      showToast('Add AI API key to translate selected language.', true);
      return false;
    }

    const sourceVariant = normalizeVariant(state.newsletterWorkspace.variants.en);
    try {
      state.translationPendingLang = { id: langId, label: getLanguageLabel(langId) };
      setLanguageTranslating(true, langId);
      showToast(`Translating ${getLanguageLabel(langId)}...`);
      const translatedHtml = await translateHtmlAIFirst(sourceVariant.html, langId, provider, aiKey);
      const checks = qaCheckTranslatedHtml(sourceVariant.html, translatedHtml);
      const failed = checks.filter(c => !c.ok && c.severity === 'critical');
      if (failed.length) throw new Error(`[gate:qa] QA failed: ${failed.map(f => f.id).join(', ')}`);
      state.newsletterWorkspace.variants[langId] = makeVariant(translatedHtml, sourceVariant.css, {
        translatedFrom: 'en',
        provider,
        translatedAt: new Date().toISOString()
      });
      persistWorkspace();
      return true;
    } catch (e) {
      if (!state.translationLastFailure) {
        recordTranslationFailure({
          message: e.message,
          kind: TranslationMetrics.classifyTranslationFailureKind(e.message),
          languageId: langId,
          languageLabel: getLanguageLabel(langId)
        });
      }
      showToast(`Translation failed: ${e.message}`, true);
      return false;
    } finally {
      setLanguageTranslating(false);
    }
  }

  async function switchPreviewLanguage(langId) {
    syncVariantFromPreviewDom(state.currentPreviewLanguage);
    const ok = await ensureLanguageTranslated(langId);
    if (!ok && langId !== 'en') return;
    renderPreviewForLanguage(langId);
  }

  function getConfig() {
    return {
      freq: document.getElementById('cfg-freq')?.value || 'Weekly',
      soc: document.getElementById('cfg-soc')?.value || 'SOC-support@abc.com',
      max: parseInt(document.getElementById('cfg-max')?.value || '2', 10),
      org: document.getElementById('cfg-org')?.value?.trim() || 'ABC Corp',
      portal: document.getElementById('cfg-portal')?.value?.trim() || 'https://security.abc.com/awareness',
      pname: document.getElementById('cfg-pname')?.value?.trim() || 'ABC Security Awareness Portal'
    };
  }

  function applyMainConfig(cfg = {}) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el != null && value != null) el.value = value;
    };
    set('cfg-freq', cfg.freq);
    set('cfg-soc', cfg.soc);
    if (cfg.max != null) set('cfg-max', String(cfg.max));
    if (cfg.org != null) set('cfg-org', cfg.org);
    if (cfg.portal != null) set('cfg-portal', cfg.portal);
    if (cfg.pname != null) set('cfg-pname', cfg.pname);
  }

  function getOptions() {
    return {
      usePoster: document.getElementById('feat-poster')?.checked ?? true,
      useLinks: document.getElementById('feat-links')?.checked ?? true,
      useQR: document.getElementById('feat-qr')?.checked ?? true,
      useIllus: document.getElementById('feat-illus')?.checked ?? true,
      useAIImagePilot: document.getElementById('ai-exp-enabled')?.checked ?? false,
      aiRollbackMode: document.getElementById('ai-exp-rollback')?.checked ?? false,
      useMotion: document.getElementById('feat-motion')?.checked ?? false,
      renderChannel: document.getElementById('render-channel')?.value || 'email-safe',
      preferReducedMotion: window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false
    };
  }

  function applyOptions(opts = {}) {
    const set = (id, checked) => {
      const el = document.getElementById(id);
      if (el && typeof checked === 'boolean') el.checked = checked;
    };
    set('feat-poster', opts.usePoster);
    set('feat-links', opts.useLinks);
    set('feat-qr', opts.useQR);
    set('feat-illus', opts.useIllus);
    set('feat-motion', opts.useMotion);
    set('feat-ai', opts.useAI);
    const channel = document.getElementById('render-channel');
    if (channel && typeof opts.renderChannel === 'string') channel.value = opts.renderChannel;
  }

  function getMetadata() {
    return {
      title: document.getElementById('meta-title')?.value?.trim() || '',
      issueDate: document.getElementById('meta-issue-date')?.value || '',
      status: document.getElementById('meta-status')?.value || 'draft',
      campaignName: document.getElementById('meta-campaign')?.value?.trim() || '',
      audience: document.getElementById('meta-audience')?.value?.trim() || '',
      owner: document.getElementById('meta-owner')?.value?.trim() || ''
    };
  }

  function getCentralConfigFromUI() {
    return {
      config: getConfig(),
      options: { ...getOptions(), useAI: document.getElementById('feat-ai')?.checked ?? true },
      metadata: getMetadata(),
      aiExperiment: getAIExperimentControlFromUI(),
      recipients: {
        testTo: document.getElementById('smtp-test-to')?.value?.trim() || '',
        sendTo: document.getElementById('smtp-send-to')?.value?.trim() || ''
      }
    };
  }

  function applyRecipients(rec = {}) {
    const testEl = document.getElementById('smtp-test-to');
    const sendEl = document.getElementById('smtp-send-to');
    if (testEl && typeof rec.testTo === 'string') testEl.value = rec.testTo;
    if (sendEl && typeof rec.sendTo === 'string') sendEl.value = rec.sendTo;
  }

  function applyCentralConfigBundle(bundle = {}) {
    if (bundle.config) applyMainConfig(bundle.config);
    if (bundle.options) applyOptions(bundle.options);
    if (bundle.metadata) applyMetadata(bundle.metadata);
    if (bundle.aiExperiment) applyAIExperimentControl(bundle.aiExperiment);
    if (bundle.recipients) applyRecipients(bundle.recipients);
    const maxLbl = document.getElementById('max-lbl');
    const maxCfg = document.getElementById('cfg-max');
    if (maxLbl && maxCfg) maxLbl.textContent = maxCfg.value || '2';
  }

  function saveCentralConfig(options = {}) {
    const { silent = false } = options;
    try {
      const bundle = getCentralConfigFromUI();
      const payload = { ...bundle, savedAt: new Date().toISOString() };
      localStorage.setItem(CENTRAL_CONFIG_STORAGE_KEY, JSON.stringify(payload));
      clearUnsavedChanges();
      if (!silent) showToast('Configuration settings saved.');
      document.dispatchEvent(new CustomEvent('awareness:config-saved', { detail: payload }));
      return bundle;
    } catch (e) {
      if (!silent) showToast('Failed to save configuration settings.', true);
      return null;
    }
  }

  function applyMetadata(meta = {}) {
    const set = (id, value) => { const el = document.getElementById(id); if (el != null) el.value = value || ''; };
    set('meta-title', meta.title);
    set('meta-issue-date', meta.issueDate);
    set('meta-status', meta.status || 'draft');
    set('meta-campaign', meta.campaignName);
    set('meta-audience', meta.audience);
    set('meta-owner', meta.owner);
  }

  function getSMTPConfigFromUI() {
    const dmEl = document.getElementById('delivery-method');
    const dmRaw = dmEl ? dmEl.value : 'smtp';
    const deliveryMethod = dmRaw === 'graph' ? 'graph' : 'smtp';
    return {
      id: 'default',
      profileName: 'Default delivery',
      deliveryMethod,
      graphTenantId: document.getElementById('graph-tenant-id')?.value?.trim() || '',
      graphClientId: document.getElementById('graph-client-id')?.value?.trim() || '',
      graphClientSecret: document.getElementById('graph-client-secret')?.value || '',
      relayUrl: document.getElementById('smtp-relay-url')?.value?.trim() || '',
      host: document.getElementById('smtp-host')?.value?.trim() || '',
      port: Number(document.getElementById('smtp-port')?.value || 587),
      secure: !!document.getElementById('smtp-secure')?.checked,
      username: document.getElementById('smtp-username')?.value?.trim() || '',
      password: document.getElementById('smtp-password')?.value || '',
      fromName: document.getElementById('smtp-from-name')?.value?.trim() || '',
      fromAddress: document.getElementById('smtp-from-address')?.value?.trim() || '',
      isDefault: true
    };
  }

  function getAISettingsFromUI() {
    return {
      provider: document.getElementById('ai-provider')?.value || 'claude',
      aiKey: document.getElementById('ai-key')?.value || ''
    };
  }

  function applyAISettings(cfg = {}) {
    const providerEl = document.getElementById('ai-provider');
    const aiKeyEl = document.getElementById('ai-key');
    if (providerEl && cfg.provider) providerEl.value = cfg.provider;
    if (aiKeyEl && typeof cfg.aiKey === 'string') aiKeyEl.value = cfg.aiKey;
  }

  function saveAISettings(options = {}) {
    const { silent = false } = options;
    try {
      const cfg = getAISettingsFromUI();
      localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(cfg));
      clearUnsavedChanges();
      if (!silent) showToast('AI settings saved.');
    } catch (e) {
      if (!silent) showToast('Failed to save AI settings.', true);
    }
  }

  function normalizeNumberInput(value, min = 0, max = Number.POSITIVE_INFINITY) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function defaultAIExperimentControl() {
    return {
      enabled: false,
      requireOptIn: true,
      requireLabel: true,
      rollbackMode: false,
      roundsCompleted: 0,
      outputsEvaluated: 0,
      brandSafetyPassRate: 0,
      relevancePassRate: 0,
      mttdHours: 0,
      mttmHours: 0,
      taxonomyCoveragePct: 0,
      taxonomyCounts: { hallucination: 0, policy: 0, timeout: 0, formatting: 0 },
      decision: 'pending',
      rationale: '',
      lastRollbackAt: '',
      savedAt: ''
    };
  }

  function getAIExperimentControlFromUI() {
    return {
      enabled: !!document.getElementById('ai-exp-enabled')?.checked,
      requireOptIn: document.getElementById('ai-exp-optin')?.checked !== false,
      requireLabel: document.getElementById('ai-exp-label')?.checked !== false,
      rollbackMode: !!document.getElementById('ai-exp-rollback')?.checked,
      roundsCompleted: normalizeNumberInput(document.getElementById('ai-exp-rounds')?.value, 0),
      outputsEvaluated: normalizeNumberInput(document.getElementById('ai-exp-outputs')?.value, 0),
      brandSafetyPassRate: normalizeNumberInput(document.getElementById('ai-exp-brand-pass')?.value, 0, 100),
      relevancePassRate: normalizeNumberInput(document.getElementById('ai-exp-relevance-pass')?.value, 0, 100),
      mttdHours: normalizeNumberInput(document.getElementById('ai-exp-mttd')?.value, 0),
      mttmHours: normalizeNumberInput(document.getElementById('ai-exp-mttm')?.value, 0),
      taxonomyCoveragePct: normalizeNumberInput(document.getElementById('ai-exp-taxonomy-coverage')?.value, 0, 100),
      taxonomyCounts: {
        hallucination: normalizeNumberInput(document.getElementById('ai-exp-tax-hallucination')?.value, 0),
        policy: normalizeNumberInput(document.getElementById('ai-exp-tax-policy')?.value, 0),
        timeout: normalizeNumberInput(document.getElementById('ai-exp-tax-timeout')?.value, 0),
        formatting: normalizeNumberInput(document.getElementById('ai-exp-tax-formatting')?.value, 0)
      },
      decision: document.getElementById('ai-exp-decision')?.value || 'pending',
      rationale: document.getElementById('ai-exp-rationale')?.value?.trim() || '',
      lastRollbackAt: state.aiExperimentControl?.lastRollbackAt || ''
    };
  }

  function getAIExperimentReadiness(cfg = {}) {
    const roundsOk = (cfg.roundsCompleted || 0) >= 3;
    const qualityOk = (cfg.brandSafetyPassRate || 0) >= 70 && (cfg.relevancePassRate || 0) >= 70;
    const incidentOk = (cfg.mttdHours || 0) <= 24 && (cfg.mttmHours || 0) <= 4 && (cfg.taxonomyCoveragePct || 0) >= 90;
    const decisionOk = cfg.decision && cfg.decision !== 'pending' && !!String(cfg.rationale || '').trim();
    const rollbackReady = cfg.rollbackMode === true || !!cfg.lastRollbackAt;
    const gatesPassed = [roundsOk, qualityOk, incidentOk, decisionOk, rollbackReady].filter(Boolean).length;
    const isReady = roundsOk && qualityOk && incidentOk && decisionOk && rollbackReady;
    return { roundsOk, qualityOk, incidentOk, decisionOk, rollbackReady, gatesPassed, isReady };
  }

  function renderAIExperimentReadiness(cfg = {}) {
    const pill = document.getElementById('ai-exp-readiness-pill');
    const note = document.getElementById('ai-exp-readiness-note');
    if (!pill || !note) return;
    const readiness = getAIExperimentReadiness(cfg);
    pill.classList.remove('good', 'warn', 'danger');
    if (readiness.isReady) {
      pill.classList.add('good');
      pill.textContent = 'Gate D Ready';
      note.textContent = 'Go/no-go evidence complete with rollback coverage.';
      return;
    }
    if (readiness.gatesPassed >= 3) {
      pill.classList.add('warn');
      pill.textContent = `In Progress (${readiness.gatesPassed}/5)`;
      note.textContent = 'Continue experiments until all thresholds pass.';
      return;
    }
    pill.classList.add('danger');
    pill.textContent = `Not Ready (${readiness.gatesPassed}/5)`;
    note.textContent = 'Insufficient evidence for controlled rollout decision.';
  }

  function renderAIRollbackBanner() {
    const el = document.getElementById('ai-rollback-banner');
    if (!el) return;
    let cfg = null;
    try {
      cfg = JSON.parse(localStorage.getItem(AI_EXPERIMENT_CONTROL_STORAGE_KEY) || 'null');
    } catch (e) {
      cfg = null;
    }
    const active = !!cfg?.rollbackMode;
    el.style.display = active ? 'block' : 'none';
    if (!active) return;
    const rollbackAt = cfg?.lastRollbackAt ? ` Last rollback: ${new Date(cfg.lastRollbackAt).toLocaleString()}.` : '';
    el.textContent = `Stable workflow active: AI experiment rollback mode is enabled, so experimental AI visuals are disabled.${rollbackAt}`;
  }

  function applyAIExperimentControl(cfg = {}) {
    const merged = { ...defaultAIExperimentControl(), ...(cfg || {}) };
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el != null && value != null) el.value = String(value);
    };
    const setCheck = (id, checked) => {
      const el = document.getElementById(id);
      if (el) el.checked = !!checked;
    };
    setCheck('ai-exp-enabled', merged.enabled);
    setCheck('ai-exp-optin', merged.requireOptIn);
    setCheck('ai-exp-label', merged.requireLabel);
    setCheck('ai-exp-rollback', merged.rollbackMode);
    setValue('ai-exp-rounds', merged.roundsCompleted);
    setValue('ai-exp-outputs', merged.outputsEvaluated);
    setValue('ai-exp-brand-pass', merged.brandSafetyPassRate);
    setValue('ai-exp-relevance-pass', merged.relevancePassRate);
    setValue('ai-exp-mttd', merged.mttdHours);
    setValue('ai-exp-mttm', merged.mttmHours);
    setValue('ai-exp-taxonomy-coverage', merged.taxonomyCoveragePct);
    setValue('ai-exp-tax-hallucination', merged.taxonomyCounts?.hallucination || 0);
    setValue('ai-exp-tax-policy', merged.taxonomyCounts?.policy || 0);
    setValue('ai-exp-tax-timeout', merged.taxonomyCounts?.timeout || 0);
    setValue('ai-exp-tax-formatting', merged.taxonomyCounts?.formatting || 0);
    setValue('ai-exp-decision', merged.decision || 'pending');
    setValue('ai-exp-rationale', merged.rationale || '');
    state.aiExperimentControl = merged;
    renderAIExperimentReadiness(merged);
  }

  function saveAIExperimentControl(options = {}) {
    const { silent = false } = options;
    try {
      const cfg = getAIExperimentControlFromUI();
      const payload = { ...cfg, savedAt: new Date().toISOString() };
      state.aiExperimentControl = payload;
      localStorage.setItem(AI_EXPERIMENT_CONTROL_STORAGE_KEY, JSON.stringify(payload));
      renderAIExperimentReadiness(payload);
      clearUnsavedChanges();
      if (!silent) showToast('AI experiment controls saved.');
      return payload;
    } catch (e) {
      if (!silent) showToast('Failed to save AI experiment controls.', true);
      return null;
    }
  }

  function triggerAIRollback() {
    const rollbackEl = document.getElementById('ai-exp-rollback');
    const pilotEl = document.getElementById('ai-exp-enabled');
    const aiEl = document.getElementById('feat-ai');
    if (rollbackEl) rollbackEl.checked = true;
    if (pilotEl) pilotEl.checked = false;
    if (aiEl) aiEl.checked = false;
    const current = getAIExperimentControlFromUI();
    current.rollbackMode = true;
    current.enabled = false;
    current.lastRollbackAt = new Date().toISOString();
    const payload = { ...current, savedAt: new Date().toISOString() };
    state.aiExperimentControl = payload;
    localStorage.setItem(AI_EXPERIMENT_CONTROL_STORAGE_KEY, JSON.stringify(payload));
    renderAIExperimentReadiness(payload);
    showToast('Rollback enabled. Experimental AI visuals are now disabled.');
  }

  function exportAIExperimentEvidence() {
    const cfg = getAIExperimentControlFromUI();
    const readiness = getAIExperimentReadiness(cfg);
    const taxonomyTotal = Object.values(cfg.taxonomyCounts || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    const md = [
      '# Phase 4 Experiment Evidence Log',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## FR-08 Feasibility Evidence',
      `- Rounds completed: ${cfg.roundsCompleted} (target >= 3)`,
      `- Outputs evaluated: ${cfg.outputsEvaluated}`,
      `- Brand safety pass rate: ${cfg.brandSafetyPassRate}% (target >= 70%)`,
      `- Relevance pass rate: ${cfg.relevancePassRate}% (target >= 70%)`,
      '',
      '## FR-09 Troubleshooting Evidence',
      `- Mean time to detect (hours): ${cfg.mttdHours} (target < 24)`,
      `- Mean time to mitigate (hours): ${cfg.mttmHours} (target < 4)`,
      `- Taxonomy coverage: ${cfg.taxonomyCoveragePct}% (target >= 90%)`,
      `- Incident totals: ${taxonomyTotal}`,
      `  - hallucination: ${cfg.taxonomyCounts?.hallucination || 0}`,
      `  - policy: ${cfg.taxonomyCounts?.policy || 0}`,
      `  - timeout: ${cfg.taxonomyCounts?.timeout || 0}`,
      `  - formatting: ${cfg.taxonomyCounts?.formatting || 0}`,
      '',
      '## Controls',
      `- Pilot enabled: ${cfg.enabled ? 'yes' : 'no'}`,
      `- Explicit opt-in required: ${cfg.requireOptIn ? 'yes' : 'no'}`,
      `- AI-generated label required: ${cfg.requireLabel ? 'yes' : 'no'}`,
      `- Rollback mode active: ${cfg.rollbackMode ? 'yes' : 'no'}`,
      '',
      '## Decision',
      `- Decision: ${cfg.decision}`,
      `- Rationale: ${cfg.rationale || 'n/a'}`,
      '',
      '## Gate D Readiness',
      `- Ready: ${readiness.isReady ? 'yes' : 'no'} (${readiness.gatesPassed}/5 gates)`,
      `- Rounds gate: ${readiness.roundsOk ? 'pass' : 'fail'}`,
      `- Quality gate: ${readiness.qualityOk ? 'pass' : 'fail'}`,
      `- Incident gate: ${readiness.incidentOk ? 'pass' : 'fail'}`,
      `- Decision gate: ${readiness.decisionOk ? 'pass' : 'fail'}`,
      `- Rollback gate: ${readiness.rollbackReady ? 'pass' : 'fail'}`,
      ''
    ].join('\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `phase4-ai-evidence-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1500);
    showToast('Phase 4 evidence log exported.');
  }

  function syncDeliveryMethodPanels() {
    const sel = document.getElementById('delivery-method');
    const graphPanel = document.getElementById('delivery-graph-panel');
    const smtpPanel = document.getElementById('delivery-smtp-panel');
    if (!sel || !graphPanel || !smtpPanel) return;
    const graphOn = sel.value === 'graph';
    graphPanel.style.display = graphOn ? '' : 'none';
    smtpPanel.style.display = graphOn ? 'none' : '';
  }

  function initDeliveryMethodUI() {
    const sel = document.getElementById('delivery-method');
    if (!sel) return;
    syncDeliveryMethodPanels();
    sel.addEventListener('change', () => {
      syncDeliveryMethodPanels();
      flagUnsavedChanges(true);
    });
  }

  function applySMTPConfig(cfg = {}) {
    const set = (id, value) => { const el = document.getElementById(id); if (el != null) el.value = value || ''; };
    const dm = document.getElementById('delivery-method');
    if (dm) dm.value = cfg.deliveryMethod === 'graph' ? 'graph' : 'smtp';
    set('smtp-relay-url', cfg.relayUrl);
    set('graph-tenant-id', cfg.graphTenantId);
    set('graph-client-id', cfg.graphClientId);
    set('graph-client-secret', cfg.graphClientSecret);
    set('smtp-host', cfg.host);
    set('smtp-port', cfg.port || 587);
    set('smtp-username', cfg.username);
    set('smtp-password', cfg.password);
    set('smtp-from-name', cfg.fromName);
    set('smtp-from-address', cfg.fromAddress);
    const secure = document.getElementById('smtp-secure');
    if (secure) secure.checked = cfg.secure !== false;
    syncDeliveryMethodPanels();
  }

  function articleSearchHaystack(article) {
    if (!article) return '';
    const parts = [
      article.title,
      article.summary,
      article.description,
      article.source,
      article.type,
      article.url
    ].map(p => stripTags(String(p || '')));
    return parts.join(' \u0001 ').toLowerCase();
  }

  /** Every whitespace-separated token must appear somewhere in the haystack (AND). */
  function articleMatchesKeywordQuery(article, rawQuery) {
    const q = String(rawQuery || '').trim().toLowerCase();
    if (!q) return true;
    const terms = q.split(/\s+/).filter(t => t.length > 0);
    if (!terms.length) return true;
    const hay = articleSearchHaystack(article);
    return terms.every(t => hay.includes(t));
  }

  function filteredArticles() {
    let list = state.allArticles.filter(a => isWithinDays(a.pubDate, state.filterDays));
    if (state.articleKeywordQuery && String(state.articleKeywordQuery).trim()) {
      list = list.filter(a => articleMatchesKeywordQuery(a, state.articleKeywordQuery));
    }
    return list;
  }

  function articleDateMs(article) {
    const ts = Date.parse(article?.pubDate || '');
    return Number.isFinite(ts) ? ts : 0;
  }

  function sortArticles(articles = []) {
    const decorated = articles.map((article, index) => ({ article, index }));
    decorated.sort((a, b) => {
      if (state.articleSort === 'date_asc') {
        const diff = articleDateMs(a.article) - articleDateMs(b.article);
        return diff || (a.index - b.index);
      }
      const diff = articleDateMs(b.article) - articleDateMs(a.article);
      return diff || (a.index - b.index);
    });
    return decorated.map(entry => entry.article);
  }

  function renderArticleStats(inRange = [], showing = []) {
    const el = document.getElementById('article-stats');
    if (!el) return;
    const max = getConfig().max;
    const selected = state.selectedArticleIndices.length;
    const searchOn = !!(state.articleKeywordQuery && String(state.articleKeywordQuery).trim());
    const rangeLabel = searchOn
      ? 'Date + search'
      : (state.filterDays === 0 ? 'All Days' : `Last ${state.filterDays} Days`);
    const cards = [
      { n: state.allArticles.length, l: 'Loaded Articles' },
      { n: inRange.length, l: rangeLabel },
      { n: showing.length, l: 'Showing (Filter)' },
      { n: `${selected}/${max}`, l: 'Selected' }
    ];
    el.innerHTML = cards.map(c => `<div class="stat-card"><div class="stat-num">${c.n}</div><div class="stat-label">${c.l}</div></div>`).join('');
  }

  async function renderDBStats() {
    const el = document.getElementById('db-stats');
    if (!el) return;
    try {
      const s = await App.DB.getStats();
      el.innerHTML = `<div class="stats-row"><div class="stat-card"><div class="stat-num">${s.total}</div><div class="stat-label">Total Stored</div></div><div class="stat-card"><div class="stat-num">${s.last7}</div><div class="stat-label">Last 7 Days</div></div><div class="stat-card"><div class="stat-num">${s.last30}</div><div class="stat-label">Last 30 Days</div></div><div class="stat-card"><div class="stat-num">${Object.keys(s.sourceCounts).length}</div><div class="stat-label">Sources</div></div></div>`;
    } catch (e) { el.innerHTML = ''; }
  }

  function renderDraftList() {
    const el = document.getElementById('saved-drafts-list');
    const activeLabel = document.getElementById('active-draft-label');
    if (!el) return;
    if (!state.drafts.length) {
      el.innerHTML = `<div class="fc-t">Projects & Saved Newsletters</div><div style="font-size:.72rem;color:#000000">No drafts saved yet.</div>`;
      if (activeLabel) activeLabel.textContent = 'No draft loaded';
      return;
    }
    const options = state.drafts.map(d => `<option value="${d.id}" ${state.selectedDraftToLoad === d.id ? 'selected' : ''}>${d.title || 'Untitled'} · ${d.status || 'draft'} · ${fmtDate(d.issueDate || d.updatedAt)}</option>`).join('');
    const cards = state.drafts.slice(0, 24).map(d => {
      const wf = d.workspace?.workflow?.state || d.status || 'draft';
      const isActive = d.id === state.activeDraftId;
      return `<div style="padding:.55rem .65rem;border:1px solid ${isActive ? 'rgba(38,39,224,.5)' : 'rgba(255,255,255,.1)'};border-radius:6px;background:${isActive ? 'rgba(0,2,215,.08)' : 'rgba(0,0,0,.015)'}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.45rem;flex-wrap:wrap">
          <strong style="font-size:.73rem;color:var(--txt)">${d.title || 'Untitled'}</strong>
          <span style="font-size:.54rem;letter-spacing:.08em;text-transform:uppercase;padding:.14rem .45rem;border:1px solid rgba(38,39,224,.35);border-radius:999px;color:var(--pri-hi)">${wf}</span>
        </div>
        <div style="font-size:.64rem;color:#000000;margin-top:.25rem">Issue: ${fmtDate(d.issueDate || d.updatedAt)} · Updated: ${fmtDate(d.updatedAt)} · Versions: ${d.version || 1}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.35rem;gap:.45rem;flex-wrap:wrap">
          <span style="font-size:.62rem;color:var(--gray2)">Owner: ${d.owner || 'Unassigned'} · Campaign: ${d.campaignName || 'N/A'}</span>
          <button class="btn" onclick="App.UI.loadDraftById('${d.id}')">Open</button>
        </div>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="fc-t">Projects & Saved Newsletters</div>
      <div style="display:flex;gap:.45rem;align-items:center;flex-wrap:wrap">
        <select id="draft-select" style="flex:1;min-width:240px;background:rgba(0,0,0,.035);border:1px solid rgba(0,0,0,.09);color:var(--txt);padding:.45rem .55rem;border-radius:5px" onchange="App.UI.pickDraftToLoad(this.value)">${options}</select>
        <button class="btn" onclick="App.UI.loadSelectedDraft()">Load</button>
      </div>
      <div style="font-size:.62rem;color:#000000;margin-top:.55rem">Each save stores a snapshot version so you can rework older copies safely.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:.45rem;margin-top:.6rem">${cards}</div>`;
    if (!state.selectedDraftToLoad) state.selectedDraftToLoad = state.drafts[0].id;
    const active = state.drafts.find(d => d.id === state.activeDraftId);
    if (activeLabel) activeLabel.textContent = active ? `Active: ${active.title || 'Untitled'} (${active.status || 'draft'})` : 'No draft loaded';
  }

  async function refreshDrafts() {
    try {
      state.drafts = await App.DB.getAllDrafts();
      if (!state.selectedDraftToLoad && state.drafts[0]) state.selectedDraftToLoad = state.drafts[0].id;
    } catch (e) { state.drafts = []; }
    renderDraftList();
  }

  function renderDeliveryLogs(logs = []) {
    const el = document.getElementById('delivery-log-list');
    if (!el) return;
    if (!logs.length) {
      el.innerHTML = `<div class="fc-t">Delivery Status History</div><div style="font-size:.72rem;color:#000000">No send attempts yet.</div>`;
      return;
    }
    el.innerHTML = `<div class="fc-t">Delivery Status History</div>${logs.slice(0, 8).map(l => `
      <div style="padding:.55rem .65rem;border:1px solid rgba(0,0,0,.06);border-radius:5px;margin-bottom:.35rem;background:rgba(0,0,0,.015)">
        <div style="display:flex;justify-content:space-between;gap:.4rem;flex-wrap:wrap">
          <strong style="font-size:.72rem;color:var(--txt)">${l.action === 'test' ? 'Test Email' : 'Newsletter Send'} · ${l.status}</strong>
          <span style="font-size:.62rem;color:#000000">${fmtDate(l.createdAt)}</span>
        </div>
        <div style="font-size:.66rem;color:var(--gray2)">Draft: ${l.draftTitle || 'N/A'} | To: ${l.recipients || 'N/A'} | Lang: ${l.language || 'en'}</div>
        ${l.error ? `<div style="font-size:.65rem;color:var(--red)">Error: ${l.error}</div>` : ''}
      </div>`).join('')}`;
  }

  async function refreshDeliveryLogs() {
    try {
      const logs = await App.DB.getDeliveryLogs();
      renderDeliveryLogs(logs);
    } catch (e) {
      renderDeliveryLogs([]);
    }
  }

  function renderFeedStats() {
    const container = document.getElementById('feed-status-area');
    if (!container) return;
    const feeds = App.RSSFetcher.getFeeds();
    container.innerHTML = feeds.map(f => {
      const s = state.feedStats[f.id];
      const ok = s?.ok ?? false;
      const cnt = s?.count ?? 0;
      return `<div class="src-row"><div style="display:flex;align-items:center;gap:.6rem"><span style="font-size:.95rem">${f.icon}</span><div><div class="src-name">${escapeHtml(f.name)}</div><div class="src-meta">${escapeHtml(f.site)}</div></div></div><div style="display:flex;align-items:center;gap:.4rem">${s?`<span style="font-size:.62rem;color:${ok?'var(--grn)':'var(--red)'}"> ${ok?(cnt+' privacy'+(s.rawCount!=null?' · '+s.rawCount+' in feed':'')):escapeHtml(s.error||'Unreachable')}</span>`:''}${s?G.feedStatusDot(ok):'<span class="sbadge b-ws">RSS</span>'}</div></div>`;
    }).join('');
  }

  function getCurationMode() {
    const el = document.getElementById('curation-mode');
    return el?.value || state.curationMode || 'balanced';
  }

  function applyCurationMode(mode) {
    state.curationMode = ['concise', 'balanced', 'deep'].includes(mode) ? mode : 'balanced';
    const el = document.getElementById('curation-mode');
    if (el) el.value = state.curationMode;
  }

  function summarizeFeedback() {
    const entries = Object.values(state.curationFeedback || {});
    return entries.reduce((acc, entry) => {
      if (entry?.unclear) acc.unclear += 1;
      if (entry?.tooLong) acc.tooLong += 1;
      if (entry?.notActionable) acc.notActionable += 1;
      return acc;
    }, { unclear: 0, tooLong: 0, notActionable: 0 });
  }

  function renderFetchTelemetryPanel() {
    const el = document.getElementById('fetch-telemetry');
    if (!el) return;
    const t = state.fetchTelemetry;
    if (!t) {
      el.innerHTML = '<div class="telemetry-empty">Fetch telemetry appears after the first live run.</div>';
      return;
    }
    const feedback = summarizeFeedback();
    el.innerHTML = `
      <div class="telemetry-grid">
        <div class="telemetry-card"><div class="telemetry-num">${t.timeToFirstArticlesMs ? `${t.timeToFirstArticlesMs}ms` : 'n/a'}</div><div class="telemetry-label">Time to First Articles</div></div>
        <div class="telemetry-card"><div class="telemetry-num">${t.totalElapsedMs || 0}ms</div><div class="telemetry-label">Total Fetch Time</div></div>
        <div class="telemetry-card"><div class="telemetry-num">${t.articlesRendered || 0}</div><div class="telemetry-label">Progressive Rendered Articles</div></div>
        <div class="telemetry-card"><div class="telemetry-num">${feedback.unclear}/${feedback.tooLong}/${feedback.notActionable}</div><div class="telemetry-label">Quality Flags U/L/A</div></div>
      </div>
    `;
  }

  function renderSidebarFeeds() {
    const el = document.getElementById('sb-feeds-list');
    if (!el) return;
    const feeds = App.RSSFetcher.getFeeds();
    const tiers = { 1: 'Government & Standards', 2: 'Enterprise Vendors', 3: 'Journalism & Awareness', 4: 'Custom Sources' };
    const grouped = { 1: [], 2: [], 3: [], 4: [] };
    feeds.forEach(f => {
      const bucket = f.custom ? 4 : f.tier;
      if (grouped[bucket]) grouped[bucket].push(f);
    });
    const hasFetched = Object.keys(state.feedStats).length > 0;
    const okCount = Object.values(state.feedStats).filter(s => s.ok).length;
    const total = feeds.length;
    let html = hasFetched
      ? `<div style="font-size:.55rem;color:#000000;padding:.25rem 0 .35rem;display:flex;gap:.4rem;flex-wrap:wrap"><span style="color:#4CAF7D">● ${okCount} live</span><span style="color:#E74C3C">● ${total - okCount} down</span><span>/ ${total} total</span></div>`
      : `<div style="font-size:.55rem;color:#000000;padding:.25rem 0 .35rem">Fetch news to check live status</div>`;
    for (const [tier, label] of Object.entries(tiers)) {
      const arr = grouped[tier];
      if (!arr.length) continue;
      html += `<div class="sb-feed-tier">${label} (${arr.length})</div>`;
      arr.forEach(f => {
        const s = state.feedStats[f.id];
        const dotClass = !s ? 'waiting' : (s.ok ? 'live' : 'dead');
        const cnt = s?.ok ? s.count : '';
        html += `<div class="sb-feed-item" title="${escapeHtml(f.site)}"><div class="sb-feed-dot ${dotClass}"></div><span class="sb-feed-icon">${f.icon}</span><span class="sb-feed-name">${escapeHtml(f.name)}</span>${cnt ? `<span class="sb-feed-cnt">${cnt}</span>` : ''}</div>`;
      });
    }
    el.innerHTML = html;
  }

  function renderSidebarKeywordManager() {
    if (!App.KeywordStore) return;
    const critEl = document.getElementById('sb-critical-keyword-list');
    const ctxEl = document.getElementById('sb-context-keyword-list');
    const noiseEl = document.getElementById('sb-noise-keyword-list');
    if (!critEl || !ctxEl || !noiseEl) return;
    const critical = App.KeywordStore.getCriticalKeywords();
    const context = App.KeywordStore.getContextKeywords();
    const noise = App.KeywordStore.getNoiseKeywords();
    critEl.innerHTML = critical.slice(0, 120).map(k => `<span class="sb-kword-chip">${k}<button onclick="App.UI.removeSidebarCriticalKeyword('${k.replace(/'/g, "\\'")}')">×</button></span>`).join('');
    ctxEl.innerHTML = context.slice(0, 120).map(k => `<span class="sb-kword-chip">${k}<button onclick="App.UI.removeSidebarContextKeyword('${k.replace(/'/g, "\\'")}')">×</button></span>`).join('');
    noiseEl.innerHTML = noise.slice(0, 120).map(k => `<span class="sb-kword-chip">${k}<button onclick="App.UI.removeSidebarNoiseKeyword('${k.replace(/'/g, "\\'")}')">×</button></span>`).join('');
  }

  function addSidebarCriticalKeyword() {
    const inp = document.getElementById('sb-critical-keyword-input');
    if (!inp) return;
    App.KeywordStore?.addKeyword?.('critical', inp.value);
    inp.value = '';
    renderSidebarKeywordManager();
    showToast('Critical keyword added.');
  }

  function addSidebarContextKeyword() {
    const inp = document.getElementById('sb-context-keyword-input');
    if (!inp) return;
    App.KeywordStore?.addKeyword?.('context', inp.value);
    inp.value = '';
    renderSidebarKeywordManager();
    showToast('Context keyword added.');
  }

  function addSidebarNoiseKeyword() {
    const inp = document.getElementById('sb-noise-keyword-input');
    if (!inp) return;
    App.KeywordStore?.addKeyword?.('noise', inp.value);
    inp.value = '';
    renderSidebarKeywordManager();
    showToast('Noise keyword added.');
  }

  function removeSidebarCriticalKeyword(keyword) {
    App.KeywordStore?.removeKeyword?.('critical', keyword);
    renderSidebarKeywordManager();
  }

  function removeSidebarContextKeyword(keyword) {
    App.KeywordStore?.removeKeyword?.('context', keyword);
    renderSidebarKeywordManager();
  }

  function removeSidebarNoiseKeyword(keyword) {
    App.KeywordStore?.removeKeyword?.('noise', keyword);
    renderSidebarKeywordManager();
  }

  function resetSidebarKeywords() {
    if (!confirm('Reset keywords to defaults?')) return;
    App.KeywordStore?.resetDefaults?.();
    renderSidebarKeywordManager();
    showToast('Keywords reset.');
  }

  function addFeedSource() {
    const nameEl = document.getElementById('feed-source-name');
    const urlEl = document.getElementById('feed-source-url');
    if (!nameEl || !urlEl || !App.RSSFetcher?.addCustomFeed) return;
    try {
      App.RSSFetcher.addCustomFeed({ name: nameEl.value, url: urlEl.value });
      nameEl.value = '';
      urlEl.value = '';
      renderFeedStats();
      renderFeedDashboard();
      renderSidebarFeeds();
      showToast('Feed source added.');
    } catch (e) {
      showToast(e?.message || 'Could not add source.', true);
    }
  }

  function removeFeedSource(feedId) {
    if (!feedId || !App.RSSFetcher?.removeCustomFeed) return;
    if (!confirm('Remove this custom feed source?')) return;
    const removed = App.RSSFetcher.removeCustomFeed(feedId);
    if (!removed) return showToast('Source not found.', true);
    delete state.feedStats[feedId];
    renderFeedStats();
    renderFeedDashboard();
    renderSidebarFeeds();
    showToast('Feed source removed.');
  }

  function renderFeedDashboard() {
    const el = document.getElementById('feed-sources-dashboard');
    if (!el) return;
    const feeds = App.RSSFetcher.getFeeds();
    const tiers = {
      1: { label: 'Tier 1 — Government CERTs & National Cyber Agencies', feeds: [] },
      2: { label: 'Tier 2 — Premium Security Journalism & Phishing Specialists', feeds: [] },
      3: { label: 'Tier 3 — Awareness Vendors & Broader Security', feeds: [] },
      4: { label: 'Custom Sources', feeds: [] }
    };
    feeds.forEach(f => {
      const bucket = f.custom ? 4 : f.tier;
      if (tiers[bucket]) tiers[bucket].feeds.push(f);
    });
    const customFeeds = App.RSSFetcher?.getCustomFeeds?.() || [];
    const totalFeeds = feeds.length;
    const okCount = Object.values(state.feedStats).filter(s => s.ok).length;
    const failCount = Object.values(state.feedStats).filter(s => !s.ok).length;
    const hasFetched = Object.keys(state.feedStats).length > 0;
    const totalArticles = Object.values(state.feedStats).reduce((s, f) => s + (f.count || 0), 0);
    const summary = hasFetched ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem"><div style="background:rgba(30,122,70,.1);border:1px solid rgba(30,122,70,.2);border-radius:var(--radius);padding:.4rem .7rem;font-size:.65rem;color:#4CAF7D">&#x2713; ${okCount} connected</div>${failCount > 0 ? `<div style="background:rgba(192,57,43,.1);border:1px solid rgba(192,57,43,.2);border-radius:var(--radius);padding:.4rem .7rem;font-size:.65rem;color:#E74C3C">&#x2715; ${failCount} not reachable</div>` : ''}<div style="background:rgba(0,2,215,.1);border:1px solid rgba(0,2,215,.2);border-radius:var(--radius);padding:.4rem .7rem;font-size:.65rem;color:#2627E0">${totalArticles} articles fetched</div><div style="background:rgba(0,0,0,.035);border:1px solid rgba(0,0,0,.06);border-radius:var(--radius);padding:.4rem .7rem;font-size:.65rem;color:#000000">${totalFeeds} total feeds</div></div>` : `<div style="font-size:.68rem;color:#000000;margin-bottom:1rem;padding:.5rem .7rem;background:rgba(0,0,0,.015);border:1px solid rgba(0,0,0,.045);border-radius:var(--radius)">Click "Fetch Live News" above to see live status for each feed.</div>`;
    const isConfigPage = !!document.getElementById('config-page-root');
    const customManager = `<div class="feed-source-mgr"><div class="feed-source-row"><input id="feed-source-name" class="feed-source-input" placeholder="Source name (e.g. Company Blog)" maxlength="90"><input id="feed-source-url" class="feed-source-input" placeholder="https://example.com/feed.xml"><button class="btn btn-a" onclick="App.UI.addFeedSource()">Add Source</button></div>${customFeeds.length ? `<div class="feed-source-list">${customFeeds.map(f => `<div class="feed-source-item"><div><div class="feed-source-title">${escapeHtml(f.name)}</div><div class="feed-source-link">${escapeHtml(f.url)}</div></div><button class="btn feed-source-remove-btn" onclick="App.UI.removeFeedSource('${escapeHtml(f.id)}')">Delete</button></div>`).join('')}</div>` : '<div class="feed-source-empty">No custom feed sources yet.</div>'}</div>`;
    let html = `${isConfigPage ? customManager : ''}${summary}`;
    for (const [, tier] of Object.entries(tiers)) {
      if (!tier.feeds.length) continue;
      html += `<div class="feed-tier-label">${tier.label}</div><div class="feed-src-grid">`;
      tier.feeds.forEach(f => {
        const s = state.feedStats[f.id];
        const hasStatus = !!s;
        const ok = s?.ok ?? false;
        const cnt = s?.count ?? 0;
        let statusBadge, statusExtra;
        if (!hasStatus) { statusBadge = '<span class="feed-src-badge waiting">Waiting</span>'; statusExtra = ''; }
        else if (ok) { statusBadge = '<span class="feed-src-badge ok">Connected</span>'; statusExtra = `<span class="feed-src-count">${cnt} matches</span>`; }
        else { statusBadge = '<span class="feed-src-badge fail">Failed</span>'; statusExtra = `<span class="feed-src-count" style="color:var(--red)">${s.error || 'Not reachable'}</span>`; }
        html += `<div class="feed-src-card"><div class="feed-src-icon">${f.icon}</div><div class="feed-src-info"><div class="feed-src-name">${escapeHtml(f.name)}</div><div class="feed-src-site">${escapeHtml(f.site)}</div></div><div class="feed-src-status">${statusExtra}${statusBadge}</div></div>`;
      });
      html += '</div>';
    }
    el.innerHTML = html;
  }

  function renderTypeChart() {
    const el = document.getElementById('type-chart');
    if (!el) return;
    const arts = filteredArticles();
    if (!arts.length) { el.innerHTML = ''; return; }
    const tc = {};
    arts.forEach(a => { tc[a.type] = (tc[a.type] || 0) + 1; });
    const colors = { 'Phishing':'#E67E22','Password & MFA':'#2627E0','Data Breach':'#E91E63','Ransomware':'#C0392B','Social Engineering':'#F39C12','Malware':'#9B59B6','Scam & Fraud':'#95A5A6','Vulnerability':'#3498DB','Advisory':'#2ECC71','Insider Threat':'#E74C3C','Security News':'#7F8C8D' };
    const data = Object.entries(tc).sort((a,b)=>b[1]-a[1]).map(([l,c])=>({label:l,count:c,color:colors[l]||'#2627E0'}));
    el.innerHTML = G.donutChart(data, 100);
  }

  function getBaselineArticles() {
    if (!Array.isArray(SAMPLE_ARTICLES) || !SAMPLE_ARTICLES.length) return [];
    return SAMPLE_ARTICLES.map((article, idx) => ({
      ...article,
      sourceId: article.sourceId || 'baseline',
      url: article.url && article.url !== '#' ? article.url : `https://baseline.local/article-${idx + 1}`,
      pubDate: article.pubDate || new Date().toISOString().split('T')[0],
      fallback: true
    }));
  }

  async function loadArticles() {
    if (state.loading) return;
    state.loading = true;
    clearLog();
    state.selectedArticleIndices = [];
    state.fetchTelemetry = {
      startedAt: Date.now(),
      timeToFirstArticlesMs: null,
      totalElapsedMs: 0,
      articlesRendered: 0
    };
    const fetchEl = document.getElementById('fetch-st');
    const areaEl = document.getElementById('articles-area');
    if (fetchEl) fetchEl.textContent = 'Fetching…';
    if (areaEl) areaEl.innerHTML = skeleton(4);
    updateDebugState({ phase: 'start-fetch', error: '' });
    try {
      log('Fetching live phishing & security news…', 'log-ai');
      const progressiveArticles = [];
      const seenUrls = new Set();
      const { articles, stats, telemetry } = await App.RSSFetcher.fetchAllFeeds(null, 25, (progress) => {
        if (!fetchEl) return;
        const done = Math.max(0, progress?.done || 0);
        const total = Math.max(1, progress?.total || 1);
        const feedName = progress?.feedName || 'feed';
        const feedStatus = progress?.ok ? `${progress?.count || 0} matches` : 'unreachable';
        fetchEl.textContent = `Fetching feeds ${done}/${total}: ${feedName} (${feedStatus}, ${progress?.elapsedMs || 0}ms)`;
        const incoming = Array.isArray(progress?.newArticles) ? progress.newArticles : [];
        if (incoming.length) {
          incoming.forEach(article => {
            const urlKey = String(article?.url || '').trim();
            if (!urlKey || seenUrls.has(urlKey)) return;
            seenUrls.add(urlKey);
            progressiveArticles.push(article);
          });
          if (!state.fetchTelemetry.timeToFirstArticlesMs) {
            state.fetchTelemetry.timeToFirstArticlesMs = Date.now() - state.fetchTelemetry.startedAt;
          }
          state.fetchTelemetry.articlesRendered = progressiveArticles.length;
          renderArticles(sortArticles(progressiveArticles.slice(0, 60)));
          renderFetchTelemetryPanel();
        }
      });
      state.feedStats = stats;
      state.fetchTelemetry.totalElapsedMs = telemetry?.totalElapsedMs || (Date.now() - state.fetchTelemetry.startedAt);
      renderFeedStats(); renderFeedDashboard(); renderSidebarFeeds();
      renderFetchTelemetryPanel();

      let dbArts = [];
      try { dbArts = await App.DB.getAllArticles(); log(`💾 ${dbArts.length} from database`, 'log-ok'); } catch (e) { log('⚠ DB not available', 'log-err'); }

      const urlSet = new Set(articles.map(a => a.url));
      const merged = [...articles];
      dbArts.forEach(a => { if (!urlSet.has(a.url)) { urlSet.add(a.url); merged.push(a); } });
      merged.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0) || new Date(b.pubDate) - new Date(a.pubDate));
      if (!merged.length) {
        const baseline = getBaselineArticles();
        merged.push(...baseline);
        if (baseline.length) {
          log('No live or stored articles found. Loaded baseline fallback articles to keep workflow unblocked.', 'log-err');
        }
      }
      state.allArticles = merged;
      Promise.resolve().then(() => App.DB.upsertArticles(merged)).catch((e) => {
        log(`⚠ Deferred DB merge save failed: ${e.message}`, 'log-err');
      });

      let filtered = filteredArticles();
      if (!filtered.length && merged.length) {
        state.filterDays = 0;
        const allChip = document.querySelector('.dur-chip[data-days="0"]');
        if (allChip) {
          document.querySelectorAll('.dur-chip').forEach(c => c.classList.remove('active'));
          allChip.classList.add('active');
        }
        filtered = filteredArticles();
      }
      log(`${filtered.length} articles in date range`, 'log-ok');

      // Old behavior: show article cards immediately after fetch.
      renderArticles(filtered);
      renderTypeChart();
      renderDBStats();

      const aiOn = document.getElementById('feat-ai')?.checked;
      const curationMode = getCurationMode();
      applyCurationMode(curationMode);
      if (aiOn) {
        const prov = document.getElementById('ai-provider')?.value || 'claude';
        const key = document.getElementById('ai-key')?.value || '';
        App.AISummarizer.configure({ provider: prov, claudeKey: prov === 'claude' ? key : '', openaiKey: prov === 'openai' ? key : '' });
        const toProcess = filtered.filter(a => !a.aiProcessed && !a.watchouts).slice(0, 15);
        if (toProcess.length) {
          if (App.AISummarizer.isAIAvailable()) {
            await App.AISummarizer.summarizeAll(toProcess.slice(0, 12), (d, t) => {
              if (fetchEl) fetchEl.textContent = `AI processing: ${d}/${t}…`;
            }, { mode: curationMode });
          } else {
            await App.AISummarizer.summarizeAll(toProcess, null, { mode: curationMode });
          }
          Promise.resolve().then(() => App.DB.upsertArticles(toProcess.filter(a => a.watchouts))).catch((e) => {
            log(`⚠ Deferred AI DB save failed: ${e.message}`, 'log-err');
          });
        }
      } else {
        filtered.forEach(a => {
          if (!a.watchouts) {
            const l = App.AISummarizer.localSummarize(a, curationMode);
            a.watchouts = l.watchouts;
            a.threatLevel = l.threatLevel;
            a.curationMeta = {
              mode: curationMode,
              confidence: typeof l.confidence === 'number' ? l.confidence : 0.5,
              fallbackUsed: true,
              provider: 'local',
              updatedAt: new Date().toISOString()
            };
          }
        });
        Promise.resolve().then(() => App.DB.upsertArticles(filtered)).catch((e) => {
          log(`⚠ Deferred DB summarize save failed: ${e.message}`, 'log-err');
        });
      }

      if (fetchEl) fetchEl.textContent = `${filtered.length} articles ready`;
      renderArticles(filtered); renderTypeChart(); renderDBStats();
    } catch (e) {
      log(`Error: ${e.message}`, 'log-err');
      if (fetchEl) fetchEl.textContent = 'Error';
      if (areaEl) areaEl.innerHTML = `<div class="empty-st"><p>Fetch failed: ${e.message}</p></div>`;
    } finally {
      state.loading = false;
    }
  }

  async function loadFromDB() {
    if (state.loading) return;
    state.loading = true;
    clearLog();
    state.selectedArticleIndices = [];
    const fetchEl = document.getElementById('fetch-st');
    const areaEl = document.getElementById('articles-area');
    if (fetchEl) fetchEl.textContent = 'Loading…';
    if (areaEl) areaEl.innerHTML = skeleton(3);
    try {
      let dbArts = await App.DB.getAllArticles();
      let usedBaselineFallback = dbArts.length > 0 && dbArts.every(article =>
        article?.fallback || article?.sourceId === 'baseline' || String(article?.url || '').includes('baseline.local')
      );
      state.allArticles = dbArts;
      if (!dbArts.length) {
        const baseline = getBaselineArticles();
        if (!baseline.length) {
          if (fetchEl) fetchEl.textContent = 'No stored articles yet. Fetch live news.';
          renderArticles([]);
          renderTypeChart();
          renderDBStats();
          return;
        }
        dbArts = baseline;
        usedBaselineFallback = true;
        state.allArticles = dbArts;
        log('No stored articles found. Loaded baseline fallback articles to keep workflow unblocked.', 'log-err');
        try { await App.DB.upsertArticles(dbArts); } catch (e) {}
      }
      log(`💾 ${dbArts.length} articles from database`, 'log-ok');

      let filtered = filteredArticles();
      if (!filtered.length && dbArts.length) {
        state.filterDays = 0;
        const allChip = document.querySelector('.dur-chip[data-days="0"]');
        if (allChip) {
          document.querySelectorAll('.dur-chip').forEach(c => c.classList.remove('active'));
          allChip.classList.add('active');
        }
        filtered = filteredArticles();
      }
      filtered.forEach(a => {
        if (!a.watchouts) { const l = App.AISummarizer.localSummarize(a); a.watchouts = l.watchouts; a.threatLevel = l.threatLevel; }
      });
      try { await App.DB.upsertArticles(filtered); } catch (e) {}

      if (fetchEl) {
        fetchEl.textContent = usedBaselineFallback
          ? `Loaded ${filtered.length} baseline fallback articles`
          : `Restored ${filtered.length} articles from previous fetch`;
      }
      renderArticles(filtered);
      renderTypeChart();
      renderDBStats();
    } catch (e) {
      log(`DB Error: ${e.message}`, 'log-err');
      if (fetchEl) fetchEl.textContent = 'DB error';
      if (areaEl) areaEl.innerHTML = `<div class="empty-st"><p>Load from DB failed: ${e.message}</p></div>`;
    } finally {
      state.loading = false;
    }
  }

  async function clearDB() {
    if (!confirm('Delete all stored articles? This cannot be undone.')) return;
    try { await App.DB.clearAll(); showToast('Database cleared'); renderDBStats(); }
    catch (e) { showToast('Failed to clear database', true); }
  }

  function renderArticles(arts) {
    try {
    const max = getConfig().max;
    const countEl = document.getElementById('articles-count');
    const inRange = Array.isArray(arts) ? arts.length : 0;
    const selected = state.selectedArticleIndices.length;
    const safeArts = Array.isArray(arts) ? arts : [];
    const types = ['All', ...new Set(safeArts.map(a => a?.type || 'Security News'))];
    const fRow = `<div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.65rem">${types.map(t => `<button class="fchip ${t===state.activeFilter?'active':''}" onclick="App.UI.setFilter('${t}')">${t}</button>`).join('')}</div>`;
    const typeFiltered = state.activeFilter === 'All' ? safeArts : safeArts.filter(a => (a?.type || 'Security News') === state.activeFilter);
    const sortedFiltered = sortArticles(typeFiltered);
    renderArticleStats(safeArts, sortedFiltered);
    if (countEl) {
      countEl.textContent = `Loaded: ${state.allArticles.length} | In range: ${inRange} | Showing: ${sortedFiltered.length} | Selected: ${selected}/${max}`;
    }
    const cards = sortedFiltered.map(art => {
      const ri = state.allArticles.indexOf(art);
      const sel = state.selectedArticleIndices.includes(ri);
      const dis = !sel && state.selectedArticleIndices.length >= max;
      const icon = typeof G.threatIcon === 'function' ? G.threatIcon(art?.type || 'Security News', 24) : '•';
      const feedbackKey = encodeURIComponent(String(art?.url || `idx-${ri}`));
      const feedback = state.curationFeedback[feedbackKey] || {};
      const curationMeta = art?.curationMeta || {};
      const confidencePct = Math.round(Math.max(0, Math.min(1, Number(curationMeta.confidence || 0))) * 100);
      const fallbackBadge = curationMeta.fallbackUsed ? '<span class="curation-chip warn">Fallback</span>' : '';
      const modeBadge = curationMeta.mode ? `<span class="curation-chip">${escapeHtml(curationMeta.mode)}</span>` : '';
      return `<div class="a-card ${sel?'sel':''} ${dis?'dis':''}" onclick="App.UI.toggleArticle(${ri})"><div style="display:flex;align-items:flex-start;gap:.6rem"><div style="flex-shrink:0;margin-top:.08rem">${icon}</div><div style="flex:1"><div class="a-src">${art?.source || 'Unknown Source'}${art?.aiProcessed?'<span class="ai-pill" style="margin-left:.3rem">\u2726 AI</span>':''}</div><div class="a-title">${art?.title || 'Untitled article'}</div></div></div><div class="a-sum">${art?.summary||art?.description||''}</div><div class="a-meta"><span class="a-type">${art?.type || 'Security News'}</span>${art?.threatLevel?`<span style="font-size:.52rem;color:${['','#4CAF7D','#8BC34A','#FFC107','#E67E22','#C0392B'][art.threatLevel]||'#888'};font-weight:600">LV${art.threatLevel}</span>`:''}<span class="a-date">${fmtDate(art?.pubDate)} \u00b7 ${daysAgo(art?.pubDate)}</span><a class="a-link" href="${art?.url || '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">\u2197</a></div><div class="curation-meta-row">${modeBadge}<span class="curation-chip">Confidence ${confidencePct}%</span>${fallbackBadge}</div><div class="curation-feedback-row"><button class="mini-chip ${feedback.unclear ? 'active' : ''}" onclick="event.stopPropagation();App.UI.flagCurationFeedback('${feedbackKey}','unclear')">Unclear</button><button class="mini-chip ${feedback.tooLong ? 'active' : ''}" onclick="event.stopPropagation();App.UI.flagCurationFeedback('${feedbackKey}','tooLong')">Too long</button><button class="mini-chip ${feedback.notActionable ? 'active' : ''}" onclick="event.stopPropagation();App.UI.flagCurationFeedback('${feedbackKey}','notActionable')">Not actionable</button></div>${sel&&art?.watchouts?.length?`<div class="a-wo"><div class="a-wo-t">Safety Tips</div><ul>${art.watchouts.map(w=>`<li>${w}</li>`).join('')}</ul></div>`:''}</div>`;
    }).join('');
    const area = document.getElementById('articles-area');
    if (!area) return;
    const sortControl = `<label style="display:flex;align-items:center;gap:.35rem;font-size:.64rem;color:#000000">Sort
      <select id="article-sort-select" onchange="App.UI.setArticleSort(this.value)" style="background:rgba(0,0,0,.035);border:1px solid rgba(0,0,0,.10);color:var(--txt);padding:.22rem .4rem;border-radius:5px;font-size:.64rem">
        <option value="date_desc" style="background:#fff;color:#111" ${state.articleSort === 'date_desc' ? 'selected' : ''}>Newest first</option>
        <option value="date_asc" style="background:#fff;color:#111" ${state.articleSort === 'date_asc' ? 'selected' : ''}>Oldest first</option>
      </select>
    </label>`;
    const emptyListMsg = !safeArts.length
      ? (state.articleKeywordQuery && String(state.articleKeywordQuery).trim()
        ? '<div class="empty-st"><p>No articles match your search.</p><p style="font-size:.65rem;opacity:.75;margin-top:.35rem">Try fewer or different keywords (matches title, summary, source, type, or link).</p></div>'
        : '<div class="empty-st"><p>No articles in the current date range.</p></div>')
      : (!sortedFiltered.length
        ? '<div class="empty-st"><p>No articles match this type filter.</p></div>'
        : '');
    area.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem;flex-wrap:wrap;gap:.4rem"><span style="font-size:.7rem;color:#000000">Select up to <strong style="color:var(--txt)">${max}</strong> article${max>1?'s':''}</span><div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap"><span style="font-size:.7rem">Selected: <span class="sel-badge">${state.selectedArticleIndices.length}</span> / ${max}</span>${sortControl}</div></div>${fRow}${cards || emptyListMsg}`;
    updateDebugState({ rendered: (sortedFiltered || []).length });
    } catch (e) {
      const area = document.getElementById('articles-area');
      if (area) area.innerHTML = `<div class="empty-st"><p>Render error: ${e.message}</p></div>`;
      renderArticleStats([], []);
      log(`Render error: ${e.message}`, 'log-err');
      updateDebugState({ phase: 'render-error', error: e.message });
    }
  }

  function setFilter(type) { state.activeFilter = type; renderArticles(filteredArticles()); }

  function setArticleKeywordSearch(value) {
    state.articleKeywordQuery = String(value ?? '');
    syncArticleKeywordSearchInput();
    renderArticles(filteredArticles());
  }

  function syncArticleKeywordSearchInput() {
    const el = document.getElementById('article-keyword-search');
    if (el && el.value !== (state.articleKeywordQuery || '')) el.value = state.articleKeywordQuery || '';
  }

  function flagCurationFeedback(feedbackKey, type) {
    if (!feedbackKey || !type) return;
    if (!state.curationFeedback[feedbackKey]) state.curationFeedback[feedbackKey] = {};
    state.curationFeedback[feedbackKey][type] = !state.curationFeedback[feedbackKey][type];
    renderArticles(filteredArticles());
    renderFetchTelemetryPanel();
  }

  function setArticleSort(sortMode) {
    state.articleSort = sortMode === 'date_asc' ? 'date_asc' : 'date_desc';
    renderArticles(filteredArticles());
  }

  function toggleArticle(idx) {
    if (idx < 0 || idx >= state.allArticles.length) return;
    const max = getConfig().max;
    const pos = state.selectedArticleIndices.indexOf(idx);
    if (pos > -1) state.selectedArticleIndices.splice(pos, 1);
    else { if (state.selectedArticleIndices.length >= max) return; state.selectedArticleIndices.push(idx); }
    renderArticles(filteredArticles());
  }

  async function buildAndPreview() {
    const opts = getOptions();
    const provider = document.getElementById('ai-provider')?.value || 'claude';
    const aiKey = document.getElementById('ai-key')?.value?.trim() || '';
    let arts = state.selectedArticleIndices.length > 0
      ? state.selectedArticleIndices.map(i => state.allArticles[i]).filter(Boolean)
      : filteredArticles().slice(0, getConfig().max);
    arts = arts.slice(0, getConfig().max);
    if (!arts.length) { showToast('No articles selected. Fetch news first, then select articles.', true); return; }
    const willTranslate = !!aiKey;
    const nonEnglishLangCount = NEWSLETTER_LANGUAGES.filter(l => l.id !== 'en').length;
    const progressTotalSteps = willTranslate ? 1 + nonEnglishLangCount : 0;
    const metaTitle = document.getElementById('meta-title');
    if (metaTitle && !metaTitle.value.trim()) metaTitle.value = defaultProjectTitle();
    arts.forEach(a => {
      if (!a.summary && a.description) a.summary = a.description;
      if (!a.watchouts) { const l = App.AISummarizer.localSummarize(a); a.watchouts = l.watchouts; }
    });
    if (typeof App.AISummarizer.dedupeWatchoutsAcrossArticles === 'function') {
      App.AISummarizer.dedupeWatchoutsAcrossArticles(arts);
    }
    if (willTranslate) {
      setTranslateProgress(true, 0, progressTotalSteps, 'Generating content…', 'Newsletter');
    }
    try {
    App.AISummarizer.configure({
      provider,
      claudeKey: provider === 'claude' ? aiKey : '',
      openaiKey: provider === 'openai' ? aiKey : ''
    });
    let nlChrome = App.AISummarizer.localNewsletterChrome(arts);
    const featAi = document.getElementById('feat-ai')?.checked !== false;
    if (featAi && aiKey) {
      try {
        nlChrome = await App.AISummarizer.newsletterChrome(arts, { mode: state.curationMode || 'balanced' });
      } catch (_e) {
        nlChrome = App.AISummarizer.localNewsletterChrome(arts);
      }
    }
    let textSlots = {};
    try {
      if (typeof App.AISummarizer.fillNewsletterTextSlots === 'function') {
        textSlots = await App.AISummarizer.fillNewsletterTextSlots(state.selectedFormat, arts, {
          mode: state.curationMode || 'balanced',
          forceLocal: !(featAi && aiKey)
        });
      }
    } catch {
      textSlots = {};
    }
    const cfg = { ...getConfig(), ...getMetadata(), ...nlChrome, ...textSlots };
    const html = App.NewsletterBuilder.build(state.selectedFormat, cfg, arts, opts);
    const variants = {};
    NEWSLETTER_LANGUAGES.forEach(l => {
      variants[l.id] = l.id === 'en'
        ? makeVariant(html, '', { translatedFrom: null })
        : makeVariant('', '', { translatedFrom: null });
    });
    state.newsletterWorkspace = {
      id: `nw_${Date.now()}`, createdAt: new Date().toISOString(),
      format: state.selectedFormat, cfg, opts, articles: arts, variants,
      currentLanguage: state.currentPreviewLanguage || 'en',
      workflow: normalizeWorkflow(null)
    };
    state.translationCache = {};
    persistWorkspace();
    refreshLanguageControls();
    renderWorkflowControls();
    } catch (genErr) {
      if (willTranslate) setTranslateProgress(false);
      showToast(`Newsletter build failed: ${genErr.message}`, true);
      return;
    }
    if (willTranslate) {
      try {
        state.translationLastFailure = null;
        setLanguageTranslating(true, 'multi');
        const firstTranslatedLang = await translateWorkspaceFromEnglish({
          overwrite: true,
          progressLabel: 'Generating translations',
          progressCompletedBase: 1,
          progressTotal: progressTotalSteps
        });
        const targetPreviewLang = state.currentPreviewLanguage !== 'en'
          ? state.currentPreviewLanguage
          : (firstTranslatedLang || 'en');
        state.currentPreviewLanguage = targetPreviewLang;
        state.newsletterWorkspace.currentLanguage = targetPreviewLang;
        persistWorkspace();
      } catch (e) {
        if (!state.translationLastFailure) {
          recordTranslationFailure({
            message: e.message,
            kind: TranslationMetrics.classifyTranslationFailureKind(e.message),
            languageId: state.translationPendingLang?.id || null,
            languageLabel: state.translationPendingLang?.label || null
          });
        }
        showToast(`Translation failed: ${e.message}`, true);
        renderTranslationFailureState(e.message);
        setLanguageTranslating(false);
        return;
      } finally {
        setLanguageTranslating(false);
      }
    } else {
      state.currentPreviewLanguage = 'en';
      state.newsletterWorkspace.currentLanguage = 'en';
      persistWorkspace();
      showToast('Newsletter generated in English. Add an AI API key in Configuration to auto-translate.');
    }
    updateProjectChrome();
    if (App.RouterNav?.goto) {
      App.RouterNav.goto('preview.html', { source: currentPageId(), projectId: state.activeProjectId || null });
      return;
    }
    document.getElementById('preview-panel')?.classList.add('active');
    renderPreviewForLanguage(state.newsletterWorkspace.currentLanguage || 'en');
    window.scrollTo(0, 0);
    if (willTranslate) {
      showToast('Newsletter generated. Click "Edit newsletter" to open the editor.');
    }
  }

  function buildWorkspaceSnapshot() {
    if (!state.newsletterWorkspace) return null;
    syncVariantFromPreviewDom(state.currentPreviewLanguage);
    return JSON.parse(JSON.stringify(state.newsletterWorkspace));
  }

  async function beforeWorkspaceSnapshot() {
    if (window.App?.Editor?.flushOpenEditorToWorkspace) {
      await App.Editor.flushOpenEditorToWorkspace();
    }
  }

  async function saveDraft({ asCopy = false } = {}) {
    const meta = getMetadata();
    if (!meta.title) return showToast('Title is required before saving a draft.', true);
    if (!state.newsletterWorkspace) return showToast('Generate newsletter first, then save draft.', true);
    await beforeWorkspaceSnapshot();
    const snapshot = buildWorkspaceSnapshot();
    const existing = (!asCopy && state.activeDraftId) ? await App.DB.getDraftById(state.activeDraftId) : null;
    const baseSnapshots = Array.isArray(existing?.snapshots) ? existing.snapshots : [];
    baseSnapshots.push({
      version: (existing?.version || 0) + 1,
      capturedAt: new Date().toISOString(),
      workspace: snapshot
    });
    const rec = await App.DB.saveDraft({
      id: asCopy ? `draft_${Date.now()}` : (state.activeDraftId || `draft_${Date.now()}`),
      title: meta.title,
      status: meta.status,
      issueDate: meta.issueDate,
      campaignName: meta.campaignName,
      audience: meta.audience,
      owner: meta.owner,
      createdAt: existing?.createdAt || new Date().toISOString(),
      version: (existing?.version || 0) + 1,
      snapshots: baseSnapshots,
      workspace: snapshot
    });
    state.activeDraftId = rec.id;
    state.selectedDraftToLoad = rec.id;
    try {
      await App.ProjectStore?.saveFromWorkspace?.(snapshot, meta, `project_${rec.id}`);
    } catch (e) {}
    await refreshDrafts();
    clearUnsavedChanges();
    showToast(asCopy ? 'Draft copy saved.' : 'Draft saved.');
  }

  async function saveProjectVersion() {
    if (!state.newsletterWorkspace) return showToast('Generate newsletter first, then save the project.', true);
    await beforeWorkspaceSnapshot();
    const title = getProjectTitle();
    const snapshot = buildWorkspaceSnapshot();
    const metadata = { ...getMetadata(), title };
    try {
      const project = await App.ProjectStore.saveFromWorkspace(snapshot, metadata, state.activeProjectId);
      state.activeProjectId = project.projectId;
      state.projectSnapshotVersion = null;
      const nav = { ...(App.RouterNav.getHandoff?.() || {}), source: currentPageId(), projectId: project.projectId };
      delete nav.projectSnapshotVersion;
      App.RouterNav?.setHandoff?.(nav);
      updateProjectChrome(project);
      clearUnsavedChanges();
      showToast(`Saved ${title} as version ${project.version || 1}.`);
      if (currentPageId() === 'editor') {
        queueMicrotask(() => { refreshEditorProjectVersionOptions().catch(() => {}); });
      }
      return project;
    } catch {
      showToast('Project save failed. Try again.', true);
      return null;
    }
  }

  async function refreshEditorProjectVersionOptions() {
    const row = document.getElementById('editor-version-row');
    const sel = document.getElementById('editor-project-version-select');
    if (!row || !sel || currentPageId() !== 'editor') return;
    if (!state.activeProjectId) {
      row.style.display = 'none';
      return;
    }
    row.style.display = 'flex';
    const project = await App.ProjectStore.get(state.activeProjectId);
    if (!project) {
      row.style.display = 'none';
      return;
    }
    sel.innerHTML = '';
    const cur = document.createElement('option');
    cur.value = 'current';
    cur.textContent = `Current saved (v${project.version || 1})`;
    sel.appendChild(cur);
    const snaps = Array.isArray(project.snapshots) ? [...project.snapshots].sort((a, b) => Number(b.version) - Number(a.version)) : [];
    snaps.forEach(s => {
      const opt = document.createElement('option');
      opt.value = String(s.version);
      opt.textContent = `v${s.version} — ${s.capturedAt ? new Date(s.capturedAt).toLocaleString() : ''}`;
      sel.appendChild(opt);
    });
    if (state.projectSnapshotVersion != null) {
      sel.value = String(state.projectSnapshotVersion);
    } else {
      sel.value = 'current';
    }
  }

  async function editorLoadSelectedProjectVersion() {
    const sel = document.getElementById('editor-project-version-select');
    if (!sel || !state.activeProjectId) {
      return showToast('No project linked. Open the editor from Projects or Preview.', true);
    }
    const v = sel.value;
    const snapNum = v === 'current' ? null : Number(v);
    const project = await App.ProjectStore.get(state.activeProjectId);
    if (!project) return showToast('Project not found.', true);
    if (!state.newsletterWorkspace) state.newsletterWorkspace = emptyNewsletterWorkspaceShell();
    applyIndexedProjectToWorkspace(project, { snapshotVersion: snapNum });
    const prev = App.RouterNav.getHandoff() || {};
    const next = { ...prev, source: currentPageId(), projectId: state.activeProjectId };
    if (snapNum != null) next.projectSnapshotVersion = snapNum;
    else delete next.projectSnapshotVersion;
    App.RouterNav.setHandoff(next);
    await refreshEditorProjectVersionOptions();
    showToast(snapNum == null ? 'Loaded latest saved version.' : `Loaded snapshot v${snapNum}.`);
  }

  async function editorRestoreSelectedVersionAsLatest() {
    const sel = document.getElementById('editor-project-version-select');
    if (!sel || !state.activeProjectId) return showToast('No project linked.', true);
    const v = sel.value;
    const snapNum = v === 'current' ? null : Number(v);
    if (snapNum == null) {
      return showToast('Pick a past snapshot (not "Current saved"), then save it as the new latest.', true);
    }
    const project = await App.ProjectStore.get(state.activeProjectId);
    if (!project) return showToast('Project not found.', true);
    if (!state.newsletterWorkspace) state.newsletterWorkspace = emptyNewsletterWorkspaceShell();
    applyIndexedProjectToWorkspace(project, { snapshotVersion: snapNum });
    await saveProjectVersion();
  }

  async function saveCopy() {
    await saveDraft({ asCopy: true });
  }

  function pickDraftToLoad(id) {
    state.selectedDraftToLoad = id;
  }

  async function loadSelectedDraft() {
    const id = state.selectedDraftToLoad || document.getElementById('draft-select')?.value;
    if (!id) return showToast('Choose a draft first.', true);
    const draft = await App.DB.getDraftById(id);
    if (!draft?.workspace) return showToast('Selected draft has no workspace payload.', true);
    state.activeDraftId = draft.id;
    state.newsletterWorkspace = draft.workspace;
    state.selectedFormat = draft.workspace.format || state.selectedFormat;
    state.currentPreviewLanguage = draft.workspace.currentLanguage || 'en';
    applyMetadata({
      title: draft.title,
      issueDate: draft.issueDate,
      status: draft.status,
      campaignName: draft.campaignName,
      audience: draft.audience,
      owner: draft.owner
    });
    persistWorkspace();
    refreshLanguageControls();
    document.getElementById('preview-panel').classList.add('active');
    renderPreviewForLanguage(state.currentPreviewLanguage || 'en');
    await refreshDrafts();
    showToast('Draft loaded.');
  }

  async function loadDraftById(id) {
    if (!id) return;
    state.selectedDraftToLoad = id;
    await loadSelectedDraft();
  }

  function navigateTo(sectionId, options = {}) {
    const keepPreview = options.keepPreview === true;
    if (!keepPreview) {
      const previewPanel = document.getElementById('preview-panel');
      if (previewPanel?.classList.contains('active')) closePreview();
    }
    const main = document.getElementById('main');
    const target = document.getElementById(sectionId);
    if (!main || !target) return;
    main.scrollTo({ top: Math.max(0, target.offsetTop - 14), behavior: 'smooth' });
  }

  function goHome() {
    try {
      if (document.getElementById('tpl-preview-modal')?.classList.contains('active')) closeTplPreview();
      if (document.getElementById('preview-panel')?.classList.contains('active')) closePreview();
      if (document.getElementById('editor-modal')?.classList.contains('active') && App.Editor?.close) App.Editor.close();
    } catch (e) {}
    if (App.RouterNav?.setHandoff) {
      const prev = App.RouterNav.getHandoff() || {};
      App.RouterNav.setHandoff({
        ...prev,
        source: currentPageId(),
        clearProjectContext: true
      });
    }
    navigateTo('section-home');
  }

  function currentPreviewVariant() {
    syncVariantFromPreviewDom(state.currentPreviewLanguage);
    if (state.newsletterWorkspace?.variants?.[state.currentPreviewLanguage]) {
      return normalizeVariant(state.newsletterWorkspace.variants[state.currentPreviewLanguage]);
    }
    return makeVariant(document.getElementById('nl-out')?.innerHTML || '', '');
  }

  function downloadCurrentHTML() {
    const variant = currentPreviewVariant();
    if (!variant.html) return showToast('No newsletter to download yet.', true);
    const file = `newsletter-${state.currentPreviewLanguage}.html`;
    downloadHTML(file, toStandaloneHtml(variant, state.currentPreviewLanguage));
    showToast(`Downloaded ${getLanguageLabel(state.currentPreviewLanguage)} HTML.`);
  }

  async function downloadAllHTML() {
    if (!state.newsletterWorkspace?.variants) return showToast('Generate newsletter first.', true);
    if (typeof JSZip === 'undefined') {
      showToast('ZIP library not loaded. Refresh the page and try again.', true);
      return;
    }
    try {
      const zip = new JSZip();
      const htmlFolder = zip.folder('html');
      const svgFolder = zip.folder('svg');
      let count = 0;
      NEWSLETTER_LANGUAGES.forEach(l => {
        const variant = normalizeVariant(state.newsletterWorkspace.variants[l.id]);
        if (!variant.html) return;
        const html = toStandaloneHtml(variant, l.id);
        htmlFolder.file(`newsletter-${l.id}.html`, html);
        svgFolder.file(`newsletter-${l.id}.svg`, htmlToSvgExport(html));
        count += 1;
      });
      if (!count) return showToast('No language files to export.', true);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `newsletter-export-${stamp}.zip`;
      downloadBlob(name, blob);
      showToast(`Downloaded ${name} (folders html/ and svg/)`);
    } catch (e) {
      showToast('Could not build ZIP export.', true);
    }
  }

  function resetCurrentLanguage() {
    if (!state.newsletterWorkspace?.variants?.en) return;
    const lang = state.currentPreviewLanguage;
    if (lang === 'en') return showToast('English is the base template.', true);
    const ok = confirm(`Reset ${getLanguageLabel(lang)} to the English base template?`);
    if (!ok) return;
    const en = normalizeVariant(state.newsletterWorkspace.variants.en);
    state.newsletterWorkspace.variants[lang] = makeVariant(en.html, en.css, null);
    persistWorkspace();
    renderPreviewForLanguage(lang);
    showToast(`${getLanguageLabel(lang)} reset to English base.`);
  }

  function goToProjectsPage() {
    if (!App.RouterNav?.goto) return;
    App.RouterNav.goto('projects.html', {
      source: currentPageId(),
      activeDraftId: state.activeDraftId || null,
      projectId: state.activeProjectId || (state.activeDraftId ? `project_${state.activeDraftId}` : null)
    });
  }

  function currentPageId() {
    const page = (window.location?.pathname || '').split('/').pop() || 'index.html';
    return page.replace(/\.html$/i, '') || 'index';
  }

  function goToPreviewPage() {
    if (!App.RouterNav?.goto) return;
    const payload = { source: currentPageId(), projectId: state.activeProjectId || null };
    if (state.projectSnapshotVersion != null) payload.projectSnapshotVersion = state.projectSnapshotVersion;
    App.RouterNav.goto('preview.html', payload);
  }

  function goToHomePage() {
    if (!App.RouterNav?.goto) return;
    App.RouterNav.goto('index.html#section-home', {
      source: currentPageId(),
      clearProjectContext: true
    });
  }

  function goToEditorPage() {
    if (!App.RouterNav?.goto) return;
    const payload = { source: currentPageId(), projectId: state.activeProjectId || null };
    if (state.projectSnapshotVersion != null) payload.projectSnapshotVersion = state.projectSnapshotVersion;
    App.RouterNav.goto('editor.html', payload);
  }

  function goToSendPage() {
    if (!App.RouterNav?.goto) return;
    const payload = { source: currentPageId(), projectId: state.activeProjectId || null };
    if (state.projectSnapshotVersion != null) payload.projectSnapshotVersion = state.projectSnapshotVersion;
    App.RouterNav.goto('send.html', payload);
  }

  async function saveSMTPConfig(options = {}) {
    const { silent = false } = options;
    const cfg = getSMTPConfigFromUI();
    const method = App.DeliveryHelpers.normalizeMethod(cfg);
    if (!cfg.relayUrl?.trim()) {
      if (!silent) showToast('Relay endpoint URL is required.', true);
      return;
    }
    if (!cfg.fromAddress) {
      if (!silent) showToast('From email is required.', true);
      return;
    }
    if (method === App.DeliveryHelpers.METHOD_GRAPH) {
      if (!cfg.graphTenantId?.trim() || !cfg.graphClientId?.trim() || !cfg.graphClientSecret?.trim()) {
        if (!silent) showToast('Microsoft Graph requires tenant ID, client ID, and client secret.', true);
        return;
      }
    } else if (!cfg.host?.trim()) {
      if (!silent) showToast('SMTP host is required when using SMTP delivery.', true);
      return;
    }
    await App.DB.saveSMTPProfile(cfg);
    localStorage.setItem(SMTP_STORAGE_KEY, JSON.stringify(cfg));
    state.smtpProfile = cfg;
    clearUnsavedChanges();
    if (!silent) showToast('SMTP configuration saved.');
  }

  function collectSMTPDiagnostics({ mode, recipients = [] } = {}) {
    const cfg = state.smtpProfile || getSMTPConfigFromUI();
    const workflowState = normalizeWorkflow(state.newsletterWorkspace?.workflow).state;
    return App.DeliveryHelpers.collectDiagnostics(cfg, { mode, recipients, workflowState });
  }

  function reportSMTPDiagnostics(mode, diagnostics) {
    const failed = diagnostics.filter(item => !item.ok);
    if (!failed.length) return '';
    const header = mode === 'test' ? 'Delivery test preflight failed:' : 'Newsletter send preflight failed:';
    return `${header}\n${failed.map(item => `- ${item.label}: ${item.action}`).join('\n')}`;
  }

  async function callRelay(payload) {
    const cfg = state.smtpProfile || getSMTPConfigFromUI();
    if (!cfg.relayUrl) throw new Error('Relay endpoint URL is required.');
    const res = await fetch(cfg.relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Relay failed (${res.status})`);
    return res.json().catch(() => ({}));
  }

  async function sendTestEmail() {
    try {
      const cfg = state.smtpProfile || getSMTPConfigFromUI();
      const to = document.getElementById('smtp-test-to')?.value?.trim();
      if (!to) return showToast('Add a test recipient email.', true);
      const diagnostics = collectSMTPDiagnostics({ mode: 'test', recipients: [to] });
      const preflightError = reportSMTPDiagnostics('test', diagnostics);
      if (preflightError) throw new Error(preflightError);
      await saveSMTPConfig();
      await App.DB.addDeliveryLog({ draftId: state.activeDraftId, draftTitle: getMetadata().title, action: 'test', status: 'queued', recipients: to, language: 'en' });
      const delivery = App.DeliveryHelpers.buildRelayDeliveryPayload(cfg);
      const label = App.DeliveryHelpers.relayKindLabel(cfg);
      const result = await callRelay({
        mode: 'test',
        delivery,
        smtp: cfg,
        to: [to],
        subject: `[Test] Awareness ${label} configuration`,
        text: `${label} relay test from Awareness newsletter workspace.`
      });
      await App.DB.addDeliveryLog({ draftId: state.activeDraftId, draftTitle: getMetadata().title, action: 'test', status: 'sent', recipients: to, language: 'en', messageId: result?.messageId || '' });
      await refreshDeliveryLogs();
      showToast('Test email sent.');
    } catch (e) {
      await App.DB.addDeliveryLog({ draftId: state.activeDraftId, draftTitle: getMetadata().title, action: 'test', status: 'failed', recipients: document.getElementById('smtp-test-to')?.value?.trim() || '', language: 'en', error: e.message });
      await refreshDeliveryLogs();
      showToast(`Test email failed: ${e.message}`, true);
    }
  }

  async function sendNewsletter() {
    if (!state.newsletterWorkspace?.variants?.[state.currentPreviewLanguage]?.html) return showToast('Generate a newsletter first.', true);
    const recipientsRaw = document.getElementById('smtp-send-to')?.value || '';
    const recipients = recipientsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (!recipients.length) return showToast('Add at least one recipient.', true);
    try {
      const diagnostics = collectSMTPDiagnostics({ mode: 'send', recipients });
      const preflightError = reportSMTPDiagnostics('send', diagnostics);
      if (preflightError) throw new Error(preflightError);
      await saveSMTPConfig();
      const variant = currentPreviewVariant();
      const meta = getMetadata();
      const subject = `${meta.title || 'Security Awareness Newsletter'} (${getLanguageLabel(state.currentPreviewLanguage)})`;
      await App.DB.addDeliveryLog({ draftId: state.activeDraftId, draftTitle: meta.title, action: 'send', status: 'queued', recipients: recipients.join(', '), subject, language: state.currentPreviewLanguage });
      const delivery = App.DeliveryHelpers.buildRelayDeliveryPayload(state.smtpProfile || getSMTPConfigFromUI());
      const result = await callRelay({
        mode: 'send',
        delivery,
        smtp: state.smtpProfile || getSMTPConfigFromUI(),
        to: recipients,
        subject,
        html: toStandaloneHtml(variant, state.currentPreviewLanguage),
        metadata: { draftId: state.activeDraftId, language: state.currentPreviewLanguage }
      });
      await App.DB.addDeliveryLog({ draftId: state.activeDraftId, draftTitle: meta.title, action: 'send', status: 'sent', recipients: recipients.join(', '), subject, language: state.currentPreviewLanguage, messageId: result?.messageId || '' });
      const statusEl = document.getElementById('meta-status');
      if (statusEl) statusEl.value = 'sent';
      await refreshDeliveryLogs();
      showToast('Newsletter sent.');
    } catch (e) {
      await App.DB.addDeliveryLog({ draftId: state.activeDraftId, draftTitle: getMetadata().title, action: 'send', status: 'failed', recipients: recipients.join(', '), subject: getMetadata().title, language: state.currentPreviewLanguage, error: e.message });
      await refreshDeliveryLogs();
      showToast(`Send failed: ${e.message}`, true);
    }
  }

  async function translatePlainTextWithAI(text, sourceLangId, targetLangId, provider, apiKey) {
    if (!apiKey) throw new Error('AI API key is required for translation.');
    const sourceLanguageName = getLanguageLabel(sourceLangId);
    const targetLanguageName = getLanguageLabel(targetLangId);
    const originalFull = String(text || '').slice(0, 4000);
    const split = TranslationMetrics.splitDecorativeLead(originalFull);
    let proseSource = originalFull;
    let deco = '';
    if (split.deco && TranslationMetrics.hasTranslatableLetters(split.rest)) {
      deco = split.deco;
      proseSource = split.rest.trimStart();
    }
    if (!TranslationMetrics.hasTranslatableLetters(proseSource)) return originalFull;
    if (typeof window !== 'undefined' && window.__AWARENESS_E2E_SEG_TRANSLATE === '1') {
      return `⟨e2e⟩${originalFull}`;
    }
    if (typeof window !== 'undefined' && window.__AWARENESS_E2E_SEG_TRANSLATE === 'echo') {
      return originalFull;
    }
    const finalizeSeg = (raw) => TranslationMetrics.normalizeTranslatedTextSegment(raw, proseSource);
    const strictPrompt = (mode = 'normal') =>
      `Translate the text inside <source> from ${sourceLanguageName} into ${targetLanguageName}. Use fluent ${targetLanguageName} suitable for native readers (locale code: ${targetLangId}).
Rules:
- Return ONLY the translation text, no explanations.
- Never ask for more text.
- Keep URLs, emails, codes, and placeholders unchanged.
- If the segment is already natural ${targetLanguageName}, return it unchanged.
- When <source> is a single line, output a single line (no newlines, no markdown list markers like "- " or "* " at the start).
<source>${proseSource}</source>
${mode === 'retry' ? 'If unsure, still return best-effort translation only.' : ''}`;

    const isBadTranslationOutput = (output, src) => {
      const out = String(output || '').trim();
      if (!out) return true;
      const badPatterns = [
        /i'?m sorry/i,
        /please provide/i,
        /need the text/i,
        /want translated/i,
        /cannot translate/i
      ];
      if (badPatterns.some(re => re.test(out))) return true;
      if (src.trim().length < 140 && out.length > src.trim().length * 3) return true;
      return false;
    };

    if (provider === 'openai') {
      const resp = await fetchWithTranslationRetry('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          messages: [
            { role: 'system', content: `${App.AISummarizer.EMPLOYEE_VOICE_BLOCK}\n\nYou are a precise translation engine. Output only translated text.` },
            { role: 'user', content: strictPrompt() }
          ]
        })
      });
      if (!resp.ok) throw new Error(`OpenAI translate failed (${resp.status})`);
      const data = await resp.json();
      let out = (data?.choices?.[0]?.message?.content || '').trim() || proseSource;
      if (isBadTranslationOutput(out, proseSource)) {
        const retry = await fetchWithTranslationRetry('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.0,
            messages: [
              { role: 'system', content: `${App.AISummarizer.EMPLOYEE_VOICE_BLOCK}\n\nReturn translated text only. No commentary.` },
              { role: 'user', content: strictPrompt('retry') }
            ]
          })
        });
        if (retry.ok) {
          const retryData = await retry.json();
          const retryOut = (retryData?.choices?.[0]?.message?.content || '').trim();
          if (!isBadTranslationOutput(retryOut, proseSource)) out = retryOut;
        }
      }
      if (isBadTranslationOutput(out, proseSource)) throw new Error('Invalid model translation output');
      const core = finalizeSeg(out);
      return deco ? deco + core.trimStart() : core;
    }

    const claudeModels = ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-3-5-sonnet-latest'];
    let lastMessage = 'unknown error';
    for (const model of claudeModels) {
      const resp = await fetchWithTranslationRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          temperature: 0.1,
          system: `${App.AISummarizer.EMPLOYEE_VOICE_BLOCK}\n\nYou are a precise translation engine. Output only translated text.`,
          messages: [{ role: 'user', content: strictPrompt() }]
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        let out = (data?.content?.[0]?.text || '').trim() || proseSource;
        if (isBadTranslationOutput(out, proseSource)) {
          const retryResp = await fetchWithTranslationRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model,
              max_tokens: 1200,
              temperature: 0.0,
              system: `${App.AISummarizer.EMPLOYEE_VOICE_BLOCK}\n\nReturn translated text only. No commentary.`,
              messages: [{ role: 'user', content: strictPrompt('retry') }]
            })
          });
          if (retryResp.ok) {
            const retryData = await retryResp.json();
            const retryOut = (retryData?.content?.[0]?.text || '').trim();
            if (!isBadTranslationOutput(retryOut, proseSource)) out = retryOut;
          }
        }
        if (isBadTranslationOutput(out, proseSource)) throw new Error('Invalid model translation output');
        const core = finalizeSeg(out);
        return deco ? deco + core.trimStart() : core;
      }
      let errMsg = `HTTP ${resp.status}`;
      try {
        const errData = await resp.json();
        errMsg = errData?.error?.message || errData?.message || errMsg;
      } catch (e) {}
      lastMessage = `${model}: ${errMsg}`;
      if (!/invalid model|model.*not found|unknown model/i.test(errMsg)) {
        break;
      }
    }
    throw new Error(`Claude translate failed (${lastMessage})`);
  }

  async function translatePlainTextAIFirst(text, sourceLangId, targetLangId, provider, aiKey) {
    const locked = protectTokens(String(text || ''));
    const src = locked.html;
    const aiOut = await translatePlainTextWithAI(src, sourceLangId, targetLangId, provider, aiKey);
    return restoreTokens(applyGlossaryLock(aiOut), locked.protectedTokens);
  }

  /**
   * Editor: translate one element's text from sourceLangId into every other workspace variant
   * at the same mirror path (structure must match across languages).
   */
  async function syncNewsletterElementTextToAllLanguages({ path, relPath, text, sourceLangId }) {
    if (!state.newsletterWorkspace?.variants) throw new Error('Generate newsletter first.');
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('No text to translate.');
    if ((!path || !path.length) && (!relPath || !relPath.length)) {
      throw new Error('Could not resolve this block in other languages.');
    }
    const provider = document.getElementById('ai-provider')?.value || 'claude';
    const aiKey = document.getElementById('ai-key')?.value?.trim() || '';
    if (!aiKey) throw new Error('Add an AI API key first.');
    const targets = NEWSLETTER_LANGUAGES.filter(l => l.id !== sourceLangId);
    let updated = 0;
    let failed = 0;
    state.translationPendingLang = { id: sourceLangId, label: getLanguageLabel(sourceLangId) };
    for (const lang of targets) {
      let outText = trimmed;
      if (TranslationMetrics.hasTranslatableLetters(trimmed)) {
        try {
          outText = await translatePlainTextAIFirst(trimmed, sourceLangId, lang.id, provider, aiKey);
        } catch (err) {
          state.translationPendingLang = { id: lang.id, label: lang.label };
          throw err;
        }
      }
      const v = normalizeVariant(state.newsletterWorkspace.variants[lang.id]);
      const raw = (v.html || '').trim();
      if (!raw) {
        failed += 1;
        continue;
      }
      const r = App.Utils.updateNewsletterNodeTextByMirrorPath(raw, path, relPath, outText, 5);
      if (r.updated) {
        state.newsletterWorkspace.variants[lang.id] = makeVariant(r.html, v.css, null);
        updated += 1;
      } else {
        failed += 1;
      }
    }
    state.translationPendingLang = null;
    persistWorkspace();
    const lid = state.currentPreviewLanguage || 'en';
    renderPreviewForLanguage(lid);
    return { updated, failed };
  }

  const GLOSSARY_LOCK = {
    en: {
      phishing: 'phishing',
      smishing: 'smishing',
      vishing: 'vishing',
      'multi-factor authentication': 'multi-factor authentication',
      mfa: 'MFA'
    }
  };
  const GLOSSARY_LOCK_TERM_LIST = [...new Set(Object.values(GLOSSARY_LOCK.en).map((t) => String(t || '').trim()).filter(Boolean))];

  function protectTokens(html) {
    const protectedTokens = [];
    let out = html;
    const patterns = [
      /https?:\/\/[^\s"'<>]+/g,
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      /\b[A-Z]{2,}-\d{3,}\b/g
    ];
    patterns.forEach(re => {
      out = out.replace(re, token => {
        const key = `__LOCK_${protectedTokens.length}__`;
        protectedTokens.push({ key, token });
        return key;
      });
    });
    return { html: out, protectedTokens };
  }

  function restoreTokens(html, protectedTokens = []) {
    let out = html;
    protectedTokens.forEach(t => { out = out.replaceAll(t.key, t.token); });
    return out;
  }

  function applyGlossaryLock(html) {
    let out = html;
    Object.values(GLOSSARY_LOCK.en).forEach(term => {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      out = out.replace(re, term);
    });
    return out;
  }

  function qaCheckTranslatedHtml(sourceHtml, translatedHtml) {
    const checks = [];
    const srcLinks = (sourceHtml.match(/https?:\/\/[^\s"'<>]+/g) || []).length;
    const outLinks = (translatedHtml.match(/https?:\/\/[^\s"'<>]+/g) || []).length;
    checks.push({ id: 'link-count', ok: Math.abs(srcLinks - outLinks) <= 1, severity: 'critical', detail: `${outLinks}/${srcLinks} links preserved` });
    const srcTags = (sourceHtml.match(/<[^>]+>/g) || []).length;
    const outTags = (translatedHtml.match(/<[^>]+>/g) || []).length;
    checks.push({ id: 'html-shape', ok: Math.abs(srcTags - outTags) < 40, severity: 'advisory', detail: `${outTags}/${srcTags} tags` });
    const srcCta = /report|click|verify|urgent/i.test(sourceHtml);
    const outCta = /report|click|verify|urgent|reporte|clic|verif|urgente|rapport|klicken/i.test(translatedHtml);
    checks.push({ id: 'cta-presence', ok: !srcCta || outCta, severity: 'advisory', detail: 'CTA hint terms check' });
    return checks;
  }

  async function translateHtmlWithAI(html, targetLang, provider, apiKey) {
    if (!apiKey) throw new Error('AI API key is required for AI translation.');
    const targetLanguageName = getLanguageLabel(targetLang);
    const container = document.createElement('div');
    container.innerHTML = html;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parentTag = node.parentElement?.tagName;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (parentTag === 'STYLE' || parentTag === 'SCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) nodes.push(current);
    if (!nodes.length) return html;

    const isBadTranslationOutput = (output, source) => {
      const out = String(output || '').trim();
      if (!out) return true;
      const badPatterns = [
        /i'?m sorry/i,
        /please provide/i,
        /need the text/i,
        /want translated/i,
        /cannot translate/i
      ];
      if (badPatterns.some(re => re.test(out))) return true;
      // If model returns a long instruction-like response for short source, reject it.
      if (source.trim().length < 140 && out.length > source.trim().length * 3) return true;
      return false;
    };

    const translateOne = async (text) => {
      const originalFull = String(text || '').slice(0, 1200);
      const split = TranslationMetrics.splitDecorativeLead(originalFull);
      let proseSource = originalFull;
      let deco = '';
      if (split.deco && TranslationMetrics.hasTranslatableLetters(split.rest)) {
        deco = split.deco;
        proseSource = split.rest.trimStart();
      }
      if (!TranslationMetrics.hasTranslatableLetters(proseSource)) return originalFull;
      if (typeof window !== 'undefined' && window.__AWARENESS_E2E_SEG_TRANSLATE === '1') {
        return `⟨e2e⟩${originalFull}`;
      }
      if (typeof window !== 'undefined' && window.__AWARENESS_E2E_SEG_TRANSLATE === 'echo') {
        return originalFull;
      }
      const strictPrompt = (mode = 'normal') =>
        `Translate the text inside <source> from English into ${targetLanguageName}. Use fluent ${targetLanguageName} suitable for native readers (locale code: ${targetLang}).
Rules:
- Return ONLY the translation text, no explanations.
- Never ask for more text.
- Keep URLs, emails, codes, and placeholders unchanged.
- If the segment is already natural ${targetLanguageName}, return it unchanged.
- When <source> has no line breaks, output a single line only (no newline characters, no markdown list markers like "- " or "* " — list formatting is already in the HTML).
<source>${proseSource}</source>
${mode === 'retry' ? 'If unsure, still return best-effort translation only.' : ''}`;

      const finalizeSeg = (raw) => TranslationMetrics.normalizeTranslatedTextSegment(raw, proseSource);

      if (provider === 'openai') {
        const resp = await fetchWithTranslationRetry('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.1,
            messages: [
              { role: 'system', content: `${App.AISummarizer.EMPLOYEE_VOICE_BLOCK}\n\nYou are a precise translation engine. Output only translated text.` },
              { role: 'user', content: strictPrompt() }
            ]
          })
        });
        if (!resp.ok) throw new Error(`OpenAI translate failed (${resp.status})`);
        const data = await resp.json();
        let out = (data?.choices?.[0]?.message?.content || '').trim() || proseSource;
        if (isBadTranslationOutput(out, proseSource)) {
          const retry = await fetchWithTranslationRetry('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              temperature: 0.0,
              messages: [
                { role: 'system', content: `${App.AISummarizer.EMPLOYEE_VOICE_BLOCK}\n\nReturn translated text only. No commentary.` },
                { role: 'user', content: strictPrompt('retry') }
              ]
            })
          });
          if (retry.ok) {
            const retryData = await retry.json();
            const retryOut = (retryData?.choices?.[0]?.message?.content || '').trim();
            if (!isBadTranslationOutput(retryOut, proseSource)) out = retryOut;
          }
        }
        if (isBadTranslationOutput(out, proseSource)) throw new Error('Invalid model translation output');
        const core = finalizeSeg(out);
        return deco ? deco + core.trimStart() : core;
      }

      const claudeModels = ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-3-5-sonnet-latest'];
      let lastMessage = 'unknown error';
      for (const model of claudeModels) {
        const resp = await fetchWithTranslationRetry('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model,
            max_tokens: 900,
            temperature: 0.1,
            system: `${App.AISummarizer.EMPLOYEE_VOICE_BLOCK}\n\nYou are a precise translation engine. Output only translated text.`,
            messages: [{ role: 'user', content: strictPrompt() }]
          })
        });
        if (resp.ok) {
          const data = await resp.json();
          let out = (data?.content?.[0]?.text || '').trim() || proseSource;
          if (isBadTranslationOutput(out, proseSource)) {
            const retryResp = await fetchWithTranslationRetry('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
              },
              body: JSON.stringify({
                model,
                max_tokens: 900,
                temperature: 0.0,
                system: `${App.AISummarizer.EMPLOYEE_VOICE_BLOCK}\n\nReturn translated text only. No commentary.`,
                messages: [{ role: 'user', content: strictPrompt('retry') }]
              })
            });
            if (retryResp.ok) {
              const retryData = await retryResp.json();
              const retryOut = (retryData?.content?.[0]?.text || '').trim();
              if (!isBadTranslationOutput(retryOut, proseSource)) out = retryOut;
            }
          }
          if (isBadTranslationOutput(out, proseSource)) throw new Error('Invalid model translation output');
          const core = finalizeSeg(out);
          return deco ? deco + core.trimStart() : core;
        }
        let errMsg = `HTTP ${resp.status}`;
        try {
          const errData = await resp.json();
          errMsg = errData?.error?.message || errData?.message || errMsg;
        } catch (e) {}
        lastMessage = `${model}: ${errMsg}`;
        if (!/invalid model|model.*not found|unknown model/i.test(errMsg)) {
          break;
        }
      }
      throw new Error(`Claude translate failed (${lastMessage})`);
    };

    // Faster processing: parallel workers with bounded concurrency.
    let lastErr = null;
    const results = [];
    const workItems = nodes
      .map((node, index) => ({ node, index, original: node.nodeValue }))
      .filter(item => item.original && item.original.trim()
        && TranslationMetrics.hasTranslatableLetters(item.original)
        && TranslationMetrics.countsTowardCoverageProgress(item.original));
    if (!workItems.length) return html;
    const concurrency = provider === 'openai' ? 5 : 4;
    let cursor = 0;

    async function worker() {
      while (cursor < workItems.length) {
        const idx = cursor++;
        const item = workItems[idx];
        const result = {
          attempted: true,
          translatable: true,
          changed: false,
          failed: false
        };
        try {
          const translated = await translateOne(item.original);
          item.node.nodeValue = translated;
          result.changed = TranslationMetrics.hasMeaningfulTextChange(item.original, translated);
        } catch (e) {
          lastErr = e;
          result.failed = true;
          item.node.nodeValue = item.original;
        }
        results.push(result);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, workItems.length || 1) }, () => worker()));
    const coverage = TranslationMetrics.coverageFromResults(results);
    if (coverage.attempted > 0 && coverage.succeeded === 0) {
      recordTranslationFailure({
        kind: 'coverage',
        gate: 'segment-coverage',
        languageId: state.translationPendingLang?.id || null,
        languageLabel: state.translationPendingLang?.label || null,
        coverage,
        lastProviderMessage: lastErr?.message || '',
        message: '[gate:coverage] No substantive segments translated.'
      });
      throw new Error(`[gate:coverage] No text segments were translated (${coverage.attempted} attempted, ${coverage.unchanged} unchanged). Last provider error: ${TranslationMetrics.sanitizeProviderMessage(lastErr?.message || 'unknown error')}`);
    }
    if (coverage.attempted > 0 && coverage.ratio < 0.5) {
      recordTranslationFailure({
        kind: 'coverage',
        gate: 'segment-coverage',
        languageId: state.translationPendingLang?.id || null,
        languageLabel: state.translationPendingLang?.label || null,
        coverage,
        lastProviderMessage: lastErr?.message || '',
        message: '[gate:coverage] Low coverage across substantive segments.'
      });
      throw new Error(`[gate:coverage] Low translation coverage: ${coverage.succeeded}/${coverage.attempted} segments translated.`);
    }
    return container.innerHTML;
  }

  async function translateHtmlAIFirst(html, targetLang, provider, aiKey) {
    const locked = protectTokens(html);
    const source = locked.html;
    const aiOut = await translateHtmlWithAI(source, targetLang, provider, aiKey);
    return restoreTokens(applyGlossaryLock(aiOut), locked.protectedTokens);
  }

  async function translateWorkspaceFromEnglish({
    overwrite = true,
    progressLabel = '',
    progressCompletedBase = 0,
    progressTotal = null
  } = {}) {
    if (!state.newsletterWorkspace?.variants?.en) throw new Error('Generate newsletter first.');
    const provider = document.getElementById('ai-provider')?.value || 'claude';
    const aiKey = document.getElementById('ai-key')?.value?.trim() || '';
    if (!aiKey) throw new Error('Add AI API key for translation.');

    const sourceVariant = normalizeVariant(state.newsletterWorkspace.variants.en);
    const targets = NEWSLETTER_LANGUAGES.filter(l => l.id !== 'en' && (overwrite || isVariantUntranslated(l.id)));
    const translationSteps = targets.length;
    const totalBar = progressTotal != null ? progressTotal : Math.max(1, translationSteps);
    let done = progressCompletedBase;
    setTranslateProgress(true, done, totalBar, `${progressLabel || 'Translating'}: preparing`, 'Translation in progress');
    let firstTranslatedLang = null;
    try {
      for (const lang of targets) {
        state.translationPendingLang = { id: lang.id, label: lang.label };
        const signature = translationSignature(lang.id, sourceVariant.html, sourceVariant.css || '');
        if (state.translationCache[signature]) {
          state.newsletterWorkspace.variants[lang.id] = normalizeVariant(state.translationCache[signature]);
          done += 1;
          if (!firstTranslatedLang) firstTranslatedLang = lang.id;
          setTranslateProgress(true, done, totalBar, `${progressLabel || 'Translating'}: ${lang.label} (cached)`, 'Translation in progress');
          continue;
        }
        if (progressLabel) {
          const fetchEl = document.getElementById('fetch-st');
          if (fetchEl) fetchEl.textContent = `${progressLabel}: ${lang.label}`;
        }
        setTranslateProgress(true, done, totalBar, `${progressLabel || 'Translating'}: ${lang.label}`, 'Translation in progress');
        const translatedHtml = await translateHtmlAIFirst(sourceVariant.html, lang.id, provider, aiKey);
        if (!TranslationMetrics.hasMeaningfulTextChangeAllowingLockedTerms(sourceVariant.html, translatedHtml, GLOSSARY_LOCK_TERM_LIST)) {
          recordTranslationFailure({
            kind: 'docUnchanged',
            gate: 'docUnchanged',
            languageId: lang.id,
            languageLabel: lang.label,
            message: '[gate:docUnchanged] Visible text unchanged after glossary-invariant stripping.'
          });
          throw new Error(`[gate:docUnchanged] ${lang.label} translation returned unchanged visible text (after ignoring glossary-invariant terms).`);
        }
        const checks = qaCheckTranslatedHtml(sourceVariant.html, translatedHtml);
        const failed = checks.filter(c => !c.ok && c.severity === 'critical');
        if (failed.length) {
          recordTranslationFailure({
            kind: 'qa',
            gate: 'qa',
            languageId: lang.id,
            languageLabel: lang.label,
            message: `[gate:qa] Critical QA: ${failed.map(f => f.id).join(', ')}`
          });
          throw new Error(`[gate:qa] ${lang.label} QA checks failed: ${failed.map(f => f.id).join(', ')}`);
        }
        state.newsletterWorkspace.variants[lang.id] = makeVariant(translatedHtml, sourceVariant.css, {
          translatedFrom: 'en',
          provider,
          translatedAt: new Date().toISOString()
        });
        state.translationCache[signature] = state.newsletterWorkspace.variants[lang.id];
        if (!firstTranslatedLang) firstTranslatedLang = lang.id;
        done += 1;
        setTranslateProgress(true, done, totalBar, `${progressLabel || 'Translating'}: ${lang.label}`, 'Translation in progress');
      }
      persistWorkspace();
      return firstTranslatedLang;
    } finally {
      setTranslateProgress(false);
    }
  }

  async function autoTranslateNewsletter() {
    if (!state.newsletterWorkspace?.variants?.en) return showToast('Generate newsletter first, then translate.', true);
    const confirmOverwrite = confirm('Auto-translate all non-English variants from the current English version? Existing non-English text will be overwritten.');
    if (!confirmOverwrite) return;
    try {
      const firstTranslatedLang = await translateWorkspaceFromEnglish({ overwrite: true, progressLabel: 'Translating' });
      // Instantly showcase a translated version in preview.
      const current = state.currentPreviewLanguage || 'en';
      const targetPreviewLang = current !== 'en' ? current : (firstTranslatedLang || 'en');
      state.currentPreviewLanguage = targetPreviewLang;
      if (state.newsletterWorkspace) state.newsletterWorkspace.currentLanguage = targetPreviewLang;
      persistWorkspace();
      renderPreviewForLanguage(targetPreviewLang);
      showToast(`Translations ready. Showing ${getLanguageLabel(targetPreviewLang)} preview.`);
    } catch (e) {
      showToast(`Translation failed: ${e.message}`, true);
      if (!state.translationLastFailure) {
        recordTranslationFailure({
          message: e.message,
          kind: TranslationMetrics.classifyTranslationFailureKind(e.message)
        });
      }
      renderTranslationFailureState(e.message);
    }
  }

  function copyCurrentHTML() {
    const variant = currentPreviewVariant();
    const html = renderVariantHtml(variant);
    copyHTML('nl-out', html);
  }

  function updateAIDisplay() {}

  function initUnsavedChangeGuard() {
    if (window.__awarenessUnsavedGuardBound) return;
    window.__awarenessUnsavedGuardBound = true;
    document.addEventListener('input', (event) => {
      const el = event.target;
      if (!el) return;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') flagUnsavedChanges(true);
    }, true);
    document.addEventListener('change', (event) => {
      const el = event.target;
      if (!el) return;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') flagUnsavedChanges(true);
    }, true);
    window.addEventListener('beforeunload', (event) => {
      if (state.suppressUnsavedPrompt || !state.unsavedChanges) return;
      event.preventDefault();
      event.returnValue = 'You have unsaved changes. Leave this page?';
    });
  }

  function init() {
    loadWorkspace();
    renderFeedStats(); renderFeedDashboard(); renderSidebarFeeds(); renderDBStats();
    applyCurationMode(getCurationMode());
    renderFetchTelemetryPanel();
    renderSidebarKeywordManager();
    refreshLanguageControls();
    renderWorkflowControls();
    refreshDrafts();
    refreshDeliveryLogs();
    if (state.newsletterWorkspace?.variants) renderPreviewForLanguage(state.currentPreviewLanguage || 'en');
    const issueDateEl = document.getElementById('meta-issue-date');
    if (issueDateEl && !issueDateEl.value) issueDateEl.value = new Date().toISOString().split('T')[0];
    try {
      const fromStorage = JSON.parse(localStorage.getItem(SMTP_STORAGE_KEY) || 'null');
      if (fromStorage) { state.smtpProfile = fromStorage; applySMTPConfig(fromStorage); }
    } catch (e) {}
    try {
      const aiSettings = JSON.parse(localStorage.getItem(AI_SETTINGS_STORAGE_KEY) || 'null');
      if (aiSettings) {
        applyAISettings(aiSettings);
        try {
          App.AISummarizer?.configure?.({
            provider: aiSettings.provider || 'claude',
            claudeKey: aiSettings.aiKey || '',
            openaiKey: aiSettings.aiKey || ''
          });
        } catch (e) {}
      }
    } catch (e) {}
    try {
      const aiExperiment = JSON.parse(localStorage.getItem(AI_EXPERIMENT_CONTROL_STORAGE_KEY) || 'null');
      applyAIExperimentControl(aiExperiment || defaultAIExperimentControl());
    } catch (e) {
      applyAIExperimentControl(defaultAIExperimentControl());
    }
    try {
      const centralCfg = JSON.parse(localStorage.getItem(CENTRAL_CONFIG_STORAGE_KEY) || 'null');
      if (centralCfg) applyCentralConfigBundle(centralCfg);
    } catch (e) {}
    App.DB.getSMTPProfile('default').then(p => { if (p) { state.smtpProfile = p; applySMTPConfig(p); } }).catch(() => {});
    const maxSel = document.getElementById('cfg-max');
    if (maxSel) { maxSel.addEventListener('change', () => { const ml = document.getElementById('max-lbl'); if (ml) ml.textContent = maxSel.value; }); }
    App.DB.open().then(() => {
      loadFromDB();
    }).catch(() => {});
    try { G.particleBackground('sidebar'); } catch(e) {}
    renderArticleStats([], []);
    renderAIRollbackBanner();
    initUnsavedChangeGuard();
    initDeliveryMethodUI();
    if (currentPageId() === 'editor' && state.activeProjectId) {
      setTimeout(() => { refreshEditorProjectVersionOptions().catch(() => {}); }, 600);
    }
  }

  function go() {}

  const SAMPLE_ARTICLES = [
    { title: 'New Phishing Scam Impersonates IT Department — Asks Staff to "Verify" Passwords', source: 'Bleeping Computer', sourceId: 'bleeping', url: '#', type: 'Phishing', pubDate: new Date().toISOString().split('T')[0], summary: 'A new phishing campaign is sending fake emails that look like they come from your IT department, asking you to click a link and "verify" your password. The emails use your company logo and even address you by name — but the link leads to a fake login page that steals your credentials.', watchouts: ["Never click password reset links you didn't request", 'Check the sender\'s full email address carefully', 'Report suspicious IT emails to security team'], threatLevel: 4, aiProcessed: true, relevanceScore: 15 },
    { title: 'Employees Tricked by Fake "Missed Delivery" Text Messages — Smishing on the Rise', source: 'The Hacker News', sourceId: 'hackernews', url: '#', type: 'Smishing', pubDate: new Date().toISOString().split('T')[0], summary: 'Scammers are sending text messages pretending to be from delivery companies like FedEx and DHL, claiming you have a missed package. The link in the text leads to a page that asks for your credit card details. This type of attack is called "smishing" — phishing via SMS.', watchouts: ["Don't click links in unexpected text messages", 'Call the delivery company directly if unsure', 'Delete suspicious texts and report to IT'], threatLevel: 3, aiProcessed: true, relevanceScore: 12 },
    { title: 'Major Data Breach Exposes 2 Million Customer Records — Change Your Passwords Now', source: 'KrebsOnSecurity', sourceId: 'krebs', url: '#', type: 'Data Breach', pubDate: new Date().toISOString().split('T')[0], summary: 'A large retail company has confirmed that hackers stole personal data including names, email addresses, and encrypted passwords of 2 million customers. If you have an account with this service, change your password immediately and enable two-factor authentication.', watchouts: ['Change your password for affected accounts now', 'Turn on two-step login (MFA) everywhere', 'Watch your accounts for unusual activity'], threatLevel: 5, aiProcessed: true, relevanceScore: 18 }
  ];

  let _previewingFmt = null;

  function previewTemplate(fmtId, fmtName) {
    _previewingFmt = fmtId;
    const cfg = getConfig();
    const opts = { useLinks: true, usePoster: true, useQR: false, useIllus: true };
    const arts = SAMPLE_ARTICLES.slice(0, Math.min(cfg.max, 3));
    const html = App.NewsletterBuilder.build(fmtId, cfg, arts, opts);
    document.getElementById('tpl-preview-out').innerHTML = html;
    document.getElementById('tpl-preview-title').textContent = `Preview \u2014 ${fmtName || fmtId}`;
    document.getElementById('tpl-preview-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeTplPreview() {
    document.getElementById('tpl-preview-modal').classList.remove('active');
    document.body.style.overflow = '';
    _previewingFmt = null;
  }

  function selectFromPreview() {
    if (_previewingFmt) {
      state.selectedFormat = _previewingFmt;
      document.querySelectorAll('.fmt-card').forEach(c => { c.classList.toggle('sel', c.getAttribute('data-fmt') === _previewingFmt); });
      showToast(`Template "${_previewingFmt}" selected!`);
    }
    closeTplPreview();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('tpl-preview-modal')?.classList.contains('active')) closeTplPreview();
      else if (document.getElementById('editor-modal')?.classList.contains('active')) App.Editor.close();
    }
  });

  return {
    state, go, closePreview, pickFormat, setDuration, setFilter, setArticleKeywordSearch,
    setArticleSort,
    toggleArticle, loadArticles, loadFromDB, clearDB,
    buildAndPreview, init, updateAIDisplay, getConfig, getOptions,
    previewTemplate, closeTplPreview, selectFromPreview,
    toggleSec, switchPreviewLanguage,
    openEditor,
    navigateTo, goHome, loadDraftById, goToProjectsPage,
    goToPreviewPage, goToHomePage, goToEditorPage, goToSendPage,
    transitionWorkflow, openWorkflowHistory,
    saveDraft, saveCopy, saveProjectVersion, loadSelectedDraft, pickDraftToLoad,
    editorLoadSelectedProjectVersion, editorRestoreSelectedVersionAsLatest,
    saveSMTPConfig, sendTestEmail, sendNewsletter,
    saveAISettings, saveAIExperimentControl, triggerAIRollback, exportAIExperimentEvidence, saveCentralConfig,
    addSidebarCriticalKeyword, addSidebarContextKeyword, addSidebarNoiseKeyword,
    removeSidebarCriticalKeyword, removeSidebarContextKeyword, removeSidebarNoiseKeyword,
    resetSidebarKeywords,
    addFeedSource, removeFeedSource,
    applyCurationMode, flagCurationFeedback,
    downloadCurrentHTML, downloadAllHTML, autoTranslateNewsletter,
    retryTranslationPipeline,
    syncNewsletterElementTextToAllLanguages,
    getTranslationDiagSnapshot: () => state.translationLastFailure,
    copyHTML: copyCurrentHTML
  };
})();
