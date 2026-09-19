//! Real local inference via llama.cpp, through the `llama-cpp-2` bindings -
//! the same underlying engine the original Python app drives via
//! `llama-cpp-python`.
//!
//! `LlamaBackend` and `LlamaContext` are not `Send`, and llama.cpp only
//! supports initializing its backend once per process, so all of this
//! module's actual llama.cpp calls happen on one dedicated worker thread
//! that lives for as long as the engine does. [`LlamaEngine`] is just a
//! `Sender` handle other threads can clone/share freely; [`LlamaEngine::load`]
//! spawns the worker and waits for the initial model load to report success
//! or failure before returning, so a bad model file surfaces immediately
//! rather than on the first chat request.
//!
//! See `crate::ai` module docs for why this file's logic could not be
//! exercised against a real model in this environment: the low-level
//! llama.cpp call sequence (tokenize → batch → decode → sample loop) is
//! copied from `llama-cpp-2`'s own official `examples/simple`, and the
//! chat-formatting step uses the model's own embedded GGUF chat template
//! via `LlamaModel::apply_chat_template` rather than a hand-rolled Gemma
//! prompt format, specifically to lean on llama.cpp's own tested behavior
//! wherever possible.

use crate::ai::{AiBackend, ChatMessage};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender};

#[derive(Debug, thiserror::Error)]
pub enum InferenceError {
    #[error("failed to initialize the llama.cpp backend: {0}")]
    Backend(String),
    #[error("failed to load model '{path}': {reason}")]
    ModelLoad { path: PathBuf, reason: String },
    #[error("failed to create an inference context: {0}")]
    ContextInit(String),
    #[error("tokenization failed: {0}")]
    Tokenize(String),
    #[error("chat template error: {0}")]
    ChatTemplate(String),
    #[error("decode failed: {0}")]
    Decode(String),
    #[error("the inference worker thread is no longer running")]
    WorkerGone,
}

struct GenerateRequest {
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: i32,
    respond_to: Sender<Result<String, InferenceError>>,
}

/// A handle to a running local Gemma engine. Cloning is cheap (it's just a
/// channel sender) and safe to share across threads/store in shared app
/// state; every clone talks to the same single worker thread.
#[derive(Clone)]
pub struct LlamaEngine {
    request_tx: Sender<GenerateRequest>,
}

impl LlamaEngine {
    /// Spawns the dedicated worker thread, loads `model_path` with a
    /// context window of `n_ctx` tokens, and blocks until that load
    /// finishes (successfully or not).
    pub fn load(model_path: impl AsRef<Path>, n_ctx: u32) -> Result<Self, InferenceError> {
        let model_path = model_path.as_ref().to_path_buf();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), InferenceError>>();
        let (request_tx, request_rx) = std::sync::mpsc::channel::<GenerateRequest>();

        std::thread::Builder::new()
            .name("ecriture-llama-engine".into())
            .spawn(move || run_engine_thread(model_path, n_ctx, &ready_tx, request_rx))
            .map_err(|e| InferenceError::Backend(e.to_string()))?;

        ready_rx.recv().map_err(|_| InferenceError::WorkerGone)??;
        Ok(Self { request_tx })
    }
}

impl AiBackend for LlamaEngine {
    fn generate_chat(&self, messages: &[ChatMessage], temperature: f32) -> Result<String, String> {
        let (respond_to, response_rx) = std::sync::mpsc::channel();
        self.request_tx
            .send(GenerateRequest {
                messages: messages.to_vec(),
                temperature,
                max_tokens: 512, // matches ai_client.py's create_chat_completion max_tokens
                respond_to,
            })
            .map_err(|_| "inference worker is not running".to_string())?;

        response_rx
            .recv()
            .map_err(|_| "inference worker dropped the response channel".to_string())?
            .map_err(|e| e.to_string())
    }
}

/// Requests as many transformer layers as possible be offloaded to a GPU.
/// This is harmless on a CPU-only build (no `cuda`/`rocm`/`metal` Cargo
/// feature enabled): with no GPU backend compiled in, llama.cpp finds no
/// GPU device to offload to and silently runs entirely on CPU regardless
/// of this value. Gemma-2-2b has far fewer than 1000 layers, so this
/// offloads the whole model whenever a GPU backend *is* available.
const GPU_LAYERS_ALL: u32 = 1000;

