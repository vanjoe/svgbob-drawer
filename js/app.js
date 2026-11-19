import { Grid, vis } from './grid.js';
import * as S from './shapes.js';
import { MAX_CIRCLE, circleRadius } from './circles.js';
import { loadSvgbob } from './svgbob.js';
import { encodeDoc, decodeDoc } from './share.js';
import { recognise } from './convert.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const wrap = $('#canvas-wrap');
const asciiBox = $('#ascii');
const editor = $('#cell-editor');

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
const STORAGE_KEY = 'svgbob-drawer:doc';
const PREFS_KEY = 'svgbob-drawer:prefs';
const DRAW_TOOLS = ['rect', 'diamond', 'circle', 'line'];
const TOOL_KEYS = { v: 'select', s: 'select', r: 'rect', d: 'diamond', c: 'circle', l: 'line', t: 'text', e: 'eraser' };
const HINTS = {
  select: 'Click to select, drag to move, drag on empty space to box-select. Double-click or Enter edits text.',
  rect: 'Drag to draw a rectangle.',
  diamond: 'Drag to draw a diamond. Making it wider than tall gives a flat-topped hexagon.',
  circle: 'Click to place a circle, or drag out from the centre to size it. svgbob only recognises fixed sizes.',
  line: 'Drag to draw a line. Press F while drawing to flip which way the elbow bends.',
  text: 'Click to type text. Esc or click elsewhere to finish.',
  eraser: 'Drag to delete shapes and loose characters. Hold Alt to punch out single characters only.',
};

const state = {
  shapes: [],
  raw: new Grid(),
  selected: new Set(),
  rawSel: new Set(),
  tool: 'select',
  defaults: {
    corner: 'sharp', stroke: 'solid', startCap: 'none', endCap: 'arrow', route: 'hv', size: 3, fillColor: '', strokeColor: '',
  },
  customLegend: [],
  fontSize: 15,
  preview: true,
  sideWidth: null,
  draft: null,
  hover: null,
  editingId: null,
  unrecognized: new Set(),
};

let nextId = 1;
let cellW = 9, cellH = 20, dpr = 1, cols = 0, rows = 0;
let gesture = null;
let edit = null;
let clip = null;
let pasteCount = 0;
let lastPropChange = { prop: null, time: 0 };
let lastTextEdit = 0;
const undoStack = [];
const redoStack = [];

const withId = (s) => ({ ...s, id: nextId++ });
const selectedShapes = () => state.shapes.filter((s) => state.selected.has(s.id));
const hasSelection = () => state.selected.size > 0 || state.rawSel.size > 0;

function serialize() {
  return {
    v: 1,
    shapes: state.shapes.map(({ id, ...s }) => s),
    raw: [...state.raw],
    legend: state.customLegend,
  };
}

function load(doc) {
  state.shapes = (Array.isArray(doc?.shapes) ? doc.shapes : []).map(S.sanitizeShape).filter(Boolean).map(withId);
  state.raw = new Grid();
  for (const cell of Array.isArray(doc?.raw) ? doc.raw : []) {
    const [x, y, c] = Array.isArray(cell) ? cell : [];
    if (Number.isInteger(x) && Number.isInteger(y) && typeof c === 'string' && c.length) state.raw.set(x, y, Array.from(c)[0]);
  }
  state.customLegend = (Array.isArray(doc?.legend) ? doc.legend : [])
    .filter((l) => typeof l === 'string').slice(0, 200).map((l) => l.slice(0, 500));
  state.selected.clear();
  state.rawSel.clear();
}

function checkpoint() {
  undoStack.push(JSON.stringify(serialize()));
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
}

function ensureCheckpoint(g) {
  if (g.checkpointed) return;
  checkpoint();
  g.checkpointed = true;
}

function stepHistory(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(serialize()));
  load(JSON.parse(from.pop()));
  changed();
}

const undo = () => stepHistory(undoStack, redoStack);
const redo = () => stepHistory(redoStack, undoStack);

function tagName(i) {
  let name = '';
  for (i++; i > 0; i = Math.floor(i / 26)) {
    i--;
    name = String.fromCharCode(97 + (i % 26)) + name;
  }
  return name;
}

const legendName = (line) => line.match(/^\s*([A-Za-z_][\w-]*)\s*=/)?.[1];

function computeTags() {
  const reserved = new Set(state.customLegend.map(legendName).filter(Boolean));
  const byStyle = new Map();
  const byId = new Map();
  let i = 0;
  for (const s of state.shapes) {
    if (!S.hasColour(s)) continue;
    const key = `${s.fillColor}|${s.strokeColor}`;
    if (!byStyle.has(key)) {
      let name;
      do name = tagName(i++); while (reserved.has(name));
      byStyle.set(key, { name, fill: s.fillColor, stroke: s.strokeColor });
    }
    byId.set(s.id, byStyle.get(key).name);
  }
  return { byId, styles: [...byStyle.values()] };
}

function legendLines(tags) {
  const generated = tags.styles.map(({ name, fill, stroke }) =>
    `${name} = { ${[fill && `fill: ${fill};`, stroke && `stroke: ${stroke};`].filter(Boolean).join(' ')} }`);
  return [...generated, ...state.customLegend];
}

function splitLegend(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => /^\s*#\s*legend\s*:?\s*$/i.test(l));
  if (at < 0) return { diagram: text, legend: null };
  return { diagram: lines.slice(0, at).join('\n'), legend: lines.slice(at + 1) };
}

function styleValue(rule, prop) {
  const m = rule.match(new RegExp(`[{;]\\s*${prop}\\s*:\\s*([^;}]*)`));
  return m ? S.cssColour(m[1]) : '';
}

