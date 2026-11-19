import { Grid, vis } from './grid.js';
import { CIRCLES, MAX_CIRCLE, circleSize, pickCircle } from './circles.js';

export const CORNERS = ['sharp', 'rounded'];
export const STROKES = ['solid', 'dashed'];
export const CAPS = ['none', 'arrow', 'circle', 'bigcircle', 'dot'];
export const ROUTES = ['hv', 'vh', 'straight'];

export const PROP_TYPES = {
  corner: ['rect', 'line'],
  stroke: ['rect', 'line'],
  route: ['line'],
  startCap: ['line'],
  endCap: ['line'],
  size: ['circle'],
};

const CAP_CHAR = { circle: 'o', bigcircle: 'O', dot: '*' };

function drawLabel(g, text, x, y, w, h) {
  if (!text) return;
  const lines = text.split('\n');
  const top = y + Math.floor((h - lines.length) / 2);
  lines.forEach((line, i) => {
    const chars = Array.from(line);
    const left = x + Math.floor((w - chars.length) / 2);
    chars.forEach((c, j) => g.set(left + j, top + i, c));
  });
}

function drawRect(g, s) {
  const { x, y, w, h } = s;
  const x2 = x + w - 1, y2 = y + h - 1;
  const dashed = s.stroke === 'dashed';
  for (let i = 1; i < w - 1; i++) {
    if (dashed && i % 2 === 0 && i >= 2 && i <= w - 3) continue;
    g.merge(x + i, y, '-');
    g.merge(x + i, y2, '-');
  }
  for (let j = 1; j < h - 1; j++) {
    g.merge(x, y + j, dashed ? ':' : '|');
    g.merge(x2, y + j, dashed ? ':' : '|');
  }
  const [top, bottom] = s.corner === 'rounded' ? ['.', "'"] : ['+', '+'];
  g.merge(x, y, top);
  g.merge(x2, y, top);
  g.merge(x, y2, bottom);
  g.merge(x2, y2, bottom);
  drawLabel(g, s.text, x + 1, y + 1, w - 2, h - 2);
}

function drawDiamond(g, s) {
  const { x, y, w, h } = s;
  if (w === h) {
    const n = h / 2;
    for (let r = 0; r < n; r++) {
      g.merge(x + n - 1 - r, y + r, '/');
      g.merge(x + n + r, y + r, '\\');
      g.merge(x + r, y + n + r, '\\');
      g.merge(x + w - 1 - r, y + n + r, '/');
    }
  } else {
    const n = (h - 1) / 2;
    for (let i = x + n; i < x + w - n; i++) {
      g.merge(i, y, '_');
      g.merge(i, y + h - 1, '_');
    }
    for (let r = 1; r <= n; r++) {
      g.merge(x + n - r, y + r, '/');
      g.merge(x + w - 1 - n + r, y + r, '\\');
      g.merge(x + r - 1, y + n + r, '\\');
      g.merge(x + w - r, y + n + r, '/');
    }
  }
  drawLabel(g, s.text, x, y, w, h);
}

function drawCircle(g, s) {
  CIRCLES[s.size].forEach((line, r) => {
    Array.from(line).forEach((c, i) => {
      if (c !== ' ') g.merge(s.x + i, s.y + r, c);
    });
  });
  const { w, h } = circleSize(s.size);
  drawLabel(g, s.text, s.x, s.y, w, h);
}

function drawText(g, s) {
  s.text.split('\n').forEach((line, r) => {
    Array.from(line).forEach((c, i) => g.set(s.x + i, s.y + r, c));
  });
}

const isStraight = (dx, dy) => dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);

export function lineVertices(s) {
  const a = { x: s.x1, y: s.y1 }, b = { x: s.x2, y: s.y2 };
  if (isStraight(b.x - a.x, b.y - a.y) && (s.route === 'straight' || a.x === b.x || a.y === b.y)) return [a, b];
  if (s.route === 'vh') return [a, { x: a.x, y: b.y }, b];
  return [a, { x: b.x, y: a.y }, b];
}

function segmentChar(sx, sy, dashed, t, n) {
  if (sy === 0) return dashed && t % 2 === 0 && t >= 2 && t <= n - 2 ? null : '-';
  if (sx === 0) return dashed ? ':' : '|';
  return sx === sy ? '\\' : '/';
}

function cornerChar(din, dout, corner) {
  if (corner !== 'rounded') return '+';
  return din.y < 0 || dout.y > 0 ? '.' : "'";
}

