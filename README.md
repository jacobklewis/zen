# Zen

A beautified WYSIWYG markdown viewer and editor for macOS. Built with
[Tauri](https://tauri.app/) v2, React 19, and
[Milkdown Crepe](https://milkdown.dev/docs/guide/using-crepe).

- Native `.app` bundle (~10 MB) using system WebKit
- Notion-style WYSIWYG editing with code blocks, tables, LaTeX, and a slash menu
- Full native macOS menu bar with `Cmd+N` / `Cmd+O` / `Cmd+S` / `Cmd+Shift+S` / `Cmd+W`
- `.md`, `.markdown`, and `.mdx` file association &mdash; right-click a file and
  pick "Open With" once installed
- Automatic light/dark theme based on system appearance
- Remembers window size and position between launches
- Unsaved-changes prompt when closing or switching documents

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
