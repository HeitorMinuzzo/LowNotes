import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  AiSettings,
  AppTheme,
  ChatMessage,
  ChatResponse,
  InitialStateResponse,
  NoteReadResponse,
  PairInfo,
  RagChunk,
  VaultItem,
  ViewMode,
} from './types';

export async function getAppState(): Promise<InitialStateResponse> {
  return await invoke('get_app_state');
}

export async function selectVault(path: string): Promise<InitialStateResponse> {
  return await invoke('select_vault', { pathStr: path });
}

export async function createVault(path: string, name?: string): Promise<InitialStateResponse> {
  return await invoke('create_vault', { pathStr: path, name });
}

export async function listNotes(): Promise<VaultItem[]> {
  return await invoke('list_notes');
}

export async function readNote(path: string): Promise<NoteReadResponse> {
  return await invoke('read_note', { path });
}

export async function saveNote(path: string, content: string): Promise<void> {
  return await invoke('save_note', { path, content });
}

export async function createNote(path: string, title?: string): Promise<string> {
  return await invoke('create_note', { path, title });
}

export async function createFolder(path: string): Promise<void> {
  return await invoke('create_folder', { path });
}

export async function renameItem(oldPath: string, newPath: string): Promise<void> {
  return await invoke('rename_item', { oldPath, newPath });
}

export async function deleteItem(path: string): Promise<void> {
  return await invoke('delete_item', { path });
}

export async function crdtApplyClientUpdate(notePath: string, updateBase64: string): Promise<void> {
  return await invoke('crdt_apply_client_update', { notePath, updateBase64 });
}

export async function networkSyncNow(): Promise<void> {
  return await invoke('network_sync_now');
}

export async function networkRequestPair(pairCode: string): Promise<void> {
  return await invoke('network_request_pair', { pairCode });
}

export async function networkAnswerPair(requestId: string, accept: boolean): Promise<void> {
  return await invoke('network_answer_pair', { requestId, accept });
}

export async function networkRemovePeer(endpointId: string): Promise<void> {
  return await invoke('network_remove_peer', { endpointId });
}

export async function networkGetPairInfo(): Promise<PairInfo | null> {
  return await invoke('network_get_pair_info');
}

export async function pickVaultDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Selecione a pasta para o Vault',
  });
  if (typeof selected === 'string') {
    return selected;
  }
  return null;
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  return await invoke('save_ai_settings', { settings });
}

export async function saveTheme(theme: AppTheme): Promise<void> {
  return await invoke('save_theme', { theme });
}

export async function saveViewMode(viewMode: ViewMode): Promise<void> {
  return await invoke('save_view_mode', { viewMode });
}

export async function fetchAiModels(
  providerId?: string,
  customUrl?: string,
  customKey?: string
): Promise<string[]> {
  return await invoke('fetch_ai_models', { providerId, customUrl, customKey });
}

export async function searchVaultRag(query: string, limit?: number): Promise<RagChunk[]> {
  return await invoke('search_vault_rag', { query, limit });
}

export async function aiChatQuery(
  prompt: string,
  notePathScope?: string,
  conversation: ChatMessage[] = []
): Promise<ChatResponse> {
  return await invoke('ai_chat_query', { prompt, notePathScope, conversation });
}

export async function markWelcomeSeen(): Promise<void> {
  return await invoke('mark_welcome_seen');
}
