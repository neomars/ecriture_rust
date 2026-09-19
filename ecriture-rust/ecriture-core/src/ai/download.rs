//! Streams a file to disk over HTTP with progress reporting, and an atomic
//! rename on completion. Ports the download loop in
//! `main.py::_install_gemma_thread` (minus the Python-specific tqdm/ETA
//! bookkeeping, which the caller can derive from the progress callback).

use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("server returned HTTP {0}")]
    HttpStatus(u16),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, DownloadError>;

/// Downloads `url` into `dest`, calling `on_progress(downloaded, total)` as
/// bytes arrive (`total` is `None` when the server doesn't send
/// `Content-Length`). Writes to a `.part` sibling file first and only
/// renames it into place once the transfer completes successfully, so a
/// crashed/interrupted download never leaves a corrupt file at `dest`
/// (mirrors the Python implementation's `os.replace` step).
pub fn download_to_file(
    url: &str,
    dest: &Path,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(None) // this is a large, potentially multi-GB transfer
        .connect_timeout(Duration::from_secs(30))
        .user_agent("Ecriture-App/1.0")
        .build()?;

    let mut response = client.get(url).send()?;
    if !response.status().is_success() {
        return Err(DownloadError::HttpStatus(response.status().as_u16()));
    }
    let total = response.content_length();

    let part_path = part_path(dest);
    let mut file = std::fs::File::create(&part_path)?;

    let mut buf = [0u8; 1024 * 1024];
    let mut downloaded: u64 = 0;
    on_progress(0, total);

    loop {
        let n = response.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        downloaded += n as u64;
        on_progress(downloaded, total);
    }
    file.flush()?;
    drop(file);

    std::fs::rename(&part_path, dest)?;
    Ok(())
}

fn part_path(dest: &Path) -> std::path::PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    dest.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::tempdir;

    /// Spins up a tiny single-request HTTP/1.1 server on loopback that
    /// serves `body` with a `Content-Length` header, so download logic can
    /// be exercised without any real network access.
    fn serve_once(body: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                // Drain the request line/headers (we don't need to parse them).
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                }
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(body);
            }
        });
        format!("http://{addr}/file.bin")
    }

    fn serve_status(status_line: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                }
                let resp = format!("{status_line}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        format!("http://{addr}/missing")
    }

    #[test]
    fn downloads_body_to_dest_and_removes_part_file() {
        let payload: &'static [u8] = b"hello world, this is the model bytes";
        let url = serve_once(payload);
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.gguf");

        let progress_calls = AtomicUsize::new(0);
        download_to_file(&url, &dest, |_downloaded, _total| {
            progress_calls.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), payload);
        assert!(!part_path(&dest).exists());
        assert!(progress_calls.load(Ordering::SeqCst) >= 2); // at least start + one chunk
    }

    #[test]
    fn progress_callback_reports_final_byte_count_and_total() {
        let payload: &'static [u8] = b"0123456789";
        let url = serve_once(payload);
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.gguf");

        let mut last = (0u64, None);
        download_to_file(&url, &dest, |downloaded, total| {
            last = (downloaded, total);
        })
        .unwrap();

        assert_eq!(last, (payload.len() as u64, Some(payload.len() as u64)));
    }

    #[test]
    fn connection_failure_is_reported_as_a_request_error_not_a_panic() {
        // Nothing listens on this port; this is the same failure shape as
        // a network policy rejecting the connection outright (e.g. the
        // huggingface.co CONNECT this sandbox's egress proxy denies), and
        // must surface as an Err, never a panic.
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.gguf");
        let result = download_to_file("http://127.0.0.1:1/unreachable", &dest, |_, _| {});
        assert!(matches!(result, Err(DownloadError::Request(_))));
        assert!(!dest.exists());
    }

    #[test]
    fn http_error_status_is_reported_and_leaves_no_destination_file() {
        let url = serve_status("HTTP/1.1 404 Not Found");
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.gguf");

        let result = download_to_file(&url, &dest, |_, _| {});
        assert!(matches!(result, Err(DownloadError::HttpStatus(404))));
        assert!(!dest.exists());
    }
}
