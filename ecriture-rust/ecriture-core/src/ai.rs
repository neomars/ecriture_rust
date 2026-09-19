//! AI writing-assistant plumbing: system prompts and the offline fallback
//! simulator. Ports `ai_prompts.py` and the non-inference parts of
//! `ai_client.py`.
//!
//! Actually running a local GGUF model (the Python app shells out to
//! `llama-cpp-python` with a downloaded Gemma checkpoint) is intentionally
//! out of scope for this crate: it needs a multi-gigabyte model download
//! and a heavyweight native inference dependency, neither of which belongs
//! in a unit-testable core library. [`AiBackend`] is the seam a real Tauri
//! command layer can implement against (e.g. wrapping `llama_cpp-rs` or an
//! HTTP call to a local inference server); [`fallback_response`] is what
//! ships today and is exercised fully offline.

use crate::locale;

pub mod prompts {
    pub const DESCRIBE: &str = "You are an expert novelist's writing assistant. Your task is to describe the selected word, character, object, action, or setting in rich, immersive, and sensory detail.\nUse vivid imagery, metaphors, and sensory references (sight, sound, smell, touch, taste) to bring the subject to life. Keep the tone literary and evocative.\nEnsure the language of your output matches the language of the input text exactly (e.g., if the input is in French, write in French; if in English, write in English).\nDo NOT include any introductory or concluding remarks (such as \"Here is the description:\")\u{2014}output ONLY the descriptive prose itself.";

    pub const REWRITE: &str = "You are an expert novelist's writing assistant. Your task is to rewrite the selected passage in a specified style.\nThe style selected is: '{style}'.\n\nHere are the guidelines for each style:\n- 'slang': Informal, conversational, using colloquialisms and street language (argotique).\n- 'elegant': Refined, sophisticated, and polished literary language with elegant vocabulary (soutenu).\n- 'medieval': Archaic, historic tone, using old-fashioned vocabulary or syntax reminiscent of medieval fantasy.\n- 'poetic': Evocative, lyrical, rhythmic, utilizing rich metaphors, similes, and figurative imagery.\n- 'brutal': Direct, harsh, visceral, and unflinching language, often fast-paced and raw.\n- 'cynical': Sardonic, mocking, pessimistic, and sharply observant tone.\n\nEnsure the language of your output matches the language of the input text exactly (e.g., if the input is in French, write in French; if in English, write in English).\nDo NOT include any introductory or concluding remarks\u{2014}output ONLY the rewritten prose itself.";

    pub const EXPAND: &str = "You are an expert novelist's writing assistant. Your task is to expand the selected passage.\nFlesh out the details, slow down the narrative pacing, add depth to the thoughts, sensations, or setting, and expand the scene's emotional weight while fully preserving the author's original intent.\nEnsure the language of your output matches the language of the input text exactly (e.g., if the input is in French, write in French; if in English, write in English).\nDo NOT include any introductory or concluding remarks\u{2014}output ONLY the expanded prose itself.";

    pub const SHOW_DONT_TELL: &str = "You are an expert novelist's writing assistant. The author has provided a sentence that is too explanatory (\"telling\").\nYour task is to apply the \"Show, Don't Tell\" principle and provide 3 different variations that convey the same information through sensory details, character behavior, body language, or environment, without explicitly stating the emotion or fact.\n\nFormat your response strictly as 3 bullet points. Do NOT include any introductory or concluding remarks.\nEnsure the language of your output matches the language of the input text exactly (e.g., if the input is in French, write in French; if in English, write in English).";

    pub const SENSORY: &str = "You are an expert novelist's writing assistant. The author has provided a scene that is too abstract.\nYour task is to inject precise sensory details into the passage. Add relevant sights, ambient sounds, tactile sensations, smells, or lighting variations to ground the scene and make it immersive, while keeping the original meaning.\n\nDo NOT include any introductory or concluding remarks. Output ONLY the rewritten sensory prose itself.\nEnsure the language of your output matches the language of the input text exactly (e.g., if the input is in French, write in French; if in English, write in English).";

    pub const POV: &str = "You are an expert novelist's writing assistant. Your task is to rewrite the selected passage by changing its Point of View (POV) or perspective.\nThe requested perspective shift is: '{style}'.\n\nHere are the guidelines for each perspective:\n- 'first_person': Rewrite the text from the first-person perspective (\"I\" / \"Je\").\n- 'third_person': Rewrite the text from the third-person perspective (\"He/She/They\" / \"Il/Elle\").\n- 'other_witness': Rewrite the text from the perspective of an external observer witnessing the scene, reacting to it without having access to the inner thoughts of the main characters.\n\nEnsure the language of your output matches the language of the input text exactly (e.g., if the input is in French, write in French; if in English, write in English).\nDo NOT include any introductory or concluding remarks\u{2014}output ONLY the rewritten prose itself.";

    pub const COMPLICATIONS: &str = "You are an expert novelist's writing assistant specializing in plot dynamization. The author's scene is stuck and needs new narrative momentum.\nYour task is to propose exactly 3 unexpected but coherent narrative complications (e.g., an intruder enters, a secret is accidentally revealed, extreme weather occurs) that fit within the context of the provided text.\n\nFormat your response strictly as 3 bullet points. Provide vivid ideas that will force the characters to react immediately.\nDo NOT include any introductory or concluding remarks. Ensure the language of your output matches the language of the input text exactly (e.g., if the input is in French, write in French; if in English, write in English).";