function capChar(cap, dx, dy) {
  if (cap === 'arrow') return dy === 0 ? (dx > 0 ? '>' : '<') : (dy > 0 ? 'V' : '^');
  return CAP_CHAR[cap] ?? null;
}

function drawLine(g, s) {
  const pts = lineVertices(s);
  if (pts.length === 2 && pts[0].x === pts[1].x && pts[0].y === pts[1].y) {
    g.set(s.x1, s.y1, capChar(s.endCap, 1, 0) ?? '-');
    return;
  }
  const dirs = [];
  const cells = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
    dirs.push(d);
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let t = i === 0 ? 0 : 1; t <= n; t++) {
      cells.push({ x: a.x + d.x * t, y: a.y + d.y * t, c: segmentChar(d.x, d.y, s.stroke === 'dashed', t, n) });
    }
  }
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    idx += Math.max(Math.abs(pts[i].x - pts[i - 1].x), Math.abs(pts[i].y - pts[i - 1].y));
    cells[idx].c = cornerChar(dirs[i - 1], dirs[i], s.corner);
  }
  const first = dirs[0], last = dirs[dirs.length - 1];
  const start = capChar(s.startCap, -first.x, -first.y);
  const end = capChar(s.endCap, last.x, last.y);
  if (start) cells[0].c = null;
  if (end) cells[cells.length - 1].c = null;
  for (const { x, y, c } of cells) if (c) g.merge(x, y, c);
  if (start) g.set(s.x1, s.y1, start);
  if (end) g.set(s.x2, s.y2, end);
}

const DRAW = { rect: drawRect, diamond: drawDiamond, circle: drawCircle, text: drawText, line: drawLine };

export function drawShape(g, s) {
  DRAW[s.type](g, s);
}

export function renderShapes(shapes, transform = (s) => s) {
  const g = new Grid();
  for (const s of shapes) {
    const t = transform(s);
    if (t) drawShape(g, t);
  }
  return g;
}

export function cellsOf(s) {
  const g = new Grid();
  drawShape(g, s);
  return g;
}

export function bbox(s) {
  switch (s.type) {
    case 'rect':
    case 'diamond':
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case 'circle':
      return { x: s.x, y: s.y, ...circleSize(s.size) };
    case 'text': {
      const lines = s.text.split('\n');
      return { x: s.x, y: s.y, w: Math.max(1, ...lines.map((l) => Array.from(l).length)), h: lines.length };
    }
    case 'line':
      return {
        x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2),
        w: Math.abs(s.x2 - s.x1) + 1, h: Math.abs(s.y2 - s.y1) + 1,
      };
  }
}

const inside = (b, x, y) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;

export function hitTest(s, x, y, outlineOnly) {
  if (s.type === 'text') return inside(bbox(s), x, y);
  if (outlineOnly || s.type === 'line') return !!vis(cellsOf(s).get(x, y));
  return inside(bbox(s), x, y);
}

export function handles(s) {
  const b = bbox(s);
  const r = b.x + b.w - 1, btm = b.y + b.h - 1;
  switch (s.type) {
    case 'rect':
    case 'diamond':
      return [
        { id: 'nw', x: b.x, y: b.y }, { id: 'ne', x: r, y: b.y },
        { id: 'sw', x: b.x, y: btm }, { id: 'se', x: r, y: btm },
      ];
    case 'circle':
      return [{ id: 'se', x: r, y: btm }];
    case 'line':
      return [{ id: 'p1', x: s.x1, y: s.y1 }, { id: 'p2', x: s.x2, y: s.y2 }];
    default:
      return [];
  }
}

function normSize(type, w, h) {
  if (type === 'diamond') {
    h = Math.max(2, h);
    if (w <= h) {
      h += h % 2;
      return [h, h];
    }
    h = Math.max(3, h - 1 + (h % 2));
    return [Math.max(w, h + 1), h];
  }
  return [Math.max(2, w), Math.max(2, h)];
}

function boxFrom(type, ax, ay, cx, cy) {
  const [w, h] = normSize(type, Math.abs(cx - ax) + 1, Math.abs(cy - ay) + 1);
  return {
    x: Math.max(0, cx < ax ? ax - w + 1 : ax),
    y: Math.max(0, cy < ay ? ay - h + 1 : ay),
    w, h,
  };
}

