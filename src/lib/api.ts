import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { InitialStateResponse, NoteReadResponse, VaultItem } from './types';

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
