// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use sidecar::SidecarState;
use std::time::Duration;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // 1. Find Node.js
            let node_bin = sidecar::find_node().map_err(|e| {
                eprintln!("Error: {}", e);
                Box::<dyn std::error::Error>::from(e)
            })?;

            // 2. Resolve resource paths
            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|e| Box::<dyn std::error::Error>::from(format!("Cannot resolve resources: {}", e)))?;

            let script_path = resource_dir.join("dist-server").join("index.js");

            if !script_path.exists() {
                return Err(Box::<dyn std::error::Error>::from(format!(
                    "Server script not found at: {:?}",
                    script_path
                )));
            }

            // 3. Resolve SQLite path
            let home = dirs::home_dir().ok_or_else(|| {
                Box::<dyn std::error::Error>::from("Cannot resolve home directory")
            })?;
            let sqlite_path = home.join(".ai-knowledge").join("knowledge.db");

            // 4. Find available port
            let port = sidecar::find_available_port(3210);

            // 5. Spawn sidecar (returns child process + identity token)
            let (child, token) = sidecar::spawn_node(
                &node_bin,
                &script_path,
                &resource_dir,
                &sqlite_path,
                port,
            )
            .map_err(|e| Box::<dyn std::error::Error>::from(e))?;

            app.manage(SidecarState::new(child));

            // 6. Wait for OUR server to be ready (verifies sidecar token), then navigate WebView
            let window = app
                .get_webview_window("main")
                .expect("Main window not found");

            tauri::async_runtime::spawn(async move {
                let ready = sidecar::wait_for_ready(port, &token, Duration::from_secs(15)).await;
                if ready {
                    let url = format!("http://localhost:{}", port);
                    let _ = window.navigate(url.parse().unwrap());
                } else {
                    let _ = window.eval(&format!(
                        "document.body.innerHTML = '<div style=\"display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;font-family:sans-serif;color:#ef4444;background:#0a0a1a\"><h2>Failed to start server</h2><p>Make sure Node.js is installed and Ollama is running.</p><p>Port: {}</p></div>'",
                        port
                    ));
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: tauri::State<SidecarState> = window.state();
                state.kill();
            }
        })
        .run(tauri::generate_context!())
        .expect("Error while running AI Knowledge Base");
}
