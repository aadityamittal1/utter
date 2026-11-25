//! Whisper model catalog: the models Utter can download, with pinned sizes and hashes.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub size_bytes: u64,
    pub sha256: &'static str,
    pub multilingual: bool,
}

static CATALOG: &[ModelInfo] = &[
    ModelInfo {
        id: "base",
        label: "Base (fast)",
        file: "ggml-base.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        size_bytes: 147_951_465,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        multilingual: true,
    },
    ModelInfo {
        id: "small-q5_1",
        label: "Small (balanced)",
        file: "ggml-small-q5_1.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
        size_bytes: 190_085_487,
        sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
        multilingual: true,
    },
    ModelInfo {
        id: "large-v3-turbo-q5_0",
        label: "Large v3 Turbo (most accurate)",
        file: "ggml-large-v3-turbo-q5_0.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
        size_bytes: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        multilingual: true,
    },
];

pub fn catalog() -> &'static [ModelInfo] {
    CATALOG
}

/// Default model: `small-q5_1` took ~14 s for an 11.6 s clip on the dev machine (x64
/// emulated), well over the 1500 ms bar, so the default is `base` (~3.7 s there).
/// See docs/DEVELOPMENT.md > Benchmarks.
pub fn default_model_id() -> &'static str {
    "base"
}

pub fn model_path(models_dir: &Path, id: &str) -> PathBuf {
    let file = catalog().iter().find(|m| m.id == id).map(|m| m.file).unwrap_or(id);
    models_dir.join(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_unique_and_hashes_are_64_hex() {
        assert!(catalog().len() >= 3);
        let mut ids: Vec<_> = catalog().iter().map(|m| m.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), catalog().len());
        for m in catalog() {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit()), "{}", m.id);
            assert!(m.url.ends_with(m.file));
            assert!(m.size_bytes > 0);
        }
        assert!(catalog().iter().any(|m| m.id == default_model_id()));
    }

    #[test]
    fn model_path_joins_catalog_file() {
        let p = model_path(Path::new("x"), "base");
        assert!(p.ends_with("ggml-base.bin"));
    }
}


