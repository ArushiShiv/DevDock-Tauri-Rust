use sysinfo::{System, ProcessesToUpdate};
use crate::state::AppState;
use crate::models::{SystemStats, ProcessInfo};

#[tauri::command]
pub fn get_system_stats(state: tauri::State<'_, AppState>) -> Result<SystemStats, String> {
    let mut sys = state.sys.lock().map_err(|e| e.to_string())?;
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let cpu_usage = sys.global_cpu_usage();
    let ram_used = sys.used_memory();
    let ram_total = sys.total_memory();
    let uptime = System::uptime();
    
    let os_name = System::name().unwrap_or_else(|| "Unknown".to_string());
    let os_version = System::os_version().unwrap_or_else(|| "Unknown".to_string());
    let hostname = System::host_name().unwrap_or_else(|| "Unknown".to_string());

    Ok(SystemStats {
        cpu_usage,
        ram_used,
        ram_total,
        uptime,
        os_name,
        os_version,
        hostname,
    })
}

#[tauri::command]
pub fn get_system_processes(state: tauri::State<'_, AppState>) -> Result<Vec<ProcessInfo>, String> {
    let mut sys = state.sys.lock().map_err(|e| e.to_string())?;
    sys.refresh_processes(ProcessesToUpdate::All, true);
    
    let mut list = Vec::new();
    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().into_owned();
        let cpu_usage = process.cpu_usage();
        let memory = process.memory();
        let status = format!("{:?}", process.status());
        
        let pid_u32 = pid.to_string().parse::<u32>().unwrap_or(0);
        
        list.push(ProcessInfo {
            pid: pid_u32,
            name,
            cpu_usage,
            memory,
            status,
        });
    }
    
    // Sort by CPU usage descending
    list.sort_by(|a, b| b.cpu_usage.partial_cmp(&a.cpu_usage).unwrap_or(std::cmp::Ordering::Equal));
    Ok(list)
}

#[tauri::command]
pub fn log_frontend_error(message: &str) {
    println!("DEBUG FRONTEND ERROR: {}", message);
}

#[tauri::command]
pub fn get_capabilities() -> Result<crate::models::CapabilitiesInfo, String> {
    use std::fs::File;
    use std::io::Read;
    use std::path::Path;

    let mut file_path = Path::new("capabilities/default.json").to_path_buf();
    if !file_path.exists() {
        file_path = Path::new("src-tauri/capabilities/default.json").to_path_buf();
    }
    if !file_path.exists() {
        file_path = Path::new("/home/solar1/Arushi Tauri App/src-tauri/capabilities/default.json").to_path_buf();
    }
    if !file_path.exists() {
        return Err("Capabilities file not found".to_string());
    }

    let mut file = File::open(&file_path).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|e| e.to_string())?;

    let val: serde_json::Value = serde_json::from_str(&contents).map_err(|e| e.to_string())?;

    let identifier = val["identifier"].as_str().unwrap_or("default").to_string();
    let description = val["description"].as_str().unwrap_or("").to_string();
    
    let mut windows = Vec::new();
    if let Some(arr) = val["windows"].as_array() {
        for w in arr {
            if let Some(s) = w.as_str() {
                windows.push(s.to_string());
            }
        }
    }

    let mut permissions = Vec::new();
    if let Some(arr) = val["permissions"].as_array() {
        for p in arr {
            if let Some(s) = p.as_str() {
                permissions.push(s.to_string());
            }
        }
    }

    Ok(crate::models::CapabilitiesInfo {
        identifier,
        description,
        windows,
        permissions,
    })
}
