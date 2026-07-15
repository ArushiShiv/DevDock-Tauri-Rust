// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use serde::Serialize;
use sysinfo::System;
use tauri::Emitter;

struct AppState {
    sys: Mutex<System>,
    processes: Arc<Mutex<HashMap<String, Child>>>,
}

#[derive(Serialize)]
struct SystemStats {
    cpu_usage: f32,
    ram_used: u64,
    ram_total: u64,
    uptime: u64,
    os_name: String,
    os_version: String,
    hostname: String,
}

#[derive(Serialize)]
struct DockerContainer {
    id: String,
    name: String,
    image: String,
    status: String,
    state: String,
    ports: String,
}

#[derive(Serialize)]
struct PortInfo {
    port: u16,
    process_name: String,
    pid: u32,
    protocol: String,
}

#[derive(Serialize, serde::Deserialize)]
struct EnvPair {
    key: String,
    value: String,
}

#[derive(Clone, Serialize)]
struct ProcessOutputPayload {
    id: String,
    text: String,
    is_error: bool,
}

#[derive(Clone, Serialize)]
struct ProcessStatusPayload {
    id: String,
    status: String,
    exit_code: Option<i32>,
}

#[tauri::command]
fn get_system_stats(state: tauri::State<'_, AppState>) -> Result<SystemStats, String> {
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
fn get_docker_containers() -> Result<Vec<DockerContainer>, String> {
    let output = Command::new("docker")
        .args(&["ps", "-a", "--format", "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Ports}}"])
        .output();
        
    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut containers = Vec::new();
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split('|').collect();
                if parts.len() >= 5 {
                    containers.push(DockerContainer {
                        id: parts[0].to_string(),
                        name: parts[1].to_string(),
                        image: parts[2].to_string(),
                        status: parts[3].to_string(),
                        state: parts[4].to_string(),
                        ports: parts.get(5).unwrap_or(&"").to_string(),
                    });
                }
            }
            Ok(containers)
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Err(format!("Docker command failed: {}", stderr))
        }
        Err(e) => {
            Err(format!("Docker is not running or not installed: {}", e))
        }
    }
}

#[tauri::command]
fn control_container(id: &str, action: &str) -> Result<String, String> {
    if action != "start" && action != "stop" && action != "restart" {
        return Err("Invalid action".to_string());
    }
    
    let output = Command::new("docker")
        .args(&[action, id])
        .output()
        .map_err(|e| format!("Failed to execute docker: {}", e))?;
        
    if output.status.success() {
        Ok(format!("Container {} successfully {}ed", id, action))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to {} container: {}", action, stderr))
    }
}

#[tauri::command]
fn get_container_logs(id: &str, tail: u32) -> Result<String, String> {
    let tail_str = tail.to_string();
    let output = Command::new("docker")
        .args(&["logs", "--tail", &tail_str, id])
        .output()
        .map_err(|e| format!("Failed to execute docker: {}", e))?;
        
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    Ok(format!("{}{}", stdout, stderr))
}

#[tauri::command]
fn get_active_ports() -> Result<Vec<PortInfo>, String> {
    let output = Command::new("lsof")
        .args(&["-iTCP", "-sTCP:LISTEN", "-P", "-n"])
        .output();
        
    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut ports = Vec::new();
            for (idx, line) in stdout.lines().enumerate() {
                if idx == 0 { continue; }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 9 {
                    let process_name = parts[0].to_string();
                    let pid = parts[1].parse::<u32>().unwrap_or(0);
                    let name_col = parts[8];
                    
                    if let Some(pos) = name_col.rfind(':') {
                        let port_str = &name_col[pos+1..];
                        if let Ok(port) = port_str.parse::<u16>() {
                            ports.push(PortInfo {
                                port,
                                process_name,
                                pid,
                                protocol: "TCP".to_string(),
                            });
                        }
                    }
                }
            }
            ports.sort_by_key(|p| p.port);
            Ok(ports)
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Err(format!("lsof failed: {}", stderr))
        }
        Err(e) => {
            Err(format!("Failed to run lsof (is it installed?): {}", e))
        }
    }
}

#[tauri::command]
fn kill_process(pid: u32) -> Result<String, String> {
    let output = Command::new("kill")
        .args(&["-9", &pid.to_string()])
        .output()
        .map_err(|e| format!("Failed to run kill command: {}", e))?;
        
    if output.status.success() {
        Ok(format!("Process {} killed successfully", pid))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to kill process: {}", stderr))
    }
}

