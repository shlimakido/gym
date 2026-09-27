// איסוף ראיות פסיבי בלבד: בקשות GET/HEAD רגילות, כמו דפדפן שגולש לאתר.
// אין התחברות, אין שליחת טפסים, אין סריקת פורטים ואין קלט זדוני.
import * as cheerio from 'cheerio';
import { MAX_PAGES, MAX_HTML_CHARS } from './config.js';

const UA = 'Audit360-PassiveBot/1.0 (+client-authorized audit; passive GET only)';
const TIMEOUT_MS = 15000;
const MAX_LINK_CHECKS = 40;

const PRIORITY_WORDS = [
  'pricing', 'price', 'plans', 'מחיר', 'מחירון', 'חבילות', 'מסלולים',
  'signup', 'register', 'join', 'הרשמה', 'הצטרפות',
  'checkout', 'cart', 'buy', 'order', 'קופה', 'סל', 'רכישה', 'הזמנה',
  'contact', 'צור קשר', 'about', 'אודות',
  'privacy', 'פרטיות', 'terms', 'תקנון', 'accessibility', 'נגישות',
  'donate', 'תרומה',
];

const SECRET_PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_\-]{35}/g },
  { name: 'Stripe live secret', re: /sk_live_[0-9a-zA-Z]{16,}/g },
  { name: 'Stripe publishable', re: /pk_live_[0-9a-zA-Z]{16,}/g },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'Slack token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: 'GitHub token', re: /gh[pousr]_[0-9A-Za-z]{30,}/g },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'Internal IP', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g },
  { name: 'localhost URL', re: /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s"'<>]*/g },
  { name: 'Staging/dev host', re: /https?:\/\/[a-z0-9.-]*(?:staging|dev|test)[a-z0-9.-]*\.[a-z]{2,}[^\s"'<>]*/gi },
];

const DEV_LEFTOVERS = /lorem ipsum|todo|fixme|test test|טקסט לדוגמה|בדיקה בדיקה|asdf|placeholder text/gi;

const SECURITY_HEADERS = [
  'strict-transport-security', 'content-security-policy', 'x-frame-options',
  'x-content-type-options', 'referrer-policy', 'permissions-policy',
];

function mask(s) {
  return s.length <= 10 ? s.slice(0, 3) + '…' : s.slice(0, 6) + '…' + s.slice(-4);
}

async function timedFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'user-agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

// עוקב אחרי הפניות ידנית כדי לתעד את כל השרשרת (ל-SEC-A)
async function fetchWithChain(url, method = 'GET') {
  const chain = [];
  let current = url;
  for (let i = 0; i < 10; i++) {
    const started = Date.now();
    const res = await timedFetch(current, { method, redirect: 'manual' });
    const ms = Date.now() - started;
    const loc = res.headers.get('location');
    chain.push({ url: current, status: res.status, ms });
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return { res, chain, finalUrl: current };
  }
  throw new Error('יותר מ-10 הפניות');
}

function textOf($el) {
  return $el.text().replace(/\s+/g, ' ').trim();
}

function analyzeHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const meta = n => $(`meta[name="${n}"]`).attr('content') || null;
  const prop = p => $(`meta[property="${p}"]`).attr('content') || null;

  const headings = [];
  $('h1,h2,h3').each((_, el) => {
    if (headings.length < 60) headings.push(`${el.tagName.toUpperCase()}: ${textOf($(el)).slice(0, 120)}`);
  });

  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = textOf($(el)).slice(0, 80) || $(el).attr('aria-label') || $(el).find('img').attr('alt') || '';
    let abs = null;
    try { abs = new URL(href, base).toString(); } catch { /* ignore */ }
    links.push({ text, href, abs, internal: abs ? new URL(abs).host === base.host : false, target: $(el).attr('target') || null });
  });

  // אותו טקסט שמוביל ליעדים שונים, או אותו יעד עם טקסטים שונים
  const byText = {};
  for (const l of links) if (l.text && l.abs) (byText[l.text] ||= new Set()).add(l.abs.split('#')[0]);
  const inconsistentLinks = Object.entries(byText).filter(([, s]) => s.size > 1).map(([t, s]) => ({ text: t, targets: [...s].slice(0, 5) }));

  const images = [];
  $('img').each((_, el) => {
    const $el = $(el);
    images.push({
      src: ($el.attr('src') || $el.attr('data-src') || '').slice(0, 160),
      alt: $el.attr('alt'),
      hasSize: Boolean($el.attr('width') && $el.attr('height')),
      loading: $el.attr('loading') || null,
    });
  });

  const forms = [];
  $('form').each((i, el) => {
    const $f = $(el);
    const fields = [];
    $f.find('input,select,textarea').each((_, inp) => {
      const $i = $(inp);
      const type = ($i.attr('type') || inp.tagName).toLowerCase();
      if (['hidden', 'submit', 'button'].includes(type)) return;
      const id = $i.attr('id');
      const hasLabel = Boolean((id && $(`label[for="${id}"]`).length) || $i.closest('label').length || $i.attr('aria-label') || $i.attr('aria-labelledby'));
      fields.push({
        type, name: $i.attr('name') || null, required: $i.is('[required]') || $i.attr('aria-required') === 'true',
        hasLabel, placeholder: $i.attr('placeholder') || null,
        autocomplete: $i.attr('autocomplete') || null, inputmode: $i.attr('inputmode') || null,
      });
    });
    forms.push({
      index: i + 1, action: $f.attr('action') || null, method: ($f.attr('method') || 'get').toLowerCase(),
      fields, submitText: textOf($f.find('button,[type=submit]').first()).slice(0, 60) || $f.find('[type=submit]').attr('value') || null,
      consentCheckbox: $f.find('input[type=checkbox]').length > 0,
    });
  });

  const buttons = [];
  $('button, a.btn, a.button, [role=button], input[type=submit]').each((_, el) => {
    const t = textOf($(el)) || $(el).attr('value') || $(el).attr('aria-label') || '';
    if (t && buttons.length < 40) buttons.push(t.slice(0, 60));
  });

  const scripts = [];
  let inlineScripts = 0;
  $('script').each((_, el) => {
    const src = $(el).attr('src');
    if (src) { try { scripts.push(new URL(src, base).host + new URL(src, base).pathname.slice(0, 60)); } catch { scripts.push(src.slice(0, 100)); } }
    else inlineScripts++;
  });
  const thirdPartyHosts = [...new Set(scripts.map(s => s.split('/')[0]).filter(h => h && h !== base.host))];

  const comments = [];
  const commentRe = /<!--([\s\S]*?)-->/g;
  let m;
  while ((m = commentRe.exec(html)) && comments.length < 20) {
    const c = m[1].trim();
    if (c && !/^\[if |^<!\[endif/.test(c)) comments.push(c.slice(0, 200));
  }

  const secrets = [];
  for (const p of SECRET_PATTERNS) {
    const found = [...new Set(html.match(p.re) || [])].slice(0, 5);
    for (const f of found) secrets.push({ type: p.name, masked: mask(f) });
  }

  $('script,style,noscript').remove();
  const bodyText = textOf($('body'));
  const leftovers = [...new Set((bodyText.match(DEV_LEFTOVERS) || []).map(s => s.toLowerCase()))];
  const lowerHtml = html.toLowerCase();

  return {
    lang: $('html').attr('lang') || null,
    dir: $('html').attr('dir') || $('body').attr('dir') || null,
    title: $('title').first().text().trim() || null,
    metaDescription: meta('description'),
    viewport: meta('viewport'),
    robotsMeta: meta('robots'),
    canonical: $('link[rel=canonical]').attr('href') || null,
    og: { title: prop('og:title'), description: prop('og:description'), image: prop('og:image'), url: prop('og:url'), type: prop('og:type') },
    twitterCard: meta('twitter:card'),
    structuredDataBlocks: $('script[type="application/ld+json"]').length,
    headings,
    h1Count: $('h1').length,
    links: { total: links.length, internal: links.filter(l => l.internal).length, external: links.filter(l => !l.internal).length, emptyText: links.filter(l => !l.text).length, sample: links.slice(0, 80).map(l => `${l.text || '(ללא טקסט)'} → ${l.href}`) },
    inconsistentLinks: inconsistentLinks.slice(0, 20),
    telLinks: links.filter(l => l.href.startsWith('tel:')).map(l => l.href),
    mailLinks: links.filter(l => l.href.startsWith('mailto:')).map(l => l.href),
    whatsappLinks: links.filter(l => /wa\.me|whatsapp/i.test(l.href)).map(l => l.href).slice(0, 5),
    images: { total: images.length, missingAlt: images.filter(i => i.alt === undefined).length, emptyAlt: images.filter(i => i.alt === '').length, missingSize: images.filter(i => !i.hasSize).length, lazy: images.filter(i => i.loading === 'lazy').length, sample: images.slice(0, 25) },
    forms,
    buttons,
    scripts: { external: scripts.slice(0, 60), inlineCount: inlineScripts, thirdPartyHosts },
    stylesheets: $('link[rel=stylesheet]').length,
    htmlComments: comments,
    possibleSecrets: secrets,
    devLeftovers: leftovers,
    signals: {
      cookieBannerKeywords: /cookie|עוגיות|קובצי cookie|consent/.test(lowerHtml),
      privacyLink: links.some(l => /privacy|פרטיות/i.test(l.text + l.href)),
      termsLink: links.some(l => /terms|תקנון|תנאי שימוש/i.test(l.text + l.href)),
      accessibilityLink: links.some(l => /accessibility|נגישות/i.test(l.text + l.href)),
      newsletterKeywords: /newsletter|ניוזלטר|הירשמו לעדכונים|subscribe/.test(lowerHtml),
      testimonialsKeywords: /testimonial|המלצות|ביקורות|reviews|לקוחות מספרים/.test(lowerHtml),
      priceSigns: (bodyText.match(/₪\s?\d[\d,.]*|\d[\d,.]*\s?₪|\$\s?\d[\d,.]*|\d[\d,.]*\s?(?:ש"ח|שח|NIS)/g) || []).slice(0, 20),
    },
    visibleTextChars: bodyText.length,
    likelyJsRendered: bodyText.length < 300 && scripts.length > 0,
    visibleTextSample: bodyText.slice(0, 4000),
    internalLinkTargets: [...new Set(links.filter(l => l.internal && l.abs && /^https?:/.test(l.abs)).map(l => l.abs.split('#')[0]))],
    linkTexts: Object.fromEntries(links.filter(l => l.abs).map(l => [l.abs.split('#')[0], l.text])),
  };
}

function pickPages(homeAnalysis, homeUrl) {
  const scored = homeAnalysis.internalLinkTargets
    .filter(u => u !== homeUrl && !/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|mp4)(\?|$)/i.test(u))
    .map(u => {
      const hay = (decodeURIComponent(u) + ' ' + (homeAnalysis.linkTexts[u] || '')).toLowerCase();
      const score = PRIORITY_WORDS.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      return { u, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, MAX_PAGES - 1)).map(s => s.u);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export function normalizeUrl(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.toString();
  } catch { return null; }
}

export function isAppStoreUrl(url) {
  return /apps\.apple\.com|play\.google\.com/i.test(url);
}

export async function collectEvidence(rawUrl, log = () => {}) {
  const url = normalizeUrl(rawUrl);
  const evidence = { url, collectedAt: new Date().toISOString(), pages: [], errors: [], site: {} };
  if (!url) { evidence.errors.push('לא סופקה כתובת תקינה, לא בוצע איסוף מהרשת.'); return evidence; }

  // בדיקת הפניה מ-http ל-https
  try {
    const httpUrl = url.replace(/^https:/, 'http:');
    const { chain } = await fetchWithChain(httpUrl, 'GET');
    evidence.site.httpRedirectChain = chain;
    evidence.site.httpRedirectsToHttps = chain.length > 1 && chain.at(-1).url.startsWith('https:');
  } catch (e) {
    evidence.site.httpRedirectChain = [];
    evidence.errors.push(`בדיקת http נכשלה: ${e.message}`);
  }

  let home;
  try {
    log(`טוען את עמוד הבית: ${url}`);
    const { res, chain, finalUrl } = await fetchWithChain(url);
    const html = await res.text();
    const headers = Object.fromEntries(SECURITY_HEADERS.map(h => [h, res.headers.get(h)]));
    const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    evidence.site.redirectChain = chain;
    evidence.site.finalUrl = finalUrl;
    evidence.site.finalHost = new URL(finalUrl).host;
    evidence.site.https = finalUrl.startsWith('https:');
    evidence.site.securityHeaders = headers;
    evidence.site.server = res.headers.get('server');
    evidence.site.poweredBy = res.headers.get('x-powered-by');
    evidence.site.cookiesSetBeforeConsent = setCookie.map(c => c.split('=')[0]);
    home = { id: 'P1', url: finalUrl, status: res.status, ms: chain.at(-1).ms, bytes: Buffer.byteLength(html), html };
  } catch (e) {
    evidence.errors.push(`טעינת עמוד הבית נכשלה: ${e.message}`);
    return evidence;
  }

  const homeAnalysis = analyzeHtml(home.html, home.url);
  evidence.pages.push({ ...home, analysis: homeAnalysis });

  const extra = pickPages(homeAnalysis, home.url);
  await pool(extra, 3, async (pageUrl, k) => {
    try {
      log(`טוען עמוד: ${pageUrl}`);
      const { res, chain, finalUrl } = await fetchWithChain(pageUrl);
      const type = res.headers.get('content-type') || '';
      if (!type.includes('html')) return;
      const html = await res.text();
      evidence.pages.push({ id: `P${k + 2}`, url: finalUrl, status: res.status, ms: chain.at(-1).ms, bytes: Buffer.byteLength(html), html, analysis: analyzeHtml(html, finalUrl) });
    } catch (e) {
      evidence.errors.push(`${pageUrl}: ${e.message}`);
    }
  });
  evidence.pages.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  // robots, sitemap ועמוד 404
  const origin = new URL(home.url).origin;
  for (const [key, path] of [['robots', '/robots.txt'], ['sitemap', '/sitemap.xml']]) {
    try {
      const r = await timedFetch(origin + path);
      const body = r.ok ? (await r.text()).slice(0, 1500) : null;
      evidence.site[key] = { status: r.status, sample: body };
    } catch (e) { evidence.site[key] = { error: e.message }; }
  }
  try {
    const probe = `${origin}/audit360-nonexistent-${Date.now().toString(36)}`;
    const r = await timedFetch(probe);
    const body = await r.text();
    const $ = cheerio.load(body);
    evidence.site.notFound = { url: probe, status: r.status, title: $('title').text().trim().slice(0, 120), hasNavigation: $('nav, header a').length > 0 };
  } catch (e) { evidence.site.notFound = { error: e.message }; }

  // בדיקת קישורים פנימיים (HEAD, עם נפילה ל-GET)
  const allInternal = [...new Set(evidence.pages.flatMap(p => p.analysis.internalLinkTargets))].slice(0, MAX_LINK_CHECKS);
  log(`בודק ${allInternal.length} קישורים פנימיים`);
  const results = await pool(allInternal, 4, async u => {
    try {
      let r = await timedFetch(u, { method: 'HEAD', redirect: 'follow' });
      if (r.status === 405 || r.status === 403) r = await timedFetch(u, { method: 'GET', redirect: 'follow' });
      return { url: u, status: r.status };
    } catch (e) { return { url: u, status: 'error', error: e.message }; }
  });
  evidence.site.linkCheck = { checked: results.length, broken: results.filter(r => r.status === 'error' || r.status >= 400) };

  return evidence;
}

// הפיכת הראיות לטקסט שהסוכנים קוראים. HTML גולמי נחתך בגבול מוצהר, לא בשקט.
export function evidenceToText(ev) {
  if (!ev || !ev.url) return 'לא בוצע איסוף מהרשת (לא סופקה כתובת).';
  const lines = [];
  lines.push(`# ראיות שנאספו פסיבית מהאתר (${ev.collectedAt})`);
  lines.push(`כתובת שסופקה: ${ev.url}`);
  const s = ev.site;
  lines.push(`\n## תשתית (SITE)`);
  lines.push(JSON.stringify({
    finalUrl: s.finalUrl, https: s.https, redirectChain: s.redirectChain, httpRedirectChain: s.httpRedirectChain,
    httpRedirectsToHttps: s.httpRedirectsToHttps, securityHeaders: s.securityHeaders, server: s.server, poweredBy: s.poweredBy,
    cookieNamesSetOnFirstLoad: s.cookiesSetBeforeConsent, robots: s.robots, sitemap: s.sitemap, notFoundPage: s.notFound,
    brokenInternalLinks: s.linkCheck,
  }, null, 1));
  if (ev.errors.length) lines.push(`\n## שגיאות איסוף\n- ${ev.errors.join('\n- ')}`);
  for (const p of ev.pages) {
    const { internalLinkTargets, linkTexts, ...a } = p.analysis;
    lines.push(`\n## עמוד ${p.id}: ${p.url}`);
    lines.push(`סטטוס ${p.status} · זמן תגובת שרת ${p.ms}ms (מדידה בודדת מהשרת שלנו, לא Core Web Vitals) · משקל HTML ${p.bytes} בתים`);
    lines.push('### ניתוח מובנה');
    lines.push(JSON.stringify(a, null, 1));
    const cut = p.html.length > MAX_HTML_CHARS;
    lines.push(`### קוד HTML גולמי${cut ? ` (נחתך אחרי ${MAX_HTML_CHARS} תווים מתוך ${p.html.length}; מה שאחרי החיתוך לא נבדק)` : ''}`);
    lines.push('```html\n' + p.html.slice(0, MAX_HTML_CHARS) + '\n```');
  }
  return lines.join('\n');
}
