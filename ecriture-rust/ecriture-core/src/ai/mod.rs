//! AI writing-assistant plumbing: system prompts, the offline fallback
//! simulator, the local Gemma GGUF download, and real local inference.
//! Ports `ai_prompts.py` and `ai_client.py`.
//!
//! - [`prompts`] / [`build_tool_system_prompt`] / [`fallback_response`] -
//!   pure, fully unit-tested, no I/O.
//! - [`model_store`] - resolves where the model file lives on disk and
//!   whether it's installed. Pure/testable.
//! - [`download`] - streams the GGUF file to disk with progress
//!   reporting. The streaming/atomic-rename logic is unit-tested against a
//!   local loopback HTTP server; it does not depend on any specific host.
//! - [`inference`] - wraps `llama-cpp-2` (Rust bindings to llama.cpp, the
//!   same engine the original Python app drives via `llama-cpp-python`) to
//!   actually run the model. This cannot be exercised by this crate's own
//!   test suite: it requires the real multi-gigabyte model file, which
//!   this development environment's network policy blocks downloading
//!   (`huggingface.co` is not reachable here). The lower-level llama.cpp
//!   API usage itself was checked against the crate's own official example
//!   (`examples/simple` in `utilityai/llama-cpp-rs`) to minimize the risk
//!   of API-usage bugs; the model download and a real generation should
//!   still be verified on a machine with an unrestricted network.
//!
//! [`AiBackend`] is the seam [`inference::LlamaEngine`] implements; the
//! Tauri command layer tries it first and falls back to
//! [`fallback_response`] on any error (missing model, load failure,
//! generation error), mirroring `ai_client.py`'s try/except structure.

pub mod download;
pub mod inference;
pub mod lore;
pub mod model_store;

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

    pub const RELECTURE_STYLE_FR: &str = "Tu es un relecteur professionnel de romans et correcteur littéraire de style et prose.\nAnalyse le texte suivant et donne des retours constructifs détaillés.\nSuggère des améliorations précises de vocabulaire, de rythme des phrases, de style, de fluidité et des reformulations d'échantillons de texte s'il y a lieu.\nRéponds en français.";
    pub const RELECTURE_STYLE_ES: &str = "Eres un corrector profesional de novelas y editor literario de estilo y prosa.\nAnaliza el siguiente texto y proporciona comentarios constructivos detallados.\nSugiere mejoras precisas de vocabulario, ritmo de oraciones, estilo, fluidez y reescrituras de muestra donde corresponda.\nResponde en español.";
    pub const RELECTURE_STYLE_RU: &str = "Вы профессиональный корректор романов и литературный редактор стиля и прозы.\nПроанализируйте следующий текст и дайте подробные конструктивные отзывы.\nПредложите точные улучшения словарного запаса, ритма предложений, стиля, текучести и образцы перефразирования текста, где это применимо.\nОтвечайте на русском языке.";
    pub const RELECTURE_STYLE_EN: &str = "You are a professional novel proofreader and copyeditor of style and prose.\nAnalyze the following text and provide detailed constructive feedback.\nSuggest precise improvements for vocabulary, sentence pacing, style, flow, and sample rewrites where applicable.\nRespond in English.";

    pub const RELECTURE_COHERENCE_FR: &str = "Tu es un relecteur professionnel de romans et conseiller en cohérence narrative.\nAnalyse le texte suivant pour en évaluer la cohérence logique, les motivations et actions des personnages, la pertinence temporelle et spatiale, et signale toute anomalie ou incohérence flagrante.\nRéponds en français.";
    pub const RELECTURE_COHERENCE_EN: &str = "You are a professional novel proofreader and narrative coherence consultant.\nAnalyze the following text to evaluate logical consistency, character motivations and actions, temporal and spatial sense, and flag any logical fallacies or glaring inconsistencies.\nRespond in English.";

    pub const LORE_COHERENCE_FR: &str = "Tu es un relecteur professionnel de romans et expert en \"worldbuilding\" et cohérence.\nAnalyse le texte suivant en le comparant avec les fiches de personnages et de lore fournies ci-dessous.\nIdentifie les contradictions, les anachronismes et les incohérences (ex. : changement de couleur des yeux, objets modernes à une mauvaise époque, ou comportements allant contre les traits établis).\nVoici les données de référence :\n{lore_context}\n\nAnalyse le texte et liste toutes les incohérences trouvées, ou indique que tout est cohérent. Réponds en français.";

    pub const LORE_COHERENCE_EN: &str = "You are a professional novel proofreader and expert in worldbuilding and consistency.\nAnalyze the following text by comparing it with the provided character and lore sheets below.\nIdentify contradictions, anachronisms, and inconsistencies (e.g., changing eye color, modern objects in the wrong era, or behaviors contradicting established traits).\nHere is the reference data:\n{lore_context}\n\nAnalyze the text and list all inconsistencies found, or state that everything is consistent. Respond in English.";

    pub const LORE_COHERENCE_ES: &str = "Eres un experto corrector literario y consultor de coherencia narrativa, experto en worldbuilding (\"lore\").\nEl autor te ha proporcionado el texto de una escena junto con el contexto del Lore (personajes, lugares, conceptos) asociados a esta escena.\n\n=== LORE PROPORCIONADO ===\n{lore_context}\n=========================\n\nInstrucciones:\n1. Analiza cuidadosamente la escena a continuación.\n2. Compara activamente las acciones, descripciones o diálogos de la escena con los elementos del Lore proporcionados.\n3. Señala cualquier **contradicción**, **inconsistencia** o **anacronismo** entre la escena y el Lore. Por ejemplo: si un personaje tiene los ojos azules en el lore pero verdes en la escena; si usa magia sin tener el rasgo de mago; si el tono de la relación no coincide.\n4. Si todo es coherente, confírmalo explicando brevemente por qué.\n5. Responde estrictamente en español. Sé claro y constructivo.\n";

    pub const LORE_COHERENCE_RU: &str = "Вы эксперт-корректор литературных произведений и консультант по повествовательной связности, специализирующийся на мироустройстве (\"лоре\").\nАвтор предоставил вам текст сцены вместе с контекстом Лора (персонажи, места, концепции), связанного с этой сценой.\n\n=== ПРЕДОСТАВЛЕННЫЙ ЛОР ===\n{lore_context}\n=========================\n\nИнструкции:\n1. Внимательно проанализируйте сцену ниже.\n2. Активно сравнивайте действия, описания или диалоги в сцене с предоставленными элементами Лора.\n3. Укажите на любое **противоречие**, **несоответствие** или **анахронизм** между сценой и Лором. Например: если у персонажа синие глаза в лоре, но зеленые в сцене; если он использует магию, не имея черты мага; если тон отношений не совпадает.\n4. Если все логично, подтвердите это, кратко объяснив, почему.\n5. Отвечайте строго на русском языке. Будьте ясны и конструктивны.\n";

    pub const EXTRACT_LORE: &str = "You are an expert literary assistant specializing in worldbuilding and character extraction.\nAnalyze the following text and extract all named characters, their physical appearances, personality traits, distinctive habits/tics, kinship/relations, and any significant objects they possess.\nFormat your response strictly as a JSON array of objects. Each object must follow this structure:\n[\n  {\n    \"name\": \"Character Name\",\n    \"appearance\": \"Physical description...\",\n    \"traits\": [\"trait1\", \"trait2\"],\n    \"notes\": \"Any other significant details, tics, or objects possessed...\"\n  }\n]\nDo NOT include any markdown formatting blocks like ```json or introductory text. Return raw JSON only.";
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

