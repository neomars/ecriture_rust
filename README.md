# Écriture

Écriture is a word processing application designed specifically for authors and writers. It integrates Artificial Intelligence assistance, literary project management features, and linguistic tools to help you write your next novel.

This project is a Rust port (using Tauri for the frontend) of the original application written in Python, offering better performance and a smaller memory footprint.

## Main Features

- **Literary Project Management:** Create, load, and save your novel projects. Manage the structure of your manuscript (chapters and scenes), your characters, the plot, and your notes.
- **Advanced Text Editor:** Continuous scroll editor, rich text formatting (Bold, Italic, Small Caps), visual page breaks, and real-time word counting.
- **Integrated AI Assistant:** Help with rewriting, text expansion, POV shifts, and description generation via a local AI (supporting Hugging Face/Transformers models).
- **Goal Tracking:** Set and track your daily and overall writing goals.
- **Plot Grid:** Visualize your story as a timeline or a grid with plot cards.
- **Linguistic Tools:** Integrated synonym search (for French and English) and support for NLP (Natural Language Processing) tools.
- **Export & Backup:** Export your document to multiple formats (DOCX, PDF, EPUB, MOBI, ODT, TXT) and manage local (ZIP) backups.

## Screenshots

### Main Interface (English)
![Main Interface (EN)](ecriture-rust/images/screenshot_main_en.png)

### Locked / Focus Mode
![Focus Mode](ecriture-rust/images/screenshot_locked.png)

### Plot Grid
![Plot Grid](ecriture-rust/images/screenshot_plot_grid.png)

### Timeline
![Timeline](ecriture-rust/images/screenshot_timeline.png)

## Installation

### Prerequisites

1. **Rust & Cargo:** You must have Rust installed on your system. You can install it via [rustup](https://rustup.rs/).
2. **Node.js & npm:** Make sure you have Node.js installed. You can download it from [nodejs.org](https://nodejs.org/).
3. **Tauri Prerequisites:** Follow the official Tauri guide to install the system dependencies required for compilation (specific to Windows, macOS, or Linux): [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites).

### Installation Steps

1. **Clone the repository:**
   ```bash
   git clone <your-repository-url>
   cd ecriture
   ```

2. **Navigate to the Rust/Tauri project folder:**
   ```bash
   cd ecriture-rust
   ```

3. **Install Frontend Dependencies:**
   ```bash
   npm install
   ```

4. **Run the application in Development Mode:**
   This command will start the Vite development server (frontend) and compile/run the Tauri application (Rust backend).
   ```bash
   npm run tauri dev
   ```

5. **Build the application for Production:**
   When you want to create a standalone executable, use the following command:
   ```bash
   npm run tauri build
   ```
   The generated executable will be located in `ecriture-rust/src-tauri/target/release/`.

## Project Architecture

The `ecriture-rust` project is built with:
- **Frontend:** HTML5, Tailwind CSS, Vanilla TypeScript, bundled with Vite.
- **Backend:** Rust with the Tauri framework, providing communication (IPC) with the frontend.

The data model uses a JSON file format to store the entire novel (settings, manuscript, plot, characters, notes).

## Backend Migration Status

The Rust backend lives in two crates under `ecriture-rust/`:

- **`ecriture-core`** — framework-agnostic business logic (no Tauri
  dependency), fully covered by unit and integration tests:
  project persistence and manuscript tree editing, export to
  txt/docx/pdf/odt/epub/mobi, French synonym lookup (bundled `lexique.db`),
  local JSON backups, locale strings, AI prompt templates + offline
  fallback responses, and update-check version comparison.
- **`src-tauri`** — thin `#[tauri::command]` adapters over `ecriture-core`,
  exposed to the frontend via `window.__TAURI__`.

Run `cargo test` inside `ecriture-rust/ecriture-core` to run the full
regression/quality/feature-verification suite (60+ tests, including a
non-regression test against the real `lexique.db`). Run `cargo clippy` in
either crate for lint/quality checks.

**Known gaps vs. the original Python app** (tracked as future work, not
silently faked):
- No local LLM inference is bundled. Contextual AI tools (describe,
  rewrite, expand, relecture, chat) return the same offline "simulated"
  fallback text the Python app shows when its local model isn't installed.
  A real backend can be plugged in behind `ecriture_core::ai::AiBackend`.
- Synonym lookup only has real data for French. The Python app additionally
  used NLTK WordNet + spaCy for English/Spanish/Russian; there is no
  equivalent pure-Rust crate, so those languages currently return an empty
  list rather than pretending to work.
- Native OS integrations that need extra Tauri plugins (folder picker for
  backups, document import from `.docx`/`.odt`/`.epub`, streaming AI chat,
  live auto-update download) are not wired up yet.

> *Note: For the French version of this README, please see [README-fr.md](README-fr.md).*
