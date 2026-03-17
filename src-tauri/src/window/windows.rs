use super::WindowHandler;
use tauri::WebviewWindow;

pub struct WindowsHandler;

impl WindowHandler for WindowsHandler {
    fn setup_window(&self, window: &WebviewWindow) {
        // Windows: remove native decorations, use custom HTML controls
        let _ = window.set_decorations(false);
        crate::log_to_file("Windows: decorations removed, using custom HTML controls");
    }

    fn focus_window(&self, window: &WebviewWindow) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
