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
            .context("o endereço do dispositivo salvo é inválido")?;
        Ok(ticket.endpoint_addr().clone())
    }

    pub fn id(&self) -> anyhow::Result<EndpointId> {
        self.endpoint_id
            .parse()
            .context("a identidade do dispositivo salvo é inválida")
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
pub struct AppSettings {
    pub device_name: String,
    pub theme: String,
    pub active_vault_id: Option<String>,
    pub vaults: Vec<VaultConfig>,
}

impl Default for AppSettings {
    fn default() -> Self {
        let host = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "LowNotes Device".to_string());

        Self {
            device_name: host,
            theme: "dark".to_string(),
            active_vault_id: None,
            vaults: Vec::new(),
        }
    }
}

impl AppSettings {
    pub fn config_file() -> anyhow::Result<PathBuf> {
        let dirs = ProjectDirs::from("dev", "lowbloat", "lownotes")
            .context("não foi possível determinar o diretório de dados")?;
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
        .context("chave secreta inválida")?;
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("tamanho de chave inválido"))?;
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
        .context("código de pareamento inválido ou de versão diferente")?;
    let json = URL_SAFE_NO_PAD.decode(body)?;
    let invite = serde_json::from_slice(&json)?;
    Ok(invite)
}
