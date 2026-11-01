import test from 'node:test';
import assert from 'node:assert/strict';
import { createUI } from '../src/ui.js';

test('terminal UI rejects panel replacement, forced closing and stale dialogue callbacks but allows Restart', () => {
  const elements = new Map();
  function element() {
    return {
      style: {}, dataset: {}, listeners: {}, options: [], textContent: '',
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      getAttribute() { return null; }, setAttribute() {}, closest() { return null; },
      set innerHTML(html) {
        this.html = html;
        this.options = [...html.matchAll(/data-i="(\d+)"/g)].map((match) => {
          const button = element(); button.dataset.i = match[1]; return button;
        });
      },
      get innerHTML() { return this.html; },
      querySelectorAll(selector) { return selector.includes('.dlg-opts') ? this.options : []; },
    };
  }
  const oldDocument = globalThis.document;
  const oldMedia = globalThis.matchMedia;
  const oldFilter = globalThis.NodeFilter;
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.document = {
    createTreeWalker: () => ({ nextNode: () => null }),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
  };
  try {
    const ui = createUI();
    let staleCalls = 0, restarts = 0;
    ui.dialogue('Old panel', 'Old', [{ label: 'Stale', fn: () => staleCalls++ }]);
    const stale = elements.get('#panel-body').options[0];
    ui.dialogue('Game Over', 'No living residents', [{ label: 'Restart run', fn: () => restarts++ }],
      '', { closable: false, terminal: true });
    const terminalHtml = elements.get('#panel-body').innerHTML;
    ui.dialogue('Charts', 'Later callback', []);
    ui.openPanel('Shift report');
    ui.closePanel(true);
    stale.listeners.click();
    assert.equal(elements.get('#panel-body').innerHTML, terminalHtml);
    assert.equal(elements.get('#panel-close').style.display, 'none');
    assert.equal(ui.panelOpen, true);
    assert.equal(staleCalls, 0);
    elements.get('#panel-body').options[0].listeners.click();
    assert.equal(restarts, 1);
  } finally {
    globalThis.document = oldDocument;
    globalThis.matchMedia = oldMedia;
    globalThis.NodeFilter = oldFilter;
  }
});
