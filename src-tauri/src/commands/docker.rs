use std::process::{Command, Stdio};
use std::io::{BufReader, BufRead};
use crate::models::{DockerContainer, ProcessOutputPayload};
use crate::state::AppState;
use tauri::Emitter;

#[tauri::command]
pub fn get_docker_containers() -> Result<Vec<DockerContainer>, String> {
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
pub fn control_container(id: &str, action: &str) -> Result<String, String> {
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
pub fn get_container_logs(id: &str, tail: u32) -> Result<String, String> {
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
pub fn start_docker_logs_stream(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    container_name: String,
) -> Result<String, String> {
    let mut cmd = Command::new("docker");
    cmd.args(&["logs", "-f", "--tail", "100", &container_name]);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn docker logs: {}", e))?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stream_id = format!("docker_logs_{}", container_name);

    {
        let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
        if let Some(mut old_child) = processes.remove(&stream_id) {
            let _ = old_child.kill();
        }
        processes.insert(stream_id.clone(), child);
    }

    let window_stdout = window.clone();
    let name_stdout = container_name.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line_text) = line {
                let _ = window_stdout.emit(
                    "docker-log-line",
                    ProcessOutputPayload {
                        id: name_stdout.clone(),
                        text: line_text,
                        is_error: false,
                    },
                );
            }
        }
    });

    let window_stderr = window.clone();
    let name_stderr = container_name.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line_text) = line {
                let _ = window_stderr.emit(
                    "docker-log-line",
                    ProcessOutputPayload {
                        id: name_stderr.clone(),
                        text: line_text,
                        is_error: true,
                    },
                );
            }
        }
    });

    Ok(stream_id)
}

#[tauri::command]
pub fn stop_docker_logs_stream(
    state: tauri::State<'_, AppState>,
    container_name: String,
) -> Result<String, String> {
    let stream_id = format!("docker_logs_{}", container_name);
    let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = processes.remove(&stream_id) {
        let _ = child.kill();
        Ok("Stream stopped".to_string())
    } else {
        Ok("No active stream found".to_string())
    }
}
