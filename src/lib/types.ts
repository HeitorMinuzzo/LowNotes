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

export type LinkOrigin = 'wikilink' | 'manual' | 'agent';

export interface LinkEdge {
  source: string;
  target: string;
  origin: LinkOrigin;
}

export interface LinkOperation {
  source: string;
  target: string;
  action: 'add' | 'remove';
}

export interface AiProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  selected_model: string;
  is_custom: boolean;
}

export interface AiSettings {
  active_provider_id: string;
  providers: AiProviderConfig[];
  auto_link_notes: boolean;
  web_search_api_key: string;
}

export interface AppSettings {
  device_name: string;
  theme: AppTheme;
  view_mode: ViewMode;
  language: string;
  update_check: boolean;
  skipped_version: string;
  active_vault_id: string | null;
  vaults: VaultConfig[];
  ai: AiSettings;
  has_seen_welcome: boolean;
}

export type AppTheme = 'dark' | 'light';
export type ViewMode = 'edit' | 'split' | 'preview';

export interface RagChunk {
  note_path: string;
  note_title: string;
  section_title: string;
  line_number: number;
  content: string;
  score: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  answer: string;
  sources: RagChunk[];
  web_sources: WebSource[];
  drafts: NoteDraft[];
  warnings: string[];
  vault_id: string;
}

export type AssistantSkill = 'auto' | 'notes' | 'write' | 'research';

export interface NoteDraft {
  path: string;
  content: string;
}

export interface WebSource {
  title: string;
  url: string;
  description: string;
}

export interface PairInfo {
  pair_code: string;
  endpoint_id: string;
}

export interface InitialStateResponse {
  settings: AppSettings;
  active_vault: VaultConfig | null;
  items: VaultItem[];
  pair_info?: PairInfo | null;
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
  | { type: 'RemoteAwareness'; note_path: string; update: number[] }
  | { type: 'Error'; peer?: string; message: string };
