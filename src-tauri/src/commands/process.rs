use std::process::{Command, Stdio};
use std::io::{BufReader, BufRead};
use crate::state::AppState;
use crate::models::{ProcessOutputPayload, ProcessStatusPayload};
use tauri::Emitter;

#[tauri::command]
pub fn run_process(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    id: String,
    command: String,
    cwd: String,
    shell: String,
    env_vars: Option<Vec<crate::models::EnvPair>>,
) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("Command cannot be empty".to_string());
    }

    let mut cmd = if cfg!(target_os = "windows") {
        if shell.to_lowercase() == "cmd" {
            let mut c = Command::new("cmd");
            c.args(&["/C", &command]);
            c
        } else {
            let mut c = Command::new("powershell");
            c.args(&["-Command", &command]);
            c
        }
    } else {
        if shell.to_lowercase() == "bash" {
            let mut c = Command::new("bash");
            c.args(&["-c", &command]);
            c
        } else if shell.to_lowercase() == "zsh" {
            let mut c = Command::new("zsh");
            c.args(&["-c", &command]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(&["-c", &command]);
            c
        }
    };

    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }

    if let Some(vars) = env_vars {
        for var in vars {
            if !var.key.trim().is_empty() {
                cmd.env(var.key, var.value);
            }
        }
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::piped());

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
                    Ok(None) => {}
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
pub fn stop_process(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = processes.remove(&id) {
        let _ = child.kill();
        Ok("Process killed".to_string())
    } else {
        Err("Process not found".to_string())
    }
}

#[tauri::command]
pub fn send_process_stdin(state: tauri::State<'_, AppState>, id: String, input: String) -> Result<String, String> {
    let mut processes = state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(child) = processes.get_mut(&id) {
        if let Some(ref mut stdin) = child.stdin {
            use std::io::Write;
            let input_with_newline = format!("{}\n", input);
            stdin.write_all(input_with_newline.as_bytes())
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin.flush().map_err(|e| format!("Failed to flush stdin: {}", e))?;
            Ok("Input sent successfully".to_string())
        } else {
            Err("Stdin stream not captured for this process".to_string())
        }
    } else {
        Err("Process not found or already exited".to_string())
    }
}
