# Zen

A beautified WYSIWYG markdown viewer and editor for macOS. Built with
[Tauri](https://tauri.app/) v2, React 19, and
[Milkdown Crepe](https://milkdown.dev/docs/guide/using-crepe).

- Native `.app` bundle (~10 MB) using system WebKit
- Notion-style WYSIWYG editing with code blocks, tables, LaTeX, and a slash menu
- Full native macOS menu bar with `Cmd+N` / `Cmd+O` / `Cmd+S` / `Cmd+Shift+S` / `Cmd+W`
- `.md`, `.markdown`, and `.mdx` file association &mdash; right-click a file and
  pick "Open With" once installed
- PDF export with a clean document style or matching viewer appearance
- Portable interactive HTML export with section navigation, search, and offline assets
- Automatic light/dark theme based on system appearance
- Drag either editor edge to resize its width in real time; the chosen width is remembered.
  Double-click an edge to reset, or focus it and use the arrow keys to adjust.
- Remembers window size and position between launches
- Unsaved-changes prompt when closing or switching documents

## Export as PDF

Open a document and choose **File → Export as PDF…** (`Cmd+Shift+E`).
The default export uses white pages, 11 pt text, 1.5 line spacing, 21 mm margins,
clear heading sizes, subtle code blocks, and lightly shaded table headers.
To retain the viewer’s current light/dark theme and typography, choose
**File → Export PDF (Match Viewer Appearance)…** instead.

In the native macOS print dialog, choose **PDF → Save as PDF** and select a
filename and location. Both styles include unsaved edits and the full document,
without the sidebar or editing controls. Paper size and orientation can be
adjusted in the print dialog. Page-number footers are not currently added by
the native export.

## Export as Interactive HTML

Choose **File → Export as Interactive HTML…** (`Cmd+Option+E` on macOS) and
save the `.html` file. Send that one file to a recipient, who can open it directly
in a browser without installing Zen or running a server.

The reader includes a nested table of contents with active-section highlighting,
search with next/previous matches, collapsible sections, expand/collapse-all controls,
light/dark themes, code highlighting and copy buttons, tables, task lists, and equations.
The layout adapts to phones, and printing expands collapsed sections automatically.
Basic reading, section links, and collapsible sections also work without JavaScript.

Exports include unsaved edits. Images, equation fonts, styles, and reader scripts
are embedded in the HTML, with no CDN or app dependencies. Local images must be
inside the saved Markdown document's folder or its subfolders; paths escaping that
folder, including symlinks, are rejected. Remote images must permit browser downloads
without authentication. If an image cannot be embedded, export reports the problem
and leaves the destination untouched; save the image in the document folder and
update its Markdown reference before trying again. Images are limited to 32 MB each.
Links to other documents or websites remain links; those destinations are not bundled.

## Browser tests

```bash
pnpm test
```

Tests use Google Chrome when installed in its standard macOS location. Otherwise,
install Playwright Chromium with `pnpm exec playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a Chromium executable. Tests open exported
HTML through `file://` with networking disabled and cover navigation, search,
math/fonts/images, mobile layout, themes, code copying, and markup escaping.
Native image-folder checks can be run with
`cargo test --offline --manifest-path src-tauri/Cargo.toml html_export --lib`.

## Prerequisites

- macOS with Xcode Command Line Tools (`xcode-select --install`)
- Rust toolchain (`brew install rust` or `rustup`)
- Node 20+ and pnpm (`brew install node && corepack enable pnpm`)

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Build a release `.app` and `.dmg`

```bash
pnpm tauri build
```

Output is written to `src-tauri/target/release/bundle/macos/Zen.app` and
`src-tauri/target/release/bundle/dmg/`. Drag the `.app` into `/Applications` to
register the file association &mdash; from then on, `.md` files will offer this
app in Finder's "Open With" menu.

## Custom icon

Drop a 1024&times;1024 PNG somewhere and run:

```bash
pnpm tauri icon path/to/icon.png
```

This regenerates the full iconset under `src-tauri/icons/`.

## Project layout

```
src/                     React + Vite frontend
  components/            Editor and empty-state UI
  lib/                   File ops, theme, menu event bridge
src-tauri/               Rust core
  src/lib.rs             Native menu, RunEvent::Opened, take_pending_files cmd
  tauri.conf.json        Window chrome, file associations, bundle config
  capabilities/          Permission scopes for fs/dialog/window
```
