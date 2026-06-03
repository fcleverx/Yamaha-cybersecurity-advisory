/* ═══════════════════════════════════════════════════════════
   utils.js — Shared utilities for the Security Awareness App
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

App.Utils = (() => {
  'use strict';

  // ── Logging ──
  const logEl = () => document.getElementById('status-log');

  function log(msg, cls = '') {
    const el = logEl();
    if (!el) return;
    el.style.display = 'block';
    const div = document.createElement('div');
    if (cls) div.className = cls;
    const ts = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `<span style="opacity:.4;margin-right:.5rem;font-size:.62rem">[${ts}]</span> › ${msg}`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  function clearLog() {
    const el = logEl();
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  }

  // ── Date helpers ──
  function fmtDate(d) {
    try {
      return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) { return d || ''; }
  }

  function daysAgo(dateStr) {
    try {
      const ts = new Date(dateStr).getTime();
      if (!Number.isFinite(ts)) return 'Date unknown';
      const diff = Date.now() - ts;
      const days = Math.floor(diff / 864e5);
      if (days <= 0) return 'Today';
      if (days === 1) return 'Yesterday';
      return `${days} days ago`;
    } catch (e) { return 'Date unknown'; }
  }

  function isWithinDays(dateStr, days) {
    if (days === 0) return true;
    try {
      const ts = new Date(dateStr).getTime();
      // Keep undated feed items visible instead of hiding all cards.
      if (!Number.isFinite(ts)) return true;
      return ts >= (Date.now() - days * 864e5);
    } catch (e) { return true; }
  }

  // ── Convert inline SVGs to base64 <img> tags for email compatibility ──
  function svgsToBase64(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('svg').forEach(svg => {
      try {
        // Serialize SVG, encode to base64 data URI
        const serializer = new XMLSerializer();
        let svgStr = serializer.serializeToString(svg);
        // Ensure xmlns is present
        if (!svgStr.includes('xmlns=')) {
          svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        const b64 = btoa(unescape(encodeURIComponent(svgStr)));
        const dataUri = `data:image/svg+xml;base64,${b64}`;
        // Create img replacement
        const img = document.createElement('img');
        img.src = dataUri;
        img.alt = 'Security illustration';
        // Preserve dimensions
        const w = svg.getAttribute('width') || svg.style.width || '';
        const h = svg.getAttribute('height') || svg.style.height || '';
        if (w) img.setAttribute('width', w.replace('px', ''));
        if (h) img.setAttribute('height', h.replace('px', ''));
        img.style.cssText = svg.style.cssText || '';
        img.style.display = 'inline-block';
        img.style.verticalAlign = 'middle';
        svg.parentNode.replaceChild(img, svg);
      } catch (e) { /* skip SVGs that fail to serialize */ }
    });
    return tmp.innerHTML;
  }

  // ── Inline all CSS custom properties for email ──
  function inlineCSSVars(html) {
    const vars = {
      'var(--blk)': '#FFFFFF', 'var(--blk2)': '#F5F5F7', 'var(--blk3)': '#F0F0F3',
      'var(--pri)': '#0002D7', 'var(--pri-hi)': '#2627E0', 'var(--pri-bar)': '#0001A0',
      'var(--pri-light)': '#E8EDF8', 'var(--pri-light2)': '#D6DEF0',
      'var(--wh)': '#FFF', 'var(--txt)': '#000000', 'var(--gray)': '#000000', 'var(--gray2)': '#000000',
      'var(--red)': '#C0392B', 'var(--grn)': '#1E7A46',
      'var(--bw)': 'rgba(0,0,0,.07)', 'var(--bg)': 'rgba(0,2,215,.18)'
    };
    let out = html;
    for (const [varName, value] of Object.entries(vars)) {
      out = out.split(varName).join(value);
    }
    return out;
  }

  // ── Clipboard: email-safe HTML with base64 images ──
  function buildEmailSafeHTMLFromElement(el) {
    if (!el) return '';
    let html = el.outerHTML;
    html = svgsToBase64(html);
    html = inlineCSSVars(html);
    return html;
  }

  /**
   * Plain-text fallback for clipboard (rich paste uses HTML separately).
   * Preserves line breaks and bullet lines so paste-as-text still resembles the layout.
   */
  function plainTextFromClipboardHtml(html) {
    const raw = String(html || '');
    if (typeof document === 'undefined') return stripTags(raw);
    const tmp = document.createElement('div');
    tmp.innerHTML = raw;
    tmp.querySelectorAll('script,style').forEach((n) => n.remove());

    const parts = [];
    function walk(node) {
      if (node.nodeType === 3) {
        parts.push(node.nodeValue || '');
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'br') {
        parts.push('\n');
        return;
      }
      if (tag === 'li') {
        parts.push('\n• ');
        Array.from(node.childNodes).forEach(walk);
        return;
      }
      if (tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'blockquote') {
        parts.push('\n');
        Array.from(node.childNodes).forEach(walk);
        parts.push('\n');
        return;
      }
      if (tag === 'tr') {
        parts.push('\n');
        Array.from(node.childNodes).forEach(walk);
        return;
      }
      Array.from(node.childNodes).forEach(walk);
    }
    Array.from(tmp.childNodes).forEach(walk);
    return parts
      .join('')
      .replace(/[ \t\f\v]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function writeRichClipboard(htmlString, plainText) {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.write === 'function' &&
      typeof ClipboardItem === 'function'
    ) {
      const htmlBlob = new Blob([htmlString], { type: 'text/html' });
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      return navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob,
        }),
      ]);
    }
    return Promise.reject(new Error('rich clipboard unavailable'));
  }

  function copyHTML(elId, htmlOverride = null) {
    const el = document.getElementById(elId);
    if (!el && !htmlOverride) return;
    showToast('Converting images to base64 for email…');
    let builtHtml = '';
    try {
      if (htmlOverride) {
        const tmp = document.createElement('div');
        tmp.innerHTML = htmlOverride;
        builtHtml = buildEmailSafeHTMLFromElement(tmp);
      } else {
        builtHtml = buildEmailSafeHTMLFromElement(el);
      }
      const plain = plainTextFromClipboardHtml(builtHtml);
      writeRichClipboard(builtHtml, plain)
        .then(() => showToast('Copied — rich HTML and plain text (paste into Outlook, Gmail, Word).'))
        .catch(() =>
          navigator.clipboard.writeText(builtHtml).then(() =>
            showToast('Email-ready HTML copied! All images embedded as base64.')
          )
        )
        .catch(() => showToast('Copy failed — select manually.', true));
    } catch (e) {
      const fallback = builtHtml || el?.outerHTML || String(htmlOverride || '');
      navigator.clipboard
        .writeText(fallback)
        .then(() => showToast('HTML copied (some images may not display in email).'))
        .catch(() => showToast('Copy failed — select manually.', true));
    }
  }

  function downloadHTML(filename, html) {
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
    } catch (e) {
      showToast('Download failed.', true);
    }
  }

  /**
   * Wrap a full HTML document string in an SVG using foreignObject so it can be saved as .svg.
   * Uses the same rendering pipeline as standalone HTML (DOMParser + XMLSerializer).
   */
  function htmlToSvgExport(fullHtml, opts = {}) {
    const width = opts.width != null ? opts.width : 800;
    const height = opts.height != null ? opts.height : 4000;
    if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><!-- DOMParser/XMLSerializer unavailable --></svg>`;
    }
    try {
      const doc = new DOMParser().parseFromString(fullHtml, 'text/html');
      const body = doc.body;
      if (!body) {
        return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
      }
      const serializer = new XMLSerializer();
      let inner = serializer.serializeToString(body);
      inner = inner.replace(/^<body\b[^>]*>/i, '<div xmlns="http://www.w3.org/1999/xhtml">').replace(/<\/body>\s*$/i, '</div>');
      return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
        `<foreignObject width="${width}" height="${height}">\n${inner}\n</foreignObject>\n` +
        `</svg>`
      );
    } catch (e) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
    }
  }

  function downloadSVG(filename, svgMarkup) {
    try {
      const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
    } catch (e) {
      showToast('SVG download failed.', true);
    }
  }

  function downloadBlob(filename, blob) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
    } catch (e) {
      showToast('Download failed.', true);
    }
  }

  /**
   * Replace contents of #nl-qr with an inline PNG data-URI image (email/offline/SVG-safe).
   */
  function injectNlQrImageIntoHtml(bodyHtml, dataUri) {
    const raw = String(bodyHtml || '');
    const uri = String(dataUri || '').trim();
    if (!uri || !raw.includes('nl-qr')) return raw;
    if (typeof DOMParser === 'undefined') return raw;
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${raw}</body></html>`,
        'text/html'
      );
      const qr = doc.body.querySelector('#nl-qr');
      if (!qr) return raw;
      qr.innerHTML = '';
      const img = doc.createElement('img');
      img.setAttribute('src', uri);
      img.setAttribute('alt', 'QR code');
      img.setAttribute('width', '144');
      img.setAttribute('height', '144');
      img.setAttribute('style', 'display:block');
      qr.appendChild(img);
      return doc.body.innerHTML;
    } catch (e) {
      return raw;
    }
  }

  // ── Toast notifications ──
  function showToast(msg, isError = false) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position:fixed;top:1.2rem;right:1.2rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;pointer-events:none';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = `
      pointer-events:auto;padding:.72rem 1.2rem;border-radius:6px;font-size:.8rem;font-weight:500;
      font-family:'DM Sans',sans-serif;backdrop-filter:blur(16px);border:1px solid;
      transform:translateX(120%);transition:transform .3s cubic-bezier(.4,0,.2,1),opacity .3s;
      ${isError
        ? 'background:rgba(192,57,43,.18);border-color:rgba(192,57,43,.4);color:#E74C3C'
        : 'background:rgba(0,2,215,.18);border-color:rgba(0,2,215,.4);color:#2627E0'}`;
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.style.transform = 'translateX(0)');
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(120%)';
      setTimeout(() => toast.remove(), 350);
    }, 3200);
  }

  // ── Skeleton loader ──
  function skeleton(count = 4) {
    return Array.from({ length: count }, () => `
      <div style="background:rgba(0,0,0,.02);border:1px solid rgba(0,0,0,.05);border-radius:8px;padding:1.1rem;margin-bottom:.72rem">
        <div class="sk" style="width:22%;height:10px;margin-bottom:.45rem"></div>
        <div class="sk" style="width:78%;height:14px;margin-bottom:.35rem"></div>
        <div class="sk" style="width:92%;height:11px;margin-bottom:.2rem"></div>
        <div class="sk" style="width:58%;height:11px;margin-bottom:.55rem"></div>
        <div style="display:flex;gap:.5rem">
          <div class="sk" style="width:60px;height:18px;border-radius:3px"></div>
          <div class="sk" style="width:80px;height:18px;border-radius:3px"></div>
        </div>
      </div>`).join('');
  }

  // ── Debounce ──
  function debounce(fn, ms = 300) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ── Simple wait ──
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Sanitize HTML entities ──
  function esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  // ── Strip HTML tags ──
  function stripTags(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  // ── Truncate text ──
  function truncate(str, len = 160) {
    if (!str || str.length <= len) return str;
    return str.slice(0, len).replace(/\s+\S*$/, '') + '…';
  }

  /**
   * When newsletter HTML is saved and opened as file://, href="google.com" resolves to a path beside the file.
   * Normalize bare hosts and scheme-less URLs to absolute https (mailto:, tel:, existing schemes unchanged).
   */
  function normalizeWebUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('sms:')) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
    if (lower.startsWith('//')) return `https:${s}`;
    if (s.startsWith('#') || s.startsWith('/') || s.startsWith('\\')) return s;
    if (/\s/.test(s)) return s;
    return `https://${s.replace(/^\/+/, '')}`;
  }

  /** Remove legacy footer classification segment from saved newsletter HTML (workspace snapshots pre-removal). */
  function stripLegacyFooterClassification(html) {
    const s = String(html || '');
    if (!s.includes('Security Awareness') || !s.includes('mailto:')) return s;
    const dot = '(?:·|&middot;|&#183;|\u00b7)';
    const re = new RegExp(
      `Security Awareness\\s*${dot}\\s*[\\s\\S]{0,500}?\\s*${dot}\\s*(<a\\s+href="mailto:)`,
      'gi'
    );
    return s.replace(re, 'Security Awareness · $1');
  }

  /**
   * Remove one element from serialized newsletter HTML using the same body→child index
   * path as the editor iframe (element children only). Used to mirror deletes across languages.
   */
  function removeNewsletterNodeByBodyChildPath(html, path) {
    const h = String(html || '');
    if (!path || !Array.isArray(path) || path.length === 0) return { html: h, removed: false };
    if (typeof DOMParser === 'undefined') return { html: h, removed: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, removed: false };
      let cur = body;
      for (let i = 0; i < path.length; i += 1) {
        const idx = path[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, removed: false };
        }
        cur = cur.children[idx];
      }
      if (cur === body) return { html: h, removed: false };
      cur.remove();
      return { html: body.innerHTML, removed: true };
    } catch (e) {
      return { html: h, removed: false };
    }
  }

  /**
   * Same as removeNewsletterNodeByBodyChildPath but paths are relative to the first
   * [data-template-id] node (newsletter root). Skips leading style/script/banner drift across languages.
   */
  function removeNewsletterNodeByTemplateChildPath(html, relPath) {
    const h = String(html || '');
    if (!relPath || !Array.isArray(relPath) || relPath.length === 0) return { html: h, removed: false };
    if (typeof DOMParser === 'undefined') return { html: h, removed: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, removed: false };
      const root = body.querySelector('[data-template-id]');
      if (!root) return { html: h, removed: false };
      let cur = root;
      for (let i = 0; i < relPath.length; i += 1) {
        const idx = relPath[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, removed: false };
        }
        cur = cur.children[idx];
      }
      if (cur === root) return { html: h, removed: false };
      cur.remove();
      return { html: body.innerHTML, removed: true };
    } catch (e) {
      return { html: h, removed: false };
    }
  }

  /**
   * Cross-language delete: prefer path inside [data-template-id], then full body path,
   * then body path with up to maxPathSkip leading indices dropped (handles extra/missing style/script).
   */
  function removeNewsletterNodeByMirrorPath(html, pathBody, relPath, maxPathSkip = 4) {
    const h = String(html || '');
    const byTpl = removeNewsletterNodeByTemplateChildPath(h, relPath);
    if (byTpl.removed) return byTpl;
    if (pathBody && pathBody.length) {
      const exact = removeNewsletterNodeByBodyChildPath(h, pathBody);
      if (exact.removed) return exact;
      const limit = Math.min(maxPathSkip, Math.max(0, pathBody.length - 1));
      for (let skip = 1; skip <= limit; skip += 1) {
        const flex = removeNewsletterNodeByBodyChildPath(h, pathBody.slice(skip));
        if (flex.removed) return flex;
      }
    }
    return { html: h, removed: false };
  }

  /**
   * Set textContent on one element (mirror of removeNewsletterNodeByBodyChildPath).
   */
  function updateNewsletterNodeTextByBodyChildPath(html, path, text) {
    const h = String(html || '');
    const next = String(text ?? '');
    if (!path || !Array.isArray(path) || path.length === 0) return { html: h, updated: false };
    if (typeof DOMParser === 'undefined') return { html: h, updated: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, updated: false };
      let cur = body;
      for (let i = 0; i < path.length; i += 1) {
        const idx = path[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, updated: false };
        }
        cur = cur.children[idx];
      }
      if (cur === body) return { html: h, updated: false };
      cur.textContent = next;
      return { html: body.innerHTML, updated: true };
    } catch (e) {
      return { html: h, updated: false };
    }
  }

  function updateNewsletterNodeTextByTemplateChildPath(html, relPath, text) {
    const h = String(html || '');
    const next = String(text ?? '');
    if (!relPath || !Array.isArray(relPath) || relPath.length === 0) return { html: h, updated: false };
    if (typeof DOMParser === 'undefined') return { html: h, updated: false };
    try {
      const doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${h}</body></html>`,
        'text/html'
      );
      const body = doc.body;
      if (!body) return { html: h, updated: false };
      const root = body.querySelector('[data-template-id]');
      if (!root) return { html: h, updated: false };
      let cur = root;
      for (let i = 0; i < relPath.length; i += 1) {
        const idx = relPath[i];
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.children.length) {
          return { html: h, updated: false };
        }
        cur = cur.children[idx];
      }
      if (cur === root) return { html: h, updated: false };
      cur.textContent = next;
      return { html: body.innerHTML, updated: true };
    } catch (e) {
      return { html: h, updated: false };
    }
  }

  /**
   * Cross-language text sync: prefer path inside [data-template-id], then full body path,
   * then body path with leading indices dropped (same strategy as removeNewsletterNodeByMirrorPath).
   */
  function updateNewsletterNodeTextByMirrorPath(html, pathBody, relPath, text, maxPathSkip = 5) {
    const h = String(html || '');
    const byTpl = updateNewsletterNodeTextByTemplateChildPath(h, relPath, text);
    if (byTpl.updated) return byTpl;
    if (pathBody && pathBody.length) {
      const exact = updateNewsletterNodeTextByBodyChildPath(h, pathBody, text);
      if (exact.updated) return exact;
      const limit = Math.min(maxPathSkip, Math.max(0, pathBody.length - 1));
      for (let skip = 1; skip <= limit; skip += 1) {
        const flex = updateNewsletterNodeTextByBodyChildPath(h, pathBody.slice(skip), text);
        if (flex.updated) return flex;
      }
    }
    return { html: h, updated: false };
  }

  // ── Generate unique ID ──
  let _idCounter = 0;
  function uid(prefix = 'id') { return `${prefix}_${++_idCounter}_${Date.now().toString(36)}`; }

  return {
    log, clearLog, fmtDate, daysAgo, isWithinDays,
    copyHTML, plainTextFromClipboardHtml, svgsToBase64, inlineCSSVars, buildEmailSafeHTMLFromElement, downloadHTML,
    htmlToSvgExport, downloadSVG, downloadBlob, injectNlQrImageIntoHtml,
    showToast, skeleton, debounce, wait,
    esc, stripTags, truncate, uid, normalizeWebUrl, stripLegacyFooterClassification,
    removeNewsletterNodeByBodyChildPath, removeNewsletterNodeByTemplateChildPath, removeNewsletterNodeByMirrorPath,
    updateNewsletterNodeTextByBodyChildPath, updateNewsletterNodeTextByTemplateChildPath, updateNewsletterNodeTextByMirrorPath
  };
})();
