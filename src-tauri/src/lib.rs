use serde::Serialize;
use std::{fs::OpenOptions, io::Write, sync::Mutex};
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

const CREDENTIAL_SERVICE: &str = "cn.loomi.geminidb-studio";

#[derive(Default)]
struct BridgeProcess {
    child: Mutex<Option<CommandChild>>,
    pid: Mutex<Option<u32>>,
    running: Mutex<bool>,
    error: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeStatus {
    running: bool,
    error: Option<String>,
    log_path: Option<String>,
}

fn bridge_log_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_log_dir().ok().map(|directory| directory.join("bridge.log"))
}

fn write_bridge_log(app: &tauri::AppHandle, level: &str, message: &str) {
    let Some(path) = bridge_log_path(app) else { return };
    if let Some(directory) = path.parent() {
        let _ = std::fs::create_dir_all(directory);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or_default();
        let _ = writeln!(file, "[{timestamp}] {level}: {}", message.trim());
    }
}

fn record_bridge_error(app: &tauri::AppHandle, message: String) {
    *app.state::<BridgeProcess>().running.lock().unwrap() = false;
    *app.state::<BridgeProcess>().error.lock().unwrap() = Some(message.clone());
    write_bridge_log(app, "ERROR", &message);
}

fn start_bridge(app: &tauri::AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        *app.state::<BridgeProcess>().running.lock().unwrap() = true;
        return Ok(());
    }

    let (mut events, child) = app
        .shell()
        .sidecar("binaries/geminidb-bridge")
        .map_err(|error| format!("找不到 GeminiDB Bridge：{error}"))?
        .args(["--parent-pid", &std::process::id().to_string()])
        .spawn()
        .map_err(|error| format!("无法启动 GeminiDB Bridge：{error}"))?;

    let pid = child.pid();
    *app.state::<BridgeProcess>().child.lock().unwrap() = Some(child);
    *app.state::<BridgeProcess>().pid.lock().unwrap() = Some(pid);
    *app.state::<BridgeProcess>().running.lock().unwrap() = true;
    *app.state::<BridgeProcess>().error.lock().unwrap() = None;
    write_bridge_log(app, "INFO", &format!("Bridge 已启动，PID {pid}"));
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    write_bridge_log(&app_handle, "STDERR", &String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(payload) => {
                    let is_current = *app_handle.state::<BridgeProcess>().pid.lock().unwrap() == Some(pid);
                    if is_current {
                        record_bridge_error(&app_handle, format!("GeminiDB Bridge 已退出：{payload:?}"));
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn stop_bridge(app: &tauri::AppHandle) {
    let child = app.state::<BridgeProcess>().child.lock().unwrap().take();
    *app.state::<BridgeProcess>().pid.lock().unwrap() = None;
    *app.state::<BridgeProcess>().running.lock().unwrap() = false;
    let Some(child) = child else { return };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let pid = child.pid().to_string();
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    // Idempotent fallback: if taskkill already ended the process this simply fails harmlessly.
    let _ = child.kill();
    write_bridge_log(app, "INFO", "Bridge 已随桌面客户端退出");
}

#[tauri::command]
fn bridge_status(app: tauri::AppHandle) -> BridgeStatus {
    let state = app.state::<BridgeProcess>();
    BridgeStatus {
        running: *state.running.lock().unwrap(),
        error: state.error.lock().unwrap().clone(),
        log_path: bridge_log_path(&app).map(|path| path.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
fn restart_bridge(app: tauri::AppHandle) -> BridgeStatus {
    stop_bridge(&app);
    if let Err(error) = start_bridge(&app) {
        record_bridge_error(&app, error);
    }
    bridge_status(app)
}

#[tauri::command]
fn save_credential(id: String, password: String) -> Result<(), String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, &id).map_err(|e| e.to_string())?.set_password(&password).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_credential(id: String) -> Result<Option<String>, String> {
    match keyring::Entry::new(CREDENTIAL_SERVICE, &id).map_err(|e| e.to_string())?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_credential(id: String) -> Result<(), String> {
    match keyring::Entry::new(CREDENTIAL_SERVICE, &id).map_err(|e| e.to_string())?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(BridgeProcess::default())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if let Err(error) = start_bridge(app.handle()) {
                record_bridge_error(app.handle(), error);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_credential,
            load_credential,
            delete_credential,
            bridge_status,
            restart_bridge
        ])
        .build(tauri::generate_context!())
        .expect("GeminiDB Studio desktop client failed to start");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_bridge(app);
        }
    });
}