function applyLegend(legend) {
  const tags = computeTags();
  const shapesByName = new Map();
  for (const s of state.shapes) {
    const name = tags.byId.get(s.id);
    if (name) shapesByName.set(name, [...(shapesByName.get(name) ?? []), s]);
  }
  const custom = [];
  const seen = new Set();
  for (const line of legend ?? []) {
    if (!line.trim()) continue;
    const name = legendName(line);
    const targets = name && shapesByName.get(name);
    if (!targets) {
      custom.push(line);
      continue;
    }
    seen.add(name);
    if (!/^[^{]*\{.*\}\s*$/.test(line)) continue;
    const fill = styleValue(line, 'fill');
    const stroke = styleValue(line, 'stroke');
    for (const s of targets) {
      if (fill !== null) s.fillColor = fill;
      if (stroke !== null) s.strokeColor = stroke;
    }
  }
  for (const [name, targets] of shapesByName) {
    if (seen.has(name)) continue;
    for (const s of targets) s.fillColor = s.strokeColor = '';
  }
  state.customLegend = custom;
}

function shapesGrid({ forDisplay = false, tags = computeTags() } = {}) {
  const g = S.renderShapes(state.shapes, (s) => {
    const t = tags.byId.has(s.id) ? { ...s, tag: tags.byId.get(s.id) } : s;
    return forDisplay && s.id === state.editingId ? (s.type === 'text' ? null : { ...t, text: '' }) : t;
  });
  if (forDisplay && state.draft) S.drawShape(g, state.draft);
  return g;
}

function overlayRaw(base) {
  const out = base.clone();
  for (const [x, y, c] of state.raw) c === ' ' ? out.delete(x, y) : out.set(x, y, c);
  return out;
}

function documentText() {
  const tags = computeTags();
  const body = overlayRaw(shapesGrid({ tags })).toText();
  const legend = legendLines(tags);
  return legend.length ? `${body}\n\n# Legend:\n${legend.join('\n')}` : body;
}

function diffRaw(textGrid, base) {
  const raw = new Grid();
  for (const [x, y, c] of textGrid) if (vis(base.get(x, y)) !== c) raw.set(x, y, c);
  for (const [x, y, c] of base) if (vis(c) && !textGrid.get(x, y)) raw.set(x, y, ' ');
  return raw;
}

let saveTimer = null;
function changed({ fromTextarea = false } = {}) {
  const text = documentText();
  if (!fromTextarea && asciiBox.value !== text) asciiBox.value = text;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store(STORAGE_KEY, serialize()), 300);
  schedulePreview();
  requestDraw();
  refreshProps();
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function restoreStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

const savePrefs = () => store(PREFS_KEY, {
  defaults: state.defaults, fontSize: state.fontSize, preview: state.preview, sideWidth: state.sideWidth,
});


function measure() {
  ctx.font = `${state.fontSize}px ${FONT}`;
  cellW = ctx.measureText('M').width;
  cellH = Math.round(state.fontSize * 1.35);
  Object.assign(editor.style, {
    font: `${state.fontSize}px ${FONT}`,
    lineHeight: `${cellH}px`,
  });
  $('#zoom-label').textContent = `${Math.round((state.fontSize / 15) * 100)}%`;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fitCanvas(g) {
  const ext = g.extent();
  const nextCols = Math.max(Math.floor(wrap.clientWidth / cellW), ext.maxX + 24);
  const nextRows = Math.max(Math.floor(wrap.clientHeight / cellH), ext.maxY + 12);
  const nextDpr = window.devicePixelRatio || 1;
  if (nextCols === cols && nextRows === rows && nextDpr === dpr) return;
  cols = nextCols;
  rows = nextRows;
  dpr = nextDpr;
  canvas.width = Math.ceil(cols * cellW * dpr);
  canvas.height = Math.ceil(rows * cellH * dpr);
  canvas.style.width = `${cols * cellW}px`;
  canvas.style.height = `${rows * cellH}px`;
}

let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(draw);
}

function cellSetOf(shapes) {
  const set = new Set();
  for (const s of shapes) for (const [x, y, c] of S.cellsOf(s)) if (vis(c)) set.add(Grid.key(x, y));
  return set;
}

function draw() {
  drawQueued = false;
  const g = overlayRaw(shapesGrid({ forDisplay: true }));
  fitCanvas(g);
  const C = {
    bg: cssVar('--canvas-bg'), grid: cssVar('--grid'), ink: cssVar('--ink'), rawInk: cssVar('--raw-ink'),
    accent: cssVar('--accent'), warn: cssVar('--warn'), muted: cssVar('--muted'), selTint: cssVar('--sel-tint'), hover: cssVar('--hover'),
  };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, cols * cellW, rows * cellH);

  ctx.fillStyle = C.grid;
  for (let y = 1; y < rows; y++) {
    for (let x = 1; x < cols; x++) ctx.fillRect(Math.round(x * cellW) - 1, y * cellH - 1, 2, 2);
  }

  ctx.fillStyle = C.selTint;
  for (const k of state.rawSel) {
    const [x, y] = Grid.unkey(k);
    ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
  }

  if (state.hover && (DRAW_TOOLS.includes(state.tool) || state.tool === 'text' || state.tool === 'eraser') && !gesture) {
    ctx.fillStyle = C.hover;
    ctx.fillRect(state.hover.x * cellW, state.hover.y * cellH, cellW, cellH);
  }

  const tags = computeTags();
  const strokeInk = new Map();
  const tagCells = new Set();
  for (const s of state.shapes) {
    if (!S.hasColour(s)) continue;
    const b = S.bbox(s);
    if (s.fillColor) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = s.fillColor;
      if (s.type === 'rect') ctx.fillRect((b.x + 0.5) * cellW, (b.y + 0.5) * cellH, (b.w - 1) * cellW, (b.h - 1) * cellH);
      else {
        ctx.beginPath();
        ctx.ellipse((b.x + b.w / 2) * cellW, (b.y + b.h / 2) * cellH, (b.w / 2 - 0.4) * cellW, (b.h / 2 - 0.3) * cellH, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (s.strokeColor) {
      for (const [x, y, c] of S.cellsOf({ ...s, text: '' })) if (vis(c)) strokeInk.set(Grid.key(x, y), s.strokeColor);
    }
    const name = tags.byId.get(s.id);
    const spot = S.tagSpot(s, name.length + 2);
    if (spot) for (let i = 0; i < name.length + 2; i++) tagCells.add(Grid.key(spot.x + i, spot.y));
  }

  const highlighted = cellSetOf(state.draft ? [...selectedShapes(), state.draft] : selectedShapes());
  const flagged = cellSetOf(state.shapes.filter((s) => state.unrecognized.has(s.id)));
  ctx.font = `${state.fontSize}px ${FONT}`;
  ctx.textBaseline = 'middle';
  for (const [x, y, c] of g) {
    if (!vis(c)) continue;
    const k = Grid.key(x, y);
    const raw = state.raw.get(x, y);
    if (highlighted.has(k) || state.rawSel.has(k)) ctx.fillStyle = C.accent;
    else if (flagged.has(k)) ctx.fillStyle = C.warn;
    else if (tagCells.has(k)) ctx.fillStyle = C.muted;
    else if (strokeInk.has(k)) ctx.fillStyle = strokeInk.get(k);
    else ctx.fillStyle = raw ? C.rawInk : C.ink;
    ctx.fillText(c, x * cellW, y * cellH + cellH / 2 + 1);
  }

  const sel = selectedShapes();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  for (const s of sel) {
    const b = S.bbox(s);
    ctx.strokeRect(b.x * cellW - 2.5, b.y * cellH - 2.5, b.w * cellW + 5, b.h * cellH + 5);
  }
  ctx.setLineDash([]);
  if (sel.length === 1 && !gesture?.kind?.startsWith('create')) {
    ctx.fillStyle = C.selTint;
    ctx.lineWidth = 1.5;
    for (const h of S.handles(sel[0])) {
      ctx.fillRect(h.x * cellW, h.y * cellH, cellW, cellH);
      ctx.strokeRect(h.x * cellW + 0.75, h.y * cellH + 0.75, cellW - 1.5, cellH - 1.5);
    }
  }

  if (gesture?.kind === 'marquee') {
    const r = rectOf(gesture.start, gesture.cur);
    ctx.fillStyle = C.selTint;
    ctx.fillRect(r.x * cellW, r.y * cellH, r.w * cellW, r.h * cellH);
    ctx.strokeRect(r.x * cellW + 0.5, r.y * cellH + 0.5, r.w * cellW - 1, r.h * cellH - 1);
  }
}

const rectOf = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1,
});

