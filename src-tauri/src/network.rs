use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, bail};
use iroh::{Endpoint, SecretKey, endpoint::presets};
use iroh_tickets::endpoint::EndpointTicket;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tauri::{AppHandle, Emitter};

use crate::{
    config::{PairInvite, PeerConfig, encode_pair_code},
    vault::{self, Manifest, NoteMeta},
};

const ALPN: &[u8] = b"lownotes/sync/1";
const MAX_PACKET_BYTES: usize = 12 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairInfo {
    pub pair_code: String,
    pub endpoint_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NetworkEventPayload {
    Ready {
        pair_code: String,
        endpoint_id: String,
    },
    Syncing {
        peer: String,
    },
    Synced {
        peer: String,
        changed: usize,
        direct: Option<bool>,
    },
    PairRequested {
        request_id: String,
        peer: PeerConfig,
    },
    PairApproved {
        peer: PeerConfig,
    },
    PairRejected {
        peer: String,
    },
    RemoteCrdtUpdate {
        note_path: String,
        update: Vec<u8>,
    },
    Error {
        peer: Option<String>,
        message: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub enum Packet {
    PairRequest {
        token: String,
        requester: PeerConfig,
    },
    PairDecision {
        accepted: bool,
        responder: Option<PeerConfig>,
    },
    Manifest(Manifest),
    Put {
        meta: NoteMeta,
        content: Vec<u8>,
    },
    Request {
        path: String,
    },
    CrdtUpdate {
        note_path: String,
        update: Vec<u8>,
    },
    Delete {
        path: String,
    },
    Done,
}

enum NetworkCommand {
    SyncNow,
    RequestPair(PairInvite),
    AnswerPair { request_id: String, accept: bool },
    BroadcastCrdt { note_path: String, update: Vec<u8> },
    BroadcastDelete { note_path: String },
}

#[derive(Clone)]
pub struct NetworkIdentity {
    pub device_name: String,
    pub secret_key: SecretKey,
    pub pairing_token: String,
    pub vault_id: String,
    pub vault_name: String,
}

pub struct NetworkService {
    peers: Arc<RwLock<Vec<PeerConfig>>>,
    commands: tokio::sync::mpsc::UnboundedSender<NetworkCommand>,
    pair_info: Arc<RwLock<Option<PairInfo>>>,
}

impl NetworkService {
    pub fn start(
        vault: PathBuf,
        identity: NetworkIdentity,
        initial_peers: Vec<PeerConfig>,
        app: AppHandle,
    ) -> Self {
        let peers = Arc::new(RwLock::new(initial_peers));
        let worker_peers = peers.clone();
        let (command_tx, command_rx) = tokio::sync::mpsc::unbounded_channel();
        let pair_info = Arc::new(RwLock::new(None::<PairInfo>));
        let worker_pair_info = pair_info.clone();

        std::thread::Builder::new()
            .name("lownotes-network".to_owned())
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .worker_threads(2)
                    .thread_name("lownotes-io")
                    .build();

                match runtime {
                    Ok(rt) => {
                        if let Err(err) = rt.block_on(run_network(
                            vault,
                            identity,
                            worker_peers,
                            worker_pair_info,
                            command_rx,
                            app.clone(),
                        )) {
                            eprintln!("[p2p] network unavailable: {err:#}");
                            let _ = app.emit(
                                "p2p:error",
                                NetworkEventPayload::Error {
                                    peer: None,
                                    message: "errors.networkUnavailable".to_string(),
                                },
                            );
                        }
                    }
                    Err(err) => {
                        let _ = app.emit(
                            "p2p:error",
                            NetworkEventPayload::Error {
                                peer: None,
                                message: format!("falha ao criar runtime de rede: {err}"),
                            },
                        );
                    }
                }
            })
            .expect("failed to spawn network thread");

        Self {
            peers,
            commands: command_tx,
            pair_info,
        }
    }

    pub fn pair_info(&self) -> Option<PairInfo> {
        self.pair_info.read().clone()
    }

    pub fn update_peers(&self, peers: Vec<PeerConfig>) {
        *self.peers.write() = peers;
    }

    pub fn sync_now(&self) {
        let _ = self.commands.send(NetworkCommand::SyncNow);
    }

    pub fn request_pair(&self, invite: PairInvite) {
        let _ = self.commands.send(NetworkCommand::RequestPair(invite));
    }

    pub fn answer_pair(&self, request_id: String, accept: bool) {
        let _ = self
            .commands
            .send(NetworkCommand::AnswerPair { request_id, accept });
    }

    pub fn broadcast_crdt_update(&self, note_path: String, update: Vec<u8>) {
        let _ = self
            .commands
            .send(NetworkCommand::BroadcastCrdt { note_path, update });
    }

    pub fn broadcast_delete(&self, note_path: String) {
        let _ = self
            .commands
            .send(NetworkCommand::BroadcastDelete { note_path });
    }
}

async fn run_network(
    vault: PathBuf,
    identity: NetworkIdentity,
    peers: Arc<RwLock<Vec<PeerConfig>>>,
    pair_info: Arc<RwLock<Option<PairInfo>>>,
    mut commands: tokio::sync::mpsc::UnboundedReceiver<NetworkCommand>,
    app: AppHandle,
) -> anyhow::Result<()> {
    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(identity.secret_key.clone())
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await?;

    publish_pair_code(&endpoint, &identity, &app, &pair_info);

    let online_ep = endpoint.clone();
    let online_id = identity.clone();
    let online_app = app.clone();
    let online_pair_info = pair_info.clone();
    tokio::spawn(async move {
        let _ = tokio::time::timeout(Duration::from_secs(10), online_ep.online()).await;
        publish_pair_code(&online_ep, &online_id, &online_app, &online_pair_info);
    });

    let pending_answers = Arc::new(tokio::sync::Mutex::new(HashMap::<
        String,
        tokio::sync::oneshot::Sender<bool>,
    >::new()));

    // Accept loop
    let accept_ep = endpoint.clone();
    let accept_peers = peers.clone();
    let accept_app = app.clone();
    let accept_vault = vault.clone();
    let accept_token = identity.pairing_token.clone();
    let accept_answers = pending_answers.clone();
    let accept_ident = identity.clone();

    tokio::spawn(async move {
        while let Some(incoming) = accept_ep.accept().await {
            let p_peers = accept_peers.clone();
            let p_app = accept_app.clone();
            let p_vault = accept_vault.clone();
            let p_token = accept_token.clone();
            let p_answers = accept_answers.clone();
            let p_ident = accept_ident.clone();

            let p_ep = accept_ep.clone();
            tokio::spawn(async move {
                let res = handle_incoming_connection(
                    p_ep,
                    incoming,
                    p_peers,
                    p_app,
                    p_vault,
                    p_token,
                    p_answers,
                    p_ident,
                )
                .await;
                if let Err(e) = res {
                    eprintln!("[p2p accept error]: {e}");
                }
            });
        }
    });

    // Command loop
    let sync_in_flight = Arc::new(parking_lot::Mutex::new(HashSet::<String>::new()));
    let pair_in_flight = Arc::new(parking_lot::Mutex::new(HashSet::<String>::new()));

    while let Some(cmd) = commands.recv().await {
        match cmd {
            NetworkCommand::SyncNow => {
                let known: Vec<PeerConfig> = peers.read().clone();
                for peer in known {
                    spawn_sync(
                        endpoint.clone(),
                        vault.clone(),
                        peer,
                        app.clone(),
                        sync_in_flight.clone(),
                    );
                }
            }
            NetworkCommand::RequestPair(invite) => {
                let target_id = invite.peer.endpoint_id.clone();
                let inserted = pair_in_flight.lock().insert(target_id.clone());
                if !inserted {
                    continue;
                }
                let ep = endpoint.clone();
                let my_peers = peers.clone();
                let my_app = app.clone();
                let my_ident = identity.clone();
                let in_flight = pair_in_flight.clone();

                tokio::spawn(async move {
                    let res = dial_pair(ep, invite, my_ident, my_peers.clone(), my_app.clone()).await;
                    in_flight.lock().remove(&target_id);
                    if let Err(e) = res {
                        let _ = my_app.emit(
                            "p2p:error",
                            NetworkEventPayload::Error {
                                peer: Some(target_id),
                                message: format!("falha ao parear: {e:#}"),
                            },
                        );
                    }
                });
            }
            NetworkCommand::AnswerPair { request_id, accept } => {
                let mut map = pending_answers.lock().await;
                if let Some(sender) = map.remove(&request_id) {
                    let _ = sender.send(accept);
                }
            }
            NetworkCommand::BroadcastCrdt { note_path, update } => {
                let known: Vec<PeerConfig> = peers.read().clone();
                for peer in known {
                    let ep = endpoint.clone();
                    let n_path = note_path.clone();
                    let u_bytes = update.clone();
                    tokio::spawn(async move {
                        let _ = send_crdt_to_peer(ep, peer, n_path, u_bytes).await;
                    });
                }
            }
            NetworkCommand::BroadcastDelete { note_path } => {
                let known: Vec<PeerConfig> = peers.read().clone();
                for peer in known {
                    let ep = endpoint.clone();
                    let n_path = note_path.clone();
                    tokio::spawn(async move {
                        let _ = send_delete_to_peer(ep, peer, n_path).await;
                    });
                }
            }
        }
    }

    Ok(())
}
fn publish_pair_code(
    endpoint: &Endpoint,
    identity: &NetworkIdentity,
    app: &AppHandle,
    pair_info: &Arc<RwLock<Option<PairInfo>>>,
) {
    let addr = endpoint.addr();
    let ticket = EndpointTicket::new(addr);
    let endpoint_id = endpoint.id().to_string();
    let invite = PairInvite {
        peer: PeerConfig {
            name: identity.device_name.clone(),
            endpoint_id: endpoint_id.clone(),
            ticket: ticket.to_string(),
        },
        token: identity.pairing_token.clone(),
        vault_id: identity.vault_id.clone(),
        vault_name: identity.vault_name.clone(),
    };
    if let Ok(code) = encode_pair_code(&invite) {
        *pair_info.write() = Some(PairInfo {
            pair_code: code.clone(),
            endpoint_id: endpoint_id.clone(),
        });
        let _ = app.emit(
            "p2p:ready",
            NetworkEventPayload::Ready {
                pair_code: code,
                endpoint_id,
            },
        );
    }
}

async fn handle_incoming_connection(
    endpoint: Endpoint,
    incoming: iroh::endpoint::Incoming,
    peers: Arc<RwLock<Vec<PeerConfig>>>,
    app: AppHandle,
    vault: PathBuf,
    pairing_token: String,
    pending_answers: Arc<tokio::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>,
    identity: NetworkIdentity,
) -> anyhow::Result<()> {
    let connection = incoming.await?;
    let remote_id = connection.remote_id();
    let (mut send, mut recv) = connection.accept_bi().await?;

    let packet: Packet = recv_packet(&mut recv).await?;

    match packet {
        Packet::PairRequest { token, requester } => {
            let already_known = peers.read().iter().any(|p| p.endpoint_id == remote_id.to_string());
            let (accepted, request_id) = if already_known {
                (true, None)
            } else if token != pairing_token {
                (false, None)
            } else {
                let req_id = remote_id.to_string();
                let (tx, rx) = tokio::sync::oneshot::channel();
                {
                    let mut lock = pending_answers.lock().await;
                    if let Some(prev) = lock.insert(req_id.clone(), tx) {
                        let _ = prev.send(false);
                    }
                }
                let _ = app.emit(
                    "p2p:pair-requested",
                    NetworkEventPayload::PairRequested {
                        request_id: req_id.clone(),
                        peer: requester.clone(),
                    },
                );

                let answer = tokio::time::timeout(Duration::from_secs(120), rx)
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or(false);

                {
                    let mut lock = pending_answers.lock().await;
                    lock.remove(&req_id);
                }
                (answer, Some(req_id))
            };

            let responder_info = if accepted {
                Some(PeerConfig {
                    name: identity.device_name,
                    endpoint_id: endpoint.id().to_string(),
                    ticket: EndpointTicket::new(endpoint.addr()).to_string(),
                })
            } else {
                None
            };

            send_packet(&mut send, &Packet::PairDecision { accepted, responder: responder_info }).await?;
            send.finish()?;
            let _ = tokio::time::timeout(Duration::from_secs(5), send.stopped()).await;

            if accepted && !already_known {
                peers.write().push(requester.clone());
                let _ = app.emit(
                    "p2p:pair-approved",
                    NetworkEventPayload::PairApproved {
                        peer: requester,
                    },
                );
            } else if !accepted {
                if let Some(r_id) = request_id {
                    let _ = app.emit(
                        "p2p:pair-rejected",
                        NetworkEventPayload::PairRejected {
                            peer: r_id,
                        },
                    );
                }
            }
            connection.close(0u32.into(), b"pair complete");
        }
        Packet::Manifest(remote_manifest) => {
            let peer = peers
                .read()
                .iter()
                .find(|p| p.endpoint_id == remote_id.to_string())
                .cloned()
                .context("errors.unauthorizedDevice")?;

            let changed = serve_sync(&mut send, &mut recv, &vault, remote_manifest).await?;
            connection.close(0u32.into(), b"sync complete");

            let direct = connection_is_direct(&connection);
            let _ = app.emit(
                "p2p:synced",
                NetworkEventPayload::Synced {
                    peer: peer.name,
                    changed,
                    direct,
                },
            );
        }
        Packet::CrdtUpdate { note_path, update } => {
            let is_peer = peers.read().iter().any(|p| p.endpoint_id == remote_id.to_string());
            if is_peer {
                let _ = app.emit(
                    "p2p:crdt-update",
                    NetworkEventPayload::RemoteCrdtUpdate {
                        note_path,
                        update,
                    },
                );
            }
        }
        Packet::Delete { path } => {
            let is_peer = peers.read().iter().any(|p| p.endpoint_id == remote_id.to_string());
            if is_peer {
                let _ = vault::delete_item(&vault, &path);
            }
        }
        _ => bail!("errors.unexpectedPacketStart"),
    }

    Ok(())
}

async fn dial_pair(
    endpoint: Endpoint,
    invite: PairInvite,
    identity: NetworkIdentity,
    peers: Arc<RwLock<Vec<PeerConfig>>>,
    app: AppHandle,
) -> anyhow::Result<()> {
    let addr = invite.peer.endpoint_addr()?;
    let connection = endpoint.connect(addr, ALPN).await?;
    let (mut send, mut recv) = connection.open_bi().await?;

    let my_requester = PeerConfig {
        name: identity.device_name,
        endpoint_id: endpoint.id().to_string(),
        ticket: EndpointTicket::new(endpoint.addr()).to_string(),
    };

    send_packet(
        &mut send,
        &Packet::PairRequest {
            token: invite.token,
            requester: my_requester,
        },
    )
    .await?;

    let response: Packet = tokio::time::timeout(Duration::from_secs(120), recv_packet(&mut recv))
        .await
        .context("o outro computador demorou para responder")??;

    match response {
        Packet::PairDecision { accepted: true, .. } => {
            let peer = invite.peer;
            peers.write().push(peer.clone());
            let _ = app.emit(
                "p2p:pair-approved",
                NetworkEventPayload::PairApproved {
                    peer: peer.clone(),
                },
            );
            connection.close(0u32.into(), b"paired");
            Ok(())
        }
        Packet::PairDecision { accepted: false, .. } => {
            bail!("errors.pairRejected");
        }
        _ => bail!("errors.invalidPairResponse"),
    }
}

fn spawn_sync(
    endpoint: Endpoint,
    vault: PathBuf,
    peer: PeerConfig,
    app: AppHandle,
    in_flight: Arc<parking_lot::Mutex<HashSet<String>>>,
) {
    let target = peer.endpoint_id.clone();
    if !in_flight.lock().insert(target.clone()) {
        return;
    }

    tokio::spawn(async move {
        let _ = app.emit(
            "p2p:syncing",
            NetworkEventPayload::Syncing {
                peer: peer.name.clone(),
            },
        );

        let res = dial_sync(endpoint, vault, peer.clone()).await;
        in_flight.lock().remove(&target);

        match res {
            Ok((changed, direct)) => {
                let _ = app.emit(
                    "p2p:synced",
                    NetworkEventPayload::Synced {
                        peer: peer.name,
                        changed,
                        direct,
                    },
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "p2p:error",
                    NetworkEventPayload::Error {
                        peer: Some(peer.name),
                        message: format!("erro ao sincronizar: {e:#}"),
                    },
                );
            }
        }
    });
}

async fn dial_sync(
    endpoint: Endpoint,
    vault: PathBuf,
    peer: PeerConfig,
) -> anyhow::Result<(usize, Option<bool>)> {
    let addr = peer.endpoint_addr()?;
    let connection = endpoint.connect(addr, ALPN).await?;
    let (mut send, mut recv) = connection.open_bi().await?;

    let my_manifest = vault::build_manifest(&vault)?;
    send_packet(&mut send, &Packet::Manifest(my_manifest.clone())).await?;

    let mut changed = 0;
    loop {
        let packet: Packet = recv_packet(&mut recv).await?;
        match packet {
            Packet::Request { path } => {
                let bytes = vault::read_note(&vault, &path)?;
                let meta = my_manifest.get(&path).context("meta ausente")?;
                send_packet(&mut send, &Packet::Put { meta: meta.clone(), content: bytes.into_bytes() }).await?;
            }
            Packet::Put { meta, content } => {
                let str_content = String::from_utf8(content)?;
                vault::save_note(&vault, &meta.path, &str_content)?;
                changed += 1;
            }
            Packet::Done => break,
            _ => bail!("errors.unexpectedPacketSync"),
        }
    }

    let direct = connection_is_direct(&connection);
    connection.close(0u32.into(), b"sync done");
    Ok((changed, direct))
}

async fn serve_sync(
    send: &mut iroh::endpoint::SendStream,
    recv: &mut iroh::endpoint::RecvStream,
    vault: &Path,
    remote_manifest: Manifest,
) -> anyhow::Result<usize> {
    let local_manifest = vault::build_manifest(vault)?;
    let mut changed = 0;

    // Send notes that remote doesn't have or remote has older
    for (path, local_meta) in &local_manifest {
        let needs_send = match remote_manifest.get(path) {
            None => true,
            Some(remote_meta) => local_meta.modified_ms > remote_meta.modified_ms && local_meta.hash != remote_meta.hash,
        };

        if needs_send {
            if let Ok(text) = vault::read_note(vault, path) {
                send_packet(send, &Packet::Put { meta: local_meta.clone(), content: text.into_bytes() }).await?;
            }
        }
    }

    // Request notes that remote has newer
    for (path, remote_meta) in &remote_manifest {
        let needs_request = match local_manifest.get(path) {
            None => true,
            Some(local_meta) => remote_meta.modified_ms > local_meta.modified_ms && local_meta.hash != remote_meta.hash,
        };

        if needs_request {
            send_packet(send, &Packet::Request { path: path.clone() }).await?;
            let packet: Packet = recv_packet(recv).await?;
            if let Packet::Put { meta, content } = packet {
                if let Ok(text) = String::from_utf8(content) {
                    vault::save_note(vault, &meta.path, &text)?;
                    changed += 1;
                }
            }
        }
    }

    send_packet(send, &Packet::Done).await?;
    Ok(changed)
}

async fn send_crdt_to_peer(
    endpoint: Endpoint,
    peer: PeerConfig,
    note_path: String,
    update: Vec<u8>,
) -> anyhow::Result<()> {
    let addr = peer.endpoint_addr()?;
    let connection = endpoint.connect(addr, ALPN).await?;
    let (mut send, _) = connection.open_bi().await?;
    send_packet(&mut send, &Packet::CrdtUpdate { note_path, update }).await?;
    send.finish()?;
    let _ = tokio::time::timeout(Duration::from_secs(2), send.stopped()).await;
    connection.close(0u32.into(), b"crdt sent");
    Ok(())
}

async fn send_delete_to_peer(
    endpoint: Endpoint,
    peer: PeerConfig,
    path: String,
) -> anyhow::Result<()> {
    let addr = peer.endpoint_addr()?;
    let connection = endpoint.connect(addr, ALPN).await?;
    let (mut send, _) = connection.open_bi().await?;
    send_packet(&mut send, &Packet::Delete { path }).await?;
    send.finish()?;
    let _ = tokio::time::timeout(Duration::from_secs(2), send.stopped()).await;
    connection.close(0u32.into(), b"delete sent");
    Ok(())
}

fn connection_is_direct(connection: &iroh::endpoint::Connection) -> Option<bool> {
    let paths = connection.paths();
    let selected = paths.iter().find(|path| path.is_selected())?;
    Some(selected.is_ip())
}

async fn send_packet(stream: &mut iroh::endpoint::SendStream, packet: &Packet) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(packet)?;
    if bytes.len() > MAX_PACKET_BYTES {
        bail!("errors.packetTooLarge");
    }
    stream.write_all(&(bytes.len() as u32).to_be_bytes()).await?;
    stream.write_all(&bytes).await?;
    Ok(())
}

async fn recv_packet<T: DeserializeOwned>(stream: &mut iroh::endpoint::RecvStream) -> anyhow::Result<T> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_PACKET_BYTES {
        bail!("pacote recebido grande demais");
    }
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    Ok(serde_json::from_slice(&buf)?)
}
