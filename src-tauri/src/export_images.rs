use std::{path::{Path, PathBuf}, time::Duration};
use anyhow::{bail, Context};
use serde::Serialize;

const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Serialize)]
pub struct ExportImageData { pub bytes: Vec<u8>, pub mime_type: String }

fn decode_path(value: &str) -> anyhow::Result<String> {
    let mut bytes = Vec::new();
    let source = value.as_bytes();
    let mut index = 0;
    while index < source.len() {
        if source[index] == b'%' {
            let hex = source.get(index + 1..index + 3).context("export.imageFailed")?;
            bytes.push(u8::from_str_radix(std::str::from_utf8(hex)?, 16)?);
            index += 3;
        } else { bytes.push(source[index]); index += 1; }
    }
    Ok(String::from_utf8(bytes)?)
}

fn local_image_path(root: &Path, note_path: &str, src: &str) -> anyhow::Result<PathBuf> {
    let source = decode_path(src.split(['?', '#']).next().unwrap_or_default())?.replace('\\', "/");
    let note = note_path.replace('\\', "/");
    if source.contains(':') || note.contains(':') { bail!("export.imageFailed"); }
    let parent = if source.starts_with('/') { "" } else { note.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("") };
    let mut components = Vec::new();
    for part in parent.split('/').chain(source.trim_start_matches('/').split('/')) {
        match part {
            "" | "." => {},
            ".." => { if components.pop().is_none() { bail!("export.imageFailed"); } },
            value => components.push(value),
        }
    }
    let canonical_root = root.canonicalize()?;
    let candidate = components.iter().fold(canonical_root.clone(), |path, part| path.join(part)).canonicalize()?;
    if !candidate.starts_with(&canonical_root) || !candidate.is_file() { bail!("export.imageFailed"); }
    Ok(candidate)
}

fn image_data(bytes: Vec<u8>) -> anyhow::Result<ExportImageData> {
    if bytes.len() > MAX_IMAGE_BYTES { bail!("export.imageFailed"); }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
        else if bytes.starts_with(b"\xff\xd8\xff") { "image/jpeg" }
        else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { "image/gif" }
        else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { "image/webp" }
        else if bytes.starts_with(b"BM") { "image/bmp" }
        else if std::str::from_utf8(&bytes).map(|text| text.trim_start_matches('\u{feff}').trim_start().starts_with("<svg")
            || (text.trim_start().starts_with("<?xml") && text.contains("<svg"))).unwrap_or(false) { "image/svg+xml" }
        else { bail!("export.imageFailed"); };
    Ok(ExportImageData { bytes, mime_type: mime.into() })
}

pub async fn load_image(root: &Path, note_path: &str, src: &str) -> anyhow::Result<ExportImageData> {
    let bytes = if src.starts_with("https://") || src.starts_with("http://") {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(5)).build()?;
        let mut response = client.get(src).send().await?.error_for_status()?;
        if response.content_length().unwrap_or(0) > MAX_IMAGE_BYTES as u64 { bail!("export.imageFailed"); }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > MAX_IMAGE_BYTES { bail!("export.imageFailed"); }
            bytes.extend_from_slice(&chunk);
        }
        bytes
    } else {
        let path = local_image_path(root, note_path, src)?;
        if std::fs::metadata(&path)?.len() > MAX_IMAGE_BYTES as u64 { bail!("export.imageFailed"); }
        std::fs::read(path)?
    };
    image_data(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_note_relative_images_and_rejects_vault_escape() {
        let root = std::env::temp_dir().join(format!("lownotes-images-{}", rand::random::<u64>()));
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("assets/image name.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        let expected = root.join("assets/image name.png").canonicalize().unwrap();
        assert_eq!(local_image_path(&root, "notes/note.md", "../assets/image%20name.png").unwrap(), expected);
        assert_eq!(local_image_path(&root, "notes/note.md", "/assets/image%20name.png").unwrap(), expected);
        assert!(local_image_path(&root, "note.md", "../outside.png").is_err());
        assert!(local_image_path(&root, "note.md", "C:/outside.png").is_err());
        assert!(local_image_path(&root, "note.md", "%2e%2e/outside.png").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn validates_image_data_and_size() {
        assert_eq!(image_data(b"\x89PNG\r\n\x1a\n".to_vec()).unwrap().mime_type, "image/png");
        assert_eq!(image_data(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>".to_vec()).unwrap().mime_type, "image/svg+xml");
        assert!(image_data(b"secret text".to_vec()).is_err());
        assert!(image_data(vec![0; MAX_IMAGE_BYTES + 1]).is_err());
    }
}
