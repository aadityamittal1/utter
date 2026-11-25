//! Clipboard snapshot / restore and text set, via the Win32 clipboard API.

use std::time::Duration;

use ::windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use ::windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
    GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use ::windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};

pub const CF_UNICODETEXT: u32 = 13;

/// Total bytes a snapshot may hold; larger formats are skipped (and so not restored).
pub const SNAPSHOT_CAP_BYTES: usize = 32 * 1024 * 1024;

/// Whether a format of `len` bytes still fits under the cap given `used` bytes so far.
pub fn fits_budget(used: usize, len: usize) -> bool {
    used.checked_add(len)
        .is_some_and(|t| t <= SNAPSHOT_CAP_BYTES)
}

/// Formats that are handles to GDI objects (not HGLOBAL byte blobs) or are synthesized by
/// Windows from other formats; these are skipped when snapshotting.
fn skip_format(fmt: u32) -> bool {
    matches!(
        fmt,
        1 // CF_TEXT (synthesized from UNICODETEXT)
        | 2 // CF_BITMAP (GDI handle; synthesized from DIB)
        | 3 // CF_METAFILEPICT
        | 7 // CF_OEMTEXT
        | 9 // CF_PALETTE
        | 14 // CF_ENHMETAFILE
        | 0x0080..=0x008F // CF_OWNERDISPLAY / DSP*
    ) || (0x0300..=0x03FF).contains(&fmt) // CF_GDIOBJFIRST..LAST
}