function cellAt(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.floor((e.clientX - r.left) / cellW)),
    y: Math.max(0, Math.floor((e.clientY - r.top) / cellH)),
  };
}

function topShapeAt(x, y, outlineOnly = false) {
  const passes = outlineOnly ? [true] : [true, false];
  for (const outline of passes) {
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      if (S.hitTest(state.shapes[i], x, y, outline)) return state.shapes[i];
    }
  }
  return null;
}


function onPointerDown(e) {
  if (e.button !== 0) return;
  if (edit) commitEditor();
  const c = cellAt(e);
  if (state.tool === 'text') {
    e.preventDefault();
    const hit = topShapeAt(c.x, c.y);
    setTimeout(() => openEditor(hit?.type === 'text' ? hit : { type: 'text', x: c.x, y: c.y, text: '' }, !hit || hit.type !== 'text'));
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  if (state.tool === 'select') return startSelectGesture(e, c);
  if (state.tool === 'eraser') {
    gesture = { kind: 'erase', alt: e.altKey, last: c };
    eraseAt(c);
    return;
  }
  gesture = { kind: 'create', start: c, cur: c, dragged: false };
  updateDraft();
}

function startSelectGesture(e, c) {
  const sel = selectedShapes();
  if (sel.length === 1) {
    const h = S.handles(sel[0]).find((h) => h.x === c.x && h.y === c.y);
    if (h) {
      gesture = { kind: 'resize', shape: sel[0], orig: { ...sel[0] }, handle: h.id };
      return;
    }
  }
  const hit = topShapeAt(c.x, c.y);
  const onSelectedRaw = state.rawSel.has(Grid.key(c.x, c.y));
  if (hit && e.shiftKey && state.selected.has(hit.id)) {
    state.selected.delete(hit.id);
    changed();
    return;
  }
  if (hit && !state.selected.has(hit.id) && !onSelectedRaw) {
    if (!e.shiftKey) {
      state.selected.clear();
      state.rawSel.clear();
    }
    state.selected.add(hit.id);
  }
  if (hit || onSelectedRaw) {
    startMove(c);
    changed();
    return;
  }
  if (!e.shiftKey) {
    state.selected.clear();
    state.rawSel.clear();
  }
  gesture = { kind: 'marquee', start: c, cur: c };
  changed();
}

function startMove(c) {
  const lifted = [];
  const under = state.raw.clone();
  for (const k of state.rawSel) {
    const [x, y] = Grid.unkey(k);
    const ch = state.raw.get(x, y);
    if (ch === undefined) continue;
    lifted.push([x, y, ch]);
    under.delete(x, y);
  }
  const orig = new Map(selectedShapes().map((s) => [s.id, { ...s }]));
  let minX = Infinity, minY = Infinity;
  for (const s of orig.values()) {
    const b = S.bbox(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  }
  for (const [x, y] of lifted) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  gesture = { kind: 'move', start: c, orig, lifted, under, minX, minY, dx: 0, dy: 0 };
}

function applyMove(g, dx, dy) {
  dx = Math.max(dx, -g.minX);
  dy = Math.max(dy, -g.minY);
  if (dx === g.dx && dy === g.dy) return;
  ensureCheckpoint(g);
  g.dx = dx;
  g.dy = dy;
  state.shapes = state.shapes.map((s) => (g.orig.has(s.id) ? { ...S.translate(g.orig.get(s.id), dx, dy), id: s.id } : s));
  if (g.lifted.length) {
    state.raw = g.under.clone();
    state.rawSel = new Set();
    for (const [x, y, ch] of g.lifted) {
      state.raw.set(x + dx, y + dy, ch);
      state.rawSel.add(Grid.key(x + dx, y + dy));
    }
  }
  changed();
}

function onPointerMove(e) {
  const c = cellAt(e);
  if (!state.hover || state.hover.x !== c.x || state.hover.y !== c.y) {
    state.hover = c;
    $('#coords').textContent = `${c.x}, ${c.y}`;
    if (!gesture) requestDraw();
  }
  if (!gesture) return;
  switch (gesture.kind) {
    case 'move':
      applyMove(gesture, c.x - gesture.start.x, c.y - gesture.start.y);
      break;
    case 'resize': {
      const s = gesture.shape;
      const before = JSON.stringify(s);
      const next = { ...s };
      S.resizeShape(next, gesture.orig, gesture.handle, c.x, c.y);
      if (JSON.stringify(next) === before) break;
      ensureCheckpoint(gesture);
      Object.assign(s, next);
      changed();
      break;
    }
    case 'marquee':
      gesture.cur = c;
      requestDraw();
      break;
    case 'create':
      if (c.x === gesture.cur.x && c.y === gesture.cur.y) break;
      gesture.cur = c;
      gesture.dragged = true;
      updateDraft();
      break;
    case 'erase':
      for (const p of cellsBetween(gesture.last, c)) eraseAt(p);
      gesture.last = c;
      break;
  }
}

function onPointerUp() {
  if (!gesture) return;
  const g = gesture;
  gesture = null;
  if (g.kind === 'marquee') finishMarquee(g);
  if (g.kind === 'create') finishCreate(g);
  changed();
}

function cancelGesture() {
  if (!gesture) return false;
  const g = gesture;
  gesture = null;
  state.draft = null;
  if (g.checkpointed) {
    load(JSON.parse(undoStack.pop()));
    if (g.orig) g.orig.forEach((_, id) => state.selected.add(id));
  }
  changed();
  return true;
}

function finishMarquee(g) {
  const r = rectOf(g.start, g.cur);
  const inside = (x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  for (const s of state.shapes) {
    const b = S.bbox(s);
    if (inside(b.x, b.y) && inside(b.x + b.w - 1, b.y + b.h - 1)) state.selected.add(s.id);
  }
  for (const [x, y, c] of state.raw) if (vis(c) && inside(x, y)) state.rawSel.add(Grid.key(x, y));
}

function updateDraft() {
  if (gesture?.kind !== 'create') return;
  state.draft = S.createShape(state.tool, gesture.start, gesture.cur, state.defaults, gesture.dragged);
  requestDraw();
}

function finishCreate(g) {
  const draft = state.draft;
  state.draft = null;
  if (!draft || (!g.dragged && state.tool !== 'circle')) return;
  checkpoint();
  const s = withId(draft);
  state.shapes.push(s);
  state.selected = new Set([s.id]);
  state.rawSel.clear();
}

function cellsBetween(a, b) {
  const out = [];
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
  for (let i = 1; i <= n; i++) {
    out.push({ x: Math.round(a.x + ((b.x - a.x) * i) / n), y: Math.round(a.y + ((b.y - a.y) * i) / n) });
  }
  return out;
}

function eraseAt({ x, y }) {
  if (gesture.alt) {
    if (!vis(overlayRaw(shapesGrid()).get(x, y))) return;
    ensureCheckpoint(gesture);
    state.raw.set(x, y, ' ');
    changed();
    return;
  }
  const hit = topShapeAt(x, y, true);
  const raw = state.raw.get(x, y);
  if (!hit && raw === undefined) return;
  ensureCheckpoint(gesture);
  if (raw !== undefined) state.raw.delete(x, y);
  else {
    state.shapes = state.shapes.filter((s) => s !== hit);
    state.selected.delete(hit.id);
  }
  changed();
}

function onDoubleClick(e) {
  if (state.tool !== 'select') return;
  const c = cellAt(e);
  const hit = topShapeAt(c.x, c.y);
  if (hit?.type === 'line') return;
  openEditor(hit ?? { type: 'text', x: c.x, y: c.y, text: '' }, !hit);
}


function layoutEditor() {
  const { shape } = edit;
  const lines = editor.value.split('\n');
  const longest = Math.max(1, ...lines.map((l) => Array.from(l).length));
  if (shape.type === 'text') {
    Object.assign(editor.style, {
      left: `${shape.x * cellW}px`, top: `${shape.y * cellH}px`,
      width: `${(longest + 2) * cellW}px`, height: `${lines.length * cellH}px`, textAlign: 'left',
    });
    return;
  }
  const b = S.bbox(shape);
  const inset = shape.type === 'rect' ? 1 : 0;
  const width = Math.max(b.w - inset * 2, longest + 2);
  const left = b.x + inset + Math.floor((b.w - inset * 2 - width) / 2);
  const top = b.y + Math.floor((b.h - lines.length) / 2);
  Object.assign(editor.style, {
    left: `${left * cellW}px`, top: `${Math.max(0, top) * cellH}px`,
    width: `${width * cellW}px`, height: `${lines.length * cellH}px`, textAlign: 'center',
  });
}

function openEditor(shape, isNew) {
  edit = { shape, isNew };
  state.editingId = isNew ? null : shape.id;
  editor.value = shape.text ?? '';
  editor.hidden = false;
  layoutEditor();
  editor.focus();
  editor.select();
  requestDraw();
}

function commitEditor() {
  if (!edit) return;
  const { shape, isNew } = edit;
  edit = null;
  state.editingId = null;
  editor.hidden = true;
  const value = editor.value.replace(/\s+$/, '');
  if (isNew) {
    if (value) {
      checkpoint();
      const s = withId({ ...shape, text: value });
      state.shapes.push(s);
      state.selected = new Set([s.id]);
      state.rawSel.clear();
    }
  } else if (value !== (shape.text ?? '')) {
    checkpoint();
    if (shape.type === 'text' && !value) {
      state.shapes = state.shapes.filter((s) => s !== shape);
      state.selected.delete(shape.id);
    } else {
      shape.text = value;
    }
  }
  changed();
}

editor.addEventListener('input', layoutEditor);
editor.addEventListener('blur', commitEditor);
editor.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    editor.blur();
  }
});


