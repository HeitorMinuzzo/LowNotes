use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context};
use serde::Serialize;
use walkdir::WalkDir;

use crate::{crdt::CrdtManager, vault};

const MAX_HISTORY_BYTES: usize = 128 * 1024 * 1024;
const MAX_HISTORY_ENTRIES: usize = 25;

struct SavedFile {
    relative: PathBuf,
    bytes: Vec<u8>,
}

pub struct DeletedSnapshot {
    path: String,
    is_dir: bool,
    directories: Vec<PathBuf>,
    files: Vec<SavedFile>,
    crdt_files: Vec<SavedFile>,
    note_paths: Vec<String>,
    bytes: usize,
}

#[derive(Serialize)]
pub struct RestoredItem {
    pub path: String,
    pub is_dir: bool,
    pub has_more: bool,
}

#[derive(Default)]
pub struct UndoHistory {
    entries: VecDeque<(String, DeletedSnapshot)>,
    bytes: usize,
}

impl DeletedSnapshot {
    pub fn capture(root: &Path, path: &str) -> anyhow::Result<Self> {
        let target = vault::safe_join(root, path)?;
        if target == root || !target.exists() {
            bail!("errors.sourceNotFound");
        }
        let is_dir = target.is_dir();
        let mut snapshot = Self {
            path: path.to_string(),
            is_dir,
            directories: Vec::new(),
            files: Vec::new(),
            crdt_files: Vec::new(),
            note_paths: Vec::new(),
            bytes: 0,
        };

        for entry in WalkDir::new(&target).follow_links(false) {
            let entry = entry?;
            let relative = entry.path().strip_prefix(root)?.to_path_buf();
            if entry.file_type().is_symlink() {
                bail!("errors.undoUnsupportedItem");
            }
            if entry.file_type().is_dir() {
                snapshot.directories.push(relative);
                continue;
            }
            if !entry.file_type().is_file() {
                bail!("errors.undoUnsupportedItem");
            }
            if vault::is_markdown(entry.path()) {
                snapshot
                    .note_paths
                    .push(relative.to_string_lossy().replace('\\', "/"));
            }
            snapshot
                .files
                .push(read_limited(root, entry.path(), &mut snapshot.bytes)?);
        }

        for note in &snapshot.note_paths {
            let state_path = root.join(CrdtManager::state_relative_path(note));
            if state_path.exists() {
                if !state_path.is_file() || state_path.is_symlink() {
                    bail!("errors.undoUnsupportedItem");
                }
                snapshot
                    .crdt_files
                    .push(read_limited(root, &state_path, &mut snapshot.bytes)?);
            }
        }

        Ok(snapshot)
    }

    pub fn restore(&self, root: &Path) -> anyhow::Result<()> {
        let target = vault::safe_join(root, &self.path)?;
        if target.symlink_metadata().is_ok() {
            bail!("errors.targetExists");
        }
        for file in &self.crdt_files {
            let destination = root.join(&file.relative);
            if destination.symlink_metadata().is_ok() && fs::read(&destination)? != file.bytes {
                bail!("errors.targetExists");
            }
        }

        let mut created_states = Vec::new();
        let result = (|| -> anyhow::Result<()> {
            if self.is_dir {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::create_dir(&target)?;
            }
            for directory in &self.directories {
                if root.join(directory) != target {
                    fs::create_dir_all(root.join(directory))?;
                }
            }
            for file in &self.files {
                write_new_file(root.join(&file.relative), &file.bytes)?;
            }
            for file in &self.crdt_files {
                let destination = root.join(&file.relative);
                if destination.symlink_metadata().is_err() {
                    write_new_file(destination.clone(), &file.bytes)?;
                    created_states.push(destination);
                }
            }
            Ok(())
        })();

        if result.is_err() {
            for state in created_states {
                let _ = fs::remove_file(state);
            }
            if self.is_dir {
                let _ = fs::remove_dir_all(&target);
            } else {
                let _ = fs::remove_file(&target);
            }
        }
        result
    }
}

impl UndoHistory {
    pub fn push(&mut self, vault_id: String, snapshot: DeletedSnapshot) {
        self.bytes += snapshot.bytes;
        self.entries.push_back((vault_id, snapshot));
        while self.entries.len() > MAX_HISTORY_ENTRIES || self.bytes > MAX_HISTORY_BYTES {
            if let Some((_, old)) = self.entries.pop_front() {
                self.bytes -= old.bytes;
            }
        }
    }

