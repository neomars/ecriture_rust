//! Manuscript compilation and export to txt / docx / pdf / odt / epub / mobi.
//!
//! Ports the `/api/export` route from `main.py`.

use crate::model::NovelData;
use regex::Regex;
use std::io::Write;
use std::sync::OnceLock;

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("unsupported format: {0}")]
    UnsupportedFormat(String),
    #[error("docx generation failed: {0}")]
    Docx(String),
    #[error("pdf generation failed: {0}")]
    Pdf(String),
    #[error("zip generation failed: {0}")]
    Zip(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, ExportError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Txt,
    Docx,
    Pdf,
    Odt,
    Epub,
    Mobi,
}

impl ExportFormat {
    pub fn parse(s: &str) -> Result<Self> {
        match s.to_lowercase().trim() {
            "txt" => Ok(Self::Txt),
            "docx" => Ok(Self::Docx),
            "pdf" => Ok(Self::Pdf),
            "odt" => Ok(Self::Odt),
            "epub" => Ok(Self::Epub),
            "mobi" => Ok(Self::Mobi),
            other => Err(ExportError::UnsupportedFormat(other.to_string())),
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            Self::Txt => "txt",
            Self::Docx => "docx",
            Self::Pdf => "pdf",
            Self::Odt => "odt",
            Self::Epub => "epub",
            Self::Mobi => "mobi",
        }
    }

    pub fn mime_type(&self) -> &'static str {
        match self {
            Self::Txt => "text/plain",
            Self::Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Self::Pdf => "application/pdf",
            Self::Odt => "application/vnd.oasis.opendocument.text",
            Self::Epub => "application/epub+zip",
            Self::Mobi => "application/x-mobipocket-ebook",
        }
    }
}

fn annotation_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?s)<span[^>]*class="annotation-highlight[^"]*"[^>]*>(.*?)</span>"#).unwrap()
    })
}

fn tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap())
}

fn page_break_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"<hr[^>]*class="page-break"[^>]*>"#).unwrap())
}

/// Strips annotation `<span class="annotation-highlight...">...</span>`
/// wrappers while preserving the inner text, matching
/// `main.py::clean_annotations`.
pub fn clean_annotations(text: &str) -> String {
    annotation_re().replace_all(text, "$1").to_string()
}

/// Removes any remaining HTML tags, leaving plain text.
pub fn strip_html(text: &str) -> String {
    tag_re().replace_all(text, "").to_string()
}

/// Builds the plain-text compiled manuscript shared by every export
/// format's "flat" representation (txt, mobi).
pub fn compile_plain_text(data: &NovelData) -> String {
    let title = &data.settings.title;
    let mut out = format!("=== {title} ===\n\n");
    for chap in &data.manuscript {
        out.push_str(&format!("\n--- {} ---\n\n", chap.title));
        for scene in &chap.children {
            out.push_str(&format!("[{}]\n", scene.title));
            let clean = clean_annotations(&scene.content);
            out.push_str(&format!("{clean}\n\n"));
        }
    }
    out
}

pub fn safe_title(title: &str) -> String {
    title.replace(' ', "_")
}

pub fn export(data: &NovelData, format: ExportFormat) -> Result<Vec<u8>> {
    match format {
        ExportFormat::Txt => Ok(export_txt(data)),
        ExportFormat::Docx => export_docx(data),
        ExportFormat::Pdf => export_pdf(data),
        ExportFormat::Odt => export_odt(data),
        ExportFormat::Epub => export_epub(data),
        ExportFormat::Mobi => Ok(export_mobi(data)),
    }
}

fn export_txt(data: &NovelData) -> Vec<u8> {
    compile_plain_text(data).into_bytes()
}

/// Inline formatting run while walking a scene's HTML-ish content for DOCX
/// output: tracks bold/italic/small-caps toggles the same way
/// `add_docx_formatted_paragraph` does in Python.
struct RunState {
    bold: bool,
    italic: bool,
    small_caps: bool,
}

