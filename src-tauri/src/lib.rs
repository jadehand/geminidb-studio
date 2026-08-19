use serde::Serialize;
use std::{fs::OpenOptions, io::Write, path::{Component, Path, PathBuf}, sync::Mutex, time::UNIX_EPOCH};
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

const CREDENTIAL_SERVICE: &str = "cn.loomi.geminidb-studio";
const MAX_NOTE_BYTES: u64 = 1_048_576;
const MAX_NOTE_COUNT: usize = 500;

#[derive(Default)]
struct NotesRoot(Mutex<Option<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteDocument { path: String, content: String, modified_ms: u64 }

fn note_relative_path(value: &str) -> Result<PathBuf, String> {
    let path=Path::new(value);
    if path.as_os_str().is_empty() || path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) { return Err("笔记路径无效".into()) }
    if !path.extension().and_then(|value|value.to_str()).is_some_and(|value|value.eq_ignore_ascii_case("md")) { return Err("仅支持 Markdown 文件".into()) }
    Ok(path.to_path_buf())
}

fn notes_root(app:&tauri::AppHandle)->Result<PathBuf,String>{app.state::<NotesRoot>().0.lock().unwrap().clone().ok_or_else(||"尚未授权个人笔记目录".into())}
fn contained_note(root:&Path, relative:&str, must_exist:bool)->Result<PathBuf,String>{
    let relative=note_relative_path(relative)?;let target=root.join(relative);
    if must_exist { let metadata=std::fs::symlink_metadata(&target).map_err(|_|"笔记不存在".to_string())?;if metadata.file_type().is_symlink(){return Err("不允许访问符号链接笔记".into())}let canonical=target.canonicalize().map_err(|e|e.to_string())?;if !canonical.starts_with(root){return Err("笔记路径超出授权目录".into())}Ok(canonical) }
    else { let parent=target.parent().ok_or_else(||"笔记路径无效".to_string())?.canonicalize().map_err(|_|"笔记目录不存在".to_string())?;if !parent.starts_with(root){return Err("笔记路径超出授权目录".into())}Ok(target) }
}

#[tauri::command]
fn authorize_notes_directory(app:tauri::AppHandle,directory:String)->Result<String,String>{let root=PathBuf::from(directory).canonicalize().map_err(|_|"笔记目录不存在或不可访问".to_string())?;if !root.is_dir(){return Err("请选择一个目录".into())}*app.state::<NotesRoot>().0.lock().unwrap()=Some(root.clone());Ok(root.to_string_lossy().into_owned())}

fn collect_notes(root:&Path,folder:&Path,notes:&mut Vec<NoteDocument>,depth:u8)->Result<(),String>{
    if notes.len()>=MAX_NOTE_COUNT || depth>12{return Ok(())}for entry in std::fs::read_dir(folder).map_err(|e|format!("读取笔记目录失败：{e}"))?{let entry=entry.map_err(|e|e.to_string())?;let metadata=entry.file_type().map_err(|e|e.to_string())?;if metadata.is_symlink(){continue}let path=entry.path();if metadata.is_dir(){collect_notes(root,&path,notes,depth+1)?}else if path.extension().and_then(|v|v.to_str()).is_some_and(|v|v.eq_ignore_ascii_case("md")){let size=entry.metadata().map_err(|e|e.to_string())?.len();if size>MAX_NOTE_BYTES{continue}let content=std::fs::read_to_string(&path).map_err(|e|format!("读取笔记失败：{e}"))?;let modified_ms=entry.metadata().ok().and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map(|v|v.as_millis() as u64).unwrap_or_default();let relative=path.strip_prefix(root).map_err(|_|"笔记路径超出授权目录".to_string())?.to_string_lossy().replace('\\',"/");notes.push(NoteDocument{path:relative,content,modified_ms});if notes.len()>=MAX_NOTE_COUNT{return Ok(())}}}Ok(())
}

