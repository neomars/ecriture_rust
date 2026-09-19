//! Builds "lore context" text blocks (associated characters and story
//! notes) for a given scene, to prepend to an AI system prompt so
//! generations stay consistent with established characters/world facts.
//! Ports `main.py::get_scene_context`.
//!
//! Characters/plot cards carry most of the fields this needs (aliases,
//! traits, appearance, relations, `linked_scenes`, plot card `characters`)
//! as free-form frontend-only data, not modeled as typed struct fields
//! (see `crate::model` docs on `extra`) - this module reads them straight
//! out of each `extra` map, exactly as the schema-less Python
//! implementation does.

use crate::model::NovelData;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

fn str_field(extra: &Map<String, Value>, key: &str) -> String {
    extra
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn str_list_field(extra: &Map<String, Value>, key: &str) -> Vec<String> {
    extra
        .get(key)
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

/// Builds the combined lore context for `scene_id`, or an empty string if
/// nothing is associated with that scene. Mirrors the Python function's
/// French section headers verbatim (these are prompt content the model
/// reads, not UI text, so they aren't run through the locale system).
pub fn build_scene_context(data: &NovelData, scene_id: &str) -> String {
    if scene_id.is_empty() {
        return String::new();
    }

    // 1. Characters linked directly to the scene, or via a plot card for it.
    let mut char_ids: HashSet<String> = HashSet::new();
    for character in &data.characters {
        if str_list_field(&character.extra, "linked_scenes").iter().any(|s| s == scene_id) {
            char_ids.insert(character.id.clone());
        }
    }
    for card in &data.plot.cards {
        if card.scene_id == scene_id {
            for c_id in str_list_field(&card.extra, "characters") {
                char_ids.insert(c_id);
            }
        }
    }

    let char_name_map: HashMap<&str, &str> = data
        .characters
        .iter()
        .map(|c| (c.id.as_str(), c.name.as_str()))
        .collect();

    let mut char_lore_blocks = Vec::new();
    for character in &data.characters {
        if !char_ids.contains(&character.id) {
            continue;
        }
        let aliases = str_list_field(&character.extra, "aliases").join(", ");
        let traits = str_list_field(&character.extra, "traits").join(", ");
        let appearance = str_field(&character.extra, "appearance");
        let notes = str_field(&character.extra, "notes");

        let mut rel_strs = Vec::new();
        if let Some(relations) = character.extra.get("relations").and_then(Value::as_array) {
            for rel in relations {
                let target_id = rel.get("target_id").and_then(Value::as_str).unwrap_or("");
                let target_name = char_name_map.get(target_id).copied().unwrap_or("Inconnu");
                let rel_type = rel.get("type").and_then(Value::as_str).unwrap_or("");
                let rel_desc = rel.get("description").and_then(Value::as_str).unwrap_or("");

                let mut parts = Vec::new();
                if !rel_type.is_empty() {
                    parts.push(rel_type);
                }
                if !rel_desc.is_empty() {
                    parts.push(rel_desc);
                }
                if !parts.is_empty() {
                    rel_strs.push(format!("- Relation avec {target_name} : {}", parts.join(", ")));
                }
            }
        }

        let mut block = vec![format!("Personnage : {}", character.name)];
        if !character.role.is_empty() {
            block.push(format!("  Rôle : {}", character.role));
        }
        if !aliases.is_empty() {
            block.push(format!("  Alias/Surnoms : {aliases}"));
        }
        if !traits.is_empty() {
            block.push(format!("  Traits de caractère : {traits}"));
        }
        if !appearance.is_empty() {
            block.push(format!("  Apparence physique : {appearance}"));
        }
        if !character.description.is_empty() {
            block.push(format!("  Description : {}", character.description));
        }
        if !notes.is_empty() {
            block.push(format!("  Notes : {notes}"));
        }
        if !rel_strs.is_empty() {
            block.push(format!("  Relations :\n{}", rel_strs.join("\n")));
        }
        char_lore_blocks.push(block.join("\n"));
    }

    // 2. Story notes whose title is mentioned in the scene's title/content
    // or in a plot card attached to it.
    let (scene_title, scene_content) = find_scene_text(&data.manuscript, scene_id);
    let mut combined = format!("{scene_title}\n{scene_content}").to_lowercase();
    for card in &data.plot.cards {
        if card.scene_id == scene_id {
            combined.push_str(&format!("\n{}\n{}", card.title, card.content).to_lowercase());
        }
    }

    let mut note_lore_blocks = Vec::new();
    for note in &data.story_notes {
        if note.title.is_empty() || !combined.contains(&note.title.to_lowercase()) {
            continue;
        }
        let mut block = vec![format!("Note : {}", note.title)];
        if !note.note_type.is_empty() {
            block.push(format!("  Type : {}", note.note_type));
        }
        if !note.content.is_empty() {
            block.push(format!("  Contenu : {}", note.content));
        }
        note_lore_blocks.push(block.join("\n"));
    }

    let mut context_parts = Vec::new();
    if !char_lore_blocks.is_empty() {
        context_parts.push(format!(
            "=== LORE DES PERSONNAGES ASSOCIÉS À CETTE SCÈNE ===\n{}",
            char_lore_blocks.join("\n\n")
        ));
    }
    if !note_lore_blocks.is_empty() {
        context_parts.push(format!(
            "=== LORE DES NOTES ASSOCIÉES À CETTE SCÈNE ===\n{}",
            note_lore_blocks.join("\n\n")
        ));
    }

    context_parts.join("\n\n")
}

fn find_scene_text(chapters: &[crate::model::Chapter], scene_id: &str) -> (String, String) {
    for chapter in chapters {
        if chapter.id == scene_id {
            return (chapter.title.clone(), String::new());
        }
        for scene in &chapter.children {
            if scene.id == scene_id {
                return (scene.title.clone(), scene.content.clone());
            }
        }
    }
    (String::new(), String::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Chapter, Character, NovelData, PlotCard, Scene, StoryNote};
    use serde_json::json;

    fn character_with_extra(id: &str, name: &str, extra: Value) -> Character {
        Character {
            id: id.into(),
            name: name.into(),
            role: "Protagonist".into(),
            description: "A brave hero.".into(),
            extra: extra.as_object().cloned().unwrap_or_default(),
        }
    }

    fn base_data() -> NovelData {
        NovelData {
            manuscript: vec![Chapter {
                id: "chap_1".into(),
                node_type: "chapter".into(),
                title: "Chapter 1".into(),
                summary: String::new(),
                children: vec![Scene {
                    id: "scene_1".into(),
                    node_type: "scene".into(),
                    title: "The Tavern".into(),
                    content: "They meet at the Rusty Anchor tavern.".into(),
                    extra: Default::default(),
                }],
                extra: Default::default(),
            }],
            characters: vec![],
            story_notes: vec![],
            ..NovelData::default()
        }
    }

    #[test]
    fn empty_scene_id_returns_empty_context() {
        let data = base_data();
        assert_eq!(build_scene_context(&data, ""), "");
    }

    #[test]
    fn scene_with_nothing_associated_returns_empty_context() {
        let data = base_data();
        assert_eq!(build_scene_context(&data, "scene_1"), "");
    }

    #[test]
    fn character_linked_via_linked_scenes_is_included_with_all_fields() {
        let mut data = base_data();
        data.characters.push(character_with_extra(
            "char_1",
            "Elara",
            json!({
                "linked_scenes": ["scene_1"],
                "aliases": ["The Wanderer"],
                "traits": ["brave", "curious"],
                "appearance": "Tall, silver hair.",
                "notes": "Afraid of water."
            }),
        ));

        let ctx = build_scene_context(&data, "scene_1");
        assert!(ctx.contains("=== LORE DES PERSONNAGES ASSOCIÉS À CETTE SCÈNE ==="));
        assert!(ctx.contains("Personnage : Elara"));
        assert!(ctx.contains("Rôle : Protagonist"));
        assert!(ctx.contains("Alias/Surnoms : The Wanderer"));
        assert!(ctx.contains("Traits de caractère : brave, curious"));
        assert!(ctx.contains("Apparence physique : Tall, silver hair."));
        assert!(ctx.contains("Description : A brave hero."));
        assert!(ctx.contains("Notes : Afraid of water."));
    }

    #[test]
    fn character_linked_via_plot_card_is_included() {
        let mut data = base_data();
        data.characters.push(character_with_extra("char_1", "Elara", json!({})));
        data.plot.cards.push(PlotCard {
            id: "card_1".into(),
            plotline_id: "pl_1".into(),
            scene_id: "scene_1".into(),
            title: "Ambush".into(),
            content: "".into(),
            extra: json!({"characters": ["char_1"]}).as_object().cloned().unwrap(),
        });

        let ctx = build_scene_context(&data, "scene_1");
        assert!(ctx.contains("Personnage : Elara"));
    }

    #[test]
    fn character_relations_are_formatted() {
        let mut data = base_data();
        data.characters.push(character_with_extra("char_1", "Elara", json!({
            "linked_scenes": ["scene_1"],
            "relations": [{"target_id": "char_2", "type": "sœur", "description": "protectrice"}]
        })));
        data.characters.push(character_with_extra("char_2", "Mira", json!({})));

        let ctx = build_scene_context(&data, "scene_1");
        assert!(ctx.contains("Relation avec Mira : sœur, protectrice"));
    }

    #[test]
    fn story_note_mentioned_in_scene_content_is_included() {
        let mut data = base_data();
        data.story_notes.push(StoryNote {
            id: "note_1".into(),
            title: "Rusty Anchor".into(),
            note_type: "Location".into(),
            content: "A rowdy dockside tavern.".into(),
            extra: Default::default(),
        });

        let ctx = build_scene_context(&data, "scene_1");
        assert!(ctx.contains("=== LORE DES NOTES ASSOCIÉES À CETTE SCÈNE ==="));
        assert!(ctx.contains("Note : Rusty Anchor"));
        assert!(ctx.contains("Type : Location"));
    }

    #[test]
    fn story_note_not_mentioned_anywhere_is_excluded() {
        let mut data = base_data();
        data.story_notes.push(StoryNote {
            id: "note_1".into(),
            title: "Unrelated Place".into(),
            note_type: "Location".into(),
            content: "Never mentioned.".into(),
            extra: Default::default(),
        });

        assert_eq!(build_scene_context(&data, "scene_1"), "");
    }

    #[test]
    fn note_title_match_is_case_insensitive() {
        let mut data = base_data();
        data.story_notes.push(StoryNote {
            id: "note_1".into(),
            title: "RUSTY ANCHOR".into(),
            note_type: String::new(),
            content: String::new(),
            extra: Default::default(),
        });

        assert!(build_scene_context(&data, "scene_1").contains("Note : RUSTY ANCHOR"));
    }
}