/// Open the clipboard, retrying (it can be briefly held by another process).
fn open_clipboard() -> anyhow::Result<()> {
    let mut last = None;
    for _ in 0..20 {
        // SAFETY: plain Win32 call; the clipboard is closed by `ClipboardGuard`.
        match unsafe { OpenClipboard(None) } {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Err(anyhow::anyhow!("could not open clipboard: {:?}", last))
}

struct ClipboardGuard;

impl ClipboardGuard {
    fn open() -> anyhow::Result<Self> {
        open_clipboard()?;
        Ok(Self)
    }
}

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        // SAFETY: we hold the clipboard open (guard only exists after a successful open).
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

pub fn clipboard_seq() -> u32 {
    // SAFETY: no preconditions.
    unsafe { GetClipboardSequenceNumber() }
}

/// Allocate a moveable global block holding `bytes` and hand it to the (already open,
/// emptied) clipboard under `fmt`. Ownership transfers to the system on success.
fn put_bytes(fmt: u32, bytes: &[u8]) -> anyhow::Result<()> {
    // SAFETY: standard GlobalAlloc/GlobalLock/copy/SetClipboardData sequence; the block is
    // freed ourselves only when SetClipboardData fails.
    unsafe {
        let hmem = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1))?;
        let ptr = GlobalLock(hmem) as *mut u8;
        if ptr.is_null() {
            let _ = GlobalFree(Some(hmem));
            anyhow::bail!("GlobalLock failed");
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(hmem);
        if let Err(e) = SetClipboardData(fmt, Some(HANDLE(hmem.0))) {
            let _ = GlobalFree(Some(hmem));
            return Err(e.into());
        }
    }
    Ok(())
}

fn put_dword_format(name: ::windows::core::PCWSTR, value: u32) {
    // SAFETY: `name` is a valid NUL-terminated wide string literal.
    let fmt = unsafe { RegisterClipboardFormatW(name) };
    if fmt != 0 {
        let _ = put_bytes(fmt, &value.to_le_bytes());
    }
}

fn set_text_inner(text: &str, private: bool) -> anyhow::Result<u32> {
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    let bytes: Vec<u8> = wide.iter().flat_map(|w| w.to_le_bytes()).collect();
    {
        let _g = ClipboardGuard::open()?;
        // SAFETY: clipboard is open.
        unsafe { EmptyClipboard()? };
        put_bytes(CF_UNICODETEXT, &bytes)?;
        if private {
        // Keep dictated text out of clipboard history / cloud clipboard / clipboard monitors.
        put_dword_format(
            ::windows::core::w!("ExcludeClipboardContentFromMonitorProcessing"),
            1,
        );
        put_dword_format(::windows::core::w!("CanIncludeInClipboardHistory"), 0);
        put_dword_format(::windows::core::w!("CanUploadToCloudClipboard"), 0);
        }
    } // clipboard closed here
    // CloseClipboard itself bumps the sequence number, so it must be read AFTER closing;
    // reading while open yields a stale value and the restore would never fire.
    Ok(clipboard_seq())
}

/// Replace the clipboard contents with `text`; returns the clipboard sequence number after the set.
pub fn set_clipboard_text(text: &str) -> anyhow::Result<u32> {
    set_text_inner(text, false)
}

/// Like `set_clipboard_text`, but flagged so clipboard history / cloud sync ignore it
/// (used for dictated text that is only on the clipboard to be pasted).
pub fn set_clipboard_text_private(text: &str) -> anyhow::Result<u32> {
    set_text_inner(text, true)
}
/// Read the clipboard's current text, if any.
pub fn get_clipboard_text() -> Option<String> {
    let _g = ClipboardGuard::open().ok()?;
    let bytes = read_format(CF_UNICODETEXT, 0)?;
    #[allow(clippy::chunks_exact_to_as_chunks)] // lint suggestion needs a newer MSRV than we target
    let wide: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let end = wide.iter().position(|&w| w == 0).unwrap_or(wide.len());
    Some(String::from_utf16_lossy(&wide[..end]))
}

/// Read one format as bytes. Caller must hold the clipboard open.
fn read_format(fmt: u32, used: usize) -> Option<Vec<u8>> {
    // SAFETY: clipboard is open; the handle is an HGLOBAL for byte formats, locked while read.
    unsafe {
        let h = GetClipboardData(fmt).ok()?;
        if h.0.is_null() {
            return None;
        }
        let hg = HGLOBAL(h.0);
        let size = GlobalSize(hg);
        if size == 0 || !fits_budget(used, size) {
            return None;
        }
        let ptr = GlobalLock(hg) as *const u8;
        if ptr.is_null() {
            return None;
        }
        let v = std::slice::from_raw_parts(ptr, size).to_vec();
        let _ = GlobalUnlock(hg);
        Some(v)
    }
}

/// Every byte-readable clipboard format at a moment in time.
#[derive(Debug, Default, Clone)]
pub struct ClipboardSnapshot {
    formats: Vec<(u32, Vec<u8>)>,
}

impl ClipboardSnapshot {
    /// None if the clipboard could not be opened (never restore from a failed snapshot).
    pub fn take() -> Option<Self> {
        let Ok(_g) = ClipboardGuard::open() else {
            return None;
        };
        let mut formats = Vec::new();
        let mut used = 0usize;
        let mut fmt = 0u32;
        loop {
            // SAFETY: clipboard is open.
            fmt = unsafe { EnumClipboardFormats(fmt) };
            if fmt == 0 {
                break;
            }
            if skip_format(fmt) {
                continue;
            }
            if let Some(bytes) = read_format(fmt, used) {
                used += bytes.len();
                formats.push((fmt, bytes));
            }
        }
        Some(Self { formats })
    }

    pub fn is_empty(&self) -> bool {
        self.formats.is_empty()
    }

    pub fn has_format(&self, fmt: u32) -> bool {
        self.formats.iter().any(|(f, _)| *f == fmt)
    }

    pub fn restore(&self) {
        let Ok(_g) = ClipboardGuard::open() else {
            log::warn!("clipboard restore: could not open clipboard");
            return;
        };
        // SAFETY: clipboard is open.
        if unsafe { EmptyClipboard() }.is_err() {
            log::warn!("clipboard restore: EmptyClipboard failed");
            return;
        }
        for (fmt, bytes) in &self.formats {
            if let Err(e) = put_bytes(*fmt, bytes) {
                log::warn!("clipboard restore: format {fmt} failed: {e}");
            }
        }
    }
}

/// True if the clipboard currently offers `fmt`.
pub fn clipboard_has_format(fmt: u32) -> bool {
    let Ok(_g) = ClipboardGuard::open() else {
        return false;
    };
    // SAFETY: clipboard is open.
    let mut f = 0u32;
    loop {
        f = unsafe { EnumClipboardFormats(f) };
        if f == 0 {
            return false;
        }
        if f == fmt {
            return true;
        }
    }
}

/// Place a small 2x2 24-bit DIB on the clipboard (used by tests).
pub fn set_clipboard_dib_for_test() -> anyhow::Result<()> {
    // BITMAPINFOHEADER (40 bytes) + 2 rows of 8 bytes (2px*3 + 2 pad).
    let mut b = Vec::new();
    b.extend_from_slice(&40u32.to_le_bytes());
    b.extend_from_slice(&2i32.to_le_bytes());
    b.extend_from_slice(&2i32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&24u16.to_le_bytes());
    b.extend_from_slice(&[0u8; 24]);
    b.extend_from_slice(&[255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0]);
    let _g = ClipboardGuard::open()?;
    // SAFETY: clipboard is open.
    unsafe { EmptyClipboard()? };
    put_bytes(8, &b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_rules() {
        assert!(skip_format(2));
        assert!(skip_format(0x0301));
        assert!(!skip_format(CF_UNICODETEXT));
        assert!(!skip_format(8));
        assert!(!skip_format(15));
    }

    /// Regression: the returned seq must still be current after the set returns (CloseClipboard
    /// bumps it), otherwise `should_restore` can never succeed.
    #[test]
    #[ignore = "uses the real system clipboard"]
    fn returned_seq_is_current_after_set() {
        let saved = ClipboardSnapshot::take();
        let seq = set_clipboard_text_private("utter seq test").expect("set");
        let now = clipboard_seq();
        if let Some(s) = saved {
            s.restore();
        }
        assert_eq!(seq, now);
    }

    #[test]
    fn snapshot_budget() {
        assert!(fits_budget(0, SNAPSHOT_CAP_BYTES));
        assert!(!fits_budget(1, SNAPSHOT_CAP_BYTES));
        assert!(!fits_budget(SNAPSHOT_CAP_BYTES, 1));
        assert!(!fits_budget(usize::MAX, 1));
    }
}
