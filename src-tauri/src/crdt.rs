use std::{
    collections::HashMap,
    sync::Arc,
};
use parking_lot::Mutex;
use yrs::{
    Doc, GetString, ReadTxn, StateVector, Text, Transact, Update,
    updates::decoder::Decode,
};

#[derive(Clone, Default)]
pub struct CrdtManager {
    docs: Arc<Mutex<HashMap<String, Doc>>>,
}

impl CrdtManager {
    pub fn new() -> Self {
        Self {
            docs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Load or initialize a document for a note path with initial text
    pub fn get_or_create_doc(&self, path: &str, initial_text: &str) -> Vec<u8> {
        let mut docs = self.docs.lock();
        if let Some(doc) = docs.get(path) {
            let txn = doc.transact();
            return txn.encode_diff_v1(&StateVector::default());
        }

        let doc = Doc::new();
        {
            let text = doc.get_or_insert_text("content");
            let mut txn = doc.transact_mut();
            if !initial_text.is_empty() {
                text.push(&mut txn, initial_text);
            }
        }
        let update = {
            let txn = doc.transact();
            txn.encode_diff_v1(&StateVector::default())
        };
        docs.insert(path.to_string(), doc);
        update
    }

    /// Apply a binary update from local client (CodeMirror / Yjs) or remote peer
    pub fn apply_update(&self, path: &str, update_bytes: &[u8]) -> anyhow::Result<String> {
        let update = Update::decode_v1(update_bytes)?;
        let mut docs = self.docs.lock();
        let doc = docs.entry(path.to_string()).or_insert_with(Doc::new);
        {
            let mut txn = doc.transact_mut();
            txn.apply_update(update)?;
        }
        let text = doc.get_or_insert_text("content");
        let txn = doc.transact();
        Ok(text.get_string(&txn))
    }

    /// Read the current plain-text representation of a note
    pub fn get_text(&self, path: &str) -> Option<String> {
        let docs = self.docs.lock();
        let doc = docs.get(path)?;
        let text = doc.get_or_insert_text("content");
        let txn = doc.transact();
        Some(text.get_string(&txn))
    }

    /// Close / unload note from memory when no longer open
    pub fn unload_doc(&self, path: &str) {
        let mut docs = self.docs.lock();
        docs.remove(path);
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crdt_doc_creation_and_text() {
        let manager = CrdtManager::new();
        let initial_text = "# Minha Nota\n\nTexto original da nota.\n";
        let update = manager.get_or_create_doc("nota.md", initial_text);
        assert!(!update.is_empty());

        let text = manager.get_text("nota.md");
        assert_eq!(text.as_deref(), Some(initial_text));
    }

    #[test]
    fn test_crdt_updates_converge() {
        let client_a = CrdtManager::new();
        let client_b = CrdtManager::new();

        let initial_a = client_a.get_or_create_doc("shared.md", "Ola ");
        let _ = client_b.get_or_create_doc("shared.md", "");

        // Sync initial state from A to B
        let _ = client_b.apply_update("shared.md", &initial_a).unwrap();
        assert_eq!(client_b.get_text("shared.md").unwrap(), "Ola ");

        // Client A edits
        let doc_a = {
            let docs = client_a.docs.lock();
            let doc = docs.get("shared.md").unwrap();
            let text = doc.get_or_insert_text("content");
            {
                let mut txn = doc.transact_mut();
                text.push(&mut txn, "Mundo!");
            }
            let update = doc.transact().encode_diff_v1(&StateVector::default());
            update
        };

        // Client B applies update from A
        let updated_b_text = client_b.apply_update("shared.md", &doc_a).unwrap();
        assert_eq!(updated_b_text, "Ola Mundo!");
        assert_eq!(client_a.get_text("shared.md").unwrap(), "Ola Mundo!");
    }
}
