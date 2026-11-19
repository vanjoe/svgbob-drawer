import { Grid, vis } from './grid.js';
import { CIRCLES, MAX_CIRCLE } from './circles.js';
import * as S from './shapes.js';

const STEP = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1], NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1] };
const OPPOSITE = { E: 'W', W: 'E', N: 'S', S: 'N', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' };
const ALL = Object.keys(STEP);
const MARKER_CAP = { '<': 'arrow', '>': 'arrow', '^': 'arrow', V: 'arrow', v: 'arrow', o: 'circle', O: 'bigcircle', '*': 'dot' };
const CORNERS = new Set(['+', '.', "'", '`']);
const ALNUM = /[A-Za-z0-9]/;
const isHorizontal = (d) => d === 'E' || d === 'W';
const isOrthogonal = (d) => d.length === 1;

function directionsOf(c) {
  switch (c) {
    case '-': case '>': case '<': return ['E', 'W'];
    case '|': case ':': return ['N', 'S'];
    case '/': return ['NE', 'SW'];
    case '\\': return ['NW', 'SE'];
    case '+': return ['N', 'S', 'E', 'W'];
    case '.': return ['E', 'W', 'S'];
    case "'": case '`': return ['E', 'W', 'N'];
    case '^': return ['S', 'SW', 'SE'];
    case 'V': case 'v': return ['N', 'NE', 'NW'];
    case 'o': case 'O': case '*': return ALL;
    default: return [];
  }
}

function tolerated(src, drawn) {
  if (src === '+') return '-|:.\'`'.includes(drawn);
  if (src === '.' || src === "'" || src === '`') return '-|:'.includes(drawn) || (src === '`' && drawn === "'");
  return src === 'v' && drawn === 'V';
}

export function recognise(raw, base, legend = new Map()) {
  const composite = base.clone();
  const G = new Grid();
  for (const [x, y, c] of raw) {
    if (c === ' ') composite.delete(x, y);
    else composite.set(x, y, c);
    if (vis(c) && !vis(base.get(x, y))) G.set(x, y, c);
  }
  const cells = [...G].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const claimed = new Set();
  const shared = new Set();
  const found = [];
  const tagCells = [];
  const usedTags = new Set();
  const key = Grid.key;
  const src = (x, y) => G.get(x, y);
  const free = (x, y) => vis(src(x, y)) && !claimed.has(key(x, y));

  function fits(shape) {
    const own = [], tol = [];
    for (const [x, y, c] of S.cellsOf(shape)) {
      const k = key(x, y);
      if (!vis(c)) {
        if (vis(composite.get(x, y))) return null;
        continue;
      }
      const s = src(x, y);
      if (claimed.has(k) || s !== c) {
        if (!tolerated(s, c)) return null;
        tol.push(k);
      } else {
        own.push(k);
      }
    }
    return own.length ? { own, tol } : null;
  }

  function accept(shape, fit) {
    found.push(shape);
    for (const k of fit.own) claimed.add(k);
    for (const k of fit.tol) shared.add(k);
  }

  function tryShapes(candidates) {
    for (const shape of candidates) {
      const fit = fits(shape);
      if (fit) {
        accept(shape, fit);
        return shape;
      }
    }
    return null;
  }

  function findCircles() {
    for (let size = MAX_CIRCLE; size >= 3; size--) {
      const art = CIRCLES[size];
      const ax = art[0].search(/\S/);
      for (const [x, y, c] of cells) {
        if (c !== art[0][ax] || claimed.has(key(x, y)) || x < ax) continue;
        tryShapes([{ type: 'circle', x: x - ax, y, size, text: '' }]);
      }
    }
  }

  function findRects() {
    for (const [x, y, c] of cells) {
      if ((c !== '+' && c !== '.') || claimed.has(key(x, y))) continue;
      const widths = [];
      for (let i = 1; i < 400; i++) {
        const ch = src(x + i, y);
        if (ch === '+' || ch === '.') widths.push(i + 1);
        if (ch === '-' || ch === '+') continue;
        if (!vis(ch) && src(x + i + 1, y) === '-') continue;
        break;
      }
      const heights = [];
      for (let j = 1; j < 400; j++) {
        const ch = src(x, y + j);
        if (ch === '+' || ch === "'" || ch === '`') heights.push(j + 1);
        if (ch !== '|' && ch !== ':' && ch !== '+') break;
      }
      const corner = c === '.' ? 'rounded' : 'sharp';
      search: for (const w of widths) {
        for (const h of heights) {
          for (const stroke of ['solid', 'dashed']) {
            if (tryShapes([{ type: 'rect', x, y, w, h, corner, stroke, text: '' }])) break search;
          }
        }
      }
    }
  }

  function findDiamonds() {
    for (const [x, y, c] of cells) {
      if (claimed.has(key(x, y))) continue;
      if (c === '/' && src(x + 1, y) === '\\') {
        let n = 1;
        while (src(x - n, y + n) === '/' && src(x + 1 + n, y + n) === '\\') n++;
        const candidates = [];
        for (let m = n; m >= 1; m--) candidates.push({ type: 'diamond', x: x - m + 1, y, w: 2 * m, h: 2 * m, text: '' });
        tryShapes(candidates);
      } else if (c === '_' && src(x - 1, y) !== '_') {
        let end = x;
        while (src(end + 1, y) === '_') end++;
        let n = 0;
        while (src(x - 1 - n, y + 1 + n) === '/') n++;
        if (n) tryShapes([{ type: 'diamond', x: x - n, y, w: end - x + 1 + 2 * n, h: 2 * n + 1, text: '' }]);
      }
    }
  }

  function findLines() {
    const gaps = new Set();
    const visited = new Set();
    const charAt = (x, y) => (gaps.has(key(x, y)) ? '-' : src(x, y));

    function isStroke(x, y) {
      const c = src(x, y);
      if (!vis(c) || claimed.has(key(x, y))) return false;
      if (ALNUM.test(c) && (ALNUM.test(src(x - 1, y) ?? '') || ALNUM.test(src(x + 1, y) ?? ''))) return false;
      return directionsOf(c).length > 0;
    }

    function step([x, y], d) {
      const [dx, dy] = STEP[d];
      const nx = x + dx, ny = y + dy;
      const c = charAt(x, y);
      if (!directionsOf(c).includes(d)) return null;
      if (isStroke(nx, ny) && directionsOf(src(nx, ny)).includes(OPPOSITE[d])) return [nx, ny];
      if (c === '-' && isHorizontal(d) && !vis(src(nx, ny)) && src(nx + dx, ny) === '-' && isStroke(nx + dx, ny)) {
        gaps.add(key(nx, ny));
        return [nx, ny];
      }
      return null;
    }

    const exits = (p) => directionsOf(charAt(...p)).filter((d) => step(p, d));

    function walk(start, dir) {
      const path = [start];
      const dirs = [null];
      let cur = start, d = dir;
      visited.add(key(...start));
      for (let guard = 0; guard < 10000; guard++) {
        const next = step(cur, d);
        if (!next) break;
        const junction = exits(next).length >= 3;
        if (visited.has(key(...next)) && !junction) break;
        path.push(next);
        dirs.push(d);
        cur = next;
        if (junction) break;
        visited.add(key(...cur));
        const c = charAt(...cur);
        if (MARKER_CAP[c]) break;
        const straight = step(cur, d);
        if (straight && !CORNERS.has(c)) continue;
        const turns = directionsOf(c).filter((t) => t !== d && t !== OPPOSITE[d] && step(cur, t));
        if (turns.length === 1) d = turns[0];
        else if (!straight) break;
      }
      return { path, dirs };
    }

    function splitIntoLines({ path, dirs }) {
      const segments = [];
      for (let i = 1; i < path.length; i++) {
        const last = segments[segments.length - 1];
        if (last && last.dir === dirs[i]) last.end = i;
        else segments.push({ dir: dirs[i], start: i - 1, end: i });
      }
      const lines = [];
      for (const seg of segments) {
        const cur = lines[lines.length - 1];
        const bendable = cur && cur.segments.length === 1 && isOrthogonal(cur.segments[0].dir) && isOrthogonal(seg.dir)
          && isHorizontal(cur.segments[0].dir) !== isHorizontal(seg.dir);
        if (bendable) {
          cur.segments.push(seg);
          cur.end = seg.end;
        } else {
          lines.push({ segments: [seg], start: seg.start, end: seg.end });
        }
      }
      return lines.map((line) => ({ ...line, cells: path.slice(line.start, line.end + 1) }));
    }

    function lineCandidates(line) {
      const { cells: pts, segments } = line;
      const first = segments[0].dir;
      const capAt = ([x, y]) => MARKER_CAP[charAt(x, y)] ?? 'none';
      const bend = segments.length === 2 ? charAt(...pts[segments[0].end - line.start]) : '+';
      const dashed = pts.some(([x, y]) => gaps.has(key(x, y)) || src(x, y) === ':');
      const base = {
        type: 'line',
        route: !isOrthogonal(first) ? 'straight' : isHorizontal(first) ? 'hv' : 'vh',
        corner: bend === '.' || bend === "'" || bend === '`' ? 'rounded' : 'sharp',
      };
      const candidates = [];
      for (const trimStart of [false, true]) {
        for (const trimEnd of [false, true]) {
          const a = trimStart ? 1 : 0, b = pts.length - (trimEnd ? 2 : 1);
          if (b - a < 2 || (trimStart && capAt(pts[0]) === 'none') || (trimEnd && capAt(pts[pts.length - 1]) === 'none')) continue;
          for (const stroke of dashed ? ['dashed', 'solid'] : ['solid', 'dashed']) {
            candidates.push({
              ...base, stroke,
              x1: pts[a][0], y1: pts[a][1], x2: pts[b][0], y2: pts[b][1],
              startCap: trimStart ? 'none' : capAt(pts[a]), endCap: trimEnd ? 'none' : capAt(pts[b]),
            });
          }
        }
      }
      return candidates;
    }

    function trace(start, dir) {
      for (const line of splitIntoLines(walk(start, dir))) tryShapes(lineCandidates(line));
    }

    for (const [x, y] of cells) {
      if (visited.has(key(x, y)) || !isStroke(x, y)) continue;
      const out = exits([x, y]);
      if (out.length === 1) trace([x, y], out[0]);
    }
    for (const [x, y] of cells) {
      if (!isStroke(x, y) || exits([x, y]).length < 3) continue;
      for (const d of exits([x, y])) {
        const next = step([x, y], d);
        if (next && !visited.has(key(...next))) trace([x, y], d);
      }
    }
    for (const [x, y] of cells) {
      if (visited.has(key(x, y)) || !isStroke(x, y)) continue;
      const out = exits([x, y]);
      if (out.length) trace([x, y], out[0]);
    }
  }

  function interiorRows(shape) {
    const b = S.bbox(shape);
    if (shape.type === 'rect') {
      return Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ y: b.y + 1 + i, from: b.x + 1, to: b.x + b.w - 2 }));
    }
    const span = new Map();
    for (const [x, y, c] of S.cellsOf(shape)) {
      if (!vis(c)) continue;
      const s = span.get(y) ?? [x, x];
      span.set(y, [Math.min(s[0], x), Math.max(s[1], x)]);
    }
    return [...span].map(([y, [lo, hi]]) => ({ y, from: lo + 1, to: hi - 1 })).filter((r) => r.to >= r.from);
  }

  function takeColourTag(shape) {
    if (!S.canColour(shape)) return;
    for (const { y, from, to } of interiorRows(shape)) {
      let row = '';
      for (let x = from; x <= to; x++) row += free(x, y) && !shared.has(key(x, y)) ? src(x, y) : ' ';
      for (const m of row.matchAll(/\{([A-Za-z_][\w-]*)\}/g)) {
        const rule = legend.get(m[1]);
        if (!rule) continue;
        shape.fillColor = rule.fill;
        shape.strokeColor = rule.stroke;
        usedTags.add(m[1]);
        for (let i = 0; i < m[0].length; i++) {
          claimed.add(key(from + m.index + i, y));
          tagCells.push([from + m.index + i, y]);
        }
        return;
      }
    }
  }

  function labelFits(shape, text, expected) {
    const plain = S.cellsOf(shape);
    const own = [];
    for (const [x, y, c] of S.cellsOf({ ...shape, text })) {
      if (plain.get(x, y) === c) continue;
      if (!vis(c)) {
        if (vis(composite.get(x, y))) return null;
      } else if (free(x, y) && !shared.has(key(x, y)) && src(x, y) === c) {
        own.push(key(x, y));
      } else {
        return null;
      }
    }
    return own.length === expected ? own : null;
  }

  function attachLabels() {
    for (const shape of found) {
      if (shape.type === 'line') continue;
      takeColourTag(shape);
      const interior = interiorRows(shape);
      const rows = interior
        .map(({ y, from, to }) => {
          const xs = [];
          for (let x = from; x <= to; x++) if (free(x, y) && !shared.has(key(x, y))) xs.push(x);
          return { y, xs };
        })
        .filter((r) => r.xs.length);
      if (!rows.length) continue;
      const lineAt = (y) => {
        const row = rows.find((r) => r.y === y);
        if (!row) return '';
        let text = '';
        for (let x = row.xs[0]; x <= row.xs[row.xs.length - 1]; x++) text += vis(src(x, y)) ? src(x, y) : ' ';
        return text;
      };
      const ys = interior.map((r) => r.y);
      const first = rows[0].y, last = rows[rows.length - 1].y;
      const innerTop = Math.min(...ys), innerBottom = Math.max(...ys);
      const expected = rows.reduce((n, r) => n + r.xs.length, 0);
      for (const [top, bottom] of [[first, last], [innerTop, last], [first, innerBottom], [innerTop, innerBottom]]) {
        const text = Array.from({ length: bottom - top + 1 }, (_, i) => lineAt(top + i)).join('\n');
        const own = labelFits(shape, text, expected);
        if (!own) continue;
        shape.text = text;
        for (const k of own) claimed.add(k);
        break;
      }
    }
  }

  function findTexts() {
    const remaining = cells.filter(([x, y]) => free(x, y) && !shared.has(key(x, y)));
    const runs = [];
    for (const [x, y, c] of remaining) {
      const last = runs[runs.length - 1];
      const gap = last && last.y === y ? x - last.end : Infinity;
      if (gap === 1 || (gap === 2 && !vis(composite.get(x - 1, y)))) {
        last.text += (gap === 2 ? ' ' : '') + c;
        last.end = x;
      } else {
        runs.push({ x, y, end: x, text: c });
      }
    }
    const words = runs.filter((r) => ALNUM.test(r.text));
    const used = new Set();
    for (const run of words) {
      if (used.has(run)) continue;
      const block = [run];
      for (let next; (next = words.find((r) => !used.has(r) && r !== run && r.x === run.x && r.y === block[block.length - 1].y + 1));) {
        block.push(next);
      }
      const shape = { type: 'text', x: run.x, y: run.y, text: block.map((r) => r.text).join('\n') };
      if (tryShapes([shape])) {
        block.forEach((r) => used.add(r));
        continue;
      }
      if (block.length > 1) tryShapes([{ type: 'text', x: run.x, y: run.y, text: run.text }]);
      used.add(run);
    }
  }

  findCircles();
  findRects();
  findDiamonds();
  findLines();
  attachLabels();
  findTexts();
  return { shapes: found.map(S.sanitizeShape).filter(Boolean), tagCells, usedTags };
}
