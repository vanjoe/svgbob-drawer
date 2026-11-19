(() => {
  'use strict';

  window.svgbobDrawer ??= {};
  const K = 1 << 16;

  const vis = (c) => (c && c !== ' ' ? c : undefined);

  const isH = (c) => c === '-' || c === '=' || c === '~';
  const isV = (c) => c === '|' || c === ':' || c === '!';
  const isCorner = (c) => c === '.' || c === "'" || c === '`' || c === ',';
  const isStroke = (c) => isH(c) || isV(c) || isCorner(c) || c === '+';

  function mergeChar(a, b) {
    if (!vis(a) || a === b) return b;
    if (!isStroke(a) || !isStroke(b)) return b;
    if (b === '+') return '+';
    if ((isH(a) && isH(b)) || (isV(a) && isV(b)) || (isCorner(a) && isCorner(b))) return b;
    return '+';
  }

  class Grid {
    constructor() {
      this.cells = new Map();
    }

    static key(x, y) {
      return y * K + x;
    }

    static unkey(k) {
      return [k % K, Math.floor(k / K)];
    }

    get(x, y) {
      return this.cells.get(y * K + x);
    }

    set(x, y, c) {
      if (x < 0 || y < 0 || x >= K) return;
      this.cells.set(y * K + x, c);
    }

    merge(x, y, c) {
      this.set(x, y, mergeChar(this.get(x, y), c));
    }

    delete(x, y) {
      this.cells.delete(y * K + x);
    }

    get size() {
      return this.cells.size;
    }

    *[Symbol.iterator]() {
      for (const [k, c] of this.cells) yield [k % K, Math.floor(k / K), c];
    }

    clone() {
      const g = new Grid();
      g.cells = new Map(this.cells);
      return g;
    }

    extent() {
      let maxX = -1, maxY = -1, minX = Infinity, minY = Infinity;
      for (const [x, y, c] of this) {
        if (!vis(c)) continue;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
      }
      return { minX, minY, maxX, maxY };
    }

    toText() {
      const rows = [];
      for (const [x, y, c] of this) {
        if (!vis(c)) continue;
        (rows[y] ??= [])[x] = c;
      }
      const lines = Array.from(rows, (row) =>
        row ? Array.from(row, (c) => c ?? ' ').join('').trimEnd() : '');
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      return lines.join('\n');
    }

    static fromText(text, ox = 0, oy = 0) {
      const g = new Grid();
      text.replace(/\r\n?/g, '\n').split('\n').forEach((line, y) => {
        let x = 0;
        for (const c of line) {
          if (c === '\t') {
            x += 4 - (x % 4);
            continue;
          }
          if (c !== ' ') g.set(ox + x, oy + y, c);
          x++;
        }
      });
      return g;
    }
  }

  window.svgbobDrawer.grid = { vis, mergeChar, Grid };
})();