    pub fn undo_last_for(
        &mut self,
        vault_id: &str,
        root: &Path,
    ) -> anyhow::Result<Option<RestoredItem>> {
        let Some(index) = self.entries.iter().rposition(|(id, _)| id == vault_id) else {
            return Ok(None);
        };
        self.entries[index].1.restore(root)?;
        let (_, snapshot) = self.entries.remove(index).expect("snapshot found");
        self.bytes -= snapshot.bytes;
        let has_more = self.entries.iter().any(|(id, _)| id == vault_id);
        Ok(Some(RestoredItem {
            path: snapshot.path,
            is_dir: snapshot.is_dir,
            has_more,
        }))
    }
}

fn read_limited(root: &Path, path: &Path, used: &mut usize) -> anyhow::Result<SavedFile> {
    let size = usize::try_from(fs::metadata(path)?.len()).unwrap_or(usize::MAX);
    if used.saturating_add(size) > MAX_HISTORY_BYTES {
        bail!("errors.undoTooLarge");
    }
    let bytes = fs::read(path).with_context(|| format!("failed to snapshot {}", path.display()))?;
    *used = used.saturating_add(bytes.len());
    if *used > MAX_HISTORY_BYTES {
        bail!("errors.undoTooLarge");
    }
    Ok(SavedFile {
        relative: path.strip_prefix(root)?.to_path_buf(),
        bytes,
    })
}

fn write_new_file(path: PathBuf, bytes: &[u8]) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    if let Err(error) = file.write_all(bytes) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root() -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("lownotes-undo-test-{}", rand::random::<u64>()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn restores_note_and_crdt_state_without_overwriting_a_replacement() {
        let root = test_root();
        fs::write(root.join("note.md"), "# Original\n").unwrap();
        let state = root.join(CrdtManager::state_relative_path("note.md"));
        fs::create_dir_all(state.parent().unwrap()).unwrap();
        fs::write(&state, b"original-state").unwrap();
        let snapshot = DeletedSnapshot::capture(&root, "note.md").unwrap();
        vault::delete_item(&root, "note.md").unwrap();
        fs::remove_file(&state).unwrap();
        fs::write(root.join("note.md"), "# Replacement\n").unwrap();
        assert!(snapshot.restore(&root).is_err());
        assert_eq!(
            fs::read_to_string(root.join("note.md")).unwrap(),
            "# Replacement\n"
        );
        fs::remove_file(root.join("note.md")).unwrap();
        snapshot.restore(&root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("note.md")).unwrap(),
            "# Original\n"
        );
        assert_eq!(fs::read(&state).unwrap(), b"original-state");
        vault::delete_item(&root, "note.md").unwrap();
        snapshot.restore(&root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("note.md")).unwrap(),
            "# Original\n"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restores_nested_folder_and_undoes_in_lifo_order() {
        let root = test_root();
        fs::create_dir_all(root.join("notes/empty")).unwrap();
        fs::write(root.join("notes/one.md"), "one").unwrap();
        fs::write(root.join("notes/image.bin"), [0, 1, 255]).unwrap();
        fs::write(root.join("two.md"), "two").unwrap();
        let mut history = UndoHistory::default();
        let folder = DeletedSnapshot::capture(&root, "notes").unwrap();
        vault::delete_item(&root, "notes").unwrap();
        history.push("vault".into(), folder);
        let note = DeletedSnapshot::capture(&root, "two.md").unwrap();
        vault::delete_item(&root, "two.md").unwrap();
        history.push("vault".into(), note);
        assert!(history.undo_last_for("other", &root).unwrap().is_none());
        assert_eq!(
            history.undo_last_for("vault", &root).unwrap().unwrap().path,
            "two.md"
        );
        assert_eq!(
            history.undo_last_for("vault", &root).unwrap().unwrap().path,
            "notes"
        );
        assert!(root.join("notes/empty").is_dir());
        assert_eq!(fs::read(root.join("notes/image.bin")).unwrap(), [0, 1, 255]);
        assert!(history.undo_last_for("vault", &root).unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
