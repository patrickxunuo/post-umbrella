use tauri::{Listener, Manager};
use std::time::Duration;
use std::fs;

fn log_to_file(msg: &str) {
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
  // Log the command line args (deep link URL comes as an arg on Windows)
  let args: Vec<String> = std::env::args().collect();
  log_to_file(&format!("App started with args: {:?}", args));

  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      log_to_file(&format!("Second launch intercepted with args: {:?}", argv));

      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
      }

      if let Some(url) = extract_deep_link(&argv) {
        inject_tokens(app, &url);
      }
    }))
    .plugin(tauri_plugin_window_state::Builder::new().build())
    .plugin(tauri_plugin_deep_link::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      log_to_file("Setup running");

      // Force remove window decorations
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_decorations(false);
        log_to_file("Decorations set to false");
      }

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

  // Extract token string (after ? or #)
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
