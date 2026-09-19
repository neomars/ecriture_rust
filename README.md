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
4. **llama.cpp build toolchain:** the local AI engine (`llama-cpp-2`) compiles llama.cpp from source at build time via `cmake` + `bindgen`, which needs a C/C++ compiler and `clang` (for `libclang`, used to generate FFI bindings):
   - Debian/Ubuntu: `sudo apt install build-essential cmake clang libclang-dev`
   - Fedora: `sudo dnf install gcc gcc-c++ cmake clang clang-devel`
   - Arch: `sudo pacman -S base-devel cmake clang`
   - macOS: `xcode-select --install` (gives you clang + cmake via Homebrew: `brew install cmake`)

   If the build fails with `fatal error: 'stdbool.h' file not found` (or a similar missing standard-header error) even after installing `clang`, `bindgen`'s `libclang` isn't finding that clang installation's own bundled headers. Point it there explicitly:
   ```bash
   export BINDGEN_EXTRA_CLANG_ARGS="-I$(clang -print-resource-dir)/include"
   npm run tauri dev
   ```
   (add that `export` line to your shell profile so it's set for future runs too).

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

### Local AI (Gemma)

Contextual AI tools (describe/rewrite/expand/POV/relecture/chat/character
extraction) run on a real local model via
[`llama-cpp-2`](https://crates.io/crates/llama-cpp-2) (Rust bindings to
llama.cpp — the same engine the Python app drives through
`llama-cpp-python`), with the same GGUF checkpoint the Python app used:
`bartowski/gemma-2-2b-it-GGUF` (`gemma-2-2b-it-Q8_0.gguf`, ~2.7 GB).

- **Download destination** (`ecriture_core::ai::model_store::model_cache_dir`,
  first writable candidate wins): `$ECRITURE_RUST_MODEL_DIR` →
  `$XDG_CACHE_HOME/ecriture-rust` → `~/.cache/ecriture-rust` →
  `<cwd>/ecriture-rust_models` → the OS temp dir. This is a **separate**
  directory from the original Python app's `~/.cache/ecriture` (that
  directory belongs to `github.com/neomars/ecriture` and is used for more
  than just the model) — the two apps do not share a model file, so
  expect a fresh ~2.7 GB download the first time you run this build even
  if you already have the Python app's model installed.
- The app downloads it automatically the first time no model is found
  (mirrors the "Gemma missing" install flow), streaming to a `.part` file
  and renaming it into place only once complete.
- Prompting uses the chat template embedded in the GGUF file itself
  (Gemma's own `<start_of_turn>`/`<end_of_turn>` format via
  `LlamaModel::apply_chat_template`) rather than a hand-rolled template.
- If the model isn't installed yet, or a generation fails for any reason,
  every AI command falls back to the same offline "simulated" response
  text the Python app shows when its model isn't installed — never an
  error dialog.

#### GPU acceleration

The engine always *asks* to offload every layer to a GPU
(`n_gpu_layers` is set to a large value unconditionally); whether that
actually happens depends on which GPU backend was compiled in. **By
default, none is** — `cargo build`/`npm run tauri dev` produce a
CPU-only build, deliberately, because each backend needs its vendor's
SDK installed at *build* time, and assuming one is present would risk
breaking the build the same way the undocumented clang/bindgen
requirement did (see above). Enabling the wrong one, or one whose SDK
isn't installed, fails the build; check `npm run tauri dev`'s terminal
output for `[ai] ggml backend devices` after your first AI request (it
lists every device llama.cpp can see, GPU or not) to confirm it's
actually being used.

Pick the feature matching your GPU and pass it through when building:

| Vendor | Feature | Needs installed first |
|---|---|---|
| NVIDIA | `gpu-cuda` | [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) |
| AMD | `gpu-rocm` | [ROCm](https://rocm.docs.amd.com/) |
| Apple Silicon / Intel Mac | `gpu-metal` | Xcode Command Line Tools (`xcode-select --install`) |

```bash
# from ecriture-rust/src-tauri
cargo build --features gpu-cuda      # or gpu-rocm / gpu-metal
# or, to also run the desktop app with it:
cargo tauri dev --features gpu-cuda
```

There's no Vulkan option: this version of the `llama-cpp-2` bindings
doesn't expose one, even though llama.cpp itself has a Vulkan backend -
CUDA/ROCm/Metal are the only vendor backends currently wired through.
Intel GPUs aren't covered either (llama.cpp's SYCL backend isn't among
the bindings' feature flags).

**Not verified end-to-end in the environment this was built in**: that
sandbox's network policy blocks `huggingface.co`, so the actual multi-GB
download and a real generation could not be run there. The download
logic itself is unit-tested against a local HTTP server (success, HTTP
error, and connection-refused cases), and the low-level llama.cpp call
sequence was written against `llama-cpp-2`'s own official
`examples/simple`. Please verify the first real download + a few AI
requests on your machine and report anything unexpected.

**Other known gaps vs. the original Python app** (tracked as future work,
not silently faked):
- Synonym lookup only has real data for French. The Python app additionally
  used NLTK WordNet + spaCy for English/Spanish/Russian; there is no
  equivalent pure-Rust crate, so those languages currently return an empty
  list rather than pretending to work.
- Native OS integrations that need extra Tauri plugins (folder picker for
  backups, document import from `.docx`/`.odt`/`.epub`, live auto-update
  download) are not wired up yet.

> *Note: For the French version of this README, please see [README-fr.md](README-fr.md).*
