(() => {
  'use strict';

  window.svgbobDrawer ??= {};

  const LOCAL_SCRIPT = 'vendor/svgbob-wasm/svgbob_wasm.js';
  const CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/svgbob-wasm@1.0.0/svgbob_wasm_bg.wasm',
    'https://unpkg.com/svgbob-wasm@1.0.0/svgbob_wasm_bg.wasm',
  ];

  let loading = null;

  function bindRender(wasm) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    return (source) => {
      const ret = wasm.__wbindgen_add_to_stack_pointer(-16);
      try {
        const input = encoder.encode(source);
        const ptr = wasm.__wbindgen_malloc(input.length);
        new Uint8Array(wasm.memory.buffer).set(input, ptr);
        wasm.render(ret, ptr, input.length);
        const [outPtr, outLen] = new Int32Array(wasm.memory.buffer, ret, 2);
        const svg = decoder.decode(new Uint8Array(wasm.memory.buffer, outPtr, outLen));
        wasm.__wbindgen_free(outPtr, outLen);
        return svg;
      } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
      }
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`couldn't load ${src}`));
      document.head.append(script);
    });
  }

  async function localWasm() {
    if (!window.svgbobDrawer.wasmBase64) await loadScript(LOCAL_SCRIPT);
    return Uint8Array.from(atob(window.svgbobDrawer.wasmBase64), (c) => c.charCodeAt(0));
  }

  async function cdnWasm(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.arrayBuffer();
  }

  function loadSvgbob() {
    loading ??= (async () => {
      let lastError;
      for (const source of [localWasm, ...CDN_URLS.map((url) => () => cdnWasm(url))]) {
        try {
          const { instance } = await WebAssembly.instantiate(await source(), {});
          return bindRender(instance.exports);
        } catch (err) {
          lastError = err;
        }
      }
      loading = null;
      throw lastError;
    })();
    return loading;
  }

  window.svgbobDrawer.svgbob = { loadSvgbob };
})();