#[tauri::command]
fn list_notes(app:tauri::AppHandle)->Result<Vec<NoteDocument>,String>{let root=notes_root(&app)?;let mut notes=Vec::new();collect_notes(&root,&root,&mut notes,0)?;notes.sort_by(|a,b|b.modified_ms.cmp(&a.modified_ms));Ok(notes)}
#[tauri::command]
fn write_note(app:tauri::AppHandle,path:String,content:String)->Result<String,String>{if content.len() as u64>MAX_NOTE_BYTES{return Err("单篇笔记不能超过 1 MB".into())}let root=notes_root(&app)?;let target=contained_note(&root,&path,root.join(&path).exists())?;std::fs::write(&target,content).map_err(|e|format!("保存笔记失败：{e}"))?;Ok(path)}
#[tauri::command]
fn rename_note(app:tauri::AppHandle,path:String,new_name:String)->Result<String,String>{if Path::new(&new_name).file_name().and_then(|v|v.to_str())!=Some(new_name.as_str()){return Err("新笔记名称无效".into())}note_relative_path(&new_name)?;let root=notes_root(&app)?;let source=contained_note(&root,&path,true)?;let target=source.parent().unwrap().join(&new_name);if target.exists(){return Err("同名笔记已存在".into())}std::fs::rename(&source,&target).map_err(|e|format!("重命名失败：{e}"))?;Ok(target.strip_prefix(&root).map_err(|_|"笔记路径超出授权目录".to_string())?.to_string_lossy().replace('\\',"/"))}
#[tauri::command]
fn delete_note(app:tauri::AppHandle,path:String)->Result<(),String>{let root=notes_root(&app)?;let target=contained_note(&root,&path,true)?;std::fs::remove_file(target).map_err(|e|format!("删除笔记失败：{e}"))}

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

    let data_dir = app.path().app_data_dir()
        .map_err(|error| format!("无法获取 GeminiDB Studio 数据目录：{error}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("无法创建 GeminiDB Studio 数据目录：{error}"))?;
    let parent_pid = std::process::id().to_string();
    let data_dir = data_dir
        .to_str()
        .ok_or_else(|| "GeminiDB Studio 数据目录不是有效的 UTF-8 路径，无法启动 Bridge".to_string())?
        .to_string();
    let (mut events, child) = app
        .shell()
        .sidecar("geminidb-bridge")
        .map_err(|error| format!("找不到 GeminiDB Bridge：{error}"))?
        .args(["--parent-pid", &parent_pid, "--data-dir", &data_dir])
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
    let running = *state.running.lock().unwrap();
    let error = state.error.lock().unwrap().clone();
    BridgeStatus {
        running,
        error,
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
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
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

#[tauri::command]
fn export_result_file(
    app: tauri::AppHandle,
    directory: String,
    filename: String,
    content: String,
) -> Result<String, String> {
    let name = std::path::Path::new(&filename);
    if name.file_name().and_then(|value| value.to_str()) != Some(filename.as_str()) {
        return Err("导出文件名无效".into());
    }
    let extension = name.extension().and_then(|value| value.to_str()).unwrap_or_default();
    if !matches!(extension, "csv" | "xls" | "json") {
        return Err("仅支持导出 CSV、Excel 或 JSON".into());
    }
    let folder = if directory.trim().is_empty() {
        app.path().download_dir().map_err(|error| format!("无法读取系统下载目录：{error}"))?
    } else {
        std::path::PathBuf::from(directory)
    };
    if !folder.is_dir() {
        return Err("导出目录不存在或不可访问".into());
    }
    let path = folder.join(name);
    std::fs::write(&path, content).map_err(|error| format!("写入导出文件失败：{error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(BridgeProcess::default())
        .manage(NotesRoot::default())
        .plugin(tauri_plugin_dialog::init())
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
            export_result_file,
            bridge_status,
            restart_bridge,
            exit_app,
            authorize_notes_directory,
            list_notes,
            write_note,
            rename_note,
            delete_note
        ])
        .build(tauri::generate_context!())
        .expect("GeminiDB Studio desktop client failed to start");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_bridge(app);
        }
    });
}
