use std::fs::File;
use std::io::{Read, Write};
use crate::models::Settings;
use tauri::Manager;

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    
    // Ensure parent directory exists
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    
    let file_path = config_dir.join("settings.json");
    if !file_path.exists() {
        let default_settings = Settings {
            env_dir: "/home/solar1/Arushi Tauri App".to_string(),
            cwd_input: "/home/solar1/Arushi Tauri App".to_string(),
            cmd_history: Vec::new(),
            theme: "dark".to_string(),
            git_path: Some("/home/solar1/Arushi Tauri App".to_string()),
            db_path: Some("/home/solar1/Arushi Tauri App/devdock.db".to_string()),
            mirror_dir: Some("/home/solar1/Downloads/Arushi Work/Predictive Maintenance/predictive-maintenance-system-for-atlas-copco-compressors".to_string()),
        };
        let json = serde_json::to_string_pretty(&default_settings).map_err(|e| e.to_string())?;
        let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        return Ok(default_settings);
    }
    
    let mut file = File::open(&file_path).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|e| e.to_string())?;
    
    let settings: Settings = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<String, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    
    let file_path = config_dir.join("settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    let mut file = File::create(file_path).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    
    Ok("Settings saved successfully".to_string())
}
