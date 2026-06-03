import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const WHITE_TEXT = /color:\s*rgba\(255,\s*255,\s*255,\s*[0-9.]+\)/i;
const LIGHT_BG = /background(?:-color)?=(?:"|')?(#FFFFFF|#FAFAFA|#F5F5F7|#fff)\b/i;

function scanForWhiteTextOnLight(html, label) {
  const hits = [];
  const re = /<[^>]+style="[^"]*"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (!WHITE_TEXT.test(tag)) continue;
    if (!LIGHT_BG.test(tag)) {
      const ctxStart = Math.max(0, m.index - 400);
      const ctx = html.slice(ctxStart, m.index + tag.length + 200);
      if (!LIGHT_BG.test(ctx)) continue;
    }
    hits.push({ label, snippet: tag.slice(0, 120) });
  }
  return hits;
}

describe('light-surface text contrast', () => {
  it('utils inlineCSSVars maps text tokens to black', () => {
    const utilsSrc = fs.readFileSync(path.join(root, 'js/utils.js'), 'utf8');
    assert.match(utilsSrc, /'var\(--txt\)':\s*'#000000'/);
    assert.match(utilsSrc, /'var\(--gray\)':\s*'#000000'/);
    assert.match(utilsSrc, /'var\(--gray2\)':\s*'#000000'/);
  });

  it('imported-standalone templates avoid white-on-white text', () => {
    const dir = path.join(root, 'templates/imported-standalone');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !f.includes('Template 10'));
    const allHits = [];
    for (const file of files) {
      const html = fs.readFileSync(path.join(dir, file), 'utf8');
      allHits.push(...scanForWhiteTextOnLight(html, file));
    }
    assert.equal(
      allHits.length,
      0,
      `white text on light background in: ${allHits.map((h) => h.label).join(', ')}`
    );
  });

  it('newsletter_builder Phishing Brief bullets use black on white body', () => {
    const src = fs.readFileSync(path.join(root, 'js/newsletter_builder.js'), 'utf8');
    const bodyBlock = src.match(
      /padding:26px 36px 18px; background:#FFFFFF;[\s\S]{0,12000}?<!-- "Don't Click/
    );
    assert.ok(bodyBlock, 'expected Phishing Brief white body section');
    assert.doesNotMatch(bodyBlock[0], /color:\s*rgba\(255,\s*255,\s*255/i);
    assert.match(bodyBlock[0], /color:#000000; line-height:1\.55/);
  });
});
