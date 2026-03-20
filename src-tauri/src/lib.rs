mod window;

use window::WindowHandler;
use tauri::{Emitter, Listener, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::image::Image;
use tauri_plugin_window_state::StateFlags;
use std::time::Duration;
use std::fs;
use std::sync::atomic::{AtomicU8, Ordering};
use base64::Engine;

// 0 = ask (no preference), 1 = hide to tray, 2 = close app
static CLOSE_BEHAVIOR: AtomicU8 = AtomicU8::new(0);

#[derive(serde::Serialize)]
struct FileInfo {
  base64: String,
  size: u64,
  name: String,
  mime_type: String,
}

#[tauri::command]
fn read_file_at_path(path: String) -> Result<FileInfo, String> {
  let file_path = std::path::Path::new(&path);
  if !file_path.exists() {
    return Err(format!("File not found: {}", path));
  }

  let metadata = fs::metadata(file_path).map_err(|e| e.to_string())?;
  let bytes = fs::read(file_path).map_err(|e| e.to_string())?;
  let base64_data = base64::engine::general_purpose::STANDARD.encode(&bytes);

  let name = file_path.file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("file")
    .to_string();

  let mime_type = match file_path.extension().and_then(|e| e.to_str()) {
    Some("png") => "image/png",
    Some("jpg") | Some("jpeg") => "image/jpeg",
    Some("gif") => "image/gif",
    Some("webp") => "image/webp",
    Some("pdf") => "application/pdf",
    Some("json") => "application/json",
    Some("xml") => "application/xml",
    Some("csv") => "text/csv",
    Some("txt") => "text/plain",
    Some("zip") => "application/zip",
    _ => "application/octet-stream",
  }.to_string();

  Ok(FileInfo {
    base64: base64_data,
    size: metadata.len(),
    name,
    mime_type,
  })
}

// behavior: 0 = ask, 1 = hide to tray, 2 = close
#[tauri::command]
fn set_close_behavior(behavior: u8) {
  CLOSE_BEHAVIOR.store(behavior, Ordering::Relaxed);
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) {
  let _ = window.hide();
}

#[tauri::command]
fn close_app(app: tauri::AppHandle) {
  app.exit(0);
}

#[derive(serde::Serialize)]
struct HttpResponse {
  status: u16,
  status_text: String,
  headers: Vec<(String, String)>,
  body: String,
}

#[tauri::command]
async fn http_request(
  method: String,
  url: String,
  headers: Vec<(String, String)>,
  body: Option<Vec<u8>>,
  timeout_ms: Option<u64>,
) -> Result<HttpResponse, String> {
  let client = reqwest::Client::builder()
    .no_proxy()
    .redirect(reqwest::redirect::Policy::limited(10))
    .timeout(Duration::from_millis(timeout_ms.unwrap_or(30000)))
    .build()
    .map_err(|e| e.to_string())?;

  let req_method: reqwest::Method = method.parse().map_err(|_| format!("Invalid method: {}", method))?;
  let mut req = client.request(req_method, &url);

  for (key, value) in &headers {
    req = req.header(key.as_str(), value.as_str());
  }

  if let Some(data) = body {
    req = req.body(data);
  }

  let res = req.send().await.map_err(|e| e.to_string())?;

  let status = res.status().as_u16();
  let status_text = res.status().canonical_reason().unwrap_or("").to_string();

  let mut res_headers = Vec::new();
  for (name, value) in res.headers().iter() {
    if let Ok(v) = value.to_str() {
      res_headers.push((name.as_str().to_string(), v.to_string()));
    }
  }

  let body_text = res.text().await.map_err(|e| e.to_string())?;

  Ok(HttpResponse { status, status_text: status_text, headers: res_headers, body: body_text })
}

pub fn log_to_file(msg: &str) {
  let path = "D:\\post-umbrella\\tauri-debug.log";
  let existing = fs::read_to_string(path).unwrap_or_default();
  let _ = fs::write(path, format!("{}{}\n", existing, msg));
}

fn extract_deep_link(argv: &[String]) -> Option<String> {
  argv.iter()
    .find(|arg| arg.starts_with("postumbrella://"))
    .cloned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let args: Vec<String> = std::env::args().collect();
  log_to_file(&format!("App started with args: {:?}", args));

  let wh = window::handler();

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![http_request, read_file_at_path, set_close_behavior, hide_window, close_app])
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      log_to_file(&format!("Second launch intercepted with args: {:?}", argv));

      if let Some(win) = app.get_webview_window("main") {
        window::handler().focus_window(&win);
      }

      if let Some(url) = extract_deep_link(&argv) {
        inject_tokens(app, &url);
      }
    }))
    .plugin(
      tauri_plugin_window_state::Builder::new()
        .with_state_flags(StateFlags::all() & !StateFlags::DECORATIONS)
        .build(),
    )
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        match CLOSE_BEHAVIOR.load(Ordering::Relaxed) {
          0 => {
            // No preference saved — ask the user
            api.prevent_close();
            let _ = window.emit("close-requested", ());
          }
          1 => {
            // Hide to tray
            api.prevent_close();
            let _ = window.hide();
          }
          _ => {
            // 2 = close normally — don't prevent
          }
        }
      }
    })
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      log_to_file("Setup running");

      if let Some(window) = app.get_webview_window("main") {
        wh.setup_window(&window);
      }

      // System tray
      let show_item = MenuItemBuilder::with_id("show", "Show").build(app)?;
      let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
      let tray_menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

      let tray_icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .expect("Failed to load tray icon");

      let _tray = TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .tooltip("Post Umbrella")
        .on_menu_event(move |app, event| {
          match event.id().as_ref() {
            "show" => {
              if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
              }
            }
            "quit" => {
              app.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
            let app = tray.app_handle();
            if let Some(win) = app.get_webview_window("main") {
              let _ = win.show();
              let _ = win.unminimize();
              let _ = win.set_focus();
            }
          }
        })
        .build(app)?;

      // Handle deep link URLs via event
      let handle = app.handle().clone();
      app.listen("deep-link://new-url", move |event| {
        let payload = event.payload();
        log_to_file(&format!("Deep link event payload: {}", payload));

        let url = payload
          .trim_matches('"')
          .trim_start_matches('[')
          .trim_end_matches(']')
          .trim_matches('"')
          .to_string();

        log_to_file(&format!("Parsed URL: {}", url));
        inject_tokens(&handle, &url);
      });

      // Also check command line args (Windows passes deep link as first arg)
      let args: Vec<String> = std::env::args().collect();
      if let Some(url) = extract_deep_link(&args) {
        log_to_file(&format!("Deep link from CLI arg: {}", url));
        let handle = app.handle().clone();
        std::thread::spawn(move || {
          std::thread::sleep(Duration::from_secs(3));
          inject_tokens(&handle, &url);
        });
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn inject_tokens(handle: &tauri::AppHandle, url: &str) {
  log_to_file(&format!("inject_tokens called with: {}", url));

  let tokens = url.find('?')
    .map(|p| &url[p + 1..])
    .or_else(|| url.find('#').map(|p| &url[p + 1..]));

  if let Some(token_str) = tokens {
    log_to_file(&format!("Token string found: {}...", &token_str[..token_str.len().min(50)]));

    if token_str.contains("access_token") {
      if let Some(window) = handle.get_webview_window("main") {
        let js = format!(
          "window.location.replace('/#{}'); setTimeout(() => window.location.reload(), 200);",
          token_str
        );
        log_to_file("Executing JS in webview");
        let result = window.eval(&js);
        log_to_file(&format!("JS eval result: {:?}", result));
        let _ = window.set_focus();
      } else {
        log_to_file("ERROR: Could not find main window");
      }
    } else {
      log_to_file("ERROR: No access_token in token string");
    }
  } else {
    log_to_file("ERROR: No ? or # found in URL");
  }
}