function deleteSelection() {
  if (!hasSelection()) return;
  checkpoint();
  state.shapes = state.shapes.filter((s) => !state.selected.has(s.id));
  for (const k of state.rawSel) state.raw.delete(...Grid.unkey(k));
  state.selected.clear();
  state.rawSel.clear();
  changed();
}

function selectionPayload() {
  return {
    shapes: selectedShapes().map(({ id, ...s }) => s),
    raw: [...state.rawSel].map((k) => [...Grid.unkey(k), state.raw.get(...Grid.unkey(k))]).filter(([, , c]) => c),
  };
}

function payloadText(p) {
  const g = S.renderShapes(p.shapes);
  for (const [x, y, c] of p.raw) c === ' ' ? g.delete(x, y) : g.set(x, y, c);
  const { minX, minY } = g.extent();
  const shifted = new Grid();
  for (const [x, y, c] of g) shifted.set(x - minX, y - minY, c);
  return shifted.toText();
}

function insertPayload(p, dx, dy) {
  checkpoint();
  state.selected.clear();
  state.rawSel.clear();
  for (const s of p.shapes) {
    const t = withId(S.translate(s, dx, dy));
    state.shapes.push(t);
    state.selected.add(t.id);
  }
  for (const [x, y, c] of p.raw) {
    if (x + dx < 0 || y + dy < 0) continue;
    state.raw.set(x + dx, y + dy, c);
    state.rawSel.add(Grid.key(x + dx, y + dy));
  }
  changed();
}

