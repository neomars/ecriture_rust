use crate::project_manager::AppState;
use tauri::State;
use regex::Regex;
use html_escape::encode_text;
use std::io::Write;

pub fn clean_annotations(text: &str) -> String {
    let re = Regex::new(r#"<span[^>]*class="annotation-highlight[^>]*>(.*?)</span>"#).unwrap();
    re.replace_all(text, "$1").to_string()
}

pub fn strip_html(text: &str) -> String {
    let re = Regex::new(r#"<[^>]+>"#).unwrap();
    re.replace_all(text, "").to_string()
}

#[tauri::command]
pub fn export_draft(format: String, state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    let project_lock = state.active_project.lock().unwrap();
    let project = project_lock.as_ref().ok_or("No active project")?;
    let data = &project.data;
    let title = &data.settings.title;

    let mut compiled_text = format!("=== {} ===\n\n", title);
    for chap in &data.manuscript {
        compiled_text.push_str(&format!("\n--- {} ---\n\n", chap.title));
        for scene in &chap.children {
            compiled_text.push_str(&format!("[{}]\n", scene.title));
            let clean_content = clean_annotations(&scene.content);
            let plain_text = strip_html(&clean_content);
            compiled_text.push_str(&format!("{}\n\n", plain_text));
        }
    }

    match format.as_str() {
        "txt" => Ok(compiled_text.into_bytes()),
        "docx" => {
            use docx_rs::*;
            let mut doc = Docx::new()
                .add_paragraph(Paragraph::new().add_run(Run::new().add_text(title.clone()).size(48)));

            for chap in &data.manuscript {
                doc = doc.add_paragraph(Paragraph::new().add_run(Run::new().add_text(chap.title.clone()).size(36)));
                for scene in &chap.children {
                    doc = doc.add_paragraph(Paragraph::new().add_run(Run::new().add_text(scene.title.clone()).size(28)));
                    let clean_content = clean_annotations(&scene.content);
                    // simple text
                    let plain_text = strip_html(&clean_content);
                    for line in plain_text.lines() {
                        if !line.trim().is_empty() {
                            doc = doc.add_paragraph(Paragraph::new().add_run(Run::new().add_text(line.trim())));
                        }
                    }
                }
            }

            let mut cursor = std::io::Cursor::new(Vec::new());
            doc.build().pack(&mut cursor).map_err(|e| e.to_string())?;
            Ok(cursor.into_inner())
        },
        "pdf" => {
            let buffer;
            {
                // Writing to file temporarily since pdf-canvas needs a File
                use pdf_canvas::{Pdf, BuiltinFont};
                let tmp_dir = std::env::temp_dir();
                let tmp_file = tmp_dir.join(format!("draft_{}.pdf", uuid::Uuid::new_v4()));
                let file = std::fs::File::create(&tmp_file).map_err(|e| e.to_string())?;

                let mut document = Pdf::new(file).map_err(|e| e.to_string())?;
                document.render_page(595.0, 842.0, |c| {
                    let font_ref = c.get_font(BuiltinFont::Times_Roman);
                    c.text(|t| {
                        t.set_font(&font_ref, 12.0)?;
                        t.pos(50.0, 800.0)?;
                        t.show(title)?;
                        t.pos(0.0, -20.0)?;

                        for chap in &data.manuscript {
                            t.show(&chap.title)?;
                            t.pos(0.0, -15.0)?;
                            for scene in &chap.children {
                                t.show(&scene.title)?;
                                t.pos(0.0, -15.0)?;
                                let clean_content = clean_annotations(&scene.content);
                                let plain_text = strip_html(&clean_content);
                                for line in plain_text.lines() {
                                    if !line.trim().is_empty() {
                                        t.show(line.trim())?;
                                        t.pos(0.0, -12.0)?;
                                    }
                                }
                            }
                        }
                        Ok(())
                    })
                }).map_err(|e| e.to_string())?;
                document.finish().map_err(|e| e.to_string())?;

                buffer = std::fs::read(&tmp_file).map_err(|e| e.to_string())?;
                let _ = std::fs::remove_file(tmp_file);
            }
            Ok(buffer)
        },
        "odt" => {
            // simple zip generation for odt
            let mut cursor = std::io::Cursor::new(Vec::new());
            {
                let mut zip = zip::ZipWriter::new(&mut cursor);
                let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

                zip.start_file("mimetype", options).unwrap();
                zip.write_all(b"application/vnd.oasis.opendocument.text").unwrap();

                zip.start_file("META-INF/manifest.xml", options).unwrap();
                let manifest = r#"<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
 <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>"#;
                zip.write_all(manifest.as_bytes()).unwrap();

                zip.start_file("content.xml", options).unwrap();
                let mut content = String::from(r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
<office:body><office:text>"#);
                for chap in &data.manuscript {
                    content.push_str(&format!("<text:h text:outline-level=\"1\">{}</text:h>", encode_text(&chap.title)));
                    for scene in &chap.children {
                        content.push_str(&format!("<text:h text:outline-level=\"2\">{}</text:h>", encode_text(&scene.title)));
                        let clean_content = clean_annotations(&scene.content);
                        let plain_text = strip_html(&clean_content);
                        for line in plain_text.lines() {
                            if !line.trim().is_empty() {
                                content.push_str(&format!("<text:p>{}</text:p>", encode_text(line.trim())));
                            }
                        }
                    }
                }
                content.push_str("</office:text></office:body></office:document-content>");
                zip.write_all(content.as_bytes()).unwrap();

                zip.finish().unwrap();
            }
            Ok(cursor.into_inner())
        },
        _ => Err("Unsupported format".to_string())
    }
}
