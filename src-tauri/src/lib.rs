use tauri::Manager;

const CREDENTIAL_SERVICE: &str = "cn.loomi.geminidb-studio";

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
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![save_credential, load_credential, delete_credential])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/IM", "geminidb-bridge.exe"])
                    .output();
            }
        })
        .run(tauri::generate_context!())
        .expect("GeminiDB Studio desktop client failed to start");
}