    pub const NAMES: &str = "You are an expert novelist's writing assistant specializing in worldbuilding and linguistics. The author needs new contextual names/toponyms.\nYour task is to generate 10 unique, evocative names (characters, inns, planets, or cities) that strictly respect the linguistic roots or style specified by the author.\n\nHere is the context/style requested by the author: '{style}'\n\nFormat your response strictly as a numbered list of 10 names. You may add a brief (one sentence) explanation of the meaning or vibe of each name if appropriate.\nDo NOT include any introductory or concluding remarks. Ensure the language of your output matches the language of the prompt exactly (e.g., if the input is in French, write in French; if in English, write in English).";
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AiError {
    #[error("unknown tool: {0}")]
    UnknownTool(String),
}

/// Builds the system prompt for a contextual writing tool, appending the
/// output-language instruction the way `main.py::handle_ai_tool` does.
pub fn build_tool_system_prompt(tool: &str, style: &str, lang: &str) -> Result<String, AiError> {
    let template = match tool {
        "describe" => prompts::DESCRIBE.to_string(),
        "rewrite" => prompts::REWRITE.replace("{style}", style),
        "pov" => prompts::POV.replace("{style}", style),
        "expand" => prompts::EXPAND.to_string(),
        "show_dont_tell" => prompts::SHOW_DONT_TELL.to_string(),
        "sensory" => prompts::SENSORY.to_string(),
        "complications" => prompts::COMPLICATIONS.to_string(),
        "names" => prompts::NAMES.replace("{style}", style),
        other => return Err(AiError::UnknownTool(other.to_string())),
    };
    Ok(format!("{template}{}", lang_instruction(lang)))
}

fn lang_instruction(lang: &str) -> String {
    let lang_name = match lang {
        "fr" => "French",
        "es" => "Spanish",
        "ru" => "Russian",
        _ => "English",
    };
    format!("Respond strictly in this language: {lang_name}.")
}

/// A pluggable real inference backend. The bundled fallback simulator does
/// not implement this trait - it's a plain function, since it never fails.
pub trait AiBackend {
    fn generate_chat(&self, messages: &[ChatMessage], temperature: f32) -> Result<String, String>;
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Very small heuristic to guess whether a snippet of prose is French,
/// used only when the caller didn't already pin a language. Mirrors the
/// keyword list in `ai_client.py::get_fallback_response`.
fn looks_french(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["le", "la", "les", "une", "un", "est", "et", "de", "je", "tu", "il"]
        .iter()
        .any(|w| lower.split_whitespace().any(|token| token == *w))
}

/// Generates a simulated, offline response for when no local model is
/// installed. Ports `AIClient.get_fallback_response`.
pub fn fallback_response(category: &str, user_text: &str, style: &str, lang: &str) -> String {
    let effective_lang = if lang == "fr" || looks_french(user_text) {
        "fr"
    } else {
        lang
    };

    match category {
        "describe" => locale::get_string(effective_lang, "fallback_describe", "{text}")
            .replace("{text}", user_text),
        "rewrite" => {
            let key = format!("fallback_rewrite_{style}");
            let mut template = locale::get_string(effective_lang, &key, "");
            if template.is_empty() {
                template = locale::get_string(effective_lang, "fallback_rewrite_elegant", "{text}");
            }
            template.replace("{text}", user_text)
        }
        "expand" => locale::get_string(effective_lang, "fallback_expand", "{text}")
            .replace("{text}", user_text),
        "relecture_style" => locale::get_string(effective_lang, "fallback_relecture_style", ""),
        "relecture_coherence" => {
            locale::get_string(effective_lang, "fallback_relecture_coherence", "")
        }
        _ => {
            let lower = user_text.to_lowercase();
            if ["plan", "intrigue", "plot"].iter().any(|k| lower.contains(k)) {
                locale::get_string(effective_lang, "fallback_chat_plot", "")
            } else if ["personnage", "character", "heros", "héro"]
                .iter()
                .any(|k| lower.contains(k))
            {
                locale::get_string(effective_lang, "fallback_chat_character", "")
            } else {
                locale::get_string(effective_lang, "fallback_chat_general", "")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_tool_system_prompt_interpolates_style_and_language() {
        let prompt = build_tool_system_prompt("rewrite", "poetic", "fr").unwrap();
        assert!(prompt.contains("'poetic'"));
        assert!(prompt.contains("Respond strictly in this language: French."));
    }

    #[test]
    fn build_tool_system_prompt_rejects_unknown_tool() {
        assert_eq!(
            build_tool_system_prompt("teleport", "x", "en"),
            Err(AiError::UnknownTool("teleport".into()))
        );
    }

    #[test]
    fn describe_and_expand_prompts_do_not_need_a_style() {
        assert!(build_tool_system_prompt("describe", "", "en").is_ok());
        assert!(build_tool_system_prompt("expand", "", "en").is_ok());
    }

    #[test]
    fn fallback_response_substitutes_selected_text() {
        let out = fallback_response("describe", "a lonely lighthouse", "elegant", "en");
        assert!(out.contains("a lonely lighthouse"));
    }

    #[test]
    fn fallback_response_falls_back_to_elegant_style_when_unknown() {
        let out = fallback_response("rewrite", "hello", "made_up_style", "en");
        let elegant = fallback_response("rewrite", "hello", "elegant", "en");
        assert_eq!(out, elegant);
    }

    #[test]
    fn fallback_chat_detects_plot_and_character_keywords() {
        let plot = fallback_response("chat", "Help me with my plot", "", "en");
        let character = fallback_response("chat", "Tell me about this character", "", "en");
        let general = fallback_response("chat", "What's the weather like", "", "en");
        assert_ne!(plot, general);
        assert_ne!(character, general);
    }

    #[test]
    fn looks_french_detects_common_french_function_words() {
        assert!(looks_french("Le chat est noir"));
        assert!(!looks_french("The cat is black"));
    }
}
