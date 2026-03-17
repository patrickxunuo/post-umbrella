use super::WindowHandler;
use tauri::WebviewWindow;

pub struct LinuxHandler;

impl WindowHandler for LinuxHandler {
    fn setup_window(&self, window: &WebviewWindow) {
        // Linux: remove native decorations, use custom HTML controls (same as Windows)
        let _ = window.set_decorations(false);
        crate::log_to_file("Linux: decorations removed, using custom HTML controls");
    }

    fn focus_window(&self, window: &WebviewWindow) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