function duplicateSelection() {
  if (hasSelection()) insertPayload(selectionPayload(), 2, 1);
}

function reorder(toFront) {
  if (!state.selected.size) return;
  checkpoint();
  const picked = state.shapes.filter((s) => state.selected.has(s.id));
  const rest = state.shapes.filter((s) => !state.selected.has(s.id));
  state.shapes = toFront ? [...rest, ...picked] : [...picked, ...rest];
  changed();
}

function nudge(dx, dy) {
  if (!hasSelection()) return;
  startMove({ x: 0, y: 0 });
  const g = gesture;
  gesture = null;
  applyMove(g, dx, dy);
}

function selectAll() {
  state.selected = new Set(state.shapes.map((s) => s.id));
  state.rawSel = new Set([...state.raw].filter(([, , c]) => vis(c)).map(([x, y]) => Grid.key(x, y)));
  changed();
}

function flipRoute() {
  const flip = { hv: 'vh', vh: 'hv', straight: 'straight' };
  if (gesture?.kind === 'create' && state.tool === 'line') {
    setProp('route', flip[state.defaults.route] ?? 'hv');
    return;
  }
  const lines = selectedShapes().filter((s) => s.type === 'line' && s.route !== 'straight');
  if (!lines.length) return;
  checkpoint();
  for (const s of lines) s.route = flip[s.route];
  changed();
}


