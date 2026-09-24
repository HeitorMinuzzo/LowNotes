pub mod config;
pub mod crdt;
pub mod network;
pub mod vault;
pub mod commands;

use std::sync::Arc;
use parking_lot::RwLock;

use config::AppSettings;
use crdt::CrdtManager;
use network::{NetworkIdentity, NetworkService};
use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = Arc::new(RwLock::new(AppSettings::load()));
    let crdt = CrdtManager::new();
    let network = Arc::new(RwLock::new(None::<NetworkService>));

    let app_state = AppState {
        settings: settings.clone(),
        crdt,
        network: network.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(move |app| {
            let s = settings.read();
            if let Some(vault) = s.active_vault() {
                if let Ok(secret) = vault.secret_key() {
                    let identity = NetworkIdentity {
                        device_name: s.device_name.clone(),
                        secret_key: secret,
                        pairing_token: vault.pairing_token.clone(),
                        vault_id: vault.id.clone(),
                        vault_name: vault.name.clone(),
                    };
                    let service = NetworkService::start(
                        vault.path.clone(),
                        identity,
                        vault.peers.clone(),
                        app.handle().clone(),
                    );
                    *network.write() = Some(service);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::select_vault,
            commands::create_vault,
            commands::list_notes,
            commands::read_note,
            commands::save_note,
            commands::create_note,
            commands::create_folder,
            commands::rename_item,
            commands::delete_item,
            commands::crdt_apply_client_update,
            commands::network_sync_now,
            commands::network_request_pair,
            commands::network_answer_pair,
            commands::network_remove_peer,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o aplicativo LowNotes");
}
