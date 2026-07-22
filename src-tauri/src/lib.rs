use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

const CREDENTIAL_SERVICE: &str = "cn.loomi.geminidb-studio";

#[derive(Default)]
struct BridgeProcess(Mutex<Option<CommandChild>>);

fn start_bridge(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        return Ok(());
    }

    let (mut events, child) = app
        .shell()
        .sidecar("binaries/geminidb-bridge")?
        .args(["--parent-pid", &std::process::id().to_string()])
        .spawn()?;

    *app.state::<BridgeProcess>().0.lock().unwrap() = Some(child);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            if let CommandEvent::Stderr(bytes) = event {
                eprintln!("[Bridge] {}", String::from_utf8_lossy(&bytes));
            }
        }
    });
    Ok(())
}

fn stop_bridge(app: &tauri::AppHandle) {
    let child = app.state::<BridgeProcess>().0.lock().unwrap().take();
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
        .setup(|app| start_bridge(app.handle()))
        .invoke_handler(tauri::generate_handler![save_credential, load_credential, delete_credential])
        .build(tauri::generate_context!())
        .expect("GeminiDB Studio desktop client failed to start");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_bridge(app);
        }
    });
}
