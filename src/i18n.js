import en from './lang/en.js';
import zh from './lang/zh-HK.js';

export const CJK_FONT = '"Noto Sans TC", "PingFang HK", "Microsoft JhengHei", sans-serif';
const dictionaries = { en, zh };
const listeners = new Set();
const cache = new Map();
const normalise = (text) => String(text).replace(/\s+/g, ' ').trim();
export function detectLang({ search = '', saved, browser = 'en' } = {}) {
  const override = new URLSearchParams(search).get('lang');
  if (override === 'en' || override === 'zh') return override;
  if (saved === 'en' || saved === 'zh') return saved;
  return /^zh-(HK|TW|Hant|MO)(-|$)/i.test(browser) ? 'zh' : 'en';
}
let current = detectLang({
  search: globalThis.location?.search,
  saved: (() => { try { return globalThis.window ? window.localStorage?.getItem('nw-lang') : null; } catch { return null; } })(),
  browser: globalThis.navigator?.language,
});
export const i18n = { get lang() { return current; } };
export { current as lang };
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setLang(value) {
  if (!Object.hasOwn(dictionaries, value)) return;
  current = value;
  cache.clear();
  try { if (globalThis.window) window.localStorage?.setItem('nw-lang', value); } catch { /* Private browsing can disable storage. */ }
  if (globalThis.document) {
    document.documentElement.lang = value === 'zh' ? 'zh-HK' : 'en';
    document.title = t('page.title');
  }
  listeners.forEach((fn) => fn(value));
}
export function t(key, vars = {}) {
  let text = dictionaries[current][key] ?? en[key] ?? key;
  if (typeof text === 'object') {
    const rule = new Intl.PluralRules(current === 'zh' ? 'zh-HK' : 'en').select(Number(vars.count ?? 0));
    text = text[rule] ?? text.other ?? en[key]?.other ?? key;
  }
  return String(text).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
}

// Simulation state, logs and records retain their canonical English text. Only presentation
// is translated, so changing language cannot change care-eligibility or case identity checks.
const entries = Object.entries(en).filter(([, text]) => typeof text === 'string' && text)
  .sort((a, b) => b[1].length - a[1].length);
const escapeRE = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrases = entries.filter(([, text]) => !/\{\w+\}/.test(text)).map(([key, text]) => ({
  key,
  re: new RegExp(`(?<![A-Za-z])${escapeRE(normalise(text))}(?![A-Za-z])`, 'g'),
}));
const longPhrases = phrases.filter(({ key }) => en[key].length > 50);
const nameRE = /\b(Mr\.|Mrs\.) ([A-Z][a-z]+) ([A-Z][a-z]+-[a-z]+)\b/g;
export function translate(text) {
  const source = String(text ?? '');
  if (current === 'en' || !/[A-Za-z]/.test(source)) return source;
  if (cache.has(source)) return cache.get(source);
  const leading = source.match(/^\s*/)[0], trailing = source.match(/\s*$/)[0];
  let result = normalise(source);
  const exact = en[result];
  if (typeof exact === 'string' && zh[result]) {
    const rendered = leading + zh[result] + trailing;
    cache.set(source, rendered);
    return rendered;
  }
  const replacements = [];
  const protect = (text) => `\uE000${replacements.push(text) - 1}\uE001`;
  for (const { key, re } of longPhrases) {
    result = result.replace(re, () => protect(t(key)));
  }
  result = result.replace(nameRE, (match, title, surname, given) => {
    const known = zh[match] ?? (zh[surname] && zh[given] ? `${zh[surname]}${zh[given]}${title === 'Mrs.' ? '女士' : '先生'}` : null);
    if (!known) return match;
    return protect(known);
  });
  result = result.replace(/\bAgency Nurse (Lui|Kwan|Fok|Szeto)\b/g, (_, surname) => protect(`${zh[surname]}姑娘（替假護士）`));
  // Protect replacements from subsequent shorter matches (including the bilingual logo).
  for (const { key, re } of phrases) {
    result = result.replace(re, () => {
      const index = replacements.push(t(key)) - 1;
      return `\uE000${index}\uE001`;
    });
  }
  result = result.replace(/\uE000(\d+)\uE001/g, (_, index) => replacements[index]);
  const rendered = leading + result + trailing;
  if (cache.size > 2000) cache.clear();
  cache.set(source, rendered);
  return rendered;
}

const originals = new WeakMap();
const attributes = new WeakMap();
export function localize(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('script, style, .logo-sign, [data-no-i18n]')) continue;
    const previous = originals.get(node);
    const source = previous && node.nodeValue === previous.rendered ? previous.source : node.nodeValue;
    const rendered = translate(source);
    if (rendered !== node.nodeValue) node.nodeValue = rendered;
    originals.set(node, { source, rendered });
  }
  for (const element of [root, ...root.querySelectorAll('[title], [aria-label]')]) {
    if (!element.getAttribute || element.closest('[data-no-i18n]')) continue;
    const records = attributes.get(element) ?? {};
    for (const name of ['title', 'aria-label']) {
      const value = element.getAttribute(name);
      if (value === null) continue;
      const previous = records[name];
      const source = previous && value === previous.rendered ? previous.source : value;
      const rendered = translate(source);
      element.setAttribute(name, rendered);
      records[name] = { source, rendered };
    }
    attributes.set(element, records);
  }
}

export function languageButtons() {
  return '<div class="language" role="group" aria-label="Language"><button type="button" data-lang="en" data-no-i18n>EN</button><button type="button" data-lang="zh" data-no-i18n>繁</button></div>';
}
export function bindLanguageButtons(root = document) {
  root.querySelectorAll('[data-lang]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === current));
    button.onclick = () => setLang(button.dataset.lang);
  });
}
if (globalThis.document) {
  document.documentElement.lang = current === 'zh' ? 'zh-HK' : 'en';
  document.title = t('page.title');
  onLangChange(() => { localize(); bindLanguageButtons(); });
}
