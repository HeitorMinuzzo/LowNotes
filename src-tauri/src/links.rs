use std::{fs, path::{Path, PathBuf}};

use anyhow::bail;
use serde::{Deserialize, Serialize};

use crate::vault;

pub const LINKS_VERSION: u8 = 1;
pub const LINKS_REL_PATH: &str = ".lownotes/links.json";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
#[allow(non_camel_case_types)]
pub enum LinkOrigin {
    wikilink,
    manual,
    agent,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
#[allow(non_camel_case_types)]
pub enum LinkAction {
    add,
    remove,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LinkEdge {
    pub source: String,
    pub target: String,
    pub origin: LinkOrigin,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LinkOperation {
    pub source: String,
    pub target: String,
    pub action: LinkAction,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LinkStore {
    pub version: u8,
    #[serde(default)]
    pub links: Vec<LinkEdge>,
}

impl Default for LinkStore {
    fn default() -> Self {
        Self {
            version: LINKS_VERSION,
            links: Vec::new(),
        }
    }
}

impl LinkStore {
    pub fn new() -> Self {
        Self::default()
    }
}

pub fn links_path(vault: &Path) -> PathBuf {
    vault.join(".lownotes").join("links.json")
}

/// Load the link store. Missing or corrupted file yields an empty store (version 1).
pub fn load_links(vault: &Path) -> LinkStore {
    fs::read_to_string(links_path(vault))
        .ok()
        .and_then(|raw| serde_json::from_str::<LinkStore>(&raw).ok())
        .unwrap_or_default()
}

pub fn save_links(vault: &Path, store: &LinkStore) -> anyhow::Result<()> {
    let path = links_path(vault);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(store)?;
    fs::write(path, json)?;
    Ok(())
}

/// Scan `[[...]]` tokens, skipping fenced code blocks and inline code spans.
/// Returns `(token, span_start, span_end)` with byte offsets into `content`.
fn wikilink_spans(content: &str) -> Vec<(String, usize, usize)> {
    let mut spans = Vec::new();
    let mut in_fence = false;
    let mut line_offset = 0usize;

    for line in content.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            line_offset += line.len();
            continue;
        }
        if in_fence {
            line_offset += line.len();
            continue;
        }

        let b = line.as_bytes();
        let mut i = 0usize;
        while i < b.len() {
            if b[i] == b'`' {
                // Inline code span: opening backtick run closes on a run of equal length.
                let mut run = 0usize;
                let mut j = i;
                while j < b.len() && b[j] == b'`' {
                    run += 1;
                    j += 1;
                }
                let mut k = j;
                let mut closed_at = None;
                while k < b.len() {
                    if b[k] == b'`' {
                        let mut run2 = 0usize;
                        while k < b.len() && b[k] == b'`' {
                            run2 += 1;
                            k += 1;
                        }
                        if run2 == run {
                            closed_at = Some(k);
                            break;
                        }
                    } else {
                        k += 1;
                    }
                }
                // Unterminated backtick run: treat the rest of the line as code.
                i = closed_at.unwrap_or(b.len());
                continue;
            }

            if b[i] == b'[' && i + 1 < b.len() && b[i + 1] == b'[' {
                let inner_start = i + 2;
                let mut j = inner_start;
                let mut end = None;
                while j + 1 < b.len() {
                    if b[j] == b']' && b[j + 1] == b']' {
                        end = Some(j);
                        break;
                    }
                    j += 1;
                }
                if let Some(end) = end {
                    let token = line[inner_start..end].trim().to_string();
                    if !token.is_empty() {
                        spans.push((token, line_offset + i, line_offset + end + 2));
                    }
                    i = end + 2;
                    continue;
                }
                i += 2;
                continue;
            }

            i += 1;
        }

        line_offset += line.len();
    }

    spans
}

/// Extract wikilink tokens from note content, deduplicated, preserving order.
pub fn extract_wikilinks(content: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (token, _, _) in wikilink_spans(content) {
        if !out.iter().any(|t| *t == token) {
            out.push(token);
        }
    }
    out
}

/// Resolve a wikilink token to an existing note path (relative, `/` separators).
/// Matches case-insensitive title, exact path, or path equal to `token + ".md"`.
pub fn resolve_link_target(vault: &Path, token: &str) -> Option<String> {
    let clean = token.trim().replace('\\', "/");
    if clean.is_empty() {
        return None;
    }
    let lower = clean.to_lowercase();
    let items = vault::list_vault_items(vault).ok()?;

    for item in items.iter().filter(|i| !i.is_dir) {
        if item.title.to_lowercase() == lower {
            return Some(item.path.clone());
        }
    }
    for item in items.iter().filter(|i| !i.is_dir) {
        let path_lower = item.path.to_lowercase();
        if path_lower == lower || path_lower == format!("{lower}.md") {
            return Some(item.path.clone());
        }
    }
    None
}

/// Rebuild wikilink-origin edges for `source` from its current content.
/// Manual/agent edges are never touched. Saves only when the store changed.
pub fn reconcile_wikilinks(vault: &Path, source: &str, content: &str) -> anyhow::Result<()> {
    let mut store = load_links(vault);
    let before = store.links.clone();

    store
        .links
        .retain(|e| !(e.origin == LinkOrigin::wikilink && e.source == source));

    for token in extract_wikilinks(content) {
        let Some(target) = resolve_link_target(vault, &token) else {
            continue;
        };
        if target == source {
            continue;
        }
        if store
            .links
            .iter()
            .any(|e| e.source == source && e.target == target)
        {
            continue;
        }
        store.links.push(LinkEdge {
            source: source.to_string(),
            target,
            origin: LinkOrigin::wikilink,
        });
    }

    if store.links != before {
        save_links(vault, &store)?;
    }
    Ok(())
}

fn validate_note(vault: &Path, relative: &str) -> anyhow::Result<()> {
    let full = vault::safe_join(vault, relative)?;
    if !full.is_file() || !vault::is_markdown(&full) {
        bail!("errors.noteNotFound");
    }
    Ok(())
}

/// Remove the first `[[token]]` occurrence whose token resolves to `target`.
fn strip_wikilink_to(vault: &Path, content: &str, target: &str) -> Option<String> {
    for (token, start, end) in wikilink_spans(content) {
        if resolve_link_target(vault, &token).as_deref() == Some(target) {
            let mut updated = String::with_capacity(content.len());
            updated.push_str(&content[..start]);
            updated.push_str(&content[end..]);
            return Some(updated);
        }
    }
    None
}

/// Apply add/remove link operations. Removing a wikilink-origin edge also strips
/// the matching `[[...]]` token from the source note content and re-reconciles.
pub fn apply_operations(
    vault: &Path,
    ops: &[LinkOperation],
    origin: LinkOrigin,
) -> anyhow::Result<()> {
    for op in ops {
        validate_note(vault, &op.source)?;
        validate_note(vault, &op.target)?;
    }

    let mut store = load_links(vault);
    let mut wikilink_removals: Vec<(String, String)> = Vec::new();

    for op in ops {
        match op.action {
            LinkAction::add => {
                let exists = store
                    .links
                    .iter()
                    .any(|e| e.source == op.source && e.target == op.target);
                if !exists {
                    store.links.push(LinkEdge {
                        source: op.source.clone(),
                        target: op.target.clone(),
                        origin: origin.clone(),
                    });
                }
            }
            LinkAction::remove => {
                let had_wikilink = store.links.iter().any(|e| {
                    e.source == op.source
                        && e.target == op.target
                        && e.origin == LinkOrigin::wikilink
                });
                store
                    .links
                    .retain(|e| !(e.source == op.source && e.target == op.target));
                if had_wikilink {
                    wikilink_removals.push((op.source.clone(), op.target.clone()));
                }
            }
        }
    }

    save_links(vault, &store)?;

    for (source, target) in &wikilink_removals {
        let Ok(content) = vault::read_note(vault, source) else {
            continue;
        };
        let Some(updated) = strip_wikilink_to(vault, &content, target) else {
            continue;
        };
        if let Err(e) = vault::save_note(vault, source, &updated) {
            eprintln!("apply_operations: failed to strip wikilink in {source}: {e}");
            continue;
        }
        if let Err(e) = reconcile_wikilinks(vault, source, &updated) {
            eprintln!("apply_operations: reconcile failed for {source}: {e}");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lownotes-links-test-{}-{tag}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_link_store_roundtrip() {
        let vault = temp_vault("roundtrip");
        // Missing file => empty store, version 1.
        let empty = load_links(&vault);
        assert_eq!(empty.version, 1);
        assert!(empty.links.is_empty());

        let store = LinkStore {
            version: LINKS_VERSION,
            links: vec![
                LinkEdge {
                    source: "a.md".to_string(),
                    target: "b.md".to_string(),
                    origin: LinkOrigin::wikilink,
                },
                LinkEdge {
                    source: "a.md".to_string(),
                    target: "c.md".to_string(),
                    origin: LinkOrigin::manual,
                },
                LinkEdge {
                    source: "b.md".to_string(),
                    target: "c.md".to_string(),
                    origin: LinkOrigin::agent,
                },
            ],
        };
        save_links(&vault, &store).unwrap();
        assert!(links_path(&vault).is_file());
        let loaded = load_links(&vault);
        assert_eq!(loaded, store);

        // Corrupted file => empty store, version 1.
        fs::write(links_path(&vault), "{ not json").unwrap();
        let corrupt = load_links(&vault);
        assert_eq!(corrupt.version, 1);
        assert!(corrupt.links.is_empty());

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn test_extract_wikilinks_skips_code() {
        let content = "\
# Title\n\
Link to [[Alpha]] and [[beta note]] and again [[Alpha]].\n\
Inline `code with [[NotALink]]` stays out.\n\
```md\n\
fenced [[AlsoNotALink]]\n\
```\n\
After fence [[Gamma]].\n";
        let tokens = extract_wikilinks(content);
        assert_eq!(tokens, vec!["Alpha", "beta note", "Gamma"]);
    }

    #[test]
    fn test_reconcile_wikilinks_keeps_manual_and_agent() {
        let vault = temp_vault("reconcile");
        fs::write(vault.join("a.md"), "# A\n\nSee [[B]].\n").unwrap();
        fs::write(vault.join("b.md"), "# B\n").unwrap();

        // Seed a manual edge that must survive reconciliation.
        let seeded = LinkStore {
            version: LINKS_VERSION,
            links: vec![LinkEdge {
                source: "a.md".to_string(),
                target: "b.md".to_string(),
                origin: LinkOrigin::manual,
            }],
        };
        save_links(&vault, &seeded).unwrap();

        reconcile_wikilinks(&vault, "a.md", &fs::read_to_string(vault.join("a.md")).unwrap())
            .unwrap();
        let store = load_links(&vault);
        // Pair already exists (manual) so no duplicate wikilink edge is added.
        assert_eq!(store.links.len(), 1);
        assert_eq!(store.links[0].origin, LinkOrigin::manual);

        // Remove the manual edge, reconcile adds the wikilink one.
        save_links(&vault, &LinkStore::new()).unwrap();
        reconcile_wikilinks(&vault, "a.md", "See [[B]] and [[Missing Note]].").unwrap();
        let store = load_links(&vault);
        assert_eq!(
            store.links,
            vec![LinkEdge {
                source: "a.md".to_string(),
                target: "b.md".to_string(),
                origin: LinkOrigin::wikilink,
            }]
        );

        // Content without the wikilink removes the edge.
        reconcile_wikilinks(&vault, "a.md", "No links here.").unwrap();
        let store = load_links(&vault);
        assert!(store.links.is_empty());

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn test_apply_operations_add_and_remove_strips_token() {
        let vault = temp_vault("apply");
        fs::write(vault.join("a.md"), "# A\n\nSee [[B]] for details.\n").unwrap();
        fs::write(vault.join("b.md"), "# B\n").unwrap();
        fs::write(vault.join("c.md"), "# C\n").unwrap();

        // Add manual edge a -> c.
        apply_operations(
            &vault,
            &[LinkOperation {
                source: "a.md".to_string(),
                target: "c.md".to_string(),
                action: LinkAction::add,
            }],
            LinkOrigin::manual,
        )
        .unwrap();
        // Adding the same pair again is ignored (no duplicates).
        apply_operations(
            &vault,
            &[LinkOperation {
                source: "a.md".to_string(),
                target: "c.md".to_string(),
                action: LinkAction::add,
            }],
            LinkOrigin::agent,
        )
        .unwrap();
        let store = load_links(&vault);
        assert_eq!(store.links.len(), 1);
        assert_eq!(store.links[0].origin, LinkOrigin::manual);

        // Reconcile wikilink a -> b, then remove it via operations: the
        // [[B]] token must disappear from a.md and the edge from the store.
        reconcile_wikilinks(&vault, "a.md", &fs::read_to_string(vault.join("a.md")).unwrap())
            .unwrap();
        assert!(load_links(&vault)
            .links
            .iter()
            .any(|e| e.target == "b.md" && e.origin == LinkOrigin::wikilink));

        apply_operations(
            &vault,
            &[LinkOperation {
                source: "a.md".to_string(),
                target: "b.md".to_string(),
                action: LinkAction::remove,
            }],
            LinkOrigin::manual,
        )
        .unwrap();

        let store = load_links(&vault);
        assert!(!store.links.iter().any(|e| e.target == "b.md"));
        // Manual edge untouched.
        assert!(store
            .links
            .iter()
            .any(|e| e.target == "c.md" && e.origin == LinkOrigin::manual));
        let content = fs::read_to_string(vault.join("a.md")).unwrap();
        assert!(!content.contains("[[B]]"));
        assert!(content.contains("for details."));

        // Validation: unknown note fails.
        let err = apply_operations(
            &vault,
            &[LinkOperation {
                source: "a.md".to_string(),
                target: "nope.md".to_string(),
                action: LinkAction::add,
            }],
            LinkOrigin::manual,
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "errors.noteNotFound");

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn test_build_manifest_includes_links_file() {
        let vault = temp_vault("manifest");
        fs::write(vault.join("a.md"), "# A\n").unwrap();
        let store = LinkStore {
            version: LINKS_VERSION,
            links: vec![LinkEdge {
                source: "a.md".to_string(),
                target: "a.md".to_string(),
                origin: LinkOrigin::manual,
            }],
        };
        save_links(&vault, &store).unwrap();

        let manifest = vault::build_manifest(&vault).unwrap();
        let meta = manifest
            .get(LINKS_REL_PATH)
            .expect("links.json missing from manifest");
        assert_eq!(meta.path, LINKS_REL_PATH);
        assert!(!meta.hash.is_empty());
        assert!(meta.size > 0);

        // UI listing must NOT expose .lownotes.
        let items = vault::list_vault_items(&vault).unwrap();
        assert!(!items.iter().any(|i| i.path.contains(".lownotes")));

        let _ = fs::remove_dir_all(&vault);
    }
}