/// Pulls the first `[...]` JSON array out of a model response and parses
/// it, tolerating models that wrap their JSON in prose or markdown code
/// fences despite being told not to (ports the regex-based extraction in
/// `main.py::api_extract_characters`).
pub fn extract_json_array(text: &str) -> Option<serde_json::Value> {
    let re = regex::Regex::new(r"(?s)\[.*\]").ok()?;
    let m = re.find(text)?;
    serde_json::from_str(m.as_str()).ok()
}

/// Builds the "worldbuilding coherence" relecture prompt, ported from
/// `main.py::api_relecture_ai`'s `worldbuilding` branch (which picks one
/// of four fully-localized `LORE_COHERENCE_PROMPT_*` templates rather than
/// appending a language instruction to a shared template).
pub fn build_lore_coherence_prompt(lang: &str, lore_context: &str) -> String {
    let template = match lang {
        "fr" => prompts::LORE_COHERENCE_FR,
        "es" => prompts::LORE_COHERENCE_ES,
        "ru" => prompts::LORE_COHERENCE_RU,
        _ => prompts::LORE_COHERENCE_EN,
    };
    template.replace("{lore_context}", lore_context)
}

/// Builds the system prompt for the "relecture" (proofreading) assistant.
/// `category` is one of `"style"`, `"coherence"` or `"worldbuilding"`;
/// `lore_context` is only used for `"worldbuilding"` (pass an empty
/// string otherwise). Ports `main.py::api_relecture_ai`'s prompt
/// selection, including its narrower language support: `coherence` only
/// has French and English prompts (any other language falls back to
/// English), matching the original.
pub fn build_relecture_system_prompt(category: &str, lang: &str, lore_context: &str) -> String {
    match category {
        "style" => match lang {
            "fr" => prompts::RELECTURE_STYLE_FR,
            "es" => prompts::RELECTURE_STYLE_ES,
            "ru" => prompts::RELECTURE_STYLE_RU,
            _ => prompts::RELECTURE_STYLE_EN,
        }
        .to_string(),
        "worldbuilding" => build_lore_coherence_prompt(lang, lore_context),
        _ => match lang {
            "fr" => prompts::RELECTURE_COHERENCE_FR,
            _ => prompts::RELECTURE_COHERENCE_EN,
        }
        .to_string(),
    }
}

