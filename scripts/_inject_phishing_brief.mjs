// One-time helper: injects buildPhishingBrief() and a switch case into js/newsletter_builder.js,
// inlining the email-safe Template 13 HTML as a JS template literal. Safe to re-run idempotently.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'templates', 'imported-email-safe', 'Template 13 - Phishing Brief (ABC Company).html');
const JS_PATH = path.join(ROOT, 'js', 'newsletter_builder.js');

const html = fs.readFileSync(HTML_PATH, 'utf8');
if (html.includes('`') || html.includes('${')) {
  console.error('ERROR: HTML contains backtick or ${ — cannot inline as template literal.');
  process.exit(1);
}

let js = fs.readFileSync(JS_PATH, 'utf8');

if (js.includes('function buildPhishingBrief')) {
  console.log('buildPhishingBrief already present — skipping insert.');
} else {
  const fn = `  // ══════════════════════════════════════════════════
  //  TEMPLATE 13: PHISHING BRIEF (ABC Company)
  //  Email-safe imported design with 3 themed bullet sections.
  //  Branding is hardcoded by design (ABC Company). 11 tokens
  //  (INTRO + 10 bullets) are filled from selected articles.
  // ══════════════════════════════════════════════════
  function buildPhishingBrief(c, arts, wo, lk, poster, qr, illus) {
    const HTML = \`${html}\`;
    const defaults = {
      INTRO: 'Phishing attempts continue to target colleagues across the company. Use the checklists below to spot suspicious messages and act quickly.',
      SECTION1_BULLET1: 'Urgent or threatening language demanding immediate action.',
      SECTION1_BULLET2: 'Sender address that does not match the organisation it claims to represent.',
      SECTION1_BULLET3: 'Unexpected attachments or links to login pages.',
      SECTION1_BULLET4: 'Requests for credentials, payment details, or money transfers.',
      SECTION2_BULLET1: 'Real organisations rarely ask for passwords via email.',
      SECTION2_BULLET2: 'Hover over links to inspect the actual destination before clicking.',
      SECTION2_BULLET3: 'When in doubt, verify through a known phone number or channel.',
      SECTION3_BULLET1: 'Pause before you click — a few seconds prevents most incidents.',
      SECTION3_BULLET2: 'Report suspicious emails using the button below.',
      SECTION3_BULLET3: 'Share what you saw — security is a team effort.'
    };
    const safeStr = (v) => typeof v === 'string' ? v : (v == null ? '' : String(v));
    const titleOf = (a) => safeStr(a && a.title).trim();
    const summaryOf = (a) => safeStr(a && (a.summary || a.description)).trim();
    const firstSentence = (s) => {
      if (!s) return '';
      const m = s.match(/^[^.!?]+[.!?]/);
      return (m ? m[0] : s).trim();
    };
    const tokens = {};
    const a0 = Array.isArray(arts) && arts[0] ? arts[0] : null;
    tokens.INTRO = a0 ? (firstSentence(summaryOf(a0)) || titleOf(a0) || defaults.INTRO) : defaults.INTRO;
    const bulletKeys = [
      'SECTION1_BULLET1','SECTION1_BULLET2','SECTION1_BULLET3','SECTION1_BULLET4',
      'SECTION2_BULLET1','SECTION2_BULLET2','SECTION2_BULLET3',
      'SECTION3_BULLET1','SECTION3_BULLET2','SECTION3_BULLET3'
    ];
    for (let i = 0; i < bulletKeys.length; i++) {
      const a = Array.isArray(arts) && arts[i] ? arts[i] : null;
      const fromArt = a ? (titleOf(a) || firstSentence(summaryOf(a))) : '';
      tokens[bulletKeys[i]] = fromArt || defaults[bulletKeys[i]];
    }
    let out = HTML;
    for (const k of Object.keys(tokens)) {
      out = out.split('{{' + k + '}}').join(escapeHtml(tokens[k]));
    }
    return out;
  }

  function build(format, cfg, arts, opts) {`;

  // Replace the `function build(...) {` opening with our function + the original opening.
  const buildMarker = '  function build(format, cfg, arts, opts) {';
  if (!js.includes(buildMarker)) {
    console.error('ERROR: could not find build() function marker.');
    process.exit(1);
  }
  js = js.replace(buildMarker, fn);
  console.log('Injected buildPhishingBrief() before build().');
}

// Add switch case
if (js.includes("case 'phishingbrief'")) {
  console.log("case 'phishingbrief' already present — skipping insert.");
} else {
  const switchMarker = "      default:            html = buildCorporateAlert(cfg,arts,wo,lk,p,qr,il); break;";
  if (!js.includes(switchMarker)) {
    console.error('ERROR: could not find default case marker in switch.');
    process.exit(1);
  }
  js = js.replace(switchMarker, "      case 'phishingbrief': html = buildPhishingBrief(cfg,arts,wo,lk,p,qr,il); break;\n      default:            html = buildCorporateAlert(cfg,arts,wo,lk,p,qr,il); break;");
  console.log("Inserted switch case 'phishingbrief'.");
}

fs.writeFileSync(JS_PATH, js, 'utf8');
console.log('Wrote', path.relative(ROOT, JS_PATH));
