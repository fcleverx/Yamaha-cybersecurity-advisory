#!/usr/bin/env node
/**
 * Copy static app files into _site/ for GitHub Pages deployment.
 * Excludes node_modules, tests, dev scripts, and backup artifacts.
 */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const out = path.join(root, '_site');

const SKIP_DIRS = new Set([
  'node_modules',
  '_site',
  '.git',
  '.github',
  'tests',
  'playwright-report',
  'test-results',
  'templates/imported-email-safe.bak',
]);

const SKIP_FILE_RE = /\.(bak|py)$/i;
const SKIP_NAMES = new Set([
  'package-lock.json',
  'baseline-critical-path-audit-results.json',
  'email_audit.js',
  'transform_dark_to_light.py',
  'transform_themes.py',
]);

function shouldSkip(rel) {
  const parts = rel.split(path.sep);
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  const base = path.basename(rel);
  if (SKIP_NAMES.has(base)) return true;
  if (SKIP_FILE_RE.test(base)) return true;
  return false;
}

function copyRecursive(srcRel) {
  const src = path.join(root, srcRel);
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (shouldSkip(srcRel)) return;
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(srcRel, name));
    }
    return;
  }
  if (shouldSkip(srcRel)) return;
  const dest = path.join(out, srcRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

if (fs.existsSync(out)) {
  fs.rmSync(out, { recursive: true, force: true });
}
fs.mkdirSync(out, { recursive: true });

// Root HTML entrypoints
for (const name of fs.readdirSync(root)) {
  if (!name.endsWith('.html')) continue;
  if (SKIP_FILE_RE.test(name)) continue;
  copyRecursive(name);
}

// Runtime assets
for (const dir of ['js', 'assets', 'templates/imported-email-safe', 'templates/imported-standalone']) {
  copyRecursive(dir);
}

// GitHub Pages: disable Jekyll processing
fs.writeFileSync(path.join(out, '.nojekyll'), '\n');

console.log('Prepared GitHub Pages site at', out);