/// Builds the localized "here's the scene's lore, stay consistent with it"
/// message the chat assistant's system prompt is prefixed with. Ports the
/// per-language strings in `main.py::ai_chat`.
pub fn build_chat_lore_intro(lang: &str, lore_context: &str) -> String {
    match lang {
        "fr" => format!(
            "Voici des informations sur le contexte et le Lore de la scène en cours. Intègre et respecte ces éléments si nécessaire dans vos réponses :\n\n{lore_context}"
        ),
        "es" => format!(
            "Aquí hay información sobre el contexto y la tradición de la escena actual. Integra y respeta estos elementos si es necesario en tus respuestas:\n\n{lore_context}"
        ),
        "ru" => format!(
            "Здесь представлена информация о контексте и лоре текущей сцены. Интегрируйте и учитывайте эти элементы при необходимости в своих ответах:\n\n{lore_context}"
        ),
        _ => format!(
            "Here is information on the context and lore of the current scene. Integrate and respect these elements if necessary in your answers:\n\n{lore_context}"
        ),
    }
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
/// [`inference::LlamaEngine`] implements this against a local Gemma GGUF
/// model.
pub trait AiBackend {
    fn generate_chat(&self, messages: &[ChatMessage], temperature: f32) -> Result<String, String>;
}

/// Reshapes an arbitrary system/user/assistant message list into the
/// strictly-alternating, user-first form Gemma 2's chat template requires.
/// Ports `AIClient.generate_chat`'s message normalization in
/// `ai_client.py`: system messages are folded into the next user message,
/// consecutive same-role messages are merged, and any assistant messages
/// before the first user message are dropped (Gemma has no system role and
/// cannot start a conversation on an assistant turn).
pub fn normalize_gemma_messages(messages: &[ChatMessage]) -> Vec<ChatMessage> {
    let mut formatted: Vec<ChatMessage> = Vec::new();
    let mut pending_system: Vec<String> = Vec::new();

    for msg in messages {
        match msg.role.as_str() {
            "system" => pending_system.push(msg.content.clone()),
            "user" => {
                let mut content = msg.content.clone();
                if !pending_system.is_empty() {
                    content = format!("{}\n\n{}", pending_system.join("\n\n"), content);
                    pending_system.clear();
                }
                match formatted.last_mut() {
                    Some(last) if last.role == "user" => {
                        last.content = format!("{}\n\n{}", last.content, content);
                    }
                    _ => formatted.push(ChatMessage { role: "user".into(), content }),
                }
            }
            "assistant" => match formatted.last_mut() {
                Some(last) if last.role == "user" => {
                    formatted.push(ChatMessage {
                        role: "assistant".into(),
                        content: msg.content.clone(),
                    });
                }
                Some(last) if last.role == "assistant" => {
                    last.content = format!("{}\n\n{}", last.content, msg.content);
                }
                _ => {} // drop a leading assistant message
            },
            _ => {}
        }
    }

    if !pending_system.is_empty() {
        let joined = pending_system.join("\n\n");
        match formatted.last_mut() {
            Some(last) if last.role != "assistant" => {
                last.content = format!("{}\n\n{joined}", last.content);
            }
            _ => formatted.push(ChatMessage {
                role: "user".into(),
                content: joined,
            }),
        }
    }

    formatted
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage { role: role.into(), content: content.into() }
    }

    #[test]
    fn normalize_folds_leading_system_into_first_user_message() {
        let out = normalize_gemma_messages(&[msg("system", "Be terse."), msg("user", "Hi")]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].role, "user");
        assert_eq!(out[0].content, "Be terse.\n\nHi");
    }

    #[test]
    fn normalize_drops_leading_assistant_message() {
        let out = normalize_gemma_messages(&[msg("assistant", "unsolicited"), msg("user", "Hi")]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].role, "user");
        assert_eq!(out[0].content, "Hi");
    }

    #[test]
    fn normalize_merges_consecutive_same_role_messages() {
        let out = normalize_gemma_messages(&[
            msg("user", "part one"),
            msg("user", "part two"),
            msg("assistant", "reply one"),
            msg("assistant", "reply two"),
        ]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].content, "part one\n\npart two");
        assert_eq!(out[1].content, "reply one\n\nreply two");
    }

    #[test]
    fn normalize_appends_trailing_system_content_to_last_user_turn() {
        let out = normalize_gemma_messages(&[msg("user", "Hi"), msg("system", "Stay in character.")]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].content, "Hi\n\nStay in character.");
    }

    #[test]
    fn normalize_appends_trailing_system_content_as_new_user_turn_after_assistant() {
        let out = normalize_gemma_messages(&[
            msg("user", "Hi"),
            msg("assistant", "Hello!"),
            msg("system", "Remember: be brief."),
        ]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[2].role, "user");
        assert_eq!(out[2].content, "Remember: be brief.");
    }

    #[test]
    fn normalize_preserves_a_full_alternating_conversation_unchanged() {
        let input = vec![msg("user", "Hi"), msg("assistant", "Hello!"), msg("user", "How are you?")];
        let out = normalize_gemma_messages(&input);
        assert_eq!(out.len(), 3);
        for (a, b) in out.iter().zip(input.iter()) {
            assert_eq!(a.role, b.role);
            assert_eq!(a.content, b.content);
        }
    }

    #[test]
    fn extract_json_array_parses_a_clean_array() {
        let value = extract_json_array(r#"[{"name":"Alice"}]"#).unwrap();
        assert_eq!(value[0]["name"], "Alice");
    }

    #[test]
    fn extract_json_array_strips_surrounding_prose_and_code_fences() {
        let text = "Here you go:\n```json\n[{\"name\": \"Bob\"}]\n```\nHope that helps!";
        let value = extract_json_array(text).unwrap();
        assert_eq!(value[0]["name"], "Bob");
    }

    #[test]
    fn extract_json_array_returns_none_for_non_json_text() {
        assert!(extract_json_array("I couldn't find any characters.").is_none());
    }

    #[test]
    fn build_chat_lore_intro_localizes_and_embeds_context() {
        assert!(build_chat_lore_intro("fr", "Nom: Elara").contains("Nom: Elara"));
        assert!(build_chat_lore_intro("fr", "x").starts_with("Voici des informations"));
        assert!(build_chat_lore_intro("es", "x").starts_with("Aquí hay información"));
        assert!(build_chat_lore_intro("ru", "x").starts_with("Здесь представлена"));
        assert!(build_chat_lore_intro("en", "x").starts_with("Here is information"));
        assert!(build_chat_lore_intro("de", "x").starts_with("Here is information"));
    }

    #[test]
    fn build_relecture_system_prompt_picks_style_by_language() {
        assert_eq!(build_relecture_system_prompt("style", "fr", ""), prompts::RELECTURE_STYLE_FR);
        assert_eq!(build_relecture_system_prompt("style", "es", ""), prompts::RELECTURE_STYLE_ES);
        assert_eq!(build_relecture_system_prompt("style", "ru", ""), prompts::RELECTURE_STYLE_RU);
        assert_eq!(build_relecture_system_prompt("style", "en", ""), prompts::RELECTURE_STYLE_EN);
        assert_eq!(build_relecture_system_prompt("style", "de", ""), prompts::RELECTURE_STYLE_EN);
    }

    #[test]
    fn build_relecture_system_prompt_coherence_only_supports_fr_and_en() {
        assert_eq!(build_relecture_system_prompt("coherence", "fr", ""), prompts::RELECTURE_COHERENCE_FR);
        // Matches the Python original: es/ru aren't handled for coherence,
        // they fall through to the English prompt.
        assert_eq!(build_relecture_system_prompt("coherence", "es", ""), prompts::RELECTURE_COHERENCE_EN);
        assert_eq!(build_relecture_system_prompt("coherence", "ru", ""), prompts::RELECTURE_COHERENCE_EN);
    }

    #[test]
    fn build_relecture_system_prompt_worldbuilding_injects_lore_context() {
        let prompt = build_relecture_system_prompt("worldbuilding", "fr", "Nom: Elara");
        assert!(prompt.contains("Nom: Elara"));
        assert!(prompt.contains("Réponds en français"));
    }

    #[test]
    fn build_lore_coherence_prompt_substitutes_context_and_picks_language() {
        let fr = build_lore_coherence_prompt("fr", "Nom: Elara");
        assert!(fr.contains("Nom: Elara"));
        assert!(fr.contains("Réponds en français"));

        let en = build_lore_coherence_prompt("en", "Name: Elara");
        assert!(en.contains("Name: Elara"));
        assert!(en.contains("Respond in English"));

        // Unknown language codes fall back to English, matching the rest
        // of the AI prompt-building functions.
        let unknown = build_lore_coherence_prompt("de", "x");
        assert!(unknown.contains("x"));
        assert!(unknown.contains("Respond in English"));
    }

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
