#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod linux;

use tauri::WebviewWindow;

pub trait WindowHandler {
    fn setup_window(&self, window: &WebviewWindow);
    fn focus_window(&self, window: &WebviewWindow);
}

#[cfg(target_os = "macos")]
pub fn handler() -> impl WindowHandler {
    macos::MacWindowHandler
}

#[cfg(target_os = "windows")]
pub fn handler() -> impl WindowHandler {
    windows::WindowsHandler
}

#[cfg(target_os = "linux")]
pub fn handler() -> impl WindowHandler {
    linux::LinuxHandler
}
