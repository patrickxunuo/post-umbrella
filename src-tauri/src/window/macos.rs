use super::WindowHandler;
use tauri::{WebviewWindow, TitleBarStyle};
use cocoa::appkit::{NSView, NSWindow, NSWindowButton, NSWindowTitleVisibility};
use cocoa::base::{id, nil};
use cocoa::foundation::NSPoint;
use objc::{msg_send, sel, sel_impl};

const HEADER_HEIGHT: f64 = 36.0;

pub struct MacWindowHandler;

impl WindowHandler for MacWindowHandler {
    fn setup_window(&self, window: &WebviewWindow) {
        let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
        let _ = window.set_title("");

        unsafe {
            let ns_win = window.ns_window().unwrap() as id;
            ns_win.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
            let _: () = msg_send![ns_win, setTitlebarAppearsTransparent: true];
        }

        // Delay initial positioning so it runs after macOS finishes its layout pass
        let win1 = window.clone();
        let win2 = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            let _ = win1.run_on_main_thread(move || {
                unsafe {
                    if let Ok(raw) = win2.ns_window() {
                        position_traffic_lights(raw as id);
                    }
                }
            });
        });

        // Re-apply on resize and focus (macOS resets button positions on these events)
        let win_clone = window.clone();
        window.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Resized { .. } | tauri::WindowEvent::Focused(true)
            ) {
                unsafe {
                    if let Ok(raw) = win_clone.ns_window() {
                        position_traffic_lights(raw as id);
                    }
                }
            }
        });

        crate::log_to_file("macOS: configured titlebar");
    }

    fn focus_window(&self, window: &WebviewWindow) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

unsafe fn position_traffic_lights(ns_window: id) {
    let close = ns_window.standardWindowButton_(NSWindowButton::NSWindowCloseButton);
    if close == nil { return; }

    let container: id = msg_send![close, superview];
    if container == nil { return; }

    let titlebar: id = msg_send![container, superview];
    if titlebar == nil { return; }

    let close_frame = NSView::frame(close);
    let btn_h = close_frame.size.height;
    let btn_y_in_container = close_frame.origin.y;
    let tb_frame = NSView::frame(titlebar);
    let container_frame = NSView::frame(container);

    // Cocoa y=0 is at the bottom of the titlebar view.
    // We want button center at HEADER_HEIGHT/2 from the window top.
    // Window top in titlebar coords = tb_frame.size.height.
    // Target button bottom (in titlebar coords):
    let target_btn_y = tb_frame.size.height - (HEADER_HEIGHT / 2.0) - (btn_h / 2.0);

    // The close button sits at btn_y_in_container within the container.
    // So container_y + btn_y_in_container = target_btn_y.
    let container_y = target_btn_y - btn_y_in_container;

    let origin = NSPoint { x: container_frame.origin.x, y: container_y };
    let _: () = msg_send![container, setFrameOrigin: origin];
}
