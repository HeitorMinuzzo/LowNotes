use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{bail, Context};
use parking_lot::Mutex;
use yrs::{updates::decoder::Decode, Doc, GetString, ReadTxn, StateVector, Text, Transact, Update};

use crate::{links, vault};

const STATE_DIR: &str = ".lownotes/crdt";

#[derive(Clone, Default)]
pub struct CrdtManager {
    docs: Arc<Mutex<HashMap<PathBuf, Doc>>>,
}

pub struct AppliedUpdate {
    pub state: Vec<u8>,
    pub changed: bool,
}

impl CrdtManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn state_relative_path(path: &str) -> String {
        format!("{STATE_DIR}/{}.bin", blake3::hash(path.as_bytes()).to_hex())
    }

    fn state_file(vault_path: &Path, path: &str) -> PathBuf {
        vault_path.join(Self::state_relative_path(path))
    }

    pub(crate) fn encode_state(doc: &Doc) -> Vec<u8> {
        doc.transact().encode_diff_v1(&StateVector::default())
    }

    fn decode_file<'a>(relative: &str, bytes: &'a [u8]) -> anyhow::Result<(String, &'a [u8])> {
        if bytes.len() < 4 {
            bail!("invalid CRDT state header");
        }
        let len = u32::from_be_bytes(bytes[..4].try_into()?) as usize;
        if len == 0 || len > 4096 || bytes.len() < 4 + len {
            bail!("invalid CRDT state path length");
        }
        let path = std::str::from_utf8(&bytes[4..4 + len])?.to_string();
        if !vault::is_markdown(Path::new(&path)) || Self::state_relative_path(&path) != relative {
            bail!("invalid CRDT state path");
        }
        Ok((path, &bytes[4 + len..]))
    }

    fn write_state(vault_path: &Path, path: &str, state: &[u8]) -> anyhow::Result<()> {
        let file = Self::state_file(vault_path, path);
        fs::create_dir_all(file.parent().context("CRDT state directory")?)?;
        let path_bytes = path.as_bytes();
        let mut bytes = Vec::with_capacity(4 + path_bytes.len() + state.len());
        bytes.extend_from_slice(&(path_bytes.len() as u32).to_be_bytes());
        bytes.extend_from_slice(path_bytes);
        bytes.extend_from_slice(state);
        fs::write(file, bytes)?;
        Ok(())
    }

    fn load_doc(vault_path: &Path, path: &str, initial_text: &str) -> anyhow::Result<Doc> {
        let file = Self::state_file(vault_path, path);
        if file.exists() {
            let bytes = fs::read(&file)?;
            let (saved_path, update) = Self::decode_file(&Self::state_relative_path(path), &bytes)?;
            if saved_path != path {
                bail!("CRDT state belongs to another note");
            }
            let doc = Doc::new();
            doc.transact_mut()
                .apply_update(Update::decode_v1(update)?)?;
            return Ok(doc);
        }

        // Matching Markdown files share the same initial Yjs IDs on every peer.
        let mut seed = blake3::Hasher::new();
        seed.update(path.as_bytes());
        seed.update(&[0]);
        seed.update(initial_text.as_bytes());
        let client_id =
            u64::from_le_bytes(seed.finalize().as_bytes()[..8].try_into()?) & ((1u64 << 53) - 1);
        let doc = Doc::with_client_id(client_id);
        if !initial_text.is_empty() {
            let text = doc.get_or_insert_text("content");
            text.push(&mut doc.transact_mut(), initial_text);
        }
        let state = Self::encode_state(&doc);
        Self::write_state(vault_path, path, &state)?;
        // Only the seed uses a stable client ID. Later replacements made by
        // external Markdown editors need a distinct ID on each device.
        let local_doc = Doc::new();
        local_doc
            .transact_mut()
            .apply_update(Update::decode_v1(&state)?)?;
        Ok(local_doc)
    }

    fn ensure_doc<'a>(
        docs: &'a mut HashMap<PathBuf, Doc>,
        vault_path: &Path,
        path: &str,
    ) -> anyhow::Result<&'a Doc> {
        if !vault::is_markdown(Path::new(path)) {
            bail!("CRDT path must be a Markdown note");
        }
        let target = vault::safe_join(vault_path, path)?;
        let state_file = Self::state_file(vault_path, path);
        let file_content = match vault::read_note(vault_path, path) {
            Ok(content) => content,
            Err(_) if !target.exists() => String::new(),
            Err(error) => return Err(error),
        };
        if !docs.contains_key(&target) {
            let doc = Self::load_doc(vault_path, path, &file_content)?;
            docs.insert(target.clone(), doc);
        }
        let doc = docs.get(&target).expect("document inserted");
        let text = doc.get_or_insert_text("content");
        let current = text.get_string(&doc.transact());
        if current != file_content {
            let markdown_is_newer = fs::metadata(&target).and_then(|meta| meta.modified()).ok()
                > fs::metadata(&state_file)
                    .and_then(|meta| meta.modified())
                    .ok();
            if markdown_is_newer {
                // A change made by an external editor becomes a CRDT replacement.
                let mut txn = doc.transact_mut();
                let len = text.len(&txn);
                if len > 0 {
                    text.remove_range(&mut txn, 0, len);
                }
                if !file_content.is_empty() {
                    text.insert(&mut txn, 0, &file_content);
                }
                drop(txn);
                Self::write_state(vault_path, path, &Self::encode_state(doc))?;
            } else {
                // Recover Markdown after an interrupted write; history is authoritative.
                vault::save_note(vault_path, path, &current)?;
            }
        }
        Ok(doc)
    }

    pub fn get_or_create_doc(&self, vault_path: &Path, path: &str) -> anyhow::Result<Vec<u8>> {
        let mut docs = self.docs.lock();
        Ok(Self::encode_state(Self::ensure_doc(
            &mut docs, vault_path, path,
        )?))
    }

    pub fn apply_update(
        &self,
        vault_path: &Path,
        path: &str,
        bytes: &[u8],
    ) -> anyhow::Result<AppliedUpdate> {
        let update = Update::decode_v1(bytes)?;
        let mut docs = self.docs.lock();
        let doc = Self::ensure_doc(&mut docs, vault_path, path)?;
        let before = Self::encode_state(doc);
        doc.transact_mut().apply_update(update)?;
        let state = Self::encode_state(doc);
        let changed = state != before;
        if changed {
            let text = doc
                .get_or_insert_text("content")
                .get_string(&doc.transact());
            Self::write_state(vault_path, path, &state)?;
            vault::save_note(vault_path, path, &text)?;
            if let Err(error) = links::reconcile_wikilinks(vault_path, path, &text) {
                eprintln!("reconcile_wikilinks failed for {path}: {error}");
            }
        }
        Ok(AppliedUpdate { state, changed })
    }

    pub fn merge_state_file(
        &self,
        vault_path: &Path,
        relative: &str,
        bytes: &[u8],
    ) -> anyhow::Result<(String, AppliedUpdate)> {
        let (path, update) = Self::decode_file(relative, bytes)?;
        vault::safe_join(vault_path, &path)?;
        let result = self.apply_update(vault_path, &path, update)?;
        Ok((path, result))
    }

    pub fn remove_doc(&self, vault_path: &Path, path: &str) -> anyhow::Result<()> {
        let target = vault::safe_join(vault_path, path)?;
        self.docs
            .lock()
            .retain(|note, _| !note.starts_with(&target));
        let state_dir = vault_path.join(STATE_DIR);
        if state_dir.is_dir() {
            for entry in fs::read_dir(state_dir)? {
                let entry = entry?;
                if !entry.file_type()?.is_file() {
                    continue;
                }
                let bytes = fs::read(entry.path())?;
                if let Some(saved_path) = bytes
                    .get(..4)
                    .and_then(|header| <[u8; 4]>::try_from(header).ok())
                    .and_then(|header| bytes.get(4..4 + u32::from_be_bytes(header) as usize))
                    .and_then(|path| std::str::from_utf8(path).ok())
                {
                    if saved_path == path || saved_path.starts_with(&format!("{path}/")) {
                        fs::remove_file(entry.path())?;
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(tag: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("lownotes-crdt-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn same_markdown_has_same_genesis_and_concurrent_edits_converge() {
        let a = temp_vault("a");
        let b = temp_vault("b");
        vault::save_note(&a, "shared.md", "Hello ").unwrap();
        vault::save_note(&b, "shared.md", "Hello ").unwrap();
        let manager_a = CrdtManager::new();
        let manager_b = CrdtManager::new();
        let initial_a = manager_a.get_or_create_doc(&a, "shared.md").unwrap();
        let initial_b = manager_b.get_or_create_doc(&b, "shared.md").unwrap();
        assert_eq!(initial_a, initial_b);

        let editor_a = Doc::with_client_id(1001);
        editor_a
            .transact_mut()
            .apply_update(Update::decode_v1(&initial_a).unwrap())
            .unwrap();
        let editor_b = Doc::with_client_id(1002);
        editor_b
            .transact_mut()
            .apply_update(Update::decode_v1(&initial_b).unwrap())
            .unwrap();
        editor_a
            .get_or_insert_text("content")
            .push(&mut editor_a.transact_mut(), "Alice");
        editor_b
            .get_or_insert_text("content")
            .push(&mut editor_b.transact_mut(), "Bob");
        let update_a = CrdtManager::encode_state(&editor_a);
        let update_b = CrdtManager::encode_state(&editor_b);
        manager_a.apply_update(&a, "shared.md", &update_a).unwrap();
        manager_b.apply_update(&b, "shared.md", &update_b).unwrap();
        manager_a.apply_update(&a, "shared.md", &update_b).unwrap();
        manager_b.apply_update(&b, "shared.md", &update_a).unwrap();
        let text_a = vault::read_note(&a, "shared.md").unwrap();
        let text_b = vault::read_note(&b, "shared.md").unwrap();
        assert_eq!(text_a, text_b);
        assert!(text_a.contains("Alice"));
        assert!(text_a.contains("Bob"));
        let _ = fs::remove_dir_all(a);
        let _ = fs::remove_dir_all(b);
    }

    #[test]
    fn persisted_state_survives_manager_restart() {
        let vault_path = temp_vault("restart");
        vault::save_note(&vault_path, "note.md", "Start").unwrap();
        let manager = CrdtManager::new();
        let state = manager.get_or_create_doc(&vault_path, "note.md").unwrap();
        let editor = Doc::with_client_id(2001);
        editor
            .transact_mut()
            .apply_update(Update::decode_v1(&state).unwrap())
            .unwrap();
        editor
            .get_or_insert_text("content")
            .push(&mut editor.transact_mut(), " end");
        manager
            .apply_update(&vault_path, "note.md", &CrdtManager::encode_state(&editor))
            .unwrap();
        let restarted = CrdtManager::new();
        assert_eq!(
            restarted.get_or_create_doc(&vault_path, "note.md").unwrap(),
            CrdtManager::encode_state(&editor)
        );
        let _ = fs::remove_dir_all(vault_path);
    }

    #[test]
    fn newer_external_markdown_edit_enters_crdt_history() {
        let vault_path = temp_vault("external");
        vault::save_note(&vault_path, "note.md", "Original").unwrap();
        let manager = CrdtManager::new();
        manager.get_or_create_doc(&vault_path, "note.md").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        vault::save_note(&vault_path, "note.md", "Changed outside the app").unwrap();
        let state = manager.get_or_create_doc(&vault_path, "note.md").unwrap();
        let restored = Doc::new();
        restored
            .transact_mut()
            .apply_update(Update::decode_v1(&state).unwrap())
            .unwrap();
        assert_eq!(
            restored
                .get_or_insert_text("content")
                .get_string(&restored.transact()),
            "Changed outside the app"
        );
        let _ = fs::remove_dir_all(vault_path);
    }

    #[test]
    fn removing_folder_clears_nested_crdt_history() {
        let vault_path = temp_vault("folder");
        vault::save_note(&vault_path, "folder/a.md", "A").unwrap();
        vault::save_note(&vault_path, "folder/nested/b.md", "B").unwrap();
        vault::save_note(&vault_path, "other.md", "Other").unwrap();
        let manager = CrdtManager::new();
        for path in ["folder/a.md", "folder/nested/b.md", "other.md"] {
            manager.get_or_create_doc(&vault_path, path).unwrap();
        }
        manager.remove_doc(&vault_path, "folder").unwrap();
        assert!(!CrdtManager::state_file(&vault_path, "folder/a.md").exists());
        assert!(!CrdtManager::state_file(&vault_path, "folder/nested/b.md").exists());
        assert!(CrdtManager::state_file(&vault_path, "other.md").exists());
        let _ = fs::remove_dir_all(vault_path);
    }
}
