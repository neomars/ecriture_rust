//! Update-check logic: compares the running version against a fetched
//! GitHub release. Ports `main.py::check_updates`.
//!
//! The actual HTTP call is behind the [`ReleaseFetcher`] trait so the
//! comparison/selection logic can be tested without a network round trip;
//! a Tauri command layer supplies a real fetcher (e.g. backed by
//! `reqwest` or `ureq`).

use serde::{Deserialize, Serialize};

pub const CURRENT_VERSION: &str = "1.0.0";
pub const GITHUB_REPO: &str = "neomars/ecriture";

#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    pub html_url: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

pub trait ReleaseFetcher {
    fn latest_release(&self, repo: &str) -> Result<GithubRelease, String>;
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UpdateStatus {
    pub update_available: bool,
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_page: Option<String>,
}

impl UpdateStatus {
    fn none() -> Self {
        Self {
            update_available: false,
            current_version: CURRENT_VERSION.to_string(),
            latest_version: None,
            download_url: None,
            release_notes: None,
            release_page: None,
        }
    }
}

/// Checks for an update using `fetcher`, never propagating a network
/// failure as an error - like the Python route, any fetch problem just
/// means "no update available" (logged by the caller if desired).
pub fn check_for_update(fetcher: &impl ReleaseFetcher, os_keyword: &str) -> UpdateStatus {
    let Ok(release) = fetcher.latest_release(GITHUB_REPO) else {
        return UpdateStatus::none();
    };

    let latest_tag = release.tag_name.trim_start_matches('v').to_string();

    match compare_versions(&latest_tag, CURRENT_VERSION) {
        Some(std::cmp::Ordering::Greater) => {
            let mut download_url = release.html_url.clone();
            for asset in &release.assets {
                if asset.name.to_lowercase().contains(os_keyword) {
                    download_url = asset.browser_download_url.clone();
                    break;
                }
            }
            UpdateStatus {
                update_available: true,
                current_version: CURRENT_VERSION.to_string(),
                latest_version: Some(latest_tag),
                download_url: Some(download_url),
                release_notes: Some(release.body),
                release_page: Some(release.html_url),
            }
        }
        _ => UpdateStatus::none(),
    }
}

/// Returns the OS keyword used to pick a release asset, matching
/// `main.py::get_os_keyword`.
pub fn os_keyword() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Minimal `major.minor.patch` comparison (missing components default to
/// 0), which is all `packaging.version.parse` needs to do for the plain
/// `X.Y.Z` tags this project uses.
fn compare_versions(a: &str, b: &str) -> Option<std::cmp::Ordering> {
    let parse = |s: &str| -> Vec<u64> {
        s.split(['.', '-', '+'])
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (va, vb) = (parse(a), parse(b));
    let len = va.len().max(vb.len());
    for i in 0..len {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            std::cmp::Ordering::Equal => continue,
            other => return Some(other),
        }
    }
    Some(std::cmp::Ordering::Equal)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockFetcher(Result<GithubRelease, String>);
    impl ReleaseFetcher for MockFetcher {
        fn latest_release(&self, _repo: &str) -> Result<GithubRelease, String> {
            self.0.clone()
        }
    }

    fn release(tag: &str, assets: Vec<ReleaseAsset>) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            html_url: "https://example.com/release".into(),
            body: "notes".into(),
            assets,
        }
    }

    #[test]
    fn compare_versions_orders_correctly() {
        assert_eq!(compare_versions("1.2.0", "1.10.0"), Some(std::cmp::Ordering::Less));
        assert_eq!(compare_versions("2.0.0", "1.9.9"), Some(std::cmp::Ordering::Greater));
        assert_eq!(compare_versions("1.0.0", "1.0.0"), Some(std::cmp::Ordering::Equal));
        assert_eq!(compare_versions("1.0", "1.0.0"), Some(std::cmp::Ordering::Equal));
    }

    #[test]
    fn newer_release_reports_update_available() {
        let fetcher = MockFetcher(Ok(release("v1.1.0", vec![])));
        let status = check_for_update(&fetcher, "linux");
        assert!(status.update_available);
        assert_eq!(status.latest_version.as_deref(), Some("1.1.0"));
        assert_eq!(status.download_url.as_deref(), Some("https://example.com/release"));
    }

    #[test]
    fn matching_os_asset_is_preferred_over_the_release_page() {
        let fetcher = MockFetcher(Ok(release(
            "v1.1.0",
            vec![
                ReleaseAsset { name: "ecriture-windows-x64.zip".into(), browser_download_url: "win".into() },
                ReleaseAsset { name: "ecriture-linux-x64.tar.gz".into(), browser_download_url: "lin".into() },
            ],
        )));
        let status = check_for_update(&fetcher, "linux");
        assert_eq!(status.download_url.as_deref(), Some("lin"));
    }

    #[test]
    fn same_or_older_release_reports_no_update() {
        let fetcher = MockFetcher(Ok(release("v1.0.0", vec![])));
        assert!(!check_for_update(&fetcher, "linux").update_available);

        let fetcher_old = MockFetcher(Ok(release("v0.9.0", vec![])));
        assert!(!check_for_update(&fetcher_old, "linux").update_available);
    }

    #[test]
    fn fetch_failure_is_treated_as_no_update_available() {
        let fetcher = MockFetcher(Err("network down".into()));
        let status = check_for_update(&fetcher, "linux");
        assert!(!status.update_available);
        assert_eq!(status.current_version, CURRENT_VERSION);
    }
}
