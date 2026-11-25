//! API key storage in Windows Credential Manager (via `keyring`).
//! The key is never written to settings, logs or error messages.

use anyhow::{anyhow, Result};

const SERVICE: &str = "dev.utter.app";
const USER: &str = "anthropic_api_key";

fn entry() -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, USER)
}

/// The stored key, or `None` if unset or the credential store is unavailable.
pub fn get_api_key() -> Option<String> {
    let key = entry().ok()?.get_password().ok()?;
    let key = key.trim().to_string();
    (!key.is_empty()).then_some(key)
}

pub fn set_api_key(key: &str) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(anyhow!("API key is empty"));
    }
    // keyring errors never include the secret, but map them to a fixed message anyway.
    entry()
        .and_then(|e| e.set_password(key))
        .map_err(|e| anyhow!("could not store the API key in the credential manager: {e}"))
}

/// Remove the stored key. Succeeds if there was none.
pub fn clear_api_key() -> Result<()> {
    match entry().and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow!(
            "could not remove the API key from the credential manager: {e}"
        )),
    }
}

/// Last four characters of a key, for display (`None` for keys shorter than 8 chars).
pub fn last4(key: &str) -> Option<String> {
    let chars: Vec<char> = key.chars().collect();
    (chars.len() >= 8).then(|| chars[chars.len() - 4..].iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last4_masks_short_keys() {
        assert_eq!(last4("sk-ant-abcdWXYZ").as_deref(), Some("WXYZ"));
        assert_eq!(last4("short"), None);
    }

    #[test]
    fn rejects_empty_key() {
        assert!(set_api_key("   ").is_err());
    }

    /// Touches the real Windows Credential Manager; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn credential_manager_round_trip() {
        let original = get_api_key();
        set_api_key("sk-ant-test-roundtrip-1234").unwrap();
        assert_eq!(get_api_key().as_deref(), Some("sk-ant-test-roundtrip-1234"));
        clear_api_key().unwrap();
        assert_eq!(get_api_key(), None);
        clear_api_key().unwrap(); // idempotent
        if let Some(k) = original {
            set_api_key(&k).unwrap();
        }
    }
}
