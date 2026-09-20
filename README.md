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
   ```bash
   npm run start
   ```
   This detects your GPU (if any) the same way `scripts/detect-gpu.sh`
   does and launches with the matching `--features gpu-*` flag
   automatically - no flag to remember, and it correctly stays CPU-only
   on a machine without a usable GPU. It then starts the Vite
   development server (frontend) and compiles/runs the Tauri application
   (Rust backend), same as `npm run tauri dev` (still available if you
   want to force a specific backend by hand - see "GPU acceleration"
   below - or force CPU-only regardless of what's detected).

5. **Build the application for Production:**
   See "Building the distributable app" under "GPU acceleration" below
   for `npm run package:linux` / `npm run package:windows` - these
   produce the actual installable app, with the same GPU auto-detection
   but decided at *runtime* (by whoever ends up running it) rather than
   on your machine at build time. The generated executable will be
   located in `ecriture-rust/src-tauri/target/release/`.

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

The engine always *asks* to offload every layer to a GPU (`n_gpu_layers`
is set to a large value unconditionally) - but only on a GPU device
reporting at least 3 GiB of total memory. The bundled Gemma-2-2b
checkpoint is ~2.7 GB on disk, and its KV cache + compute buffers add
real overhead on top at runtime, so a smaller GPU is more likely to fail
to allocate (or barely help, offloading only a handful of layers) than
to give the speedup GPU offload is for - below that threshold, that
device is skipped and every layer stays on CPU instead. Whether any of
this actually happens at all further depends on which GPU backend was
compiled in.

**`npm run start` detects this automatically** - it's a small wrapper
(`scripts/dev-with-gpu.sh`) that runs the same hardware detection as
`scripts/detect-gpu.sh` before launching `tauri dev`, and passes the
matching `--features gpu-*` flag through for you. This is the
recommended way to run the app day-to-day: no flag to remember, and it
correctly stays CPU-only when nothing GPU-specific is detected. Plain
`cargo build`/`npm run tauri dev` (no wrapper) still produce a CPU-only
build, unaffected - useful if you want to force CPU-only regardless of
what's installed, or if `bash` isn't available (the wrapper needs it;
Windows users without Git Bash/WSL should pick a feature from the table
below by hand instead). Enabling the wrong feature, or one whose SDK
isn't installed, fails the build; check the terminal output for
`[ai] ggml backend devices` after your first AI request (it lists every
device llama.cpp can see, GPU or not) to confirm the right one is
actually being used.

Want the human-readable report instead of just launching? Run
`ecriture-rust/scripts/detect-gpu.sh` directly - it inspects the actual
hardware and installed SDKs on the machine it runs on (GPU vendor via
`lspci`/`nvidia-smi`, CUDA/ROCm install, a working Vulkan driver, or no
GPU at all) and explains which `--features gpu-*` flag it would use, if
any (`./detect-gpu.sh --feature` prints just the flag name, which is
what `npm run start` captures).

Or pick the feature matching your GPU by hand and pass it through when building:

| Vendor | Feature | Needs installed first |
|---|---|---|
| NVIDIA | `gpu-cuda` | [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) |
| AMD | `gpu-rocm` | [ROCm](https://rocm.docs.amd.com/) |
| Apple Silicon / Intel Mac | `gpu-metal` | Xcode Command Line Tools (`xcode-select --install`) |
| Any vendor (NVIDIA/AMD/Intel) via Vulkan | `gpu-vulkan` | Vulkan loader + a GLSL-to-SPIR-V compiler - see below |

```bash
# from ecriture-rust/src-tauri
cargo build --features gpu-cuda      # or gpu-rocm / gpu-metal / gpu-vulkan
# or, to also run the desktop app with it:
cargo tauri dev --features gpu-cuda
```

`gpu-vulkan` is the closest thing to a universal option: on a machine
whose vendor doesn't have a `gpu-*` feature of its own above (or where
you don't know which vendor's GPU is installed), it's the one to try
first, since it drives the GPU through its own driver's Vulkan
implementation rather than a vendor-specific toolkit. It isn't exposed by
`llama-cpp-2` itself (only `llama-cpp-sys-2`, one layer below, has it),
so `ecriture-core/Cargo.toml` depends on `llama-cpp-sys-2` directly just
to reach that flag - Cargo's feature unification means it's still the
exact same underlying crate `llama-cpp-2` already uses, not a second copy.
It needs, at build time only:
- Debian/Ubuntu: `sudo apt install libvulkan-dev glslc` (or
  `libshaderc-dev`, which provides the same `glslc` shader compiler under
  a different package name on some distros)
- Fedora: `sudo dnf install vulkan-loader-devel shaderc`
- Arch: `sudo pacman -S vulkan-icd-loader shaderc`
- macOS: not supported (use `gpu-metal` instead) - Vulkan on Apple
  platforms would go through the MoltenVK translation layer, which isn't
  what llama.cpp's Vulkan backend targets here.
- Windows: also needs the [Vulkan SDK](https://vulkan.lunarg.com/)
  installed and `VULKAN_SDK` set (llama-cpp-sys-2's build script checks
  for it on that platform only).

At *run* time, Vulkan itself only needs the GPU's regular driver (the one
you'd already have for any 3D application) - no separate toolkit to
install on the machine actually running the app, unlike CUDA/ROCm.

Intel GPUs have no dedicated feature of their own here (llama.cpp's SYCL
backend isn't among the bindings' flags), but a discrete or integrated
Intel GPU exposing a Vulkan driver (typical on Linux via Mesa's `ANV`
driver) can still be reached through `gpu-vulkan`.

#### Building the distributable app (Windows .exe / Linux app)

The commands above (`cargo build --features gpu-cuda`, etc.) are for
local development - picking one specific vendor's feature by hand ahead
of time. The actual **distributable app** - what end users install as a
Windows `.exe` or a Linux package - is built differently: with
`gpu-vulkan` always on, so a single shipped binary adapts to whatever's
actually on the end user's machine at *runtime*, instead of anyone
needing to pick a build in advance:

```bash
# from ecriture-rust
npm run package:linux      # produces the Linux app
npm run package:windows    # produces the Windows .exe
```

- On a machine with a Vulkan-capable GPU with at least 3 GiB of memory
  (NVIDIA/AMD/Intel - the overwhelming majority of PCs), it's used
  automatically: `n_gpu_layers` is always requested (see above), and
  llama.cpp's own device enumeration at startup decides whether there's
  actually anything big enough to offload to.
- On a machine with no GPU (or no working Vulkan driver), it falls back
  to CPU automatically - no separate build, no user-facing toggle to
  flip.
- `package:windows` additionally sets `LLAMA_STATIC_CRT=1` (a
  `llama-cpp-sys-2` build-time env var), so the Windows build statically
  links the MSVC C runtime into the executable instead of depending on
  the end user having the Visual C++ Redistributable already installed -
  the distributable is meant to run standalone, with nothing extra to
  install beyond what a PC with a working display already has.
- Check `[ai] ggml backend devices` in the app's logs after the first AI
  request to confirm whether a GPU was actually found and used - this
  works identically in the distributable and in `cargo tauri dev`.

**Known edge case**: this links against the system's Vulkan loader
(`libvulkan.so.1` / `vulkan-1.dll`), which any machine with a working GPU
driver already has - the app doesn't bundle this itself, the same way it
doesn't bundle GPU drivers. That's not literally every machine, though: a
genuinely headless install with no display/graphics stack at all
(unusual for this app's actual users, a desktop writing tool, but
possible on e.g. a minimal server-like setup) may lack the Vulkan loader
entirely, in which case the app would fail to *launch* rather than
gracefully falling back to CPU. If that's ever hit, `npm run tauri build`
(no `--features` flag) produces a CPU-only build with no such dependency,
as a fallback distributable.

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