#[tauri::command]
fn list_env_files(dir_path: &str) -> Result<Vec<String>, String> {
    println!("DEBUG: list_env_files called with dir_path: '{}'", dir_path);
    let path = Path::new(dir_path);
    if !path.is_dir() {
        println!("DEBUG: '{}' is not a directory", dir_path);
        return Err("Not a directory".to_string());
    }
    
    let entries = std::fs::read_dir(path).map_err(|e| {
        println!("DEBUG: Failed to read directory: {}", e);
        e.to_string()
    })?;
    
    let mut files = Vec::new();
    for entry in entries {
        if let Ok(entry) = entry {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            println!("DEBUG: Discovered file: '{}'", file_name);
            if file_name == ".env" || file_name.starts_with(".env.") {
                files.push(file_name);
            }
        }
    }
    files.sort();
    println!("DEBUG: Returning files: {:?}", files);
    Ok(files)
}

#[tauri::command]
fn read_env_file(file_path: &str) -> Result<Vec<EnvPair>, String> {
    println!("DEBUG: read_env_file called with file_path: '{}'", file_path);
    let path = Path::new(file_path);
    if !path.is_file() {
        println!("DEBUG: '{}' is not a file", file_path);
        return Err("Not a file".to_string());
    }
    
    let file = File::open(path).map_err(|e| {
        println!("DEBUG: Failed to open file: {}", e);
        e.to_string()
    })?;
    let reader = BufReader::new(file);
    let mut pairs = Vec::new();
    
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        
        if let Some(pos) = trimmed.find('=') {
            let key = trimmed[..pos].trim().to_string();
            let mut value = trimmed[pos+1..].trim().to_string();
            
            if (value.starts_with('"') && value.ends_with('"')) || (value.starts_with('\'') && value.ends_with('\'')) {
                if value.len() >= 2 {
                    value = value[1..value.len()-1].to_string();
                }
            }
            
            pairs.push(EnvPair { key, value });
        }
    }
    
    println!("DEBUG: read_env_file returning {} pairs", pairs.len());
    Ok(pairs)
}

#[tauri::command]
fn save_env_file(file_path: &str, pairs: Vec<EnvPair>) -> Result<String, String> {
    let path = Path::new(file_path);
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    
    for pair in pairs {
        let clean_key = pair.key.trim();
        if clean_key.is_empty() {
            continue;
        }
        
        let value = pair.value.trim();
        let formatted_value = if value.contains(' ') && !value.starts_with('"') {
            format!("\"{}\"", value)
        } else {
            value.to_string()
        };
        
        writeln!(file, "{}={}", clean_key, formatted_value).map_err(|e| e.to_string())?;
    }
    
    Ok("Env file saved successfully".to_string())
}

#[tauri::command]
fn run_process(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    id: String,
    command: String,
    cwd: String,
) -> Result<String, String> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Command cannot be empty".to_string());
    }
    
    let program = parts[0];
    let args = &parts[1..];
    
    let mut cmd = Command::new(program);
    cmd.args(args);
    
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn process: {}", e))?;
    
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    
    {
        let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
        processes.insert(id.clone(), child);
    }
    
    let window_stdout = window.clone();
    let id_stdout = id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line_text) = line {
                let _ = window_stdout.emit(
                    "process-output",
                    ProcessOutputPayload {
                        id: id_stdout.clone(),
                        text: line_text,
                        is_error: false,
                    },
                );
            }
        }
    });
    
    let window_stderr = window.clone();
    let id_stderr = id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line_text) = line {
                let _ = window_stderr.emit(
                    "process-output",
                    ProcessOutputPayload {
                        id: id_stderr.clone(),
                        text: line_text,
                        is_error: true,
                    },
                );
            }
        }
    });
    
    let window_exit = window.clone();
    let id_exit = id.clone();
    let processes_clone = state.processes.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let mut processes = processes_clone.lock().unwrap();
            if let Some(child) = processes.get_mut(&id_exit) {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let _ = window_exit.emit(
                            "process-status",
                            ProcessStatusPayload {
                                id: id_exit.clone(),
                                status: "exit".to_string(),
                                exit_code: status.code(),
                            },
                        );
                        processes.remove(&id_exit);
                        break;
                    }
                    Ok(None) => {
                        // Still running
                    }
                    Err(_) => {
                        let _ = window_exit.emit(
                            "process-status",
                            ProcessStatusPayload {
                                id: id_exit.clone(),
                                status: "error".to_string(),
                                exit_code: None,
                            },
                        );
                        processes.remove(&id_exit);
                        break;
                    }
                }
            } else {
                break;
            }
        }
    });
    
    Ok("Process started".to_string())
}

#[tauri::command]
fn stop_process(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = processes.remove(&id) {
        let _ = child.kill();
        Ok("Process killed".to_string())
    } else {
        Err("Process not found".to_string())
    }
}

#[tauri::command]
fn log_frontend_error(message: &str) {
    println!("DEBUG FRONTEND ERROR: {}", message);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
            processes: Arc::new(Mutex::new(HashMap::new())),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_system_stats,
            get_docker_containers,
            control_container,
            get_container_logs,
            get_active_ports,
            kill_process,
            list_env_files,
            read_env_file,
            save_env_file,
            run_process,
            stop_process,
            log_frontend_error
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
