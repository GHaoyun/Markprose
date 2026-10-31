use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const TEXT_EXT: [&str; 6] = ["md", "markdown", "mdown", "mkd", "txt", "text"];
const SKIP_DIRS: [&str; 8] = [".git", "node_modules", "target", "dist", ".obsidian", ".idea", ".vscode", "assets"];

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn mtime_ms(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_text_file(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| TEXT_EXT.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Serialize)]
struct ReadResult {
    content: String,
    mtime: u64,
    size: u64,
}

#[derive(Serialize)]
struct MtimeResult {
    mtime: u64,
}

#[tauri::command]
fn read_text(path: String) -> Result<ReadResult, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("文件不存在：{}", path));
    }
    let bytes = fs::read(&p).map_err(err)?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    Ok(ReadResult {
        size: bytes.len() as u64,
        content,
        mtime: mtime_ms(&p),
    })
}

#[tauri::command]
fn write_text(path: String, content: String) -> Result<MtimeResult, String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(err)?;
        }
    }
    fs::write(&p, content.as_bytes()).map_err(err)?;
    Ok(MtimeResult { mtime: mtime_ms(&p) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    name: String,
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<Node>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mtime: Option<u64>,
}

fn walk_dir(dir: &Path, depth: usize) -> Vec<Node> {
    let mut out: Vec<Node> = Vec::new();
    let rd = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return out,
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".moke" {
            continue;
        }
        let is_dir = path.is_dir();
        if is_dir {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            if depth >= 8 {
                continue;
            }
            let children = walk_dir(&path, depth + 1);
            out.push(Node {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                children: Some(children),
                size: None,
                mtime: None,
            });
        } else if is_text_file(&path) {
            let size = fs::metadata(&path).ok().map(|m| m.len());
            out.push(Node {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                children: None,
                size,
                mtime: Some(mtime_ms(&path)),
            });
        }
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    out
}

#[tauri::command]
fn list_tree(root: String) -> Result<Node, String> {
    let p = PathBuf::from(&root);
    if !p.exists() {
        return Err(format!("目录不存在：{}", root));
    }
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| root.clone());
    Ok(Node {
        name,
        path: p.to_string_lossy().to_string(),
        is_dir: true,
        children: Some(walk_dir(&p, 0)),
        size: None,
        mtime: None,
    })
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err("文件已存在".into());
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(&p, b"").map_err(err)
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(PathBuf::from(path)).map_err(err)
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    fs::rename(PathBuf::from(from), PathBuf::from(to)).map_err(err)
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(err)
    } else {
        fs::remove_file(p).map_err(err)
    }
}

#[derive(Serialize)]
struct SearchHit {
    path: String,
    line: usize,
    text: String,
}

#[tauri::command]
fn search_in_folder(root: String, query: String, limit: usize) -> Result<Vec<SearchHit>, String> {
    let q = query.to_lowercase();
    if q.trim().is_empty() {
        return Ok(vec![]);
    }
    let mut hits: Vec<SearchHit> = Vec::new();
    let root_p = PathBuf::from(&root);
    for entry in WalkDir::new(&root_p)
        .max_depth(10)
        .into_iter()
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && (SKIP_DIRS.contains(&n.as_ref()) || n.starts_with('.')))
        })
        .flatten()
    {
        if hits.len() >= limit {
            break;
        }
        let p = entry.path();
        if !entry.file_type().is_file() || !is_text_file(p) {
            continue;
        }
        if let Ok(content) = fs::read_to_string(p) {
            if content.len() > 4 * 1024 * 1024 {
                continue;
            }
            for (i, line) in content.lines().enumerate() {
                if hits.len() >= limit {
                    break;
                }
                if line.to_lowercase().contains(&q) {
                    hits.push(SearchHit {
                        path: p.to_string_lossy().to_string(),
                        line: i + 1,
                        text: line.chars().take(240).collect(),
                    });
                }
            }
        }
    }
    Ok(hits)
}

#[tauri::command]
fn save_image(dir: String, base64: String, ext: String) -> Result<String, String> {
    if dir.trim().is_empty() {
        return Err("文档还没有保存，没有可写入的目录".into());
    }
    let clean_ext = ext
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>();
    let ext = if clean_ext.is_empty() {
        "png".to_string()
    } else if clean_ext == "jpg" {
        "jpg".to_string()
    } else {
        clean_ext
    };
    let base = PathBuf::from(&dir);
    if !base.is_dir() {
        return Err(format!("文档所在目录不存在：{}", dir));
    }
    let assets = base.join("assets");
    fs::create_dir_all(&assets)
        .map_err(|e| format!("无法创建 assets 文件夹（{}）：{}", assets.display(), e))?;
    let name = format!("image-{}.{}", now_ms(), ext);
    let target = assets.join(&name);
    let data = B64.decode(base64.as_bytes()).map_err(err)?;
    fs::write(&target, data)
        .map_err(|e| format!("无法写入图片（{}）：{}", target.display(), e))?;
    Ok(format!("assets/{}", name))
}

#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|_| format!("图片不存在：{}", path))?;
    if meta.len() > 32 * 1024 * 1024 {
        return Err("图片过大（超过 32MB）".into());
    }
    let data = fs::read(&p).map_err(|e| format!("读取图片失败（{}）：{}", path, e))?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{};base64,{}", mime, B64.encode(data)))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录：{}", e))?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("markprose-settings.json"))
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = settings_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(err)
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = settings_path(&app)?;
    fs::write(p, json).map_err(err)
}

