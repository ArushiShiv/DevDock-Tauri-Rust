use std::process::Command;

#[tauri::command]
pub fn mirror_workspace(src: String, dest: String) -> Result<String, String> {
    if src.trim().is_empty() || dest.trim().is_empty() {
        return Err("Source and Destination paths cannot be empty".to_string());
    }
    
    let output = Command::new("rsync")
        .args(&[
            "-av",
            "--delete",
            "--exclude", "node_modules",
            "--exclude", "target",
            "--exclude", ".git",
            "--exclude", "dist",
            "--exclude", ".svelte-kit",
            "--exclude", ".next",
            &format!("{}/", src),
            &format!("{}/", dest),
        ])
        .output()
        .map_err(|e| format!("Failed to execute rsync: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(format!("Workspace mirroring successfully completed!\n\n{}", stdout))
    } else {
        Err(format!("rsync synchronization error: {}", stderr))
    }
}
