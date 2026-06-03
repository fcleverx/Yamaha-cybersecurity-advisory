/* ═══════════════════════════════════════════════════════════
   ai_summarizer.js — AI-powered article summarisation
   Enterprise internal awareness tone: concise, professional, org-wide.
   ═══════════════════════════════════════════════════════════ */
window.App = window.App || {};

App.AISummarizer = (() => {
  'use strict';
  const { log, truncate } = App.Utils;

  let config = {
    provider: 'claude',
    claudeKey: '', claudeModel: 'claude-sonnet-4-20250514',
    openaiKey: '', openaiModel: 'gpt-4o-mini',
    maxConcurrent: 3, retryAttempts: 2, retryDelayMs: 1500
  };
  const CURATION_MODES = {
    concise: {
      label: 'concise',
      sentenceStyle: 'Exactly 2 short sentences.',
      maxContentChars: 480,
      localSummaryLen: 190,
      summaryMaxChars: 220
    },
    balanced: {
      label: 'balanced',
      sentenceStyle: 'Exactly 2 or 3 short sentences.',
      maxContentChars: 800,
      localSummaryLen: 300,
      summaryMaxChars: 300
    },
    deep: {
      label: 'deep',
      sentenceStyle: 'Exactly 3 or 4 concise sentences.',
      maxContentChars: 1200,
      localSummaryLen: 480,
      summaryMaxChars: 400
    }
  };

  function configure(opts) { Object.assign(config, opts); }
  function getConfig() { return { ...config }; }

  const EMPLOYEE_VOICE_BLOCK = `You are writing internal corporate security communications for a general employee audience with no IT or cybersecurity background. Write in a warm, clear, professional tone — like a trusted colleague from the security team sending a company-wide email. Use plain everyday language. Never use jargon, acronyms, or technical terms without immediately explaining them in simple words. Be direct, specific, and human. Every sentence should feel natural and immediately useful to someone sitting at their office desk.`;

  const STYLE_BLOCK = `You are the lead editor for an internal organization-wide security awareness bulletin (technical and non-technical readers).
Voice: CERT / CISA–style operational awareness — calm, factual, concise. Not marketing, not tabloid, not "thought leadership".

STYLE (mandatory):
- Professional, neutral, present tense where natural. No narrative, anecdotes, metaphors, or "story" framing.
- No filler or throat-clearing. Never use: "it is important to note", "it is worth noting", "remember that", "in today's world", "as we all know", "needless to say", "at the end of the day", "in conclusion", "this article", "the takeaway is", "here's what you need to know", "so,", "basically", "actually", "staying vigilant", "be mindful", "bad actors", "in today's digital landscape".
- No rhetorical questions, exclamation marks, hype, jokes, slang, tabloid tone, or vendor/marketing voice.
- Forbidden in JSON values: URLs, scam-style urgency.

GROUNDING (mandatory):
- The user's Content / Stories block is the only source of facts. Paraphrase what is stated or clearly implied; do not invent statistics, victim counts, CVEs, patch levels, legal outcomes, or named products not present in the text.
- Prefer concrete vocabulary from the article (channel, platform, attack pattern, geography) over generic security words.
- If the source is thin, stay appropriately high-level rather than inventing precision.`;

  /** Request 1 of 2 per article: summary + threat + category only (no watchouts). */
  const SYSTEM_ARTICLE_CORE = `${EMPLOYEE_VOICE_BLOCK}

You complete REQUEST 1 of 2 for a single item in that bulletin. ${STYLE_BLOCK}

TASK — produce three fields only (no watchouts in this response):

1) summary (string)
- Obey the user message sentence count and hard character cap exactly.
- First sentence: what happened or what threat class is active, using terms that appear in the source where possible.
- Follow-on sentence(s): organizational relevance (who should care and why) only if supported by the text; otherwise one calm clause on why the program is flagging it.
- Do not paste the title as the whole summary; do not quote long spans verbatim.

2) threatLevel (integer 1–5)
- 1–2: background or research-only pieces with no clear active risk to typical staff workflows.
- 3: meaningful risk for some roles or common workflows.
- 4–5: active exploitation, fast-moving campaigns, or incidents that likely require immediate staff or IT action. When uncertain, prefer 3 over 5.

3) category (exact enum string)
- One of: Phishing, Password & MFA, Data Breach, Ransomware, Social Engineering, Malware, Scam & Fraud, Vulnerability, Advisory, Insider Threat, Security News, Smishing.
- Classify from the dominant mechanism in the body, not from a sensational headline. Example: npm or CI supply-chain abuse with developer-token theft → "Security News" or "Malware" is usually better than "Password & MFA" unless the piece is truly about end-user password compromise at scale.

Return ONLY valid JSON with exactly these keys (no markdown fences, no commentary):
{"summary":"…","threatLevel":3,"category":"Category"}`;

  /** Request 2 of 2 per article: watchouts only, after summary exists. */
  const SYSTEM_ARTICLE_WATCHOUTS = `${EMPLOYEE_VOICE_BLOCK}

You complete REQUEST 2 of 2: exactly three imperative "What you should do" lines for ONE bulletin story. ${STYLE_BLOCK}

WATCHOUTS (JSON key "watchouts", array length 3):
- Each string: imperative mood; max 10 words; max 60 characters including spaces; no URLs; no exclamation marks.
- Slot 1: strongest preventive or hardening action tied to THIS threat (specific beat generic).
- Slot 2: how an affected reader would notice, verify, or safely check the risk.
- Slot 3: escalate or report through normal org channels (IT, AppSec, SOC, manager)—process names only, never mailto or links.

RELEVANCE TEST (silent, before you write): each line must contain at least one concrete anchor paraphrased from the article (e.g. text, email, npm, payroll, VPN, USB, invoice, QR, browser, cloud console)—not interchangeable slogans.

SUPPLY CHAIN / DEV TOOLING: if the story involves malicious packages, registries, CI/CD, GitHub Actions, install scripts, or theft of developer or build secrets, all three lines must reflect pipeline or software hygiene (dependencies, lockfiles, scoped tokens, approved registries, AppSec review). Hard-ban unrelated consumer lines such as "use a different password on every website" or "enable MFA everywhere" unless the source explicitly describes mass theft of employee or customer login databases.

NEGATIVE EXAMPLES (never output or paraphrase these patterns): "Stay vigilant online", "Be aware of cyber threats", "Security is everyone's job", "Always use strong passwords".

VOICE GUARD: Never imitate scam or phishing language (no "Click here", "Act now", "URGENT", "verify your account now", congratulations, time pressure).

Return ONLY valid JSON: {"watchouts":["…","…","…"]}`;

  // ── System prompt — legacy single-shot JSON (labs / compatibility) ──
  const SYSTEM_PROMPT = `${EMPLOYEE_VOICE_BLOCK}

You draft one JSON object for an internal organization-wide security awareness bulletin (all roles). ${STYLE_BLOCK}

SUMMARY (JSON "summary"):
- Obey the user message for sentence count and hard character cap.
- (1) What occurred or what threat class is in scope, in plain facts drawn from the Content. (2) One calm clause on why it matters — no drama, no second headline.
- Do not paste the article title as the entire summary.

WATCHOUTS (JSON "watchouts"): Exactly 3 strings. Each: imperative, max 10 words, max 60 characters including spaces, no URLs, no exclamation marks.
- Order: (1) prevention / hardening for THIS incident type, (2) detection or verification staff can perform, (3) response or reporting within normal org process.
- Each line must reuse concrete vocabulary from the source where possible — not interchangeable generic advice.
- Supply chain / npm / CI / dev-token stories: engineering and pipeline hygiene only; no consumer password-MFA platitudes unless the text explicitly describes end-user account database compromise.

VOICE GUARD: Never imitate scam or phishing language (no "Click here", "Act now", "URGENT", "verify your account now", congratulations, time pressure).

OTHER FIELDS:
- threatLevel: integer 1–5 (1 = general awareness, 5 = immediate protective action likely).
- category: one of Phishing, Password & MFA, Data Breach, Ransomware, Social Engineering, Malware, Scam & Fraud, Vulnerability, Advisory, Insider Threat, Security News, Smishing.

Return ONLY valid JSON:
{"summary":"…","watchouts":["tip 1","tip 2","tip 3"],"threatLevel":3,"category":"Category"}`;

  function shouldUseOpenAIJsonMode(systemPrompt, userPrompt) {
    const blob = `${systemPrompt}\n${userPrompt}`;
    return /\bReturn ONLY valid JSON\b/i.test(blob) || /\bReturn ONLY a single JSON\b/i.test(blob) || /\bOutput: JSON only\b/i.test(blob);
  }

  function openAIChatCompletionsBody(systemPrompt, userPrompt, maxTokens, temperature) {
    const body = {
      model: config.openaiModel,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };
    if (shouldUseOpenAIJsonMode(systemPrompt, userPrompt)) {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  // ── API calls ──
  async function callClaude(prompt, systemPrompt = SYSTEM_PROMPT) {
    if (!config.claudeKey) throw new Error('No API key');
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: config.claudeModel,
        max_tokens: 450,
        temperature: 0.15,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json();
    return d.content?.[0]?.text || '';
  }

  async function callOpenAI(prompt, systemPrompt = SYSTEM_PROMPT) {
    if (!config.openaiKey) throw new Error('No API key');
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.openaiKey}` },
      body: JSON.stringify(openAIChatCompletionsBody(systemPrompt, prompt, 450, 0.08))
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json();
    return d.choices?.[0]?.message?.content || '';
  }

  // ── Local summariser with SIMPLE, employee-friendly language ──
  function localSummarize(article, mode = 'balanced') {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const text = article.description || article.title;
    const sentences = text.replace(/([.!?])\s+/g, '$1|').split('|').map(s => s.trim()).filter(s => s.length > 15);

    let s1 = sentences[0] || article.title;
    let s2 = sentences.length > 1
      ? sentences.slice(1).sort((a, b) => b.length - a.length)[0]
      : 'See the actions below if this type of incident could affect your work.';
    if (!s1.endsWith('.')) s1 += '.';
    if (!s2.endsWith('.')) s2 += '.';
    const cap = Math.min(modeCfg.localSummaryLen, modeCfg.summaryMaxChars || modeCfg.localSummaryLen);
    const draft = `${s1} ${s2}`;
    const summary = finalizeEmployeeSummary(draft, modeCfg) || truncate(sanitizeSummaryProse(draft), cap);

    return {
      summary,
      watchouts: generateTips(article),
      threatLevel: estimateLevel(article),
      category: article.type,
      confidence: 0.5
    };
  }

  /** Text used to match local tips and relevance (title + body + optional summary). */
  function corpusForTips(article) {
    return (article.title + ' ' + (article.description || '') + ' ' + (article.summary || '')).toLowerCase();
  }

  /** Corpus signals for npm / PyPI / CI / dev-token supply-chain risk (shared by generateTips, guards, edition logic). */
  const SUPPLY_CHAIN_CORPUS_MARKERS = [
    'supply chain', 'supply-chain', 'npm package', 'npm packages', 'malicious package', 'compromised package',
    'package.json', 'github actions', 'github action secrets', 'ci/cd', 'ci cd', 'build pipeline',
    'npm registry', 'pypi', 'rubygems', 'typosquat', 'postinstall', 'post-install', 'install script',
    'shai-hulud', 'shai hulud', 'sap bas', 'sap cloud sdk', 'developer credential', 'npm token',
    'registry token', 'kubernetes secret', 'sbom', 'software bill of materials', 'third-party package',
    'malware in npm', 'team pcp', 'teampcp', 'safe dep', 'safedep', 'aikido security', 'wiz research',
    'malicious versions', 'compromised npm', 'javascript ecosystem', 'vsix',
    'vscode extension', 'registry.npmjs', 'install-time code', 'github actions secrets', 'internal registry'
  ];

  function isSoftwareSupplyChainStory(article) {
    if (!article) return false;
    const t = corpusForTips(article);
    return SUPPLY_CHAIN_CORPUS_MARKERS.some((m) => t.includes(m));
  }

  function editionHasSupplyChain(articles = []) {
    const list = Array.isArray(articles) ? articles : [];
    return list.some((a) => a && isSoftwareSupplyChainStory(a));
  }

  const SOFTWARE_SUPPLY_CHAIN_WATCHOUT_TIPS = [
    'Verify dependency updates and lockfiles before production deploys',
    'Never paste repo, CI, npm, or cloud secrets into chat or email',
    'Report odd package installs or CI token alerts to AppSec or IT'
  ];

  /** When no keyword rule matches: align with article.type so tips are not random. */
  function defaultTipsForType(article) {
    if (isSoftwareSupplyChainStory(article)) return [...SOFTWARE_SUPPLY_CHAIN_WATCHOUT_TIPS];
    const typ = String(article.type || 'Security News').toLowerCase();
    if (typ.includes('phish')) {
      return ['Verify odd email requests using a channel you trust', 'Hover or long-press links before you tap them', 'Forward phishing samples to IT using their process'];
    }
    if (typ.includes('smish')) {
      return ['Ignore delivery or bank texts you were not expecting', 'Open shipper or bank sites only from URLs you type', 'Screenshot and report smishing texts to IT'];
    }
    if (typ.includes('breach') || typ.includes('data')) {
      return ['Change passwords you reused on other sites', 'Watch accounts for odd logins or charges', 'Turn on MFA where the breached service allows it'];
    }
    if (typ.includes('malware') || typ.includes('ransomware')) {
      return ['Do not open attachments you did not expect', 'Tell IT if files change extension or look encrypted', 'Keep backups only on approved company storage'];
    }
    if (typ.includes('scam') || typ.includes('fraud')) {
      return ['Slow down when someone pushes fast payment or secrecy', 'Confirm money asks with a separate call you start', 'Report gift-card or wire scams to IT right away'];
    }
    if (typ.includes('password') || typ.includes('mfa')) {
      return ['Turn on MFA on accounts that offer it', 'Use unique passwords with your approved password tool', 'Never share one-time codes with callers or chat'];
    }
    if (typ.includes('vulnerab') || typ.includes('advisory') || typ.includes('security news')) {
      return ['Install patches when IT or your device prompts you', 'Report odd software behavior or install prompts to IT', 'Use only approved stores and packages for work tools'];
    }
    return ['Stay alert — if something feels off, report it', 'Never share passwords or login codes with anyone', 'When in doubt, ask IT before you click'];
  }

  // ── Safety tips in PLAIN ENGLISH (ordered: more specific rules first) ──
  function generateTips(article) {
    const t = corpusForTips(article);
    const rules = [
      {
        match: SUPPLY_CHAIN_CORPUS_MARKERS,
        tips: SOFTWARE_SUPPLY_CHAIN_WATCHOUT_TIPS
      },
      {
        match: ['business email compromise', 'bec', 'ceo fraud', 'vendor email fraud', 'fake vendor', 'supplier fraud', 'wire instruction', 'bank account change'],
        tips: ['Confirm wire or vendor bank changes by phone you dial', 'Ignore pressure to skip normal finance checks', 'Use saved finance numbers, not ones from the email alone']
      },
      {
        match: ['paypal', 'venmo', 'zelle', 'fake invoice', 'invoice scam', 'payment request fraud', 'bogus invoice'],
        tips: ['Log into PayPal or banking from bookmarks you saved', 'Verify odd invoices with finance on a known number', 'Treat payment links in email as suspect until confirmed']
      },
      {
        match: ['tech support scam', 'fake tech support', 'remote access scam', 'anydesk', 'teamviewer', 'pop-up virus', 'fake microsoft'],
        tips: ['Never call support numbers shown only in pop-ups', 'Get help through your employer official IT channel', 'Close fake virus pages and report them to IT if they return']
      },
      {
        match: ['malvertising', 'rogue ad', 'google ads malware', 'search poisoning'],
        tips: ['Download software only from the vendor site you looked up', 'Avoid sponsored download buttons that look unofficial', 'Ask IT before installing helpers found through search ads']
      },
      {
        match: ['deepfake', 'voice clone', 'synthetic media', 'ai-generated voice'],
        tips: ['Verify voice or video payment asks with a callback you start', 'Use an agreed finance code word for large wires if your org has one', 'Report deepfake or fake exec calls to IT right away']
      },
      {
        match: ['fedex', 'dhl', 'ups', 'missed delivery', 'package delivery', 'delivery text', 'parcel scam'],
        tips: ['Ignore delivery texts when you are not expecting a package', 'Track orders only on the store or shipper site you trust', 'Report texts asking for card or login details to IT']
      },
      {
        match: ['smishing', 'sms phish', 'text message scam', 'text scam', 'whatsapp scam', 'telegram scam'],
        tips: ['Do not tap links in unexpected personal texts', 'Never share one-time codes or passwords over SMS or chat', 'Call the company using a number from their official site']
      },
      {
        match: ['vishing', 'voice phish', 'phone scam', 'scam call', 'fake call center'],
        tips: ['Hang up on callers asking for passwords or codes', 'Call back using a number from the company website', 'Never install remote access software for unknown callers']
      },
      {
        match: ['qr code', 'quishing', 'malicious qr'],
        tips: ['Do not scan QR codes from stickers or flyers you do not trust', 'Check the URL after scan before you log in', 'Report odd QR codes in the workplace to IT']
      },
      {
        match: ['session hijack', 'cookie steal', 'oauth token', 'token theft'],
        tips: ['Sign out of sensitive sites on shared or hotel computers', 'Clear site data on borrowed devices after use', 'Report repeated unexpected logouts to IT']
      },
      {
        match: ['gift card', 'itunes card', 'steam wallet', 'prepaid card scam'],
        tips: ['Refuse requests to buy gift cards for strangers or bosses', 'Know your employer will not ask for gift card payment', 'Report gift-card pressure scams to IT immediately']
      },
      {
        match: ['phish', 'fake email', 'suspicious email', 'spoof', 'spear phish'],
        tips: ['Do not click links in unexpected work emails', 'Check the full sender address before you reply', 'Report phishing using your company process']
      },
      {
        match: [
          'data breach', 'breach notification', 'records leaked', 'customer records', 'personal data exposed',
          'database breach', 'user data stolen', 'credential dump', 'password dump', 'data dump of',
          'information leak', 'millions of customers', 'customer data stolen', 'accounts compromised en masse'
        ],
        tips: ['Change passwords for affected services and reused logins', 'Turn on MFA where the service still allows it', 'Watch bank and work accounts for odd activity']
      },
      {
        match: ['password reuse', 'credential stuffing', 'brute force', 'stolen password', 'weak password', 'password dump'],
        tips: ['Use a different password for each important account', 'Turn on two-step login where it is offered', 'Change passwords if a service you use was breached']
      },
      {
        match: [
          'mfa fatigue', 'mfa bombing', 'mfa bypass', 'otp bombing', 'push bombing mfa', 'bypass multi-factor',
          'mandatory mfa', 'enforce mfa', 'mfa enrollment', 'roll out mfa', 'require two-factor',
          'two-factor authentication policy', 'multi-factor authentication policy', 'phishing-resistant mfa'
        ],
        tips: ['Turn on two-step login on accounts that support it', 'Never share login codes with callers or chat agents', 'Prefer an authenticator app over SMS when you can']
      },
      {
        match: ['ransomware', 'encrypt', 'ransom', 'locked files', 'file extension'],
        tips: ['Do not open unexpected email attachments', 'Tell IT right away if files look renamed or encrypted', 'Save important work only to approved backup locations']
      },
      {
        match: ['malware', 'trojan', 'virus', 'spyware', 'infostealer'],
        tips: ['Only install apps from official stores or IT-approved sources', 'Keep your work device updated when prompted', 'Tell IT if the browser or PC acts slow or strange']
      },
      {
        match: ['social engineer', 'impersonat', 'pretexting', 'pig butchering'],
        tips: ['Verify who you are talking to before sharing sensitive info', 'Do not trust callers only because they know your name', 'Check unusual requests with your manager or IT']
      },
      {
        match: ['scam', 'fraud', 'fake website', 'counterfeit shop'],
        tips: ['If an offer feels too good to be true, pause and verify', 'Pay only on sites you reached by typing the address', 'Report fraud attempts to IT using their template']
      },
      {
        match: ['clickfix', 'browser pop', 'fake error', 'paste command', 'powershell scam'],
        tips: ['Never paste commands from pop-up or chat instructions', 'Real IT will not ask you to disable security to fix errors', 'Close the tab and open a ticket with your real IT team']
      },
      {
        match: ['zero-day', '0-day', 'n-day', 'patch tuesday', 'security update'],
        tips: ['Apply security patches on work devices when IT tells you to', 'Restart after updates if your device asks', 'Report crashes after patching so IT can help']
      }
    ];

    for (const rule of rules) {
      if (rule.match.some(m => t.includes(m))) return rule.tips;
    }
    return defaultTipsForType(article);
  }

  function estimateLevel(article) {
    const t = corpusForTips(article);
    let lv = 2;
    if (t.includes('zero-day') || t.includes('0-day')) lv += 2;
    if (t.includes('active') && (t.includes('exploit') || t.includes('attack'))) lv += 1;
    if (t.includes('critical') || t.includes('urgent')) lv += 1;
    if (t.includes('phish') || t.includes('credential')) lv += 1;
    if (t.includes('ransomware')) lv += 1;
    if (t.includes('breach') || t.includes('leak')) lv += 1;
    if (t.includes('patch') && t.includes('available')) lv -= 1;
    return Math.max(1, Math.min(5, lv));
  }

  /** Latin-1–misread UTF-8 repair (common in email copy/paste). */
  function tryRepairMojibakeUtf8(s) {
    const str = String(s || '');
    if (!str.includes('â') && !str.includes('Ã')) return str;
    try {
      const bytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
      const fixed = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (fixed.includes('\uFFFD')) return str;
      if (fixed && fixed !== str) return fixed;
    } catch (_e) { /* ignore */ }
    return str;
  }

  function scrubTipSurface(s) {
    return tryRepairMojibakeUtf8(String(s || '').trim())
      .replace(/[`]+/g, '')
      .replace(/!+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Per-article tips (What you should do) — short imperative lines. */
  const WATCHOUT_MAX_CHARS = 60;
  const WATCHOUT_MAX_WORDS = 10;
  /** Key takeaways strip — very short employee actions. */
  const EDITION_TAKEAWAY_MAX_CHARS = 48;
  const EDITION_TAKEAWAY_MAX_WORDS = 8;
  const EDITION_TAKEAWAY_MIN_CHARS = 10;

  /** Dedupe / overlap checks for tips and edition lines. */
  function normalizeTipDedupeKey(s) {
    return scrubTipSurface(s).toLowerCase().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();
  }

  const UNSAFE_TIP_PATTERNS = /click\s+here|click\s+this|tap\s+here|tap\s+this|act\s+now|limited\s+time|verify\s+your\s+account|account\s+suspended|congratulations|you'?ve\s+won|wire\s+funds|send\s+bitcoin|pay\s+with\s+gift\s+cards?\s+over|bitcoin\s+atm|western\s+union|moneygram|reset\s+your\s+password\s+here|login\s+here|sign\s+in\s+here|\burgent!\b|\bURGENT\b|â€|âš|âœ/i;

  function softClampWords(s, maxWords) {
    const words = String(s || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    if (words.length <= maxWords) return words.join(' ');
    return words.slice(0, maxWords).join(' ');
  }

  /** Trim words then hard char cap (no mid-word cut unless unavoidable). */
  function finalizeShortLine(s, maxChars, maxWords) {
    const t = softClampWords(scrubTipSurface(s), maxWords);
    return clampStr(t, maxChars);
  }

  function isCalmEmployeeTip(t, maxLen, minLen = 8) {
    const u = String(t || '').trim();
    if (u.length < minLen || u.length > maxLen) return false;
    if (/\bhttps?:\/\//i.test(u)) return false;
    if (UNSAFE_TIP_PATTERNS.test(u)) return false;
    return true;
  }

  function sanitizeEmployeeTip(s, maxLen = 120) {
    const u = scrubTipSurface(s);
    if (!isCalmEmployeeTip(u, maxLen)) return '';
    return u.length <= maxLen ? u : `${u.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
  }

  /** Key takeaway line: imperative, employee-level, strict length. */
  function sanitizeTakeawayLine(s) {
    const t = finalizeShortLine(s, EDITION_TAKEAWAY_MAX_CHARS, EDITION_TAKEAWAY_MAX_WORDS);
    if (!isCalmEmployeeTip(t, EDITION_TAKEAWAY_MAX_CHARS, EDITION_TAKEAWAY_MIN_CHARS)) return '';
    return t;
  }

  function sanitizeWatchoutLine(s) {
    const t = finalizeShortLine(s, WATCHOUT_MAX_CHARS, WATCHOUT_MAX_WORDS);
    if (!isCalmEmployeeTip(t, WATCHOUT_MAX_CHARS)) return '';
    return t;
  }

  /** Generic account-hygiene lines that misread npm / CI / supply-chain stories. */
  function isGenericConsumerPasswordMfaWatchoutMisaligned(line, article) {
    if (!isSoftwareSupplyChainStory(article)) return false;
    const u = scrubTipSurface(line).toLowerCase();
    if (!u) return false;
    if (/\bdifferent password|\bfor each account\b|\beach account\b|\bunique passwords?\b.*\b(account|everywhere)\b/i.test(u)) return true;
    if (/two-step|two step|\bmfa\b.*everywhere|turn on mfa everywhere|enable mfa everywhere|mfa on every/i.test(u)) return true;
    if (/change (your )?password(s)? if.*breach|breach.*change (your )?password/i.test(u)) return true;
    if (/\bturn on two-step\b|\bturn on mfa\b(?!\s+where)/i.test(u) && /everywhere|all accounts|each account/i.test(u)) return true;
    return false;
  }

  /** Edition takeaway lines that dilute a supply-chain–heavy send. */
  function takeawayMisalignedWithSupplyEdition(line, articles) {
    if (!editionHasSupplyChain(articles)) return false;
    const u = scrubTipSurface(line).toLowerCase();
    if (!u) return false;
    if (/\battachment|unexpected.*link|avoid unexpected attachments/i.test(u)) return true;
    if (/\bdifferent password|each account|two-step|two step|\bmfa\b.*everywhere|unique passwords everywhere|strong unique passwords/i.test(u)) return true;
    return false;
  }

  /** Longer imperative lines for newsletter template blocks (Do/Don't, spotlight defence rows). */
  const SLOT_MAX_CHARS = 118;
  const SLOT_MAX_WORDS = 16;

  function sanitizeTemplateSlotLine(s) {
    const t = finalizeShortLine(s, SLOT_MAX_CHARS, SLOT_MAX_WORDS);
    if (!isCalmEmployeeTip(t, SLOT_MAX_CHARS, 6)) return '';
    return t;
  }

  function dedupeTemplateLines(lines) {
    const out = [];
    const seen = new Set();
    for (const raw of lines) {
      const t = typeof raw === 'string' ? sanitizeTemplateSlotLine(raw) : sanitizeTemplateSlotLine(String(raw || ''));
      if (!t) continue;
      const k = normalizeTipDedupeKey(t);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }

  const DEFAULT_DODONT_DOS = [
    "Check the sender's full email address before you reply",
    'Hover over links to see the real destination URL',
    'Use unique passwords with your approved password tool',
    'Turn on MFA everywhere your org allows it',
    'Report suspicious messages through your IT security channel',
    'Call the person to verify unusual payment or access requests'
  ];

  const DEFAULT_DODONT_DONTS = [
    'Click links in unexpected emails or text messages',
    'Share passwords, MFA codes, or recovery codes with anyone',
    'Open attachments you were not expecting from that sender',
    'Trust caller ID or chat display names alone for sensitive asks',
    'Rush when someone creates urgency—pause and verify first',
    'Reuse the same password across work and personal accounts'
  ];

  const SPOTLIGHT_DEFENCE_DEFAULTS = [
    "Check the sender's full email address",
    'Hover over links before you click',
    'Call to verify unusual payment or access requests',
    'Report suspicious messages to IT using the posted process',
    'Use MFA on accounts that support it',
    'Never share passwords or one-time codes by email or chat'
  ];

  const SPOTLIGHT_TACTICS_DEFAULT = [
    { icon: '🎭', tactic: 'They impersonate someone you trust', detail: 'Boss, IT, bank, or vendor — sometimes with logos copied from real brands.' },
    { icon: '⏰', tactic: 'They create urgency and fear', detail: 'Pressure to act before you can check facts or ask IT for guidance.' },
    { icon: '🔗', tactic: 'They hide dangerous links in normal-looking text', detail: 'Displayed text may not match the real web address underneath.' },
    { icon: '🤖', tactic: 'They use polished wording or AI-assisted copy', detail: 'Good grammar alone does not prove a message is legitimate.' }
  ];

  function mergedArticleForEditionTips(articles = []) {
    const list = (Array.isArray(articles) ? articles : []).filter(a => a && (a.title || a.description)).slice(0, 6);
    if (!list.length) return { title: 'Security', description: '', type: 'Security News' };
    return {
      title: list.map(a => a.title).join(' · '),
      description: list.map(a => [a.title, a.summary || '', a.description || ''].filter(Boolean).join('\n')).join('\n\n'),
      type: list[0].type || 'Security News'
    };
  }

  function localDoLinesFromArticles(articles = []) {
    const list = (Array.isArray(articles) ? articles : []).filter(a => a && (a.title || a.description));
    const merged = mergedArticleForEditionTips(list);
    const out = [];
    for (const a of list) {
      for (const w of a.watchouts || []) {
        const t = sanitizeWatchoutLine(w);
        if (t) out.push(t);
      }
    }
    for (const t of generateTips(merged)) {
      const u = sanitizeWatchoutLine(t) || sanitizeTemplateSlotLine(t);
      if (u) out.push(u);
    }
    let deduped = dedupeTemplateLines(out);
    for (const fill of DEFAULT_DODONT_DOS) {
      if (deduped.length >= 6) break;
      deduped = dedupeTemplateLines([...deduped, fill]);
    }
    return deduped.slice(0, 6);
  }

  function localDontLinesFromArticles(articles = []) {
    const list = (Array.isArray(articles) ? articles : []).filter(a => a && (a.title || a.description));
    const t = combinedCorpusForSlots(list);
    const candidates = [];

    const RULES = [
      {
        match: ['supply chain', 'supply-chain', 'npm', 'pypi', 'rubygems', 'package.json', 'malicious package', 'lockfile', 'github actions', 'github action', 'ci/cd', 'build pipeline', 'registry token', 'npm token', 'postinstall', 'sbom'],
        lines: [
          'Approve dependency or CI changes without peer or security review',
          'Paste repo, registry, or cloud tokens into chat, email, or public tickets',
          'Run install scripts from unfamiliar packages on build or dev machines',
          'Skip comparing lockfiles or hashes before promoting to production',
          'Store long-lived CI secrets in plaintext config outside the vault',
          'Download internal packages from unofficial mirrors or random URLs'
        ]
      },
      {
        match: ['phish', 'spear', 'credential harvesting', 'fake login', 'spoofed sender'],
        lines: [
          'Click login or reset links from email or SMS you did not expect',
          'Send MFA codes or passwords to someone who contacted you first',
          'Trust display names or logos as proof of who really sent the message',
          'Open compressed attachments claiming to be invoices or HR forms',
          'Reply to BEC-style threads without confirming on a known number',
          'Use links in password-reset mail without checking the real domain'
        ]
      },
      {
        match: ['smish', 'sms', 'text message', 'fake delivery'],
        lines: [
          'Tap shortened links in surprise delivery or bank texts',
          'Call phone numbers only shown inside a suspicious SMS thread',
          'Install apps from texts that promise refunds or package tracking',
          'Share one-time codes after an unexpected text about your account',
          'Assume a text is genuine because it uses your first name',
          'Forward smishing screenshots without reporting them to IT first'
        ]
      },
      {
        match: ['ransomware', 'malware', 'trojan', 'macro'],
        lines: [
          'Enable macros on documents you did not ask someone to send',
          'Plug unknown USB drives into work laptops or kiosks',
          'Disable endpoint alerts because they feel inconvenient',
          'Run cracked or unlicensed software from unofficial download sites',
          'Ignore sudden file renames or ransom notes on shared drives',
          'Delay reporting possible infection to avoid a short disruption'
        ]
      },
      {
        match: ['breach', 'leak', 'exposed database', 'customer data'],
        lines: [
          'Reuse the same password on breached services and internal tools',
          'Ignore breach notifications because nothing looks wrong yet',
          'Share breach screenshots with personal contacts before IT clears it',
          'Assume vendor breach notices do not apply to integrations you use',
          'Delay rotating API keys that pointed at the affected vendor',
          'Post internal incident details on public social channels'
        ]
      },
      {
        match: ['deepfake', 'voice clone', 'synthetic media'],
        lines: [
          'Wire funds based only on a voice that sounds like leadership',
          'Skip callback verification because the video call looked authentic',
          'Share confidential data in real time with unvetted new contacts',
          'Disable recording policies solely to speed up a rushed request',
          'Trust urgent executive asks that bypass normal finance controls',
          'Assume video quality proves identity without a second factor'
        ]
      }
    ];

    for (const r of RULES) {
      if (r.match.some(k => t.includes(k))) {
        for (const line of r.lines) candidates.push(line);
      }
    }

    const merged = mergedArticleForEditionTips(list);
    const typ = String(merged.type || '').toLowerCase();
    if (!candidates.length) {
      if (typ.includes('phish')) RULES[1].lines.forEach(l => candidates.push(l));
      else if (typ.includes('smish')) RULES[2].lines.forEach(l => candidates.push(l));
      else if (typ.includes('malware') || typ.includes('ransom')) RULES[3].lines.forEach(l => candidates.push(l));
      else if (typ.includes('breach') || typ.includes('data')) RULES[4].lines.forEach(l => candidates.push(l));
      else DEFAULT_DODONT_DONTS.forEach(l => candidates.push(l));
    }

    let deduped = dedupeTemplateLines(candidates);
    if (deduped.length < 6) deduped = dedupeTemplateLines([...deduped, ...DEFAULT_DODONT_DONTS]);
    while (deduped.length < 6) {
      deduped = dedupeTemplateLines([...deduped, ...DEFAULT_DODONT_DONTS]);
      if (deduped.length >= 6) break;
    }
    return deduped.slice(0, 6);
  }

  function combinedCorpusForSlots(list) {
    return list.map(a => `${a.title || ''} ${a.summary || ''} ${a.description || ''} ${a.type || ''}`).join(' ').toLowerCase();
  }

  function localSpotlightTacticsFromArticles(articles = []) {
    const list = (Array.isArray(articles) ? articles : []).filter(a => a && (a.title || a.description)).slice(0, 6);
    const icons = ['📰', '⏱', '🔗', '🛰', '📦', '☁️'];
    const tactics = [];
    let i = 0;
    for (const a of list) {
      if (tactics.length >= 4) break;
      const summ = sanitizeSummaryProse((a.summary || a.description || '').replace(/\s+/g, ' ').trim());
      const detail = clampStr(summ, 140) || 'Review the summary with IT if the risk could affect your role.';
      const typeLbl = String(a.type || 'Threat').trim();
      const tactic = sanitizeTemplateSlotLine(`${typeLbl}: ${clampStr(a.title || 'Incident', 72)}`) || sanitizeTemplateSlotLine(clampStr(a.title || 'Incident', 90));
      if (!tactic) continue;
      tactics.push({ icon: icons[i % icons.length], tactic, detail });
      i++;
    }
    while (tactics.length < 4) {
      const d = SPOTLIGHT_TACTICS_DEFAULT[tactics.length];
      tactics.push({ icon: d.icon, tactic: d.tactic, detail: d.detail });
    }
    return tactics.slice(0, 4);
  }

  function localSpotlightDefenceFromArticles(articles = []) {
    const list = (Array.isArray(articles) ? articles : []).filter(a => a && (a.title || a.description));
    const out = [];
    for (const a of list) {
      for (const w of a.watchouts || []) {
        const u = sanitizeTemplateSlotLine(w) || sanitizeWatchoutLine(w);
        if (u) out.push(u);
      }
    }
    const take = localNewsletterTakeaways(list);
    const merged = dedupeTemplateLines([...out, ...take]);
    if (merged.length >= 6) return merged.slice(0, 6);
    return dedupeTemplateLines([...merged, ...SPOTLIGHT_DEFENCE_DEFAULTS]).slice(0, 6);
  }

  const TEMPLATE_SLOTS_SYSTEM = `${EMPLOYEE_VOICE_BLOCK}

You are a senior security-comms writer producing slot copy for an internal newsletter builder. ${STYLE_BLOCK}
Output: JSON only, exactly the keys requested in the user message. Each string must be defensible from the provided Stories JSON—no invented incidents, no URLs, no scam tone, no exclamation marks, no filler phrases ("it is important to note", "remember that", "in today's world"). Prefer concrete nouns from the articles over generic security platitudes.`;

  const BANKPAGE_SLOTS_SYSTEM = `${EMPLOYEE_VOICE_BLOCK}

You are filling four sections of an internal security-awareness newsletter for all staff. The threat topic of this edition is determined entirely by the articles in the user message — it may be phishing, ransomware, supply-chain compromise, data breach, smishing, scams, vulnerabilities, insider risk, or any mix. Do not assume any topic; let the articles dictate the focus. Ground every line in those articles — never invent facts, vendors, victims, statistics, CVEs, or details not present there. Paraphrase what the attackers in the articles are actually doing, then translate that into practical guidance for non-technical readers.

${STYLE_BLOCK}

Output: a single JSON object with exactly these keys (no markdown fences, no extra keys, no nulls):
{
  "intro": "string — see SECTION 1 in user message",
  "section1Bullets": ["...", "...", "...", "..."],
  "section2Bullets": ["...", "...", "..."],
  "section3Bullets": ["...", "...", "..."]
}`;

  function templateSlotsCompactStories(articles = [], mode = 'balanced') {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    return (Array.isArray(articles) ? articles : []).slice(0, 8).map(a => ({
      title: a.title,
      type: a.type,
      summary: truncate(a.summary || a.description || '', modeCfg.maxContentChars)
    }));
  }

  function buildBankPageUserPrompt(articles = [], mode = 'balanced') {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const compact = (Array.isArray(articles) ? articles : []).slice(0, 6).map(a => ({
      title: a.title,
      source: a.source,
      type: a.type,
      pubDate: a.pubDate,
      summary: truncate(a.summary || a.description || '', 600)
    }));
    return `You are writing four specific sections for one issue of an internal security awareness bulletin. Audience: general office staff with no IT or cybersecurity background. The topic of this edition is whatever the articles below describe — do not assume phishing or any other category in advance.

ARTICLES (full context — every line you write must be supported by these facts):
${JSON.stringify(compact)}

CURATION MODE: ${modeCfg.label}

Return JSON exactly as the schema in your system instructions requires. Section-specific rules below.

────────────
SECTION 1 — "intro" (one paragraph that immediately follows the salutation "Dear Colleague,")
- 2 or 3 sentences, max 55 words total.
- Name what the attackers / criminals / scammers in these specific articles are doing right now. The behaviour MUST come from the article summaries (whether that is impersonating IT, faking delivery texts, deploying ransomware, poisoning npm packages, exploiting a CVE, exfiltrating data, etc.). Use plain words like "attackers", "scammers", "criminals", "fraudsters". Do not use "threat actors", "adversaries", "TTPs", or any jargon.
- Last sentence: a short, calm reason this matters for the reader personally — again grounded in what the articles describe, not generic.
- No bullet points. No URLs. No exclamation marks.

────────────
SECTION 2 — "section1Bullets" — exactly 4 bullets under "How to spot a fraudulent message"
- Target distribution: 2 red flags per article when there are 2 articles. If one article does not yield 2 distinct red flags without forcing it, split 3-and-1 instead. Quality of each bullet beats strict distribution.
- Each bullet is a concrete signal a reader could notice in their own inbox, browser, phone, dev environment, or workflow — drawn directly from the tactic the matching article describes. If the article is about phishing, write phishing signals; if it is about a malicious package, write package/build signals; if it is about smishing, write SMS signals; etc.
- Max 16 words, max 110 characters per bullet. No bullet may be generic enough to apply to an unrelated article.

────────────
SECTION 3 — "section2Bullets" — exactly 3 bullets under "What you should remember"
- The 3 most important things readers must remember in light of these articles taken together. Pick the obvious, high-leverage lessons that match the actual threat mix of this edition.
- Must draw on both articles. One bullet may combine the lesson from both; the other two should each anchor in at least one article.
- Max 18 words, max 130 characters per bullet. Plain language.

────────────
SECTION 4 — "section3Bullets" — exactly 3 bullets under "Stay safe"
- Direct, immediate actions a reader can take today, tied to the threats in these specific articles. The action must match the article: verify a sender for phishing, lock down package install workflows for supply-chain stories, change a leaked credential for breach stories, report a suspicious text for smishing, patch a specific advisory if named in the article, etc.
- Each bullet must reference something specific from the articles — not generic "be vigilant" advice.
- Max 16 words, max 110 characters per bullet.

Rules across all four sections: no URLs, no exclamation marks, no rhetorical questions, no scam-style urgency, no filler phrases, no topic assumptions beyond what the articles state. Output JSON only — no markdown fences, no commentary.`;
  }

  /** Request 1 of 2 for Do/Don't template (dos column only). */
  function buildTemplateSlotsUserPromptDosOnly(articles = [], mode = 'balanced') {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const compact = templateSlotsCompactStories(articles, mode);
    return `Template: Do vs Don't — **Dos column only** (request 1 of 2).

Return ONLY valid JSON (no markdown) with this single key:
- "dos": array of exactly 6 strings. Safe behaviors staff should follow, each explicitly tied to a risk or channel visible in the stories (headlines, types, summaries)—not generic security slogans.

Rules for each string: imperative mood, max ${SLOT_MAX_WORDS} words, max ${SLOT_MAX_CHARS} characters including spaces, no URLs, no emoji.
Before returning: ensure each line could only apply to this edition's topics (swap-in test: if a line would still make sense for unrelated news, rewrite it).

Mode: ${modeCfg.label}

Stories (JSON):
${JSON.stringify(compact)}`;
  }

  /** Request 2 of 2 for Do/Don't template (donts column only). */
  function buildTemplateSlotsUserPromptDontsOnly(articles = [], mode = 'balanced') {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const compact = templateSlotsCompactStories(articles, mode);
    return `Template: Do vs Don't — **Don'ts column only** (request 2 of 2).

Return ONLY valid JSON (no markdown) with this single key:
- "donts": array of exactly 6 strings. Risky or wrong behaviors to avoid, phrased as short wrong actions (e.g. "Click unexpected reset links") — not prefixed with "Don't". Each line must match a concrete mistake suggested by these stories—not interchangeable generic lines.

Rules for each string: imperative mood, max ${SLOT_MAX_WORDS} words, max ${SLOT_MAX_CHARS} characters including spaces, no URLs, no emoji.
Before returning: each line should fail the "any week" test — it must reflect a mistake someone could make in the specific threats described.

Mode: ${modeCfg.label}

Stories (JSON):
${JSON.stringify(compact)}`;
  }

  function buildTemplateSlotsUserPromptDoDont(articles = [], mode = 'balanced') {
    return `${buildTemplateSlotsUserPromptDosOnly(articles, mode)}\n\n---\n\n${buildTemplateSlotsUserPromptDontsOnly(articles, mode)}`;
  }

  /** Request 1 of 2 for spotlight template (tactics grid only). */
  function buildTemplateSlotsUserPromptTacticsOnly(articles = [], mode = 'balanced') {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const compact = templateSlotsCompactStories(articles, mode);
    return `Template: Threat spotlight — **tactics grid only** (request 1 of 2).

Return ONLY valid JSON (no markdown) with this single key:
- "tactics": array of exactly 4 objects, each: "icon" (single emoji), "tactic" (short headline, max 72 chars), "detail" (one sentence, max 140 chars). Each object must reflect a tactic or theme from the stories below—not filler rows. "detail" must restate something specific from the matching story summary where possible.

Mode: ${modeCfg.label}

Stories (JSON):
${JSON.stringify(compact)}`;
  }

  /** Request 2 of 2 for spotlight template (defence checklist only). */
  function buildTemplateSlotsUserPromptDefenceOnly(articles = [], mode = 'balanced') {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const compact = templateSlotsCompactStories(articles, mode);
    return `Template: Threat spotlight — **defence checklist only** (request 2 of 2).

Return ONLY valid JSON (no markdown) with this single key:
- "defenceLines": array of exactly 6 short imperative defence actions for staff, max ${SLOT_MAX_WORDS} words and ${SLOT_MAX_CHARS} chars each, no URLs, no filler. Each line must map to a risk theme in the stories—not generic advice that could apply to any edition. Prefer one actionable clause per line.

Mode: ${modeCfg.label}

Stories (JSON):
${JSON.stringify(compact)}`;
  }

  function buildTemplateSlotsUserPromptSpotlight(articles = [], mode = 'balanced') {
    return `${buildTemplateSlotsUserPromptTacticsOnly(articles, mode)}\n\n---\n\n${buildTemplateSlotsUserPromptDefenceOnly(articles, mode)}`;
  }

  /** Read-only: prompts used when AI fills Do/Don't and spotlight slots. */
  function previewNewsletterTemplateSlotsPrompts(formatId, articles = [], options = {}) {
    const mode = options.mode || 'balanced';
    if (formatId === 'dodont') {
      return {
        systemPrompt: TEMPLATE_SLOTS_SYSTEM,
        userPrompt: buildTemplateSlotsUserPromptDoDont(articles, mode),
        userPromptDos: buildTemplateSlotsUserPromptDosOnly(articles, mode),
        userPromptDonts: buildTemplateSlotsUserPromptDontsOnly(articles, mode),
        mode
      };
    }
    if (formatId === 'spotlight') {
      return {
        systemPrompt: TEMPLATE_SLOTS_SYSTEM,
        userPrompt: buildTemplateSlotsUserPromptSpotlight(articles, mode),
        userPromptTactics: buildTemplateSlotsUserPromptTacticsOnly(articles, mode),
        userPromptDefence: buildTemplateSlotsUserPromptDefenceOnly(articles, mode),
        mode
      };
    }
    if (formatId === 'poster') {
      return { systemPrompt: TEMPLATE_SLOTS_SYSTEM, userPrompt: buildCorporateTopicUserPrompt(articles, mode), mode };
    }
    return { systemPrompt: '', userPrompt: '', mode };
  }

  async function callTemplateSlotsAI(userPrompt, slotOpts = {}) {
    const system = slotOpts.systemPrompt != null ? slotOpts.systemPrompt : TEMPLATE_SLOTS_SYSTEM;
    const max_tokens = slotOpts.maxTokens != null ? slotOpts.maxTokens : 900;
    let raw;
    if (config.provider === 'claude' && config.claudeKey) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.claudeKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: config.claudeModel,
          max_tokens,
          temperature: 0.15,
          system,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const d = await resp.json();
      raw = d.content?.[0]?.text || '';
    } else if (config.provider === 'openai' && config.openaiKey) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
        body: JSON.stringify(openAIChatCompletionsBody(system, userPrompt, max_tokens, 0.08))
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const d = await resp.json();
      raw = d.choices?.[0]?.message?.content || '';
    } else {
      throw new Error('No API key');
    }
    const cleaned = String(raw).replace(/```json\s*|```\s*/g, '').trim();
    return JSON.parse(cleaned);
  }

  async function aiFillDoDontSlots(articles, mode, retries = 0) {
    const base = {
      nlDoDontDos: localDoLinesFromArticles(articles),
      nlDoDontDonts: localDontLinesFromArticles(articles)
    };
    const slotTok = { maxTokens: 520 };
    try {
      const p1 = await callTemplateSlotsAI(buildTemplateSlotsUserPromptDosOnly(articles, mode), slotTok);
      const dos = dedupeTemplateLines(Array.isArray(p1.dos) ? p1.dos : []);
      await App.Utils.wait(220);
      let donts = base.nlDoDontDonts;
      try {
        const p2 = await callTemplateSlotsAI(buildTemplateSlotsUserPromptDontsOnly(articles, mode), slotTok);
        const d2 = dedupeTemplateLines(Array.isArray(p2.donts) ? p2.donts : []);
        if (d2.length >= 6) donts = d2.slice(0, 6);
      } catch {
        donts = base.nlDoDontDonts;
      }
      return {
        nlDoDontDos: dos.length >= 6 ? dos.slice(0, 6) : base.nlDoDontDos,
        nlDoDontDonts: donts.length >= 6 ? donts : base.nlDoDontDonts
      };
    } catch {
      if (retries < config.retryAttempts) {
        await App.Utils.wait(config.retryDelayMs * (retries + 1));
        return aiFillDoDontSlots(articles, mode, retries + 1);
      }
      return base;
    }
  }

  function normalizeSpotlightTactic(obj, fallback, index) {
    const f = fallback[index] || SPOTLIGHT_TACTICS_DEFAULT[index];
    if (!obj || typeof obj !== 'object') return { ...f };
    const icon = scrubTipSurface(String(obj.icon || f.icon || '📌')).slice(0, 4) || f.icon;
    const tactic = sanitizeTemplateSlotLine(String(obj.tactic || '')) || f.tactic;
    const detailRaw = sanitizeSummaryProse(String(obj.detail || ''));
    const detail = clampStr(detailRaw, 140) || f.detail;
    return { icon, tactic, detail };
  }

  const CORP_TOPIC_MAX_CHARS = 340;

  /** Corporate Alert topic card title (fixed; body must read as edition focus). */
  const CORPORATE_TOPIC_HEADING = 'Edition focus';

  /**
   * Up to two complete sentences; prefer whole sentences under maxChars (no mid-word ellipsis).
   */
  function finalizeCorporateTopicBlurb(text, maxChars = CORP_TOPIC_MAX_CHARS) {
    let t = sanitizeSummaryProse(String(text || ''));
    if (!t) return '';
    const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean).filter((s) => s.length > 8);
    if (!sentences.length) return clampStr(t, maxChars);
    const one = sentences[0];
    const two = sentences.slice(0, 2).join(' ');
    if (two.length <= maxChars) return two;
    if (one.length <= maxChars) return one;
    let cut = one.slice(0, maxChars);
    const sp = cut.lastIndexOf(' ');
    if (sp > Math.floor(maxChars * 0.55)) cut = cut.slice(0, sp);
    cut = cut.trim();
    if (!/[.!?]$/.test(cut)) cut += '.';
    return cut;
  }

  function formatTypePhraseForTopic(types = []) {
    const t = types.filter(Boolean);
    if (!t.length) return 'current security';
    if (t.length === 1) return t[0];
    if (t.length === 2) return `${t[0]} and ${t[1]}`;
    return `${t.slice(0, -1).join(', ')}, and ${t[t.length - 1]}`;
  }

  function localCorporateTopicBlurb(articles = []) {
    const list = (Array.isArray(articles) ? articles : []).filter((a) => a && (a.title || a.description));
    if (!list.length) {
      return finalizeCorporateTopicBlurb(
        'This edition focuses on active security themes relevant to all staff. Use the items below to see what is in scope for this send and how to respond through official channels.',
        CORP_TOPIC_MAX_CHARS
      );
    }
    const types = [...new Set(list.map((a) => String(a.type || '').trim()).filter(Boolean))];
    const typePhrase = formatTypePhraseForTopic(types);
    const lead = list[0];
    const corpus = [lead.summary, lead.description].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const s1 = `This edition focuses on ${typePhrase}: these are the priority themes for this send and what the following items expand on.`;
    let s2 = '';
    if (corpus.length > 36) {
      const segs = corpus.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
      s2 = (segs[0] && segs[0].length >= 20 ? segs[0] : corpus).trim();
      if (s2.length > 220) {
        const cut = s2.slice(0, 220);
        const sp = cut.lastIndexOf(' ');
        s2 = (sp > 100 ? cut.slice(0, sp) : cut).trim();
      }
      if (s2 && !/[.!?]$/.test(s2)) s2 += '.';
    } else {
      const tips = generateTips(mergedArticleForEditionTips(list));
      s2 = (tips[0] || 'Verify unusual requests through a channel you trust before you act.').trim();
      if (s2 && !/[.!?]$/.test(s2)) s2 += '.';
    }
    return finalizeCorporateTopicBlurb(`${s1} ${s2}`.trim(), CORP_TOPIC_MAX_CHARS);
  }

  function buildCorporateTopicUserPrompt(articles = [], mode = 'balanced') {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const compact = (Array.isArray(articles) ? articles : []).slice(0, 8).map((a) => ({
      title: a.title,
      type: a.type,
      summary: truncate(a.summary || a.description || '', modeCfg.maxContentChars)
    }));
    return `Template: Corporate Alert — card body for the fixed title "Edition focus" (the template supplies the title; do not invent a different title).

Return ONLY valid JSON (no markdown) with one key:
- "nlCorporateTopicBlurb": string, exactly 1 or 2 complete sentences, at most ${CORP_TOPIC_MAX_CHARS} characters. Do not end with an ellipsis or a cut-off word.

Blurb must read as the edition focus under that heading:
- Sentence 1: what this edition is centering on (threat themes or incidents in the stories) and why that is the focus now — use themes that appear in the JSON, not generic "cyber" language.
- Sentence 2 (optional): what staff should keep in view for this edition (verify, report, patch, or channel-specific care) tied directly to that focus — not a generic slogan.

Tone: internal advisory (CERT/CISA-style), factual, no rhetorical questions, no exclamation marks, no URLs, no filler phrases ("it is important to note", "remember that", "in today's world"). Do not invent vendors, numbers, or incidents not present in the stories.

Mode: ${modeCfg.label}

Stories (JSON):
${JSON.stringify(compact)}`;
  }

  async function aiFillCorporateTopicBlurb(articles, mode, retries = 0) {
    const prompt = buildCorporateTopicUserPrompt(articles, mode);
    const localB = localCorporateTopicBlurb(articles);
    const out = { nlCorporateTopicBlurb: localB, nlCorporateTopicHeading: CORPORATE_TOPIC_HEADING };
    try {
      const p = await callTemplateSlotsAI(prompt);
      const raw = p.nlCorporateTopicBlurb != null ? String(p.nlCorporateTopicBlurb) : '';
      const cleaned = finalizeCorporateTopicBlurb(raw, CORP_TOPIC_MAX_CHARS);
      out.nlCorporateTopicBlurb = cleaned || localB;
      return out;
    } catch {
      if (retries < config.retryAttempts) {
        await App.Utils.wait(config.retryDelayMs * (retries + 1));
        return aiFillCorporateTopicBlurb(articles, mode, retries + 1);
      }
      return out;
    }
  }

  async function aiFillSpotlightSlots(articles, mode, retries = 0) {
    const localT = localSpotlightTacticsFromArticles(articles);
    const localD = localSpotlightDefenceFromArticles(articles);
    const slotTokT = { maxTokens: 720 };
    const slotTokD = { maxTokens: 520 };
    try {
      const p1 = await callTemplateSlotsAI(buildTemplateSlotsUserPromptTacticsOnly(articles, mode), slotTokT);
      const rawT = Array.isArray(p1.tactics) ? p1.tactics : [];
      const tactics = [];
      for (let i = 0; i < 4; i++) {
        tactics.push(normalizeSpotlightTactic(rawT[i], localT, i));
      }
      await App.Utils.wait(220);
      let defenceLines = localD;
      try {
        const p2 = await callTemplateSlotsAI(buildTemplateSlotsUserPromptDefenceOnly(articles, mode), slotTokD);
        const defRaw = Array.isArray(p2.defenceLines) ? p2.defenceLines : [];
        defenceLines = dedupeTemplateLines(defRaw);
        if (defenceLines.length < 6) defenceLines = dedupeTemplateLines([...defenceLines, ...localD, ...SPOTLIGHT_DEFENCE_DEFAULTS]);
      } catch {
        defenceLines = localD;
      }
      defenceLines = defenceLines.slice(0, 6);
      return { nlSpotlightTactics: tactics, nlSpotlightDefenceLines: defenceLines };
    } catch {
      if (retries < config.retryAttempts) {
        await App.Utils.wait(config.retryDelayMs * (retries + 1));
        return aiFillSpotlightSlots(articles, mode, retries + 1);
      }
      return { nlSpotlightTactics: localT, nlSpotlightDefenceLines: localD };
    }
  }

  function localBankPageSlots(/* articles */) {
    return {};
  }

  function sanitizeBankPageIntro(raw, maxChars = 400) {
    const u = scrubTipSurface(String(raw || '').trim()).replace(/https?:\/\/\S+/gi, '').trim();
    if (u.length < 20) return '';
    if (u.length <= maxChars) return u;
    const cut = u.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    return (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut).trim();
  }

  function sanitizeBankPageBullet(raw, maxChars = 140) {
    const u = scrubTipSurface(String(raw || '').trim()).replace(/https?:\/\/\S+/gi, '').trim();
    if (u.length < 6) return '';
    if (u.length <= maxChars) return u;
    const cut = u.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 50 ? cut.slice(0, lastSpace) : cut).trim() + '…';
  }

  async function aiFillBankPageSlots(articles, mode = 'balanced', retries = 0) {
    const slotTok = { systemPrompt: BANKPAGE_SLOTS_SYSTEM, maxTokens: 1100 };
    try {
      const parsed = await callTemplateSlotsAI(buildBankPageUserPrompt(articles, mode), slotTok);
      const intro = sanitizeBankPageIntro(parsed.intro);
      const s1 = (Array.isArray(parsed.section1Bullets) ? parsed.section1Bullets : [])
        .slice(0, 4).map(b => sanitizeBankPageBullet(b, 130)).filter(Boolean);
      const s2 = (Array.isArray(parsed.section2Bullets) ? parsed.section2Bullets : [])
        .slice(0, 3).map(b => sanitizeBankPageBullet(b, 150)).filter(Boolean);
      const s3 = (Array.isArray(parsed.section3Bullets) ? parsed.section3Bullets : [])
        .slice(0, 3).map(b => sanitizeBankPageBullet(b, 130)).filter(Boolean);
      if (!intro || s1.length < 3 || s2.length < 2 || s3.length < 2) {
        throw new Error('bank page slots underfilled');
      }
      return {
        nlBankPageIntro: intro,
        nlBankPageRedFlags: s1,
        nlBankPageRemember: s2,
        nlBankPageStaySafe: s3
      };
    } catch {
      if (retries < config.retryAttempts) {
        await App.Utils.wait(config.retryDelayMs * (retries + 1));
        return aiFillBankPageSlots(articles, mode, retries + 1);
      }
      return localBankPageSlots(articles);
    }
  }

  /**
   * Fills per-template text slots from the selected articles (AI when configured, else local heuristics).
   * Merge the returned object into newsletter cfg before NewsletterBuilder.build.
   */
  async function fillNewsletterTextSlots(formatId, articles = [], options = {}) {
    const mode = options.mode || 'balanced';
    const list = (Array.isArray(articles) ? articles : []).filter(a => a && (a.title || a.description));
    const useAI = options.forceLocal ? false : isAIAvailable();
    if (formatId === 'dodont') {
      if (useAI) return aiFillDoDontSlots(list, mode);
      return {
        nlDoDontDos: localDoLinesFromArticles(list),
        nlDoDontDonts: localDontLinesFromArticles(list)
      };
    }
    if (formatId === 'spotlight') {
      if (useAI) return aiFillSpotlightSlots(list, mode);
      return {
        nlSpotlightTactics: localSpotlightTacticsFromArticles(list),
        nlSpotlightDefenceLines: localSpotlightDefenceFromArticles(list)
      };
    }
    if (formatId === 'poster') {
      if (useAI) return aiFillCorporateTopicBlurb(list, mode);
      return {
        nlCorporateTopicBlurb: localCorporateTopicBlurb(list),
        nlCorporateTopicHeading: CORPORATE_TOPIC_HEADING
      };
    }
    if (formatId === 'bankpage1_static' || formatId === 'bankpage1_dynamic') {
      if (useAI) return aiFillBankPageSlots(list, mode);
      return localBankPageSlots(list);
    }
    return {};
  }

  function sanitizeWatchoutsForArticle(raw, article) {
    const out = [];
    const seen = new Set();
    const pushUnique = (line) => {
      const t = sanitizeWatchoutLine(line);
      if (!t) return;
      const k = normalizeTipDedupeKey(t);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(t);
    };
    if (Array.isArray(raw)) {
      for (const line of raw) {
        if (isGenericConsumerPasswordMfaWatchoutMisaligned(line, article)) continue;
        pushUnique(line);
      }
    }
    const fallback = generateTips(article);
    for (const f of fallback) {
      if (out.length >= 3) break;
      pushUnique(f);
    }
    while (out.length < 3) pushUnique('When in doubt, ask IT before you click');
    return out.slice(0, 3);
  }

  const EDITION_ACTION_BY_TYPE = {
    Phishing: 'Verify senders before you click links',
    'Password & MFA': 'Turn on MFA for important accounts',
    'Data Breach': 'Change reused passwords on other sites',
    Ransomware: 'Avoid unexpected attachments and links',
    'Social Engineering': 'Confirm money asks using a number you dial',
    Malware: 'Keep devices updated and use official stores',
    'Scam & Fraud': 'Slow down on urgent money or gift asks',
    Vulnerability: 'Apply security updates as soon as you can',
    Advisory: 'Read IT notices and follow posted steps',
    'Insider Threat': 'Keep work data in approved tools only',
    'Security News': 'Report strange messages to IT security',
    Smishing: 'Do not tap links in surprise SMS messages'
  };

  const GENERIC_EDITION_LINES = [
    'Report phishing and spam to IT',
    'Use strong unique passwords everywhere',
    'Never share MFA codes with anyone',
    'Lock your screen when you step away'
  ];

  /** Short edition lines when any story is software supply chain / dev tooling risk. */
  const SUPPLY_CHAIN_EDITION_TAKEAWAYS = [
    'Use IT-approved package sources for work projects',
    'Report suspicious packages or CI alerts to AppSec',
    'Never paste repo or CI secrets into chat or email',
    'Review dependency changes before production deploy'
  ];

  function watchoutDedupeKeys(articles = []) {
    const keys = new Set();
    for (const a of articles) {
      for (const w of a?.watchouts || []) {
        const k = normalizeTipDedupeKey(w);
        if (k) keys.add(k);
      }
    }
    return keys;
  }

  /** Extra lines when cross-article dedupe must replace a duplicate watchout. */
  const STOCK_ORG_WATCHOUTS = [
    'Use organization-approved channels for sensitive work data only',
    'Report suspected incidents through the official IT intake process',
    'Confirm unusual access requests with the requester by a second path',
    'Review link targets on external mail before you authenticate',
    'Segregate personal accounts from corporate credentials and SSO',
    'Escalate repeated authentication failures on your accounts to IT'
  ];

  function collectAlternativesForArticle(article) {
    const primary = generateTips(article);
    const secondary = defaultTipsForType(article);
    const out = [];
    const seen = new Set();
    for (const line of [...primary, ...secondary, ...STOCK_ORG_WATCHOUTS]) {
      const t = sanitizeWatchoutLine(line);
      const k = normalizeTipDedupeKey(t);
      if (!t || !k || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }

  /**
   * After per-article tips exist: avoid repeating the same recommendation across stories
   * (first article keeps priority order; later articles substitute from alternates).
   */
  function dedupeWatchoutsAcrossArticles(articles = []) {
    const list = Array.isArray(articles) ? articles : [];
    const usedGlobal = new Set();
    for (const art of list) {
      if (!Array.isArray(art.watchouts)) continue;
      const pool = [];
      const poolKeys = new Set();
      for (const w of art.watchouts) {
        const t = sanitizeWatchoutLine(w);
        const k = normalizeTipDedupeKey(t);
        if (t && k && !poolKeys.has(k)) {
          poolKeys.add(k);
          pool.push(t);
        }
      }
      for (const t of collectAlternativesForArticle(art)) {
        const k = normalizeTipDedupeKey(t);
        if (k && !poolKeys.has(k)) {
          poolKeys.add(k);
          pool.push(t);
        }
      }
      const chosen = [];
      for (const t of pool) {
        if (chosen.length >= 3) break;
        const k = normalizeTipDedupeKey(t);
        if (!k || usedGlobal.has(k)) continue;
        chosen.push(t);
        usedGlobal.add(k);
      }
      art.watchouts = sanitizeWatchoutsForArticle(chosen, art);
    }
  }

  /** Edition-level short actions (not a repeat of per-story bullets). */
  function localNewsletterTakeaways(articles = []) {
    const list = (Array.isArray(articles) ? articles : []).slice(0, 8);
    const lines = [];
    const seenLine = new Set();
    const supplyEdition = editionHasSupplyChain(list);

    if (supplyEdition) {
      for (const seed of SUPPLY_CHAIN_EDITION_TAKEAWAYS) {
        if (lines.length >= 4) break;
        const line = sanitizeTakeawayLine(seed);
        const k = normalizeTipDedupeKey(line);
        if (k && !seenLine.has(k)) {
          seenLine.add(k);
          lines.push(line);
        }
      }
    }

    const seenType = new Set();
    for (const a of list) {
      const typ = String(a?.type || 'Security News').trim();
      if (seenType.has(typ)) continue;
      seenType.add(typ);
      let raw = EDITION_ACTION_BY_TYPE[typ] || EDITION_ACTION_BY_TYPE['Security News'];
      if (supplyEdition) {
        if (typ === 'Ransomware') raw = 'Patch only through IT-approved channels you trust';
        if (typ === 'Password & MFA') raw = 'Treat registry and CI tokens like live passwords';
      }
      const line = sanitizeTakeawayLine(raw);
      const k = normalizeTipDedupeKey(line);
      if (k && !seenLine.has(k)) {
        seenLine.add(k);
        lines.push(line);
      }
    }
    for (const g of GENERIC_EDITION_LINES) {
      if (lines.length >= 6) break;
      if (supplyEdition && /strong unique password|Never share MFA codes/i.test(g)) continue;
      const line = sanitizeTakeawayLine(g);
      const k = normalizeTipDedupeKey(line);
      if (k && !seenLine.has(k)) {
        seenLine.add(k);
        lines.push(line);
      }
    }
    return lines.slice(0, 6);
  }

  function mergeNlTakeawaysFromAI(rawList, articles) {
    const watchKeys = watchoutDedupeKeys(articles);
    const out = [];
    const seen = new Set();
    const list = Array.isArray(rawList) ? rawList : [];
    for (const item of list) {
      const t = sanitizeTakeawayLine(item);
      if (!t) continue;
      if (takeawayMisalignedWithSupplyEdition(t, articles)) continue;
      const k = normalizeTipDedupeKey(t);
      if (!k || seen.has(k) || watchKeys.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= 6) break;
    }
    if (out.length < 4) {
      for (const fill of localNewsletterTakeaways(articles)) {
        if (out.length >= 6) break;
        const k = normalizeTipDedupeKey(fill);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(fill);
      }
    }
    return out.slice(0, 6);
  }

  /** Strip common LLM filler and hype; collapse whitespace (advisory tone). */
  function stripAdvisoryFiller(s) {
    let t = String(s || '');
    const fillers = [
      /\bit is important to note that\b\.?/gi,
      /\bit is worth noting that\b\.?/gi,
      /\bit's worth noting that\b\.?/gi,
      /\bremember that\b,?/gi,
      /\bin today's digital world\b,?/gi,
      /\bin today's world\b,?/gi,
      /\bas we all know\b,?/gi,
      /\bneedless to say\b,?/gi,
      /\bat the end of the day\b,?/gi,
      /\bin conclusion\b,?/gi,
      /\bthis article\b/gi,
      /\bthe takeaway is\b:?/gi,
      /\bhere's what you need to know\b:?/gi,
      /\bhere is what you need to know\b:?/gi,
      /^(so|now|okay|ok),?\s+/i,
      /\bbasically\b,?/gi,
      /\bactually\b,?/gi,
      /\bof course\b,?/gi,
      /\bmake no mistake\b,?/gi
    ];
    for (const re of fillers) t = t.replace(re, '');
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  /** Remove hype punctuation; collapse whitespace (awareness bulletin tone). */
  function sanitizeSummaryProse(s) {
    return stripAdvisoryFiller(String(s || ''))
      .replace(/\s+/g, ' ')
      .replace(/!+/g, '')
      .trim();
  }

  /** Hard cap summary length while keeping full sentences where possible. */
  function finalizeEmployeeSummary(text, modeCfg) {
    const max = modeCfg.summaryMaxChars || 320;
    let s = sanitizeSummaryProse(text);
    if (!s) return '';
    if (s.length <= max) return s;
    const parts = s.split(/(?<=[.!?])\s+/).filter(Boolean);
    let out = '';
    for (const p of parts) {
      const piece = p.trim();
      if (!piece) continue;
      const next = out ? `${out} ${piece}` : piece;
      if (next.length > max) break;
      out = next;
    }
    if (out.length >= Math.min(48, max)) return out;
    return clampStr(s, max);
  }

  const NEWSLETTER_CHROME_SYSTEM = `${EMPLOYEE_VOICE_BLOCK}

You write masthead and edition metadata for an internal security awareness bulletin. ${STYLE_BLOCK}
Output: a single JSON object exactly as specified in the user message — no markdown fences, no keys beyond those requested, no nulls. Values must be tightly tied to the Stories JSON (titles, types, summaries); do not invent incidents, vendors, or controls not supported by that text.`;

  const NEWSLETTER_CHROME_FRAME_PROMPT = `Return ONLY valid JSON (no markdown). Voice: short internal security program advisory (CERT/CISA-style): factual, concise, no storytelling, no filler, no rhetorical questions, no exclamation marks.

This is REQUEST 1 OF 2 for edition chrome: masthead lines only (do not include nlTakeaways).

Keys:
- nlKicker: string, max 70 characters, Title Case. Summarize the dominant threat themes across the stories using words that actually appear in the JSON (e.g. ransomware, npm, phishing, smishing)—not generic slogans like "Cyber Awareness" or "Stay Secure".
- nlSpotlight: string, max 100 characters. One sentence stating why this edition matters now for the internal audience, grounded in the story mix (who or what workflows are most in scope).
- nlFooterBlurb: string, max 140 characters. One line: the single most important org action for this send (verify, report, patch, or channel-specific care) tied to those same stories—not a generic "think before you click" unless the edition is actually phishing-centric.

Do not use filler phrases ("it is important to note", "remember that", "in today's world", etc.) in any value.

Stories (JSON):`;

  const NEWSLETTER_CHROME_TAKEAWAYS_PROMPT = `Return ONLY valid JSON (no markdown). Voice: short internal security program advisory (CERT/CISA-style): factual, concise, no filler, no rhetorical questions, no exclamation marks.

This is REQUEST 2 OF 2 for edition chrome: edition-wide takeaway lines only.

Keys:
- nlTakeaways: array of 4 to 6 strings. Each: max ${EDITION_TAKEAWAY_MAX_CHARS} characters and max ${EDITION_TAKEAWAY_MAX_WORDS} words. Imperative staff actions.
- Each line must map to a concrete risk theme visible in the Stories JSON (headlines, types, summaries). Do not output generic advice unrelated to these items (for example do not tell everyone to "change all passwords" or "enable MFA everywhere" unless the stories clearly involve credential theft, phishing, account breaches, or similar).
- If any story mentions npm, PyPI, registries, CI/CD, GitHub Actions, install scripts, or developer or build secrets, do not emit generic email-attachment advice or blanket password-rotation lines for that edition unless the JSON clearly describes employee or customer account-database exposure.
- Prefer distinct actions per line (no near-duplicates). Order from highest organizational priority to supporting actions.
- Do not copy per-story watchout bullets verbatim; synthesize edition-level actions.

No URLs, no emoji, no scam-style urgency. No filler phrases ("it is important to note", "remember that", "in today's world", etc.).

Stories (JSON):`;

  function buildArticleSummarizeUserPrompt(article, mode = 'balanced') {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    return `You are curating one item for an internal security bulletin. Read the Content carefully before writing.

SOURCE
Title: ${article.title}
Source: ${article.source}
Date: ${article.pubDate}
Content:
${truncate([article.description, article.summary].filter(Boolean).join('\n\n') || article.title, modeCfg.maxContentChars)}

CURATION MODE: ${modeCfg.label}
Summary shape: ${modeCfg.sentenceStyle}
Hard cap: JSON field "summary" must be at most ${modeCfg.summaryMaxChars} characters including spaces (prefer shorter if complete).

TASK (request 1 of 2 — summary + metadata only; do not output watchouts)
1. Write "summary" from the Content only: what happened or what is in scope, then why the program is surfacing it. Use vocabulary that appears in the Content when you can.
2. Set "threatLevel" using the calibration in your system instructions.
3. Set "category" from the dominant mechanism in the Content (not from the title alone).

Hard rules: no URLs; no filler phrases; no exclamation marks; do not fabricate numbers, CVEs, or vendor claims absent from the Content.

Output: JSON only, no markdown. Keys allowed: summary, threatLevel, category only.`;
  }

  function buildArticleWatchoutsUserPrompt(article, mode, approvedSummary) {
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const sum = String(approvedSummary || '').trim() || '(derive only from Content below)';
    return `You are writing three "What you should do" lines for the same bulletin item. Read the Content first; the Approved summary is for alignment only — do not paste it into watchouts.

SOURCE
Title: ${article.title}
Source: ${article.source}
Date: ${article.pubDate}
Content:
${truncate([article.description, article.summary].filter(Boolean).join('\n\n') || article.title, modeCfg.maxContentChars)}

Approved summary (alignment only — do not copy into watchouts): ${truncate(sum, 420)}

CURATION MODE: ${modeCfg.label}

TASK (request 2 of 2 — watchouts only)
- Output exactly three imperative lines, max ${WATCHOUT_MAX_WORDS} words and ${WATCHOUT_MAX_CHARS} characters each, no URLs, no exclamation marks.
- Order: (1) reduce exposure / prevent recurrence for this threat, (2) recognize or verify safely, (3) report or escalate per org process.
- Each line must echo at least one concrete element from the Content (channel, system, data type, attack pattern)—if you cannot, you are being too generic; rewrite.

If the content is about malicious npm or other packages, supply chain or CI/CD compromise, or theft of developer or cloud build secrets, write watchouts for engineering and pipeline risk (dependencies, lockfiles, CI tokens, approved tooling)—not generic consumer password-reset advice unless the article clearly states customer or employee account databases were breached.

${isSoftwareSupplyChainStory(article) ? `Supply-chain / dev-tooling mode (detected): all three watchouts must reference packages, registries, builds, lockfiles, CI tokens, or reporting odd installs to AppSec/IT. Do not output lines about using different passwords on each account, turning on MFA or two-step "everywhere", or changing passwords for a generic breach unless the Content explicitly describes stolen employee or customer login databases.` : ''}

Output: JSON only, no markdown. Key allowed: watchouts (array of exactly 3 strings) only.`;
  }

  /** Read-only preview of the per-article curation prompts (two sequential API requests when AI is used). */
  function previewArticleCurationPrompts(article, options = {}) {
    const mode = options.mode || 'balanced';
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const stubSummary = truncate([article.description, article.summary].filter(Boolean).join(' ') || article.title, modeCfg.summaryMaxChars || 220);
    return {
      mode,
      modeLabel: modeCfg.label,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildArticleSummarizeUserPrompt(article, mode),
      systemPromptCore: SYSTEM_ARTICLE_CORE,
      userPromptCore: buildArticleSummarizeUserPrompt(article, mode),
      systemPromptWatchouts: SYSTEM_ARTICLE_WATCHOUTS,
      userPromptWatchouts: buildArticleWatchoutsUserPrompt(article, mode, stubSummary)
    };
  }

  function buildNewsletterChromeUserPromptFrame(articles = []) {
    const list = (Array.isArray(articles) ? articles : []).slice(0, 8);
    const compact = list.map(a => ({
      title: a.title,
      type: a.type,
      summary: truncate(a.summary || a.description || a.title || '', 360)
    }));
    return `${NEWSLETTER_CHROME_FRAME_PROMPT}\n${JSON.stringify(compact)}`;
  }

  function buildNewsletterChromeUserPromptTakeaways(articles = []) {
    const list = (Array.isArray(articles) ? articles : []).slice(0, 8);
    const compact = list.map(a => ({
      title: a.title,
      type: a.type,
      summary: truncate(a.summary || a.description || a.title || '', 360)
    }));
    return `${NEWSLETTER_CHROME_TAKEAWAYS_PROMPT}\n${JSON.stringify(compact)}`;
  }

  function buildNewsletterChromeUserPrompt(articles = []) {
    return `${buildNewsletterChromeUserPromptFrame(articles)}\n\n---\n\n${buildNewsletterChromeUserPromptTakeaways(articles)}`;
  }

  /** Second-stage newsletter masthead / edition JSON prompts (when AI keys are used at build time). */
  function previewNewsletterChromePrompts(articles = []) {
    return {
      systemPrompt: NEWSLETTER_CHROME_SYSTEM,
      userPrompt: buildNewsletterChromeUserPrompt(articles),
      userPromptFrame: buildNewsletterChromeUserPromptFrame(articles),
      userPromptTakeaways: buildNewsletterChromeUserPromptTakeaways(articles)
    };
  }

  // ── Process single article ──
  async function summarizeArticle(article, options = {}, retries = 0) {
    const mode = options.mode || 'balanced';
    const modeCfg = CURATION_MODES[mode] || CURATION_MODES.balanced;
    const promptCore = buildArticleSummarizeUserPrompt(article, mode);

    try {
      if (!(config.provider === 'claude' && config.claudeKey) && !(config.provider === 'openai' && config.openaiKey)) {
        const local = localSummarize(article, mode);
        return { ...local, watchouts: sanitizeWatchoutsForArticle(local.watchouts, article), fallbackUsed: true };
      }

      const raw1 = config.provider === 'claude' && config.claudeKey
        ? await callClaude(promptCore, SYSTEM_ARTICLE_CORE)
        : await callOpenAI(promptCore, SYSTEM_ARTICLE_CORE);
      const cleaned1 = raw1.replace(/```json\s*|```\s*/g, '').trim();
      const p1 = JSON.parse(cleaned1);
      const summaryRaw = p1.summary != null ? String(p1.summary) : '';
      const summaryDone = summaryRaw ? finalizeEmployeeSummary(summaryRaw, modeCfg) : '';

      await App.Utils.wait(220);
      const promptWo = buildArticleWatchoutsUserPrompt(article, mode, summaryDone);
      let watchoutsArr = [];
      try {
        const raw2 = config.provider === 'claude' && config.claudeKey
          ? await callClaude(promptWo, SYSTEM_ARTICLE_WATCHOUTS)
          : await callOpenAI(promptWo, SYSTEM_ARTICLE_WATCHOUTS);
        const cleaned2 = raw2.replace(/```json\s*|```\s*/g, '').trim();
        const p2 = JSON.parse(cleaned2);
        watchoutsArr = Array.isArray(p2.watchouts) ? p2.watchouts : [];
      } catch (_w) {
        watchoutsArr = [];
      }

      return {
        summary: summaryDone || null,
        watchouts: sanitizeWatchoutsForArticle(watchoutsArr, article),
        threatLevel: typeof p1.threatLevel === 'number' ? Math.min(5, Math.max(1, p1.threatLevel)) : null,
        category: p1.category || null,
        confidence: typeof p1.confidence === 'number' ? Math.max(0, Math.min(1, p1.confidence)) : 0.86,
        fallbackUsed: false
      };
    } catch (e) {
      if (retries < config.retryAttempts) { await App.Utils.wait(config.retryDelayMs * (retries + 1)); return summarizeArticle(article, options, retries + 1); }
      log(`⚠ AI failed for "${article.title.slice(0, 40)}…" — using local`, 'log-err');
      const local = localSummarize(article, mode);
      return { ...local, watchouts: sanitizeWatchoutsForArticle(local.watchouts, article), fallbackUsed: true };
    }
  }

  // ── Batch process ──
  async function summarizeAll(articles, onProgress = null, options = {}) {
    const total = articles.length;
    let completed = 0;
    const mode = options.mode || 'balanced';
    const useAI = (config.provider === 'claude' && config.claudeKey) || (config.provider === 'openai' && config.openaiKey);
    log(useAI ? `✦ AI summaries active (${config.provider.toUpperCase()}/${mode}) — ${total} articles…` : `Local summaries (${mode}) — ${total} articles…`, useAI ? 'log-ai' : '');

    const queue = [...articles];
    async function processNext() {
      if (!queue.length) return;
      const art = queue.shift();
      try {
        const r = await summarizeArticle(art, { mode });
        if (r.summary) art.summary = r.summary;
        if (r.watchouts) art.watchouts = r.watchouts;
        if (r.threatLevel) art.threatLevel = r.threatLevel;
        if (r.category && art.type === 'Security News') art.type = r.category;
        art.aiProcessed = useAI;
        art.curationMeta = {
          mode,
          confidence: typeof r.confidence === 'number' ? r.confidence : (useAI ? 0.86 : 0.5),
          fallbackUsed: !!r.fallbackUsed,
          provider: useAI ? config.provider : 'local',
          updatedAt: new Date().toISOString()
        };
        completed++;
        log(`✓ [${completed}/${total}] ${art.title.slice(0, 45)}…`, 'log-ok');
        if (onProgress) onProgress(completed, total, art);
      } catch (e) { completed++; log(`✗ [${completed}/${total}] Failed`, 'log-err'); }
    }

    // Multi-threaded workers for parallel processing
    const concurrency = useAI ? config.maxConcurrent : 20; // local is instant, crank it up
    log(`⚡ ${concurrency} concurrent workers processing…`, 'log-ai');
    async function worker(wid) {
      while (queue.length) {
        await processNext();
        if (useAI) await App.Utils.wait(300); // rate-limit API calls
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, (_, i) => worker(i + 1)));

    dedupeWatchoutsAcrossArticles(articles);
    log(`✓ Done: ${completed}/${total} articles processed`, 'log-ok');
    return articles;
  }

  function isAIAvailable() {
    return (config.provider === 'claude' && !!config.claudeKey) || (config.provider === 'openai' && !!config.openaiKey);
  }

  function clampStr(s, max) {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    if (t.length <= max) return t;
    return `${t.slice(0, Math.max(0, max - 1)).trim()}…`;
  }

  /** Short masthead/footer lines derived from selected articles (no org/portal names). */
  function localNewsletterChrome(articles = []) {
    const list = Array.isArray(articles) ? articles : [];
    const types = [...new Set(list.map(a => String(a?.type || '').trim()).filter(Boolean))].slice(0, 4);
    const nlKicker = types.length ? types.join(' · ') : 'This week\'s security headlines';
    const lead = list[0];
    let nlSpotlight = 'Curated themes from the stories in this edition.';
    if (lead && lead.title) {
      nlSpotlight = `This week: ${clampStr(lead.title, 88)}`;
    }
    const t0 = types[0] || 'these risks';
    const nlFooterBlurb = list.length <= 1
      ? `Stay alert on ${t0.toLowerCase()}: forward anything unusual to security below.`
      : 'These stories share a theme—verify requests, use MFA, and report odd messages to security.';
    return {
      nlKicker: clampStr(nlKicker, 72),
      nlSpotlight: clampStr(nlSpotlight, 100),
      nlFooterBlurb: clampStr(nlFooterBlurb, 140),
      nlTakeaways: localNewsletterTakeaways(list)
    };
  }

  async function fetchNewsletterChromeMessage(userContent, maxTokens = 520) {
    if (config.provider === 'claude' && config.claudeKey) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.claudeKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: config.claudeModel,
          max_tokens: maxTokens,
          temperature: 0.15,
          system: NEWSLETTER_CHROME_SYSTEM,
          messages: [{ role: 'user', content: userContent }]
        })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const d = await resp.json();
      return d.content?.[0]?.text || '';
    }
    if (config.provider === 'openai' && config.openaiKey) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
        body: JSON.stringify(openAIChatCompletionsBody(NEWSLETTER_CHROME_SYSTEM, userContent, maxTokens, 0.08))
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const d = await resp.json();
      return d.choices?.[0]?.message?.content || '';
    }
    throw new Error('No API key');
  }

  async function newsletterChrome(articles = [], options = {}, retries = 0) {
    const list = (Array.isArray(articles) ? articles : []).slice(0, 8);
    if (!list.length) return localNewsletterChrome(list);
    const base = localNewsletterChrome(list);
    try {
      const rawFrame = await fetchNewsletterChromeMessage(buildNewsletterChromeUserPromptFrame(list), 420);
      const cleaned1 = String(rawFrame).replace(/```json\s*|```\s*/g, '').trim();
      const p1 = JSON.parse(cleaned1);

      await App.Utils.wait(220);
      let mergedTakeaways = base.nlTakeaways;
      try {
        const rawTake = await fetchNewsletterChromeMessage(buildNewsletterChromeUserPromptTakeaways(list), 520);
        const cleaned2 = String(rawTake).replace(/```json\s*|```\s*/g, '').trim();
        const p2 = JSON.parse(cleaned2);
        mergedTakeaways = mergeNlTakeawaysFromAI(p2.nlTakeaways, list);
      } catch {
        mergedTakeaways = base.nlTakeaways;
      }

      return {
        nlKicker: clampStr(sanitizeSummaryProse(p1.nlKicker || ''), 72) || base.nlKicker,
        nlSpotlight: clampStr(sanitizeSummaryProse(p1.nlSpotlight || ''), 100) || base.nlSpotlight,
        nlFooterBlurb: clampStr(sanitizeSummaryProse(p1.nlFooterBlurb || ''), 140) || base.nlFooterBlurb,
        nlTakeaways: mergedTakeaways.length >= 4 ? mergedTakeaways : base.nlTakeaways
      };
    } catch {
      if (retries < config.retryAttempts) {
        await App.Utils.wait(config.retryDelayMs * (retries + 1));
        return newsletterChrome(articles, options, retries + 1);
      }
      return localNewsletterChrome(list);
    }
  }

  return {
    EMPLOYEE_VOICE_BLOCK,
    configure,
    getConfig,
    summarizeArticle,
    summarizeAll,
    localSummarize,
    generateTips,
    previewArticleCurationPrompts,
    previewNewsletterChromePrompts,
    previewNewsletterTemplateSlotsPrompts,
    fillNewsletterTextSlots,
    isAIAvailable,
    localNewsletterChrome,
    newsletterChrome,
    localNewsletterTakeaways,
    sanitizeWatchoutsForArticle,
    sanitizeEmployeeTip,
    sanitizeTemplateSlotLine,
    sanitizeTakeawayLine,
    dedupeWatchoutsAcrossArticles,
    finalizeEmployeeSummary,
    mergeNlTakeawaysFromAI
  };
})();
