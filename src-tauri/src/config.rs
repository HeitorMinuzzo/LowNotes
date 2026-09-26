use std::{
    fs,
    path::PathBuf,
};

use anyhow::Context;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use directories::ProjectDirs;
use iroh::{EndpointAddr, EndpointId, SecretKey};
use iroh_tickets::endpoint::EndpointTicket;
use rand::Rng;
use serde::{Deserialize, Serialize};

const PAIR_CODE_PREFIX: &str = "LOWNOTES1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PeerConfig {
    pub name: String,
    pub endpoint_id: String,
    pub ticket: String,
}

impl PeerConfig {
    pub fn endpoint_addr(&self) -> anyhow::Result<EndpointAddr> {
        let ticket: EndpointTicket = self
            .ticket
            .parse()
            .context("errors.invalidDeviceAddress")?;
        Ok(ticket.endpoint_addr().clone())
    }

    pub fn id(&self) -> anyhow::Result<EndpointId> {
        self.endpoint_id
            .parse()
            .context("errors.invalidDeviceId")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairInvite {
    pub peer: PeerConfig,
    pub token: String,
    pub vault_id: String,
    pub vault_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub secret_key: String,
    pub pairing_token: String,
    #[serde(default)]
    pub peers: Vec<PeerConfig>,
}

impl VaultConfig {
    pub fn new(path: PathBuf, name: Option<String>) -> Self {
        let vault_name = name.unwrap_or_else(|| {
            path.file_name()
                .and_then(|v| v.to_str())
                .filter(|v| !v.trim().is_empty())
                .unwrap_or("Vault")
                .to_owned()
        });

        Self {
            id: URL_SAFE_NO_PAD.encode(rand::rng().random::<[u8; 18]>()),
            name: vault_name,
            path,
            secret_key: URL_SAFE_NO_PAD.encode(rand::rng().random::<[u8; 32]>()),
            pairing_token: new_pairing_token(),
            peers: Vec::new(),
        }
    }

    pub fn secret_key(&self) -> anyhow::Result<SecretKey> {
        decode_secret(&self.secret_key)
    }

    pub fn ensure_keys(&mut self) -> bool {
        let mut changed = false;
        if self.pairing_token.trim().is_empty() {
            self.pairing_token = new_pairing_token();
            changed = true;
        }
        if decode_secret(&self.secret_key).is_err() {
            self.secret_key = URL_SAFE_NO_PAD.encode(rand::rng().random::<[u8; 32]>());
            changed = true;
        }
        changed
    }

    pub fn add_peer(&mut self, peer: PeerConfig) -> bool {
        if self.peers.iter().any(|p| p.endpoint_id == peer.endpoint_id) {
            false
        } else {
            self.peers.push(peer);
            true
        }
    }

    pub fn remove_peer(&mut self, endpoint_id: &str) -> bool {
        let prev_len = self.peers.len();
        self.peers.retain(|p| p.endpoint_id != endpoint_id);
        self.peers.len() < prev_len
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub selected_model: String,
    #[serde(default)]
    pub is_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSettings {
    pub active_provider_id: String,
    pub providers: Vec<AiProviderConfig>,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            active_provider_id: "ollama".to_string(),
            providers: vec![
                AiProviderConfig {
                    id: "ollama".to_string(),
                    name: "Ollama (Local)".to_string(),
                    base_url: "http://localhost:11434/v1".to_string(),
                    api_key: String::new(),
                    selected_model: "qwen2.5:1.5b".to_string(),
                    is_custom: false,
                },
                AiProviderConfig {
                    id: "openai".to_string(),
                    name: "OpenAI".to_string(),
                    base_url: "https://api.openai.com/v1".to_string(),
                    api_key: String::new(),
                    selected_model: "gpt-4o-mini".to_string(),
                    is_custom: false,
                },
                AiProviderConfig {
                    id: "openrouter".to_string(),
                    name: "OpenRouter".to_string(),
                    base_url: "https://openrouter.ai/api/v1".to_string(),
                    api_key: String::new(),
                    selected_model: "meta-llama/llama-3.3-70b-instruct:free".to_string(),
                    is_custom: false,
                },
                AiProviderConfig {
                    id: "groq".to_string(),
                    name: "Groq".to_string(),
                    base_url: "https://api.groq.com/openai/v1".to_string(),
                    api_key: String::new(),
                    selected_model: "llama-3.3-70b-versatile".to_string(),
                    is_custom: false,
                },
                AiProviderConfig {
                    id: "lmstudio".to_string(),
                    name: "LM Studio (Local)".to_string(),
                    base_url: "http://localhost:1234/v1".to_string(),
                    api_key: String::new(),
                    selected_model: "local-model".to_string(),
                    is_custom: false,
                },
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub device_name: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_view_mode")]
    pub view_mode: String,
    #[serde(default)]
    pub language: String,
    pub active_vault_id: Option<String>,
    pub vaults: Vec<VaultConfig>,
    #[serde(default)]
    pub ai: AiSettings,
    #[serde(default)]
    pub has_seen_welcome: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        let host = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "LowNotes Device".to_string());

        Self {
            device_name: host,
            theme: default_theme(),
            view_mode: default_view_mode(),
            language: String::new(),
            active_vault_id: None,
            vaults: Vec::new(),
            ai: AiSettings::default(),
            has_seen_welcome: false,
        }
    }
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_view_mode() -> String {
    "split".to_string()
}

impl AppSettings {
    pub fn config_file() -> anyhow::Result<PathBuf> {
        let dirs = ProjectDirs::from("dev", "lowbloat", "lownotes")
            .context("errors.configDir")?;
        let dir = dirs.config_dir();
        fs::create_dir_all(dir)?;
        Ok(dir.join("settings.json"))
    }

    pub fn load() -> Self {
        Self::config_file()
            .ok()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = Self::config_file()?;
        let json = serde_json::to_string_pretty(self)?;
        fs::write(path, json)?;
        Ok(())
    }

    pub fn active_vault(&self) -> Option<&VaultConfig> {
        let id = self.active_vault_id.as_deref()?;
        self.vaults.iter().find(|v| v.id == id)
    }

    pub fn active_vault_mut(&mut self) -> Option<&mut VaultConfig> {
        let id = self.active_vault_id.clone()?;
        self.vaults.iter_mut().find(|v| v.id == id)
    }
}

pub fn new_pairing_token() -> String {
    URL_SAFE_NO_PAD.encode(rand::rng().random::<[u8; 16]>())
}

pub fn decode_secret(encoded: &str) -> anyhow::Result<SecretKey> {
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded.trim())
        .context("errors.invalidSecretKey")?;
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("errors.invalidKeySize"))?;
    Ok(SecretKey::from(key))
}

pub fn encode_pair_code(invite: &PairInvite) -> anyhow::Result<String> {
    let json = serde_json::to_vec(invite)?;
    let encoded = URL_SAFE_NO_PAD.encode(json);
    Ok(format!("{PAIR_CODE_PREFIX}_{encoded}"))
}

pub fn decode_pair_code(code: &str) -> anyhow::Result<PairInvite> {
    let trimmed = code.trim();
    let body = trimmed
        .strip_prefix(&format!("{PAIR_CODE_PREFIX}_"))
        .or_else(|| trimmed.strip_prefix(PAIR_CODE_PREFIX))
        .context("errors.invalidPairCode")?;
    let json = URL_SAFE_NO_PAD.decode(body)?;
    let invite = serde_json::from_slice(&json)?;
    Ok(invite)
}

#[cfg(test)]
mod tests {
    use super::AppSettings;

    #[test]
    fn existing_settings_without_view_mode_open_split() {
        let mut saved = serde_json::to_value(AppSettings::default()).unwrap();
        saved.as_object_mut().unwrap().remove("view_mode");

        let restored: AppSettings = serde_json::from_value(saved).unwrap();
        assert_eq!(restored.view_mode, "split");
        assert_eq!(restored.theme, "dark");
    }

    #[test]
    fn test_vault_config_ensure_keys() {
        let mut vault = super::VaultConfig {
            id: "v1".to_string(),
            name: "Test".to_string(),
            path: std::path::PathBuf::from("/test"),
            secret_key: "".to_string(),
            pairing_token: "".to_string(),
            peers: Vec::new(),
        };
        assert!(vault.ensure_keys());
        assert!(!vault.secret_key.is_empty());
        assert!(!vault.pairing_token.is_empty());
        assert!(vault.secret_key().is_ok());
        // Second time should not change anything
        assert!(!vault.ensure_keys());
    }
}