fn log_backend_devices() {
    let devices = llama_cpp_2::list_llama_ggml_backend_devices();
    let gpu_count = devices
        .iter()
        .filter(|d| {
            matches!(
                d.device_type,
                llama_cpp_2::LlamaBackendDeviceType::Gpu | llama_cpp_2::LlamaBackendDeviceType::IntegratedGpu
            )
        })
        .count();
    eprintln!("[ai] ggml backend devices ({} found, {gpu_count} GPU):", devices.len());
    for d in &devices {
        eprintln!(
            "[ai]   [{}] {} ({}) via {} - {:?}, {} MiB free / {} MiB total",
            d.index,
            d.name,
            d.description,
            d.backend,
            d.device_type,
            d.memory_free / 1024 / 1024,
            d.memory_total / 1024 / 1024,
        );
    }
    if gpu_count == 0 {
        eprintln!(
            "[ai] no GPU backend compiled in (or no GPU detected) - running on CPU. \
             See README for how to enable GPU acceleration for your hardware."
        );
    }
}

fn run_engine_thread(
    model_path: PathBuf,
    n_ctx: u32,
    ready_tx: &Sender<Result<(), InferenceError>>,
    request_rx: Receiver<GenerateRequest>,
) {
    let loaded = LlamaBackend::init()
        .map_err(|e| InferenceError::Backend(e.to_string()))
        .and_then(|backend| {
            log_backend_devices();
            let model_params = LlamaModelParams::default().with_n_gpu_layers(GPU_LAYERS_ALL);
            let model = LlamaModel::load_from_file(&backend, &model_path, &model_params).map_err(|e| {
                InferenceError::ModelLoad {
                    path: model_path.clone(),
                    reason: e.to_string(),
                }
            })?;
            Ok((backend, model))
        });

    let (backend, model) = match loaded {
        Ok(pair) => {
            let _ = ready_tx.send(Ok(()));
            pair
        }
        Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
        }
    };

    for request in request_rx {
        let result = generate_once(
            &backend,
            &model,
            n_ctx,
            &request.messages,
            request.temperature,
            request.max_tokens,
        );
        let _ = request.respond_to.send(result);
    }
}

fn generate_once(
    backend: &LlamaBackend,
    model: &LlamaModel,
    n_ctx: u32,
    messages: &[ChatMessage],
    temperature: f32,
    max_tokens: i32,
) -> Result<String, InferenceError> {
    let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(n_ctx));
    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| InferenceError::ContextInit(e.to_string()))?;

    let prompt = render_chat_prompt(model, messages)?;

    let tokens = model
        .str_to_token(&prompt, AddBos::Always)
        .map_err(|e| InferenceError::Tokenize(e.to_string()))?;
    if tokens.is_empty() {
        return Ok(String::new());
    }

    let mut batch = LlamaBatch::new(tokens.len().max(512), 1);
    let last_index = (tokens.len() - 1) as i32;
    for (i, token) in (0_i32..).zip(tokens.iter().copied()) {
        batch
            .add(token, i, &[0], i == last_index)
            .map_err(|e| InferenceError::Decode(e.to_string()))?;
    }
    ctx.decode(&mut batch)
        .map_err(|e| InferenceError::Decode(e.to_string()))?;

    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::temp(temperature.max(0.01)),
        LlamaSampler::dist(rand::random()),
    ]);

    let mut n_cur = batch.n_tokens();
    let end = n_cur + max_tokens;
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut output = String::new();

    while n_cur < end {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);

        if model.is_eog_token(token) {
            break;
        }

        let piece = model
            .token_to_piece(token, &mut decoder, true, None)
            .map_err(|e| InferenceError::Decode(e.to_string()))?;
        output.push_str(&piece);

        batch.clear();
        batch
            .add(token, n_cur, &[0], true)
            .map_err(|e| InferenceError::Decode(e.to_string()))?;
        n_cur += 1;
        ctx.decode(&mut batch)
            .map_err(|e| InferenceError::Decode(e.to_string()))?;
    }

    Ok(output.trim().to_string())
}

/// Renders the chat history into the final prompt string using the chat
/// template embedded in the GGUF file itself (Gemma's own
/// `<start_of_turn>`/`<end_of_turn>` format), rather than a hand-rolled
/// template - this is llama.cpp's own recommended approach and avoids
/// silently drifting from whatever template the specific downloaded
/// checkpoint actually expects.
fn render_chat_prompt(model: &LlamaModel, messages: &[ChatMessage]) -> Result<String, InferenceError> {
    let template = model
        .chat_template(None)
        .map_err(|e| InferenceError::ChatTemplate(e.to_string()))?;

    let llama_messages = messages
        .iter()
        .map(|m| LlamaChatMessage::new(m.role.clone(), m.content.clone()))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| InferenceError::ChatTemplate(e.to_string()))?;

    model
        .apply_chat_template(&template, &llama_messages, true)
        .map_err(|e| InferenceError::ChatTemplate(e.to_string()))
}
