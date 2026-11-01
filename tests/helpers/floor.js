import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

// Load the same GLTFs and furnishing code as Vite, without needing a renderer.
export async function furnishedFloor() {
  const root = new URL('../../public/', import.meta.url).href;
  const hooks = registerHooks({
    load(url, context, next) {
      const result = next(url, context);
      if (url.endsWith('/src/assets.js')) {
        return { ...result, source: String(result.source).replace('import.meta.env.BASE_URL', JSON.stringify(root)) };
      }
      return result;
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request, options) => {
    const url = typeof request === 'string' ? request : request.url;
    if (!url.startsWith('file:')) return originalFetch(request, options);
    return new Response(await readFile(fileURLToPath(url)));
  };
  globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
  globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });
  globalThis.self = globalThis;
  const context = new Proxy({}, {
    get(object, key) {
      if (key === 'measureText') return () => ({ width: 20 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return object[key] ?? (() => {});
    },
    set(object, key, value) { object[key] = value; return true; },
  });
  globalThis.document = {
    documentElement: {},
    querySelectorAll: () => [],
    createElement: () => ({ width: 512, height: 512, getContext: () => context }),
    fonts: { ready: Promise.resolve() },
  };
  try {
    const { loadAssets } = await import('../../src/assets.js');
    await loadAssets();
    const { buildMap } = await import('../../src/map.js');
    const scene = new THREE.Scene();
    return { map: buildMap(scene), scene };
  } finally {
    globalThis.fetch = originalFetch;
    hooks.deregister();
  }
}
