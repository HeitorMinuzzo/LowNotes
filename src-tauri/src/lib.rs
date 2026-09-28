pub mod config;
pub mod crdt;
pub mod network;
pub mod vault;
pub mod commands;
pub mod rag;
pub mod links;
pub mod assistant;
pub mod web_search;
pub mod chat_history;

use std::sync::Arc;
use parking_lot::RwLock;
use tauri::{Manager, menu::{Menu, MenuItem}, tray::{MouseButton, TrayIconBuilder, TrayIconEvent}};

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .setup(move |app| {
            let mut s = settings.write();
            let mut saved_keys = false;
            if let Some(vault) = s.active_vault_mut() {
                saved_keys = vault.ensure_keys();
            }
            if saved_keys {
                let _ = s.save();
            }
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
                        settings.clone(),
                    );
                    *network.write() = Some(service);
                }
            }
            drop(s);

            let open = MenuItem::with_id(app, "open", "Abrir LowNotes", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair do LowNotes", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("ícone do aplicativo").clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.app_handle().state::<AppState>().settings.read().close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::chat_history_get,
            commands::chat_history_save,
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
            commands::network_broadcast_awareness,
            commands::save_ai_settings,
            commands::save_web_search_settings,
            commands::network_get_pair_info,
            commands::save_theme,
            commands::save_theme_palettes,
            commands::save_view_mode,
            commands::save_language,
            commands::fetch_ai_models,
            commands::search_vault_rag,
            commands::ai_chat_query,
            commands::ai_save_draft,
            commands::export_document,
            commands::mark_welcome_seen,
            commands::links_get,
            commands::links_apply,
            commands::ai_suggest_links,
            commands::save_update_prefs,
            commands::save_close_to_tray,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o aplicativo LowNotes");
}
