use std::process::Command;
use crate::models::PortInfo;
#[cfg(target_os = "windows")]
use sysinfo::{System, Pid};

#[tauri::command]
pub fn get_active_ports() -> Result<Vec<PortInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        get_active_ports_windows()
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        get_active_ports_unix()
    }
}

#[cfg(target_os = "windows")]
fn get_active_ports_windows() -> Result<Vec<PortInfo>, String> {
    let output = Command::new("netstat")
        .args(&["-ano", "-p", "tcp"])
        .output()
        .map_err(|e| format!("Failed to run netstat: {}", e))?;
        
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("netstat failed: {}", stderr));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ports = std::collections::HashSet::new();
    let mut sys = System::new_all();
    sys.refresh_all();
    
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 && parts[0] == "TCP" && parts[3] == "LISTENING" {
            let local_addr = parts[1];
            let pid_str = parts[4];
            
            if let Some(pos) = local_addr.rfind(':') {
                let port_str = &local_addr[pos + 1..];
                if let Ok(port) = port_str.parse::<u16>() {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        let process_name = sys.process(Pid::from(pid as usize))
                            .map(|p| p.name().to_string_lossy().into_owned())
                            .unwrap_or_else(|| "Unknown".to_string());
                            
                        ports.insert((port, process_name, pid));
                    }
                }
            }
        }
    }
    
    let mut port_list: Vec<PortInfo> = ports.into_iter().map(|(port, process_name, pid)| PortInfo {
        port,
        process_name,
        pid,
        protocol: "TCP".to_string(),
    }).collect();
    
    port_list.sort_by_key(|p| p.port);
    Ok(port_list)
}

#[cfg(not(target_os = "windows"))]
fn get_active_ports_unix() -> Result<Vec<PortInfo>, String> {
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
        _ => {
            let ss_output = Command::new("ss")
                .args(&["-tlnp"])
                .output();
                
            match ss_output {
                Ok(out) if out.status.success() => {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let mut ports = Vec::new();
                    for (idx, line) in stdout.lines().enumerate() {
                        if idx == 0 { continue; }
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 4 {
                            let local_addr = parts[3];
                            let mut port = 0;
                            if let Some(pos) = local_addr.rfind(':') {
                                port = local_addr[pos+1..].parse::<u16>().unwrap_or(0);
                            }
                            
                            if port > 0 {
                                let mut process_name = "Unknown".to_string();
                                let mut pid = 0;
                                
                                let users_col = parts.get(4).or_else(|| parts.get(5)).cloned().unwrap_or("");
                                if !users_col.is_empty() {
                                    if let Some(pid_pos) = users_col.find("pid=") {
                                        let sub = &users_col[pid_pos+4..];
                                        let end_pos = sub.find(',').or_else(|| sub.find(')')).unwrap_or(sub.len());
                                        pid = sub[..end_pos].parse::<u32>().unwrap_or(0);
                                    }
                                    if let Some(name_start) = users_col.find('"') {
                                        let sub = &users_col[name_start+1..];
                                        if let Some(name_end) = sub.find('"') {
                                            process_name = sub[..name_end].to_string();
                                        }
                                    }
                                }
                                
                                ports.push(PortInfo {
                                    port,
                                    process_name,
                                    pid,
                                    protocol: "TCP".to_string(),
                                });
                            }
                        }
                    }
                    ports.sort_by_key(|p| p.port);
                    Ok(ports)
                }
                _ => {
                    Err("Failed to fetch active ports (both lsof and ss failed)".to_string())
                }
            }
        }
    }
}

#[tauri::command]
pub fn kill_process(pid: u32) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill")
            .args(&["/F", "/PID", &pid.to_string()])
            .output()
            .map_err(|e| format!("Failed to run taskkill: {}", e))?;
            
        if output.status.success() {
            Ok(format!("Process {} killed successfully", pid))
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to kill process: {}", stderr))
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
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
}
