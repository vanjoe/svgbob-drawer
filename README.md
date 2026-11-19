# svgbob drawer

A browser tool for drawing [svgbob](https://github.com/ivanceras/svgbob) diagrams. You draw shapes on a
character-grid canvas, and the ASCII source updates live in a text box beside it. You can also edit the text
directly, and those changes show up on the canvas. A live svgbob SVG preview sits below the text.

It is a static site with no build step, written as plain scripts rather than ES modules so it also runs when
you open `index.html` straight from disk. The svgbob renderer used for the preview and for SVG export is
[`svgbob-wasm`](https://github.com/agoose77/svgbob-wasm) 1.0.0 under its MIT/Apache-2.0 licences. Its
`svgbob_wasm_bg.wasm` (SHA-256 `fbb0789a16f281141baac34cae11564f8b993812e2ef38bef477ee190e8d576c`) is embedded as
base64 in `vendor/svgbob-wasm/svgbob_wasm.js`, because browsers won't `fetch()` local files. If that script
can't be loaded, the app falls back to the same package on jsDelivr, then unpkg.

## Features

- **Rectangles** with sharp (`+`) or rounded (`.` `'`) corners, solid or dashed (`- -`, `:`) strokes, and a
  centred label.
- **Circles** in the 22 exact sizes svgbob recognises (radius 0.5 to 11). Drag to size one, or use the slider.
  svgbob ignores a circle when something touches its outline, so the app highlights any circle the renderer
  didn't recognise in red.
- **Diamonds**. Drawing one wider than it is tall gives a flat-topped hexagon.
- **Lines and arrows**: across-then-down or down-then-across elbows (press `F` to flip), or straight lines that
  snap to horizontal, vertical or diagonal. Each end can be plain, an arrow, `o`, `O` or `*`. Corners can be
  sharp or rounded, and strokes solid or dashed. Crossings and junctions merge into `+`.
- **Colours**: fill and outline colours for solid boxes and circles, from swatches or a custom picker. The app
  writes svgbob's `{tag}` inside the shape and its CSS as a `# Legend:` block under the ASCII, after a blank
  line. You can edit that block in the text box or in the Legend section under the canvas. A coloured
  shape that svgbob would ignore (a line joining its edge, or no room for the tag) is highlighted in red.
- **Text** anywhere on the canvas.
- **Loose characters**: anything typed, pasted or imported into the text box. You can box-select and move it,
  erase it, or punch out single characters with `Alt` + eraser.
- **Recognize shapes**: converts loose characters into editable boxes, circles, diamonds, lines and text, including
  labels, arrowheads, dashed strokes and `{tag}` colours. A shape is only accepted if redrawing it reproduces its
  exact characters, so the drawing never changes. Anything not recognised stays as loose characters.
- Select, move, resize with handles, duplicate, z-order, undo/redo, copy/cut/paste, and keyboard shortcuts
  (press `?` in the app).
- Export to clipboard (plain or as a Markdown ` ```bob ` block), `.bob` text, `.svg`, or a `.json` project
  that keeps shapes editable. Share links put the whole drawing in the URL.
- Autosaves to the browser's local storage. Light and dark themes.

## Run locally

Open `index.html` in any modern browser; it works from `file://` in Firefox and Chrome. Serving the folder works
too:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick your branch and the `/ (root)`
   folder, then save.
3. The site will be live at `https://<user>.github.io/<repo>/` within a minute or two.

## Layout

| Path            | Purpose                                                             |
| --------------- | ------------------------------------------------------------------- |
| `index.html`    | Page markup: toolbar, property bar, canvas, text and preview panes  |
| `css/style.css` | Styles and light/dark theme tokens                                  |
| `js/app.js`     | Editor state, canvas rendering, tools, history, import/export       |
| `js/shapes.js`  | Shape models and how each is drawn into the character grid          |
| `js/grid.js`    | Sparse character grid, junction merging, text conversion            |
| `js/circles.js` | svgbob's circle art, copied verbatim from its source                |
| `js/convert.js` | Recognises shapes in loose ASCII for the Recognize shapes button    |
| `js/svgbob.js`  | Loads the svgbob WASM renderer                                      |
| `vendor/`       | The vendored `svgbob-wasm` renderer (as base64 JS) and its licences |
| `js/share.js`   | Compresses and decompresses drawings for share links                |
