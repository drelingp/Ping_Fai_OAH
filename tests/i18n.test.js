import test from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/lang/en.js';
import zh from '../src/lang/zh-HK.js';
import { lang, i18n, setLang, t, translate, detectLang } from '../src/i18n.js';
import { auditSources, auditText } from '../scripts/i18n-audit.js';
import { PERSONALITIES, ROUTINES, NEEDS, BELL_NEEDS, NURSES, ROOMS, SURNAMES, MALE, FEMALE } from '../src/data.js';
import { createCase1 } from '../src/case1.js';

function flatten(object, path = '') {
  return Object.fromEntries(Object.entries(object).flatMap(([key, value]) => {
    const full = path ? `${path}.${key}` : key;
    return value && typeof value === 'object' ? Object.entries(flatten(value, full)) : [[full, value]];
  }));
}
test('English and Hong Kong Chinese keys match in both directions, including nested values', () => {
  const english = flatten(en), chinese = flatten(zh);
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english)) {
    assert.equal(typeof english[key], 'string', `${key}: English must be text`);
    assert.equal(typeof chinese[key], 'string', `${key}: Chinese must be text`);
    assert.ok(english[key].trim(), `${key}: empty English`);
    assert.ok(chinese[key].trim(), `${key}: empty Chinese`);
    const vars = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(vars(chinese[key]), vars(english[key]), `${key}: placeholder mismatch`);
  }
});
test('interpolation, plural categories, English fallback and invalid languages are safe', () => {
  setLang('zh');
  assert.equal(lang, 'zh');
  assert.equal(i18n.lang, 'zh');
  assert.equal(t('hud.reputation', { rep: 70, susp: 12 }), '院舍聲譽 70 · 員工戒心 12');
  assert.equal(t('bell.more', { count: 1 }), '+1 個叫人鐘');
  assert.equal(t('bell.more', { count: 8 }), '+8 個叫人鐘');
  assert.equal(t('unregistered'), 'unregistered');
  en['test.fallback'] = 'English {count}';
  assert.equal(t('test.fallback', { count: 2 }), 'English 2');
  delete en['test.fallback'];
  setLang('unknown');
  assert.equal(lang, 'zh');
  setLang('en');
  assert.equal(t('bell.more', { count: 1 }), '+1 more call bell');
  assert.equal(t('bell.more', { count: 2 }), '+2 more call bells');
});
test('URL override wins over saved language, which wins over supported navigator locales', () => {
  for (const browser of ['zh-HK', 'zh-TW', 'zh-Hant', 'zh-MO', 'zh-Hant-HK']) assert.equal(detectLang({ browser }), 'zh');
  for (const browser of ['en-HK', 'zh-CN', 'ja', 'en']) assert.equal(detectLang({ browser }), 'en');
  assert.equal(detectLang({ search: '?lang=zh', saved: 'en', browser: 'en' }), 'zh');
  assert.equal(detectLang({ search: '?lang=en', saved: 'zh', browser: 'zh-HK' }), 'en');
  assert.equal(detectLang({ search: '?lang=bad', saved: 'en', browser: 'zh-HK' }), 'en');
  assert.equal(detectLang({ saved: 'zh', browser: 'en' }), 'zh');
});
test('canonical simulation data, generated names and stored logs translate without mutating data', () => {
  setLang('zh');
  assert.equal(translate('Mrs. Kwok Fung-yee'), '郭鳳儀女士');
  assert.equal(translate('Mr. Chan Kwok-wing'), '陳國榮先生');
  for (const surname of SURNAMES) for (const given of [...MALE, ...FEMALE]) {
    assert.ok(!/[A-Za-z]/.test(translate(`Mrs. ${surname} ${given}`)));
  }
  const caseResidents = createCase1({ s: {} }).residents();
  const text = [
    ...PERSONALITIES, ...ROUTINES, ...Object.values(NEEDS).flat(),
    ...BELL_NEEDS.map((n) => n.need), ...NURSES.map((n) => n.name),
    ...ROOMS.flatMap((r) => [r.name, r.name.replace(' (out of service)', '').replace(' (locked)', '')]),
    ...caseResidents.flatMap((r) => [r.name, r.personality, r.routine, r.note, ...r.needs]),
  ];
  for (const value of text) assert.deepEqual(auditText(value), [], value);
  const log = '07:30 — Mr. Chan Kwok-wing died. It may have been preventable.';
  assert.equal(translate(log), '07:30 — 陳國榮先生 離世。這或許原可避免。');
  assert.equal(caseResidents[0].name, 'Mr. Chan Kwok-wing');
  setLang('en');
  assert.equal(translate(log), log);
});
test('all human-facing source strings are catalogued; scanner flags new untranslated copy', () => {
  assert.deepEqual(auditSources(), []);
  setLang('zh');
  assert.ok(auditText('A newly added untranslated button').length > 0);
  setLang('en');
});