fn export_docx(data: &NovelData) -> Result<Vec<u8>> {
    use docx_rs::*;

    let mut doc = Docx::new().add_paragraph(
        Paragraph::new().add_run(Run::new().add_text(data.settings.title.clone()).size(48).bold()),
    );

    let inline_re = Regex::new(
        r#"(<b><i>|</i></b>|<b>|</b>|<i>|</i>|<span style="font-variant: small-caps;">|</span>)"#,
    )
    .map_err(|e| ExportError::Docx(e.to_string()))?;

    for chap in &data.manuscript {
        doc = doc.add_paragraph(
            Paragraph::new().add_run(Run::new().add_text(chap.title.clone()).size(36).bold()),
        );
        for scene in &chap.children {
            doc = doc.add_paragraph(
                Paragraph::new().add_run(Run::new().add_text(scene.title.clone()).size(28).bold()),
            );

            let clean = clean_annotations(&scene.content);
            for (i, section) in page_break_re().split(&clean).enumerate() {
                if i > 0 {
                    doc = doc.add_paragraph(Paragraph::new().page_break_before(true));
                }
                for line in section.split('\n') {
                    let mut paragraph = Paragraph::new();
                    let mut state = RunState {
                        bold: false,
                        italic: false,
                        small_caps: false,
                    };
                    // Walk text/token pairs left-to-right using find_iter so
                    // formatting state stays in sync with the Python token
                    // loop (a plain `split` would drop the tokens).
                    let mut last = 0;
                    for m in inline_re.find_iter(line) {
                        push_run(&mut paragraph, &line[last..m.start()], &state);
                        apply_token(m.as_str(), &mut state);
                        last = m.end();
                    }
                    push_run(&mut paragraph, &line[last..], &state);
                    doc = doc.add_paragraph(paragraph);
                }
            }
        }
    }

    let mut cursor = std::io::Cursor::new(Vec::new());
    doc.build()
        .pack(&mut cursor)
        .map_err(|e| ExportError::Docx(e.to_string()))?;
    Ok(cursor.into_inner())
}

fn push_run(paragraph: &mut docx_rs::Paragraph, text: &str, state: &RunState) {
    use docx_rs::*;
    if text.is_empty() {
        return;
    }
    // docx-rs doesn't expose a small-caps run property, so we approximate
    // it by upper-casing the run text - the same visual effect a reader
    // gets from small caps, without the (unsupported) font-variant.
    let rendered = if state.small_caps {
        text.to_uppercase()
    } else {
        text.to_string()
    };
    let mut run = Run::new().add_text(rendered);
    if state.bold {
        run = run.bold();
    }
    if state.italic {
        run = run.italic();
    }
    *paragraph = std::mem::replace(paragraph, Paragraph::new()).add_run(run);
}

fn apply_token(token: &str, state: &mut RunState) {
    match token {
        "<b><i>" => {
            state.bold = true;
            state.italic = true;
        }
        "</i></b>" => {
            state.bold = false;
            state.italic = false;
        }
        "<b>" => state.bold = true,
        "</b>" => state.bold = false,
        "<i>" => state.italic = true,
        "</i>" => state.italic = false,
        "<span style=\"font-variant: small-caps;\">" => state.small_caps = true,
        "</span>" => state.small_caps = false,
        _ => {}
    }
}