function setTool(tool) {
  if (edit) commitEditor();
  state.tool = tool;
  for (const b of $$('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  wrap.dataset.tool = tool;
  $('#hint').textContent = HINTS[tool];
  refreshProps();
  requestDraw();
}

function propTargets(prop) {
  return selectedShapes().filter((s) => S.PROP_TYPES[prop].includes(s.type));
}

function currentProp(prop) {
  if (state.tool === 'select') {
    const s = propTargets(prop)[0];
    if (s) return s[prop];
  }
  return state.defaults[prop];
}

function colourNote() {
  if (state.tool === 'rect' && state.defaults.stroke === 'dashed') return "svgbob can't colour dashed boxes.";
  if (state.tool !== 'select') return '';
  const targets = propTargets('fillColor');
  const blocked = targets.find((s) => !S.canColour(s));
  if (blocked?.type === 'rect') {
    return blocked.stroke === 'dashed' ? "svgbob can't colour dashed boxes." : 'Boxes must be at least 5×3 to take a colour.';
  }
  if (blocked) return 'Circles this small have no room for a colour tag.';
  if (targets.some((s) => S.hasColour(s) && !S.tagSpot(s, 3))) {
    return 'No room inside for the colour tag. Make the shape bigger or shorten its label.';
  }
  return '';
}

function refreshProps() {
  const types = state.tool === 'select' ? new Set(selectedShapes().map((s) => s.type)) : new Set([state.tool]);
  let any = false;
  for (const el of $$('.prop')) {
    const prop = el.dataset.prop;
    const show = S.PROP_TYPES[prop].some((t) => types.has(t));
    el.hidden = !show;
    if (!show) continue;
    any = true;
    const value = currentProp(prop);
    for (const b of el.querySelectorAll('button[data-value]')) b.setAttribute('aria-pressed', String(b.dataset.value === value));
    if (prop === 'size') {
      $('#circle-size').value = value;
      $('#circle-size-out').textContent = `r = ${circleRadius(value)}`;
    }
    const custom = el.querySelector('.swatch.custom');
    if (custom) {
      const inPalette = [...el.querySelectorAll('button[data-value]')].some((b) => b.dataset.value === value);
      custom.setAttribute('aria-pressed', String(!inPalette));
      if (/^#[0-9a-f]{6}$/i.test(value)) custom.querySelector('input').value = value;
    }
  }
  const note = $('#colour-note');
  note.textContent = colourNote();
  note.hidden = !note.textContent || $('.prop[data-prop=fillColor]').hidden;
  const empty = $('#props-empty');
  empty.hidden = any;
  empty.textContent = state.tool === 'select' && !state.selected.size
    ? 'Select a shape to change its style, or pick a drawing tool.'
    : 'No style options here. Double-click a shape to edit its label.';
}

function setProp(prop, value) {
  state.defaults[prop] = value;
  savePrefs();
  const targets = propTargets(prop).filter((s) => s[prop] !== value);
  if (targets.length) {
    const now = Date.now();
    if (lastPropChange.prop !== prop || now - lastPropChange.time > 1000) checkpoint();
    lastPropChange = { prop, time: now };
    for (const s of targets) {
      if (prop === 'size') {
        const [cx, cy] = S.circleCenter(s);
        s.size = value;
        S.centerCircle(s, cx, cy);
      } else {
        s[prop] = value;
      }
      if (s.type === 'line') S.fixLine(s);
    }
  }
  updateDraft();
  changed();
}

for (const b of $$('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
for (const el of $$('.prop')) {
  for (const b of el.querySelectorAll('button[data-value]')) {
    b.addEventListener('click', () => setProp(el.dataset.prop, b.dataset.value));
  }
}
$('#circle-size').max = MAX_CIRCLE;
$('#circle-size').addEventListener('input', (e) => setProp('size', Number(e.target.value)));
for (const input of $$('.swatch.custom input')) {
  input.addEventListener('input', (e) => setProp(e.target.closest('.prop').dataset.prop, e.target.value));
}


let textTimer = null;
asciiBox.addEventListener('input', () => {
  clearTimeout(textTimer);
  textTimer = setTimeout(applyTextarea, 150);
});

function survivesIn(textGrid, shape) {
  let kept = 0, total = 0;
  for (const [x, y, c] of S.cellsOf(shape)) {
    if (!vis(c)) continue;
    total++;
    if (textGrid.get(x, y) === c) kept++;
  }
  return kept * 2 > total;
}

function applyTextarea() {
  const now = Date.now();
  if (now - lastTextEdit > 1500) checkpoint();
  lastTextEdit = now;
  const { diagram, legend } = splitLegend(asciiBox.value);
  applyLegend(legend);
  const textGrid = Grid.fromText(diagram);
  state.shapes = state.shapes.filter((s) => survivesIn(textGrid, s));
  state.selected = new Set(state.shapes.filter((s) => state.selected.has(s.id)).map((s) => s.id));
  state.raw = diffRaw(textGrid, shapesGrid());
  state.rawSel.clear();
  changed({ fromTextarea: true });
}


let previewTimer = null;
let previewUrl = null;
const circleOrigins = new Map();

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 200);
}

function svgCircleCentres(svg) {
  return [...svg.replace(/<defs>[\s\S]*?<\/defs>/, '').matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
}

function circleOrigin(render, size) {
  if (!circleOrigins.has(size)) {
    const art = S.cellsOf({ type: 'circle', x: 0, y: 0, size, text: '' }).toText();
    circleOrigins.set(size, svgCircleCentres(render(art))[0] ?? [NaN, NaN]);
  }
  return circleOrigins.get(size);
}

function checkRender(render, svg) {
  const found = svgCircleCentres(svg);
  const circles = new Set();
  const colours = new Set();
  const tags = computeTags();
  const leftoverText = [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text')]
    .filter((t) => t.textContent.includes('{'))
    .map((t) => ({ text: t.textContent, col: Number(t.getAttribute('x')) / 8, row: Number(t.getAttribute('y')) / 16 }));
  const tagIgnored = (name, spot) => leftoverText.some((t) => t.text.includes(`{${name}}`)
    && spot.x >= t.col - 1 && spot.x <= t.col + t.text.length + 1 && Math.abs(t.row - spot.y - 0.5) <= 1);
  for (const s of state.shapes) {
    if (s.type === 'circle') {
      const [ox, oy] = circleOrigin(render, s.size);
      const cx = ox + s.x * 8, cy = oy + s.y * 16;
      if (!found.some(([x, y]) => Math.abs(x - cx) < 1 && Math.abs(y - cy) < 1)) circles.add(s.id);
    }
    const name = tags.byId.get(s.id);
    if (!name) continue;
    const spot = S.tagSpot(s, name.length + 2);
    if (!spot || tagIgnored(name, spot)) colours.add(s.id);
  }
  setIssues(circles, colours);
}

const plural = (n, one, many) => (n === 1 ? one : many.replace('#', n));

function setIssues(circles = new Set(), colours = new Set()) {
  const problems = [
    circles.size && plural(circles.size, "svgbob doesn't see the highlighted circle as a circle.",
      "svgbob doesn't see # highlighted circles as circles."),
    colours.size && plural(colours.size, "svgbob won't colour the highlighted shape.", "svgbob won't colour # highlighted shapes."),
  ].filter(Boolean);
  const text = problems.length
    ? `${problems.join(' ')} Leave a one-cell gap around the outline, and room inside for the label${colours.size ? ' and colour tag' : ''}.`
    : '';
  const ids = new Set([...circles, ...colours]);
  const warn = $('#warn');
  const same = text === warn.textContent && ids.size === state.unrecognized.size && [...ids].every((id) => state.unrecognized.has(id));
  if (same) return;
  state.unrecognized = ids;
  warn.textContent = text;
  warn.hidden = !text;
  requestDraw();
}

async function renderSvg(text) {
  const render = await loadSvgbob();
  return render(text);
}

async function renderPreview() {
  const status = $('#preview-status');
  const img = $('#preview-img');
  const text = documentText();
  if (!text.trim()) {
    img.hidden = true;
    status.textContent = 'Nothing to preview yet.';
    status.hidden = false;
    setIssues();
    return;
  }
  try {
    const render = await loadSvgbob();
    const svg = render(text);
    checkRender(render, svg);
    if (!state.preview) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.src = previewUrl;
    img.hidden = false;
    status.hidden = true;
  } catch (err) {
    img.hidden = true;
    status.hidden = false;
    status.textContent = `Couldn't load the svgbob renderer (${err.message}). The text output still works.`;
    setIssues();
  }
}

function setPreview(on) {
  state.preview = on;
  $('#preview-toggle').checked = on;
  $('#preview-body').hidden = !on;
  savePrefs();
  if (on) schedulePreview();
}

$('#preview-toggle').addEventListener('change', (e) => setPreview(e.target.checked));


function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Clipboard is blocked here. Select the text and copy it by hand.');
  }
}

const TAG = /\{[A-Za-z_][\w-]*\}/g;

function comparableText(text) {
  return splitLegend(text).diagram
    .replace(TAG, (m) => ' '.repeat(m.length))
    .split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n+$/, '');
}

function legendRules() {
  const rules = new Map();
  for (const line of state.customLegend) {
    const name = legendName(line);
    if (!name || !/^[^{]*\{.*\}\s*$/.test(line)) continue;
    rules.set(name, { fill: styleValue(line, 'fill') ?? '', stroke: styleValue(line, 'stroke') ?? '' });
  }
  return rules;
}

function describeCounts(shapes) {
  const names = { rect: ['box', 'boxes'], circle: ['circle', 'circles'], diamond: ['diamond', 'diamonds'], line: ['line', 'lines'], text: ['text', 'texts'] };
  const counts = new Map();
  for (const s of shapes) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  return [...counts].map(([type, n]) => `${n} ${names[type][n === 1 ? 0 : 1]}`).join(', ');
}

function convertToShapes() {
  if (edit) commitEditor();
  clearTimeout(textTimer);
  if (asciiBox.value !== documentText()) applyTextarea();
  const before = documentText();
  const { shapes, tagCells, usedTags } = recognise(state.raw, shapesGrid(), legendRules());
  if (!shapes.length) {
    toast('No shapes found among the loose characters.');
    return;
  }
  const snapshot = JSON.stringify(serialize());
  checkpoint();
  const added = shapes.map(withId);
  state.shapes.push(...added);
  for (const [x, y] of tagCells) state.raw.delete(x, y);
  const drawn = shapesGrid();
  for (const [x, y, c] of [...state.raw]) if (c !== ' ' && drawn.get(x, y) === c) state.raw.delete(x, y);
  const looseText = new Grid();
  for (const [x, y, c] of state.raw) if (vis(c)) looseText.set(x, y, c);
  const stillTagged = looseText.toText();
  state.customLegend = state.customLegend.filter((line) => {
    const name = legendName(line);
    return !name || !usedTags.has(name) || stillTagged.includes(`{${name}}`);
  });
  if (comparableText(documentText()) !== comparableText(before)) {
    undoStack.pop();
    load(JSON.parse(snapshot));
    changed();
    toast("Converting would have changed the drawing, so nothing was converted.");
    return;
  }
  state.selected = new Set(added.map((s) => s.id));
  state.rawSel.clear();
  setTool('select');
  changed();
  const loose = looseText.size;
  toast(`Converted ${describeCounts(added)}.${loose ? ` ${loose} character${loose === 1 ? '' : 's'} left loose.` : ''}`);
}

function importText(text) {
  try {
    const doc = JSON.parse(text);
    if (doc && Array.isArray(doc.shapes)) {
      checkpoint();
      load(doc);
      changed();
      toast('Project opened');
      return;
    }
  } catch {}
  checkpoint();
  const { diagram, legend } = splitLegend(text);
  state.shapes = [];
  state.selected.clear();
  state.rawSel.clear();
  state.customLegend = (legend ?? []).filter((l) => l.trim());
  state.raw = Grid.fromText(diagram);
  changed();
  toast('Text imported. Drag-select regions to move them.');
}

const actions = {
  undo,
  redo,
  delete: deleteSelection,
  duplicate: duplicateSelection,
  front: () => reorder(true),
  back: () => reorder(false),
  'zoom-in': () => zoom(1),
  'zoom-out': () => zoom(-1),
  clear: () => {
    if (!state.shapes.length && !state.raw.size) return;
    if (!confirm('Clear the whole drawing? You can undo this.')) return;
    checkpoint();
    state.shapes = [];
    state.raw = new Grid();
    state.customLegend = [];
    state.selected.clear();
    state.rawSel.clear();
    changed();
  },
  open: () => $('#file-input').click(),
  'copy-text': () => copyText(documentText(), 'Copied ASCII'),
  convert: convertToShapes,
  'copy-md': () => copyText('```bob\n' + documentText() + '\n```', 'Copied as a Markdown code block'),
  'download-txt': () => download('diagram.bob', documentText() + '\n', 'text/plain'),
  'download-svg': async () => {
    try {
      download('diagram.svg', await renderSvg(documentText()), 'image/svg+xml');
    } catch (err) {
      toast(`SVG export failed: ${err.message}`);
    }
  },
  'download-json': () => download('diagram.svgbob.json', JSON.stringify(serialize(), null, 1), 'application/json'),
  share: async () => {
    const url = `${location.origin}${location.pathname}#d=${await encodeDoc(serialize())}`;
    copyText(url, 'Share link copied');
  },
  help: () => $('#help').showModal(),
};

for (const b of $$('[data-action]')) {
  b.addEventListener('click', () => {
    b.closest('details')?.removeAttribute('open');
    actions[b.dataset.action]();
  });
}

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importText(await file.text());
});

document.addEventListener('click', (e) => {
  for (const d of $$('details.menu[open]')) if (!d.contains(e.target)) d.removeAttribute('open');
});

function zoom(dir) {
  const next = Math.min(28, Math.max(9, state.fontSize + dir * 2));
  if (next === state.fontSize) return;
  state.fontSize = next;
  savePrefs();
  measure();
  cols = rows = 0;
  if (edit) layoutEditor();
  requestDraw();
}


const isTyping = (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);

document.addEventListener('keydown', (e) => {
  if (isTyping(e.target) || $('#help').open) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod) {
    if (key === 'z') e.shiftKey ? redo() : undo();
    else if (key === 'y') redo();
    else if (key === 'd') duplicateSelection();
    else if (key === 'a') selectAll();
    else if (key === '=' || key === '+') zoom(1);
    else if (key === '-') zoom(-1);
    else return;
    e.preventDefault();
    return;
  }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[key]) {
    const [dx, dy] = arrows[key];
    const step = e.shiftKey ? 5 : 1;
    nudge(dx * step, dy * step);
  } else if (key === 'delete' || key === 'backspace') {
    deleteSelection();
  } else if (key === 'escape') {
    if (cancelGesture()) return;
    if (state.tool !== 'select') setTool('select');
    else {
      state.selected.clear();
      state.rawSel.clear();
      changed();
    }
  } else if (key === 'enter') {
    const sel = selectedShapes();
    if (sel.length === 1 && sel[0].type !== 'line') openEditor(sel[0], false);
    else return;
  } else if (key === 'f') {
    flipRoute();
  } else if (key === '?') {
    $('#help').showModal();
  } else if (TOOL_KEYS[key] && !e.altKey) {
    setTool(TOOL_KEYS[key]);
  } else {
    return;
  }
  e.preventDefault();
});

