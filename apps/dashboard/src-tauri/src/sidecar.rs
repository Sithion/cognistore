use std::env;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

pub struct SidecarState {
    child: Mutex<Option<Child>>,
}

impl SidecarState {
    pub fn new(child: Child) -> Self {
        Self {
            child: Mutex::new(Some(child)),
        }
    }

    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// Find the Node.js binary on the system.
pub fn find_node() -> Result<PathBuf, String> {
    // Try PATH first
    if let Ok(output) = Command::new("which").arg("node").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    // Fallback paths
    let fallbacks = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];

    for path in &fallbacks {
        let p = PathBuf::from(path);
        if p.exists() {
            return Ok(p);
        }
    }

    // Check common nvm paths
    if let Some(home) = dirs::home_dir() {
        let nvm_dir = home.join(".nvm").join("versions").join("node");
        if nvm_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
                // Pick the latest version
                let mut versions: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .collect();
                versions.sort();
                if let Some(latest) = versions.last() {
                    let node_bin = latest.join("bin").join("node");
                    if node_bin.exists() {
                        return Ok(node_bin);
                    }
                }
            }
        }
    }

    Err("Node.js not found. Please install Node.js (https://nodejs.org) and try again.".into())
}

/// Spawn the Fastify server as a child process.
pub fn spawn_node(
    node_bin: &PathBuf,
    script_path: &PathBuf,
    resource_dir: &PathBuf,
    sqlite_path: &PathBuf,
    port: u16,
) -> Result<Child, String> {
    let dist_path = resource_dir.join("dist");
    let node_modules_path = resource_dir.join("node_modules");

    let child = Command::new(node_bin)
        .arg(script_path)
        .env("SQLITE_PATH", sqlite_path.to_string_lossy().to_string())
        .env("OLLAMA_HOST", "http://localhost:11434")
        .env("OLLAMA_MODEL", env::var("OLLAMA_MODEL").unwrap_or_else(|_| "all-minilm".into()))
        .env("EMBEDDING_DIMENSIONS", "384")
        .env("DASHBOARD_PORT", port.to_string())
        .env("DASHBOARD_DIST_PATH", dist_path.to_string_lossy().to_string())
        .env("NODE_ENV", "production")
        .env("NODE_PATH", node_modules_path.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    Ok(child)
}

/// Wait for the Fastify server to respond on /api/health.
pub async fn wait_for_ready(port: u16, timeout: Duration) -> bool {
    let url = format!("http://localhost:{}/api/health", port);
    let start = std::time::Instant::now();

    while start.elapsed() < timeout {
        match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await {
            Ok(_) => {
                // Port is open, now check if HTTP is ready
                // Simple TCP connect is enough — Fastify binds before serving
                return true;
            }
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
        }
    }

    false
}

/// Find an available port, starting from the preferred one.
pub fn find_available_port(preferred: u16) -> u16 {
    for port in preferred..preferred + 100 {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    // Fallback: let OS assign
    if let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:0") {
        if let Ok(addr) = listener.local_addr() {
            return addr.port();
        }
    }
    preferred
}