export function snapStraight(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const adx = Math.abs(dx), ady = Math.abs(dy) * 2;
  if (ady < adx * 0.414) return [bx, ay];
  if (ady > adx * 2.414) return [ax, by];
  let d = Math.round((Math.abs(dx) + Math.abs(dy)) / 2);
  if (dx < 0) d = Math.min(d, ax);
  if (dy < 0) d = Math.min(d, ay);
  return [ax + Math.sign(dx) * d, ay + Math.sign(dy) * d];
}

export function fixLine(s) {
  if (s.route === 'straight') [s.x2, s.y2] = snapStraight(s.x1, s.y1, s.x2, s.y2);
  return s;
}

export function centerCircle(s, cx, cy) {
  const { w, h } = circleSize(s.size);
  s.x = Math.max(0, cx - Math.floor(w / 2));
  s.y = Math.max(0, cy - Math.floor(h / 2));
  return s;
}

export function circleCenter(s) {
  const { w, h } = circleSize(s.size);
  return [s.x + Math.floor(w / 2), s.y + Math.floor(h / 2)];
}

export function createShape(type, a, b, d, dragged) {
  switch (type) {
    case 'rect':
      return { type, ...boxFrom(type, a.x, a.y, b.x, b.y), corner: d.corner, stroke: d.stroke, text: '' };
    case 'diamond':
      return { type, ...boxFrom(type, a.x, a.y, b.x, b.y), text: '' };
    case 'line':
      return fixLine({
        type, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        route: d.route, corner: d.corner, stroke: d.stroke, startCap: d.startCap, endCap: d.endCap,
      });
    case 'circle': {
      const size = dragged ? pickCircle(Math.abs(b.x - a.x) * 2 + 1, Math.abs(b.y - a.y) * 2 + 1) : d.size;
      return centerCircle({ type, size, text: '' }, a.x, a.y);
    }
  }
}

export function resizeShape(s, orig, handle, cx, cy) {
  if (s.type === 'line') {
    const [mx, my, ox, oy] = handle === 'p1' ? ['x1', 'y1', 'x2', 'y2'] : ['x2', 'y2', 'x1', 'y1'];
    [s[mx], s[my]] = s.route === 'straight' ? snapStraight(orig[ox], orig[oy], cx, cy) : [cx, cy];
    return;
  }
  if (s.type === 'circle') {
    const [ccx, ccy] = circleCenter(orig);
    s.size = pickCircle(Math.abs(cx - ccx) * 2 + 1, Math.abs(cy - ccy) * 2 + 1);
    centerCircle(s, ccx, ccy);
    return;
  }
  const ax = handle.includes('w') ? orig.x + orig.w - 1 : orig.x;
  const ay = handle.includes('n') ? orig.y + orig.h - 1 : orig.y;
  Object.assign(s, boxFrom(s.type, ax, ay, cx, cy));
}

export function translate(s, dx, dy) {
  const t = { ...s };
  if (s.type === 'line') {
    t.x1 += dx; t.x2 += dx; t.y1 += dy; t.y2 += dy;
  } else {
    t.x += dx; t.y += dy;
  }
  return t;
}

const int = (v, lo = 0, hi = 4000) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || 0));
const oneOf = (v, list) => (list.includes(v) ? v : list[0]);
const str = (v) => (typeof v === 'string' ? v.slice(0, 10000) : '');

export function sanitizeShape(s) {
  if (!s || typeof s !== 'object') return null;
  switch (s.type) {
    case 'rect':
      return {
        type: 'rect', x: int(s.x), y: int(s.y), w: int(s.w, 2), h: int(s.h, 2),
        corner: oneOf(s.corner, CORNERS), stroke: oneOf(s.stroke, STROKES), text: str(s.text),
      };
    case 'diamond': {
      const [w, h] = normSize('diamond', int(s.w, 2), int(s.h, 2));
      return { type: 'diamond', x: int(s.x), y: int(s.y), w, h, text: str(s.text) };
    }
    case 'circle':
      return { type: 'circle', x: int(s.x), y: int(s.y), size: int(s.size, 0, MAX_CIRCLE), text: str(s.text) };
    case 'text': {
      const text = str(s.text);
      return text ? { type: 'text', x: int(s.x), y: int(s.y), text } : null;
    }
    case 'line':
      return fixLine({
        type: 'line', x1: int(s.x1), y1: int(s.y1), x2: int(s.x2), y2: int(s.y2),
        route: oneOf(s.route, ROUTES), corner: oneOf(s.corner, CORNERS), stroke: oneOf(s.stroke, STROKES),
        startCap: oneOf(s.startCap, CAPS), endCap: oneOf(s.endCap, CAPS),
      });
    default:
      return null;
  }
}