function onCopy(e, cut) {
  if (isTyping(document.activeElement) || !hasSelection()) return;
  const payload = selectionPayload();
  const text = payloadText(payload);
  clip = { payload, text };
  pasteCount = 0;
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
  if (cut) deleteSelection();
}

document.addEventListener('copy', (e) => onCopy(e, false));
document.addEventListener('cut', (e) => onCopy(e, true));
document.addEventListener('paste', (e) => {
  if (isTyping(document.activeElement)) return;
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  if (clip && clip.text === text) {
    pasteCount++;
    insertPayload(clip.payload, pasteCount * 2, pasteCount);
    return;
  }
  const at = state.hover ?? { x: 1, y: 1 };
  insertPayload({ shapes: [], raw: [...Grid.fromText(text)] }, at.x, at.y);
  setTool('select');
});


function setSideWidth(px) {
  state.sideWidth = px;
  if (px) document.documentElement.style.setProperty('--side-width', `${px}px`);
}

$('#splitter').addEventListener('pointerdown', (e) => {
  const splitter = e.currentTarget;
  splitter.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const width = document.body.clientWidth - ev.clientX;
    setSideWidth(Math.round(Math.min(document.body.clientWidth * 0.7, Math.max(260, width))));
    requestDraw();
  };
  const up = () => {
    splitter.removeEventListener('pointermove', move);
    splitter.removeEventListener('pointerup', up);
    savePrefs();
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up);
});

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('dblclick', onDoubleClick);
canvas.addEventListener('pointerleave', () => {
  state.hover = null;
  $('#coords').textContent = '';
  requestDraw();
});
wrap.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

