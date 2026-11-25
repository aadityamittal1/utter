//! Win32 foreground-window detection and focus restoration.

use super::classify::AppInfo;

/// The currently focused top-level window, or `None` if there is none / it can't be read.
#[cfg(target_os = "windows")]
pub fn foreground_app() -> Option<AppInfo> {
    use ::windows::core::PWSTR;
    use ::windows::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
    use ::windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    // SAFETY: plain Win32 queries; buffers are sized and lengths come from the API.
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut tbuf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut tbuf);
        let title = String::from_utf16_lossy(&tbuf[..n.max(0) as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut process = String::new();
        if pid != 0 {
            if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buf = [0u16; MAX_PATH as usize * 2];
                let mut len = buf.len() as u32;
                if QueryFullProcessImageNameW(
                    h,
                    PROCESS_NAME_WIN32,
                    PWSTR(buf.as_mut_ptr()),
                    &mut len,
                )
                .is_ok()
                {
                    let path = String::from_utf16_lossy(&buf[..len as usize]);
                    process = path.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase();
                }
                let _ = CloseHandle(h);
            }
        }
        Some(AppInfo {
            process,
            title,
            hwnd: hwnd.0 as isize,
            pid,
        })
    }
}

/// Bring `hwnd` to the foreground. Returns whether it is the foreground window afterwards.
#[cfg(target_os = "windows")]
pub fn focus_window(hwnd: isize) -> bool {
    use ::windows::Win32::Foundation::HWND;
    use ::windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId,
        IsIconic, IsWindow, SetForegroundWindow, ShowWindow, ASFW_ANY, SW_RESTORE,
    };

    let target = HWND(hwnd as *mut core::ffi::c_void);
    // SAFETY: Win32 calls; the handle is validated with IsWindow before use.
    unsafe {
        if hwnd == 0 || !IsWindow(Some(target)).as_bool() {
            return false;
        }
        if IsIconic(target).as_bool() {
            let _ = ShowWindow(target, SW_RESTORE);
        }
        if GetForegroundWindow() == target {
            return true;
        }
        if SetForegroundWindow(target).as_bool() && GetForegroundWindow() == target {
            return true;
        }
        // Refused: borrow the foreground thread's input queue so the request is honoured.
        let _ = AllowSetForegroundWindow(ASFW_ANY);
        let fg = GetForegroundWindow();
        let fg_thread = if fg.0.is_null() {
            0
        } else {
            GetWindowThreadProcessId(fg, None)
        };
        let me = GetCurrentThreadId();
        let attached =
            fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, true).as_bool();
        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);
        if attached {
            let _ = AttachThreadInput(me, fg_thread, false);
        }
        GetForegroundWindow() == target
    }
}

#[cfg(not(target_os = "windows"))]
pub fn foreground_app() -> Option<AppInfo> {
    None
}

#[cfg(not(target_os = "windows"))]
pub fn focus_window(_hwnd: isize) -> bool {
    false
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "needs a desktop session"]
    fn foreground_app_returns_something() {
        let app = super::foreground_app();
        println!("foreground: {app:?}");
        assert!(app.is_some());
    }
}
