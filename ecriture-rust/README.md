# Écriture (Tauri app)

This directory holds the Tauri desktop app: the Vite/TypeScript frontend
(`src/`, `static/js/`, `index.html`) and the two Rust crates that make up
the backend:

- [`ecriture-core/`](ecriture-core) — framework-agnostic business logic
  (project persistence, export, synonyms, backups, AI prompts/fallback,
  update checks), unit- and integration-tested with plain `cargo test`.
- [`src-tauri/`](src-tauri) — the Tauri command layer that exposes
  `ecriture-core` to the frontend, plus the desktop shell configuration.

See the [project root README](../README.md) (or [README-fr.md](../README-fr.md))
for the full feature list, installation steps, and current migration status.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
