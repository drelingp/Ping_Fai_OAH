import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'rolldown/experimental';
import { setLang, translate } from '../src/i18n.js';
import en from '../src/lang/en.js';

// Asset/rig names, shaders, selectors, font stacks and diagnostics are not player text.
const technical = /^(?:Head|Body|Root|Hips|Spine\d*|Neck|Armature|Eye|Left\w+|Right\w+|Idle\w*|Walk\w*|Jog\w*|Sprint\w*|Sitting\w*|Interact|PickUp\w*|Push_Loop|Punch\w*|Fixing\w*|Death\d+|Hit_Chest|Crouch\w*|Enter|Escape|Arrow\w+|Space|Key\w+|Shift|NIGHT|AM|PM|GET|POST)$/;
const allowedWords = /^(?:E|M|C|P|A|B|D|F|S|WASD|Esc|Shift|II|EN|Ping|Fai|Nursing|Home)$/;
export function untranslated(text) {
  const rendered = translate(text);
  return (rendered.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? []).filter((word) => !allowedWords.test(word));
}
export function auditText(text, force = false) {
  if (!text || technical.test(text) || !/[A-Za-z]/.test(text)) return [];
  if (Object.hasOwn(en, text) && text !== en[text]) return []; // t() key, not copy.
  if (/^([.#[]|https?:|\/src\/|rgba?\(|[./]|\{|\(?max-width|bold |uniform |varying |attribute |models\/|(?:furn|hw|x|char):|floor\||translate\(|\(pointer:)/.test(text)) return [];
  if (/\.(?:js|css|glb|gltf|png|jpe?g|webp|ogg|mp3)$/.test(text) || /(?:system-ui|sans-serif|monospace|Unable to |Failed to |failed to load|Cannot |Missing )/.test(text)) return [];
  if (/^(?:2d|YXZ|show | \(out of service\)| \(locked\)| ⟦⟧ -(?:cuff|trolley)| ⟦⟧ px  ⟦⟧ )$/.test(text)) return [];
  if (!force && /^[a-z][\w-]*$/.test(text)) return []; // IDs, modes, attributes and event types.
  return text.split(/<[^>]*>/).flatMap((part) => {
    if (/^[\w-]+=["']|^(?:class|style|data-|aria-|id|role)=/.test(part.trim())) return [];
    return untranslated(part.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  });
}
export function auditSources() {
  setLang('zh');
  const failures = [];
  const dir = new URL('../src/', import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js') && name !== 'i18n.js')) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    const parsed = parseSync(file, source);
    if (parsed.errors.length) throw new Error(`Cannot audit ${file}: ${JSON.stringify(parsed.errors)}`);
    function visit(node, parent = null) {
      if (!node || typeof node !== 'object') return;
      let text;
      if (node.type === 'Literal' && typeof node.value === 'string') text = node.value;
      if (node.type === 'TemplateLiteral') text = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' ⟦⟧ ');
      if (text) {
        const property = parent?.type === 'Property' ? parent.key.name ?? parent.key.value : '';
        const sink = parent?.type === 'CallExpression' ? parent.callee?.property?.name ?? parent.callee?.name : '';
        const words = auditText(text, ['label', 'need', 'personality', 'routine', 'note'].includes(property) || ['toast', 'dialogue', 'setObjective', 'setInteract', 'fillText', 'signTexture'].includes(sink));
        if (words.length) failures.push({ file, line: source.slice(0, node.start).split('\n').length, text, words });
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'quasis' || key === 'value' || key === 'raw') continue;
        if (Array.isArray(value)) value.forEach((child) => visit(child, node));
        else if (value && typeof value === 'object') visit(value, node);
      }
    }
    visit(parsed.program);
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const text of html.match(/(?<=>)[^<>]+(?=<)|(?<=aria-label=")[^"]+|(?<=title=")[^"]+/g) ?? []) {
    const words = auditText(text.trim());
    if (words.length) failures.push({ file: 'index.html', text, words });
  }
  setLang('en');
  return failures;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = auditSources();
  for (const item of failures) console.log(`${item.file}:${item.line ?? ''} ${JSON.stringify(item.words)} ${JSON.stringify(item.text)}`);
  process.exitCode = failures.length ? 1 : 0;
}