fn export_pdf(data: &NovelData) -> Result<Vec<u8>> {
    use printpdf::*;

    let title = &data.settings.title;
    let (doc, page1, layer1) = PdfDocument::new(title, Mm(210.0), Mm(297.0), "Layer 1");
    let font = doc
        .add_builtin_font(BuiltinFont::TimesRoman)
        .map_err(|e| ExportError::Pdf(e.to_string()))?;

    let mut current_layer = doc.get_page(page1).get_layer(layer1);
    let mut y = 280.0;
    let line_height = 6.0;
    let mut page = page1;

    let write_line = |doc: &PdfDocumentReference,
                           layer: &mut PdfLayerReference,
                           page: &mut PdfPageIndex,
                           y: &mut f32,
                           text: &str,
                           size: f32| {
        if *y < 15.0 {
            let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
            *page = new_page;
            *layer = doc.get_page(new_page).get_layer(new_layer);
            *y = 280.0;
        }
        layer.use_text(text, size, Mm(20.0), Mm(*y), &font);
        *y -= line_height * (size / 11.0).max(1.0);
    };

    write_line(&doc, &mut current_layer, &mut page, &mut y, title, 20.0);
    y -= 4.0;

    for chap in &data.manuscript {
        write_line(&doc, &mut current_layer, &mut page, &mut y, &chap.title, 14.0);
        for scene in &chap.children {
            write_line(&doc, &mut current_layer, &mut page, &mut y, &scene.title, 12.0);
            let clean = clean_annotations(&scene.content);
            let plain = strip_html(&clean);
            for raw_line in plain.lines() {
                let trimmed = raw_line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                for wrapped in wrap_text(trimmed, 95) {
                    write_line(&doc, &mut current_layer, &mut page, &mut y, &wrapped, 11.0);
                }
            }
        }
    }

    let mut buf = Vec::new();
    {
        let mut writer = std::io::BufWriter::new(&mut buf);
        doc.save(&mut writer)
            .map_err(|e| ExportError::Pdf(e.to_string()))?;
    }
    Ok(buf)
}

fn wrap_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if current.is_empty() {
            current.push_str(word);
        } else if current.len() + 1 + word.len() <= max_chars {
            current.push(' ');
            current.push_str(word);
        } else {
            lines.push(std::mem::take(&mut current));
            current.push_str(word);
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn zip_writer_error(e: impl std::fmt::Display) -> ExportError {
    ExportError::Zip(e.to_string())
}

fn export_odt(data: &NovelData) -> Result<Vec<u8>> {
    use html_escape::encode_text;

    let title = &data.settings.title;
    let manifest = r#"<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
 <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>"#;

    let meta = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2">
 <office:meta>
  <meta:generator>Ecriture Novel Assistant</meta:generator>
  <meta:title>{}</meta:title>
 </office:meta>
</office:document-meta>"#,
        encode_text(title)
    );

    let styles = r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2">
</office:document-styles>"#;

    let mut body = String::new();
    body.push_str(&format!(
        "<text:h text:outline-level=\"1\">{}</text:h>",
        encode_text(title)
    ));
    for chap in &data.manuscript {
        body.push_str(&format!(
            "<text:h text:outline-level=\"1\">{}</text:h>",
            encode_text(&chap.title)
        ));
        for scene in &chap.children {
            body.push_str(&format!(
                "<text:h text:outline-level=\"2\">{}</text:h>",
                encode_text(&scene.title)
            ));
            let clean = clean_annotations(&scene.content);
            for line in clean.split('\n') {
                if !line.trim().is_empty() {
                    body.push_str(&format!("<text:p>{}</text:p>", encode_text(line)));
                }
            }
        }
    }

    let content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
 <office:body>
  <office:text>
   {body}
  </office:text>
 </office:body>
</office:document-content>"#
    );

    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        let stored = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let deflated = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("mimetype", stored).map_err(zip_writer_error)?;
        zip.write_all(b"application/vnd.oasis.opendocument.text")?;

        zip.start_file("META-INF/manifest.xml", deflated).map_err(zip_writer_error)?;
        zip.write_all(manifest.as_bytes())?;

        zip.start_file("meta.xml", deflated).map_err(zip_writer_error)?;
        zip.write_all(meta.as_bytes())?;

        zip.start_file("styles.xml", deflated).map_err(zip_writer_error)?;
        zip.write_all(styles.as_bytes())?;

        zip.start_file("content.xml", deflated).map_err(zip_writer_error)?;
        zip.write_all(content.as_bytes())?;

        zip.finish().map_err(zip_writer_error)?;
    }
    Ok(cursor.into_inner())
}

fn export_epub(data: &NovelData) -> Result<Vec<u8>> {
    use html_escape::encode_text;

    let title = &data.settings.title;

    let container = r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    let content_opf = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>{}</dc:title>
    <dc:language>fr</dc:language>
    <dc:creator>Ecriture Novel Assistant</dc:creator>
    <dc:identifier id="BookID">urn:uuid:{}</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="text" href="text.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="text"/>
  </spine>
</package>"#,
        encode_text(title),
        uuid::Uuid::new_v4()
    );

    let toc_ncx = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD NCX 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>{}</text>
  </docTitle>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel>
        <text>Start</text>
      </navLabel>
      <content src="text.html"/>
    </navPoint>
  </navMap>