new ResizeObserver(requestDraw).observe(wrap);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', requestDraw);


const SAMPLE = {
  shapes: [
    { type: 'rect', x: 2, y: 1, w: 18, h: 3, corner: 'rounded', stroke: 'solid', text: 'svgbob drawer' },
    { type: 'line', x1: 20, y1: 2, x2: 30, y2: 2, route: 'hv', corner: 'sharp', stroke: 'solid', startCap: 'none', endCap: 'arrow' },
    { type: 'circle', x: 32, y: 1, size: 3, text: '' },
    { type: 'line', x1: 10, y1: 4, x2: 24, y2: 8, route: 'vh', corner: 'rounded', stroke: 'dashed', startCap: 'dot', endCap: 'arrow' },
    { type: 'diamond', x: 25, y: 6, w: 12, h: 4, text: 'ok?' },
    { type: 'text', x: 2, y: 11, text: 'Draw on the canvas; the text on the right updates as you go.' },
  ],
  raw: [],
};

async function start() {
  const prefs = restoreStored(PREFS_KEY);
  if (prefs) {
    Object.assign(state.defaults, prefs.defaults);
    state.fontSize = Number(prefs.fontSize) || state.fontSize;
    state.preview = prefs.preview !== false;
    setSideWidth(Number(prefs.sideWidth) || null);
  }
  let doc = null;
  const hash = location.hash.match(/^#d=([\w-]+)/);
  if (hash) {
    try {
      doc = await decodeDoc(hash[1]);
      history.replaceState(null, '', location.pathname + location.search);
      toast('Loaded diagram from link');
    } catch {
      toast("That share link couldn't be read.");
    }
  }
  load(doc ?? restoreStored(STORAGE_KEY) ?? SAMPLE);
  measure();
  setTool('select');
  setPreview(state.preview);
  changed();
}

start();
