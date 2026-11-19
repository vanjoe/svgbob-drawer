(() => {
  'use strict';

  window.svgbobDrawer ??= {};
  async function pipe(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function encodeDoc(doc) {
    const bytes = await pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream('deflate-raw'));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function decodeDoc(encoded) {
    const bin = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = await pipe(bytes, new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(json));
  }

  window.svgbobDrawer.share = { encodeDoc, decodeDoc };
})();
