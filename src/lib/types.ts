export interface VaultItem {
  path: string;
  name: string;
  title: string;
  modified_ms: number;
  size: number;
  is_dir: boolean;
}

export interface PeerConfig {
  name: string;
  endpoint_id: string;
  ticket: string;
}

export interface VaultConfig {
  id: string;
  name: string;
  path: string;
  secret_key: string;
  pairing_token: string;
  peers: PeerConfig[];
}

export interface AppSettings {
  device_name: string;
  theme: string;
  active_vault_id: string | null;
  vaults: VaultConfig[];
}

export interface InitialStateResponse {
  settings: AppSettings;
  active_vault: VaultConfig | null;
  items: VaultItem[];
}

export interface NoteReadResponse {
  content: string;
  crdt_update_base64: string;
}

export type NetworkEventPayload =
  | { type: 'Ready'; pair_code: string; endpoint_id: string }
  | { type: 'Syncing'; peer: string }
  | { type: 'Synced'; peer: string; changed: number; direct?: boolean }
  | { type: 'PairRequested'; request_id: string; peer: PeerConfig }
  | { type: 'PairApproved'; peer: PeerConfig }
  | { type: 'PairRejected'; peer: string }
  | { type: 'RemoteCrdtUpdate'; note_path: string; update: number[] }
  | { type: 'Error'; peer?: string; message: string };
