//! Resumable, hash-verified model downloader.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

use super::catalog::ModelInfo;

/// Downloads `info` into `dir`, streaming to `<file>.part` (resuming with an HTTP
/// Range request if one exists), verifies the sha256, then renames into place.
/// `progress(downloaded, total)` is called as bytes arrive. On a hash mismatch the
/// `.part` file is deleted and an error is returned. On cancel the `.part` is kept.
pub async fn download_model(
    info: &ModelInfo,
    dir: &Path,
    cancel: CancellationToken,
    progress: impl Fn(u64, u64) + Send,
) -> Result<PathBuf> {
    tokio::fs::create_dir_all(dir)
        .await
        .context("create models dir")?;
    let final_path = dir.join(info.file);
    let part_path = dir.join(format!("{}.part", info.file));
    let total = info.size_bytes;

    let mut have = tokio::fs::metadata(&part_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    if have > total {
        let _ = tokio::fs::remove_file(&part_path).await;
        have = 0;
    }

    if have < total {
        let client = reqwest::Client::new();
        let mut req = client.get(info.url);
        if have > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let resp = req.send().await.context("request model")?;
        let status = resp.status();
        let mut file = if status == reqwest::StatusCode::PARTIAL_CONTENT && have > 0 {
            tokio::fs::OpenOptions::new()
                .append(true)
                .open(&part_path)
                .await?
        } else if status.is_success() {
            // Server ignored the range (or fresh start): restart from zero.
            have = 0;
            tokio::fs::File::create(&part_path).await?
        } else {
            bail!("download failed: HTTP {status}");
        };

        let mut stream = resp.bytes_stream();
        let mut done = have;
        progress(done, total);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    file.flush().await.ok();
                    bail!("download cancelled");
                }
                chunk = stream.next() => match chunk {
                    Some(chunk) => {
                        let chunk = chunk.context("download stream")?;
                        file.write_all(&chunk).await?;
                        done += chunk.len() as u64;
                        progress(done.min(total), total);
                    }
                    None => break,
                }
            }
        }
        file.flush().await?;
        drop(file);
    }

    let actual = hash_file(&part_path).await?;
    if !actual.eq_ignore_ascii_case(info.sha256) {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err(anyhow!(
            "checksum mismatch for {} (got {actual})",
            info.file
        ));
    }
    tokio::fs::rename(&part_path, &final_path)
        .await
        .context("finalize model file")?;
    Ok(final_path)
}

async fn hash_file(path: &Path) -> Result<String> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || -> Result<String> {
        use std::io::Read;
        let mut f = std::fs::File::open(&path)?;
        let mut h = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = f.read(&mut buf)?;
            if n == 0 {
                break;
            }
            h.update(&buf[..n]);
        }
        Ok(hex::encode(h.finalize()))
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    fn leak(s: String) -> &'static str {
        Box::leak(s.into_boxed_str())
    }

    fn info_for(body: &[u8], url: String, sha: Option<String>) -> ModelInfo {
        ModelInfo {
            id: "t",
            label: "t",
            file: "ggml-t.bin",
            url: leak(url),
            size_bytes: body.len() as u64,
            sha256: leak(sha.unwrap_or_else(|| hex::encode(Sha256::digest(body)))),
            multilingual: false,
        }
    }

    #[tokio::test]
    async fn download_resumes_from_part_file() {
        let body: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("GET", "/m.bin")
            .match_header("range", "bytes=4000-")
            .with_status(206)
            .with_body(&body[4000..])
            .create_async()
            .await;
        let info = info_for(&body, format!("{}/m.bin", server.url()), None);
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("ggml-t.bin.part"), &body[..4000]).unwrap();

        let last = Arc::new(AtomicU64::new(0));
        let l2 = last.clone();
        let path = download_model(&info, dir.path(), CancellationToken::new(), move |d, _| {
            l2.store(d, Ordering::SeqCst)
        })
        .await
        .unwrap();

        m.assert_async().await;
        assert_eq!(std::fs::read(&path).unwrap(), body);
        assert!(!dir.path().join("ggml-t.bin.part").exists());
        assert_eq!(last.load(Ordering::SeqCst), body.len() as u64);
    }

    #[tokio::test]
    async fn download_rejects_bad_hash() {
        let body = vec![7u8; 2048];
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("GET", "/m.bin")
            .with_status(200)
            .with_body(&body)
            .create_async()
            .await;
        let info = info_for(
            &body,
            format!("{}/m.bin", server.url()),
            Some("0".repeat(64)),
        );
        let dir = tempfile::tempdir().unwrap();

        let err = download_model(&info, dir.path(), CancellationToken::new(), |_, _| {})
            .await
            .unwrap_err();
        assert!(err.to_string().contains("checksum"), "{err}");
        assert!(!dir.path().join("ggml-t.bin.part").exists());
        assert!(!dir.path().join("ggml-t.bin").exists());
    }
}