#[tauri::command]
fn default_save_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("无法定位文档目录：{}", e))?;
    let dir = docs.join("Markprose");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.to_string_lossy().to_string())
}

/// 列出系统已安装的字体族名，给设置面板的字体选择器用
#[tauri::command]
fn list_fonts() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;

        const KEY: &str = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
        const SUFFIXES: [&str; 6] = [
            " (TrueType)",
            " (OpenType)",
            " (TrueType Collection)",
            " (All res)",
            " (All Res)",
            " (PostScript)",
        ];

        let mut out: Vec<String> = Vec::new();
        for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            let Ok(sub) = RegKey::predef(root).open_subkey(KEY) else {
                continue;
            };
            for (raw, _) in sub.enum_values().flatten() {
                let mut s = raw.as_str();
                for suffix in SUFFIXES {
                    if let Some(rest) = s.strip_suffix(suffix) {
                        s = rest;
                    }
                }
                // "SimSun & NSimSun" 这类只取第一个族名；@ 开头是竖排变体，跳过
                let family = s.split('&').next().unwrap_or(s).trim();
                if family.is_empty() || family.starts_with('@') {
                    continue;
                }
                let lower = family.to_lowercase();
                if lower.ends_with(".ttf") || lower.ends_with(".otf") || lower.ends_with(".ttc") {
                    continue;
                }
                out.push(family.to_string());
            }
        }
        out.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        out.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        out
    }
    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

/// 启动时带进来的文件（把 .md 拖到 exe 图标上就会走这里）
#[tauri::command]
fn startup_files() -> Vec<String> {
    let mut out = Vec::new();
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let p = PathBuf::from(&arg);
        if p.is_file() && is_text_file(&p) {
            out.push(p.to_string_lossy().to_string());
        }
    }
    out
}

/// 把当前 exe 注册进「打开方式」列表（HKCU，不需要管理员权限）
#[tauri::command]
fn register_file_assoc() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let exe = std::env::current_exe().map_err(err)?;
        let cmd = format!("\"{}\" \"%1\"", exe.display());
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let (app, _) = hkcu
            .create_subkey(r"Software\Classes\Applications\Markprose.exe")
            .map_err(err)?;
        app.set_value("FriendlyAppName", &"Markprose").map_err(err)?;
        let (shell, _) = app
            .create_subkey(r"shell\open\command")
            .map_err(err)?;
        shell.set_value("", &cmd).map_err(err)?;
        let (types, _) = app.create_subkey("SupportedTypes").map_err(err)?;
        for ext in [".md", ".markdown", ".mdown", ".txt"] {
            types.set_value(ext, &"").map_err(err)?;
        }
        let (icon, _) = app.create_subkey("DefaultIcon").map_err(err)?;
        icon.set_value("", &format!("{},0", exe.display())).map_err(err)?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// 当前是不是 .md 的默认程序
#[tauri::command]
fn is_default_app() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey(r"Software\Classes\.md") {
            if let Ok(v) = key.get_value::<String, _>("") {
                return v == "Markprose.md";
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// 尝试把 Markprose 设为 .md 的默认程序。
/// 返回 "set"（已设置）或 "blocked"（被系统 UserChoice 拦住，需要用户手动确认）
#[tauri::command]
fn set_default_app() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let exe = std::env::current_exe().map_err(err)?;
        let cmd = format!("\"{}\" \"%1\"", exe.display());
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // ProgID
        let (prog, _) = hkcu
            .create_subkey(r"Software\Classes\Markprose.md")
            .map_err(err)?;
        prog.set_value("", &"Markprose Markdown 文档").map_err(err)?;
        let (shell, _) = prog.create_subkey(r"shell\open\command").map_err(err)?;
        shell.set_value("", &cmd).map_err(err)?;
        let (icon, _) = prog.create_subkey("DefaultIcon").map_err(err)?;
        icon.set_value("", &format!("{},0", exe.display())).map_err(err)?;

        // 系统里已经有用户选择记录时，程序改不动，只能引导用户去设置页
        let blocked = hkcu
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice")
            .is_ok();

        if !blocked {
            let (ext, _) = hkcu.create_subkey(r"Software\Classes\.md").map_err(err)?;
            ext.set_value("", &"Markprose.md").map_err(err)?;
        }

        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .spawn();

        Ok(if blocked { "blocked".into() } else { "set".into() })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok("blocked".into())
    }
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(err)?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&path).spawn().map_err(err)?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        std::process::Command::new("xdg-open").arg(&path).spawn().map_err(err)?;
        Ok(())
    }
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let p = PathBuf::from(&path);
        if p.is_file() {
            std::process::Command::new("explorer")
                .arg(format!("/select,{}", p.to_string_lossy()))
                .spawn()
                .map_err(err)?;
        } else {
            std::process::Command::new("explorer").arg(&path).spawn().map_err(err)?;
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        open_path(path)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            list_tree,
            path_exists,
            create_file,
            create_dir,
            rename_path,
            delete_path,
            search_in_folder,
            save_image,
            read_image_data_url,
            load_settings,
            save_settings,
            default_save_dir,
            list_fonts,
            startup_files,
            register_file_assoc,
            is_default_app,
            set_default_app,
            open_path,
            reveal_in_explorer
        ])
        .setup(|app| {
            // 无边框窗口不会自动带图标，这里显式设一次，任务栏才会显示新图标
            use tauri::Manager;
            if let Some(icon) = app.default_window_icon().cloned() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_icon(icon);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Markprose 启动失败");
}
