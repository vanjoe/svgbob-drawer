const WASM_URLS = [
  new URL('../vendor/svgbob-wasm/svgbob_wasm_bg.wasm', import.meta.url).href,
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

export function loadSvgbob() {
  loading ??= (async () => {
    let lastError;
    for (const url of WASM_URLS) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
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