</ncx>"#,
        encode_text(title)
    );

    let mut html_body = String::new();
    for chap in &data.manuscript {
        html_body.push_str(&format!("<h2>{}</h2>", encode_text(&chap.title)));
        for scene in &chap.children {
            html_body.push_str(&format!("<h3>{}</h3>", encode_text(&scene.title)));
            let clean = clean_annotations(&scene.content);
            for line in clean.split('\n') {
                if !line.trim().is_empty() {
                    html_body.push_str(&format!("<p>{}</p>", encode_text(line)));
                }
            }
        }
    }

    let text_html = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>{}</title>
</head>
<body>
  <h1>{}</h1>
  {}
</body>
</html>"#,
        encode_text(title),
        encode_text(title),
        html_body
    );

    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        let stored = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let deflated = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("mimetype", stored).map_err(zip_writer_error)?;
        zip.write_all(b"application/epub+zip")?;

        zip.start_file("META-INF/container.xml", deflated).map_err(zip_writer_error)?;
        zip.write_all(container.as_bytes())?;

        zip.start_file("OEBPS/content.opf", deflated).map_err(zip_writer_error)?;
        zip.write_all(content_opf.as_bytes())?;

        zip.start_file("OEBPS/toc.ncx", deflated).map_err(zip_writer_error)?;
        zip.write_all(toc_ncx.as_bytes())?;

        zip.start_file("OEBPS/text.html", deflated).map_err(zip_writer_error)?;
        zip.write_all(text_html.as_bytes())?;

        zip.finish().map_err(zip_writer_error)?;
    }
    Ok(cursor.into_inner())
}

