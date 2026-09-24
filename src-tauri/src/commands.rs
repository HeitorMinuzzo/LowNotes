use std::{
    path::PathBuf,
    sync::Arc,
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    config::{AppSettings, VaultConfig, decode_pair_code},
    crdt::CrdtManager,
    network::{NetworkIdentity, NetworkService},
    vault::{self, VaultItem},
};

pub struct AppState {
    pub settings: Arc<RwLock<AppSettings>>,
    pub crdt: CrdtManager,
    pub network: Arc<RwLock<Option<NetworkService>>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InitialStateResponse {
    pub settings: AppSettings,
    pub active_vault: Option<VaultConfig>,
    pub items: Vec<VaultItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteReadResponse {
    pub content: String,
    pub crdt_update_base64: String,
}

#[tauri::command]
pub fn get_app_state(state: State<'_, AppState>) -> Result<InitialStateResponse, String> {
    let settings = state.settings.read().clone();
    let active_vault = settings.active_vault().cloned();
    let items = if let Some(vault) = &active_vault {
        vault::list_vault_items(&vault.path).map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };

    Ok(InitialStateResponse {
        settings,
        active_vault,
        items,
    })
}

#[tauri::command]
pub fn select_vault(
    path_str: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<InitialStateResponse, String> {
    let path = PathBuf::from(path_str);
    if !path.is_dir() {
        return Err("o caminho informado não é uma pasta válida".to_string());
    }

    let mut settings = state.settings.write();
    let vault_id = if let Some(existing) = settings.vaults.iter().find(|v| v.path == path) {
        existing.id.clone()
    } else {
        let new_vault = VaultConfig::new(path.clone(), None);
        let id = new_vault.id.clone();
        settings.vaults.push(new_vault);
        id
    };

    settings.active_vault_id = Some(vault_id);
    settings.save().map_err(|e| e.to_string())?;

    let active_vault = settings.active_vault().cloned().ok_or("vault não encontrado")?;
    drop(settings);

    // Restart network service for the selected vault
    restart_network_service(&state, &active_vault, app)?;

    let items = vault::list_vault_items(&active_vault.path).map_err(|e| e.to_string())?;
    let current_settings = state.settings.read().clone();

    Ok(InitialStateResponse {
        settings: current_settings,
        active_vault: Some(active_vault),
        items,
    })
}

#[tauri::command]
pub fn create_vault(
    path_str: String,
    name: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<InitialStateResponse, String> {
    let path = PathBuf::from(path_str);
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    let mut settings = state.settings.write();
    let new_vault = VaultConfig::new(path.clone(), name);
    let id = new_vault.id.clone();
    settings.vaults.push(new_vault);
    settings.active_vault_id = Some(id);
    settings.save().map_err(|e| e.to_string())?;

    let active_vault = settings.active_vault().cloned().ok_or("vault não encontrado")?;
    drop(settings);

    restart_network_service(&state, &active_vault, app)?;

    let items = vault::list_vault_items(&active_vault.path).map_err(|e| e.to_string())?;
    let current_settings = state.settings.read().clone();

    Ok(InitialStateResponse {
        settings: current_settings,
        active_vault: Some(active_vault),
        items,
    })
}

#[tauri::command]
pub fn list_notes(state: State<'_, AppState>) -> Result<Vec<VaultItem>, String> {
    let settings = state.settings.read();
    let vault = settings.active_vault().ok_or("nenhum vault ativo")?;
    vault::list_vault_items(&vault.path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_note(path: String, state: State<'_, AppState>) -> Result<NoteReadResponse, String> {
    let settings = state.settings.read();
    let vault = settings.active_vault().ok_or("nenhum vault ativo")?;
    let content = vault::read_note(&vault.path, &path).map_err(|e| e.to_string())?;

    let crdt_bytes = state.crdt.get_or_create_doc(&path, &content);
    let crdt_update_base64 = URL_SAFE_NO_PAD.encode(crdt_bytes);

    Ok(NoteReadResponse {
        content,
        crdt_update_base64,
    })
}

#[tauri::command]
pub fn save_note(path: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.read();
    let vault = settings.active_vault().ok_or("nenhum vault ativo")?;
    vault::save_note(&vault.path, &path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    path: String,
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let settings = state.settings.read();
    let vault = settings.active_vault().ok_or("nenhum vault ativo")?;
    let init_content = title.map(|t| format!("# {t}\n\n"));
    vault::create_note(&vault.path, &path, init_content.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.read();
    let vault = settings.active_vault().ok_or("nenhum vault ativo")?;
    vault::create_folder(&vault.path, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_item(
    old_path: String,
    new_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let settings = state.settings.read();
    let vault = settings.active_vault().ok_or("nenhum vault ativo")?;
    vault::rename_item(&vault.path, &old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_item(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.read();
    let vault = settings.active_vault().ok_or("nenhum vault ativo")?;
    vault::delete_item(&vault.path, &path).map_err(|e| e.to_string())?;

    if let Some(net) = state.network.read().as_ref() {
        net.broadcast_delete(path);
    }

    Ok(())
}

#[tauri::command]
pub fn crdt_apply_client_update(
    note_path: String,
    update_base64: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let update_bytes = URL_SAFE_NO_PAD
        .decode(&update_base64)
        .map_err(|e| format!("base64 inválido: {e}"))?;

    // Apply to Yrs in-memory doc and get text
    let new_text = state
        .crdt
        .apply_update(&note_path, &update_bytes)
        .map_err(|e| e.to_string())?;

    // Persist to disk
    let settings = state.settings.read();
    if let Some(vault) = settings.active_vault() {
        let _ = vault::save_note(&vault.path, &note_path, &new_text);
    }

    // Broadcast to P2P peers
    if let Some(net) = state.network.read().as_ref() {
        net.broadcast_crdt_update(note_path, update_bytes);
    }

    Ok(())
}

#[tauri::command]
pub fn network_sync_now(state: State<'_, AppState>) -> Result<(), String> {
    let net = state.network.read();
    let service = net.as_ref().ok_or("serviço P2P não iniciado")?;
    service.sync_now();
    Ok(())
}

#[tauri::command]
pub fn network_request_pair(pair_code: String, state: State<'_, AppState>) -> Result<(), String> {
    let invite = decode_pair_code(&pair_code).map_err(|e| e.to_string())?;
    let net = state.network.read();
    let service = net.as_ref().ok_or("serviço P2P não iniciado")?;
    service.request_pair(invite);
    Ok(())
}

#[tauri::command]
pub fn network_answer_pair(
    request_id: String,
    accept: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let net = state.network.read();
    let service = net.as_ref().ok_or("serviço P2P não iniciado")?;
    service.answer_pair(request_id, accept);
    Ok(())
}

#[tauri::command]
pub fn network_remove_peer(
    endpoint_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut settings = state.settings.write();
    if let Some(vault) = settings.active_vault_mut() {
        let removed = vault.remove_peer(&endpoint_id);
        if removed {
            let updated_peers = vault.peers.clone();
            let _ = settings.save();
            drop(settings);

            if let Some(net) = state.network.read().as_ref() {
                net.update_peers(updated_peers);
            }
        }
    }
    Ok(())
}

fn restart_network_service(
    state: &AppState,
    vault: &VaultConfig,
    app: AppHandle,
) -> Result<(), String> {
    let secret = vault.secret_key().map_err(|e| e.to_string())?;
    let identity = NetworkIdentity {
        device_name: state.settings.read().device_name.clone(),
        secret_key: secret,
        pairing_token: vault.pairing_token.clone(),
        vault_id: vault.id.clone(),
        vault_name: vault.name.clone(),
    };

    let service = NetworkService::start(vault.path.clone(), identity, vault.peers.clone(), app);
    *state.network.write() = Some(service);
    Ok(())
}