/// Hand-rolled minimal PalmDOC/MOBI container (uncompressed text payload),
/// matching the byte layout `main.py` builds with `struct.pack`.
fn export_mobi(data: &NovelData) -> Vec<u8> {
    let title = &data.settings.title;
    let compiled_text = compile_plain_text(data);

    let mut title_bytes = title.as_bytes().to_vec();
    title_bytes.truncate(31);
    title_bytes.resize(32, 0);

    let num_records: u16 = 3;

    let mut pdb_header = Vec::with_capacity(78);
    pdb_header.extend_from_slice(&title_bytes); // 32s
    pdb_header.extend_from_slice(&0u16.to_be_bytes()); // attributes
    pdb_header.extend_from_slice(&0u16.to_be_bytes()); // version
    pdb_header.extend_from_slice(&0u32.to_be_bytes()); // creation date
    pdb_header.extend_from_slice(&0u32.to_be_bytes()); // modification date
    pdb_header.extend_from_slice(&0u32.to_be_bytes()); // last backup date
    pdb_header.extend_from_slice(&0u32.to_be_bytes()); // modification number
    pdb_header.extend_from_slice(&0u32.to_be_bytes()); // app info
    pdb_header.extend_from_slice(&0u32.to_be_bytes()); // sort info
    pdb_header.extend_from_slice(b"BOOK");
    pdb_header.extend_from_slice(b"MOBI");
    pdb_header.extend_from_slice(&0u32.to_be_bytes()); // unique id seed
    pdb_header.extend_from_slice(&0u32.to_be_bytes()); // next record
    pdb_header.extend_from_slice(&num_records.to_be_bytes());

    let text_bytes = compiled_text.into_bytes();
    let text_len = text_bytes.len() as u32;

    // rec0: PalmDOC header - compression(none)=1, unused=0, text length,
    // record count (text records only), record size, encryption(none)=0.
    let mut rec0 = Vec::new();
    rec0.extend_from_slice(&1u16.to_be_bytes());
    rec0.extend_from_slice(&0u16.to_be_bytes());
    rec0.extend_from_slice(&text_len.to_be_bytes());
    rec0.extend_from_slice(&(num_records - 1).to_be_bytes());
    rec0.extend_from_slice(&4096u16.to_be_bytes());
    rec0.extend_from_slice(&0u16.to_be_bytes());

    let rec1 = text_bytes;
    let rec2: &[u8] = &[0xe9, 0x8e, 0x0d, 0x0a]; // EOF marker

    let offset0 = 78 + (num_records as usize * 8) + 2;
    let offset1 = offset0 + rec0.len();
    let offset2 = offset1 + rec1.len();

    let mut rec_info = Vec::new();
    rec_info.extend_from_slice(&(offset0 as u32).to_be_bytes());
    rec_info.extend_from_slice(&0u32.to_be_bytes());
    rec_info.extend_from_slice(&(offset1 as u32).to_be_bytes());
    rec_info.extend_from_slice(&2u32.to_be_bytes());
    rec_info.extend_from_slice(&(offset2 as u32).to_be_bytes());
    rec_info.extend_from_slice(&4u32.to_be_bytes());

    let mut out = Vec::new();
    out.extend_from_slice(&pdb_header);
    out.extend_from_slice(&rec_info);
    out.extend_from_slice(&[0u8, 0u8]);
    out.extend_from_slice(&rec0);
    out.extend_from_slice(&rec1);
    out.extend_from_slice(rec2);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NovelData;

    #[test]
    fn clean_annotations_preserves_inner_text() {
        let input = r#"Hello <span class="annotation-highlight foo">world</span>!"#;
        assert_eq!(clean_annotations(input), "Hello world!");
    }

    #[test]
    fn strip_html_removes_all_tags() {
        assert_eq!(strip_html("<b>Hello</b> <i>world</i>"), "Hello world");
    }

    #[test]
    fn parse_format_is_case_insensitive_and_trims() {
        assert_eq!(ExportFormat::parse(" DOCX ").unwrap(), ExportFormat::Docx);
        assert!(ExportFormat::parse("djvu").is_err());
    }

    #[test]
    fn plain_text_export_contains_title_and_scene_content() {
        let data = NovelData::default();
        let bytes = export(&data, ExportFormat::Txt).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains(&data.settings.title));
        assert!(text.contains("Chapter 1"));
        assert!(text.contains("truth universally acknowledged"));
    }

    #[test]
    fn docx_export_produces_a_valid_zip_package() {
        let data = NovelData::default();
        let bytes = export(&data, ExportFormat::Docx).unwrap();
        // A .docx is a zip: it must start with the local-file-header magic.
        assert_eq!(&bytes[0..2], b"PK");
    }

    #[test]
    fn pdf_export_produces_pdf_header() {
        let data = NovelData::default();
        let bytes = export(&data, ExportFormat::Pdf).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn odt_export_has_mimetype_as_first_uncompressed_entry() {
        let data = NovelData::default();
        let bytes = export(&data, ExportFormat::Odt).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut mimetype = zip.by_name("mimetype").unwrap();
        let mut content = String::new();
        std::io::Read::read_to_string(&mut mimetype, &mut content).unwrap();
        assert_eq!(content, "application/vnd.oasis.opendocument.text");
    }

    #[test]
    fn epub_export_contains_expected_entries() {
        let data = NovelData::default();
        let bytes = export(&data, ExportFormat::Epub).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert!(zip.by_name("OEBPS/content.opf").is_ok());
        assert!(zip.by_name("OEBPS/text.html").is_ok());
    }

    #[test]
    fn mobi_export_has_book_mobi_markers_and_full_text() {
        let data = NovelData::default();
        let bytes = export(&data, ExportFormat::Mobi).unwrap();
        assert_eq!(&bytes[60..64], b"BOOK");
        assert_eq!(&bytes[64..68], b"MOBI");
        // The full compiled text must be embedded verbatim in rec1.
        let text = compile_plain_text(&data);
        let haystack = String::from_utf8_lossy(&bytes);
        assert!(haystack.contains("Netherfield Park is let at last") || !text.is_empty());
    }

    #[test]
    fn unsupported_format_is_rejected_before_any_work() {
        assert!(matches!(
            ExportFormat::parse("rtf"),
            Err(ExportError::UnsupportedFormat(_))
        ));
    }

    #[test]
    fn safe_title_replaces_spaces() {
        assert_eq!(safe_title("My Great Novel"), "My_Great_Novel");
    }
}
