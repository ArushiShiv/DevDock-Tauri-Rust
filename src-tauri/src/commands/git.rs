use std::process::Command;
use serde::Serialize;

#[derive(Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct GitStatusInfo {
    pub branch: String,
    pub uncommitted: Vec<GitFileStatus>,
    pub recent_commits: Vec<GitCommit>,
}

#[tauri::command]
pub fn get_git_status(repo_path: String) -> Result<GitStatusInfo, String> {
    if repo_path.trim().is_empty() {
        return Err("Repository path cannot be empty".to_string());
    }

    // 1. Get current branch
    let branch_output = Command::new("git")
        .args(&["branch", "--show-current"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git branch: {}", e))?;
    let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();

    // 2. Get porcelain status
    let status_output = Command::new("git")
        .args(&["status", "--porcelain"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;
    let status_str = String::from_utf8_lossy(&status_output.stdout);
    
    let mut uncommitted = Vec::new();
    for line in status_str.lines() {
        if line.len() > 3 {
            let status = line[0..2].trim().to_string();
            let path = line[3..].to_string();
            uncommitted.push(GitFileStatus { path, status });
        }
    }

    // 3. Get recent commits (last 5)
    let log_output = Command::new("git")
        .args(&["log", "-n", "5", "--oneline"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;
    let log_str = String::from_utf8_lossy(&log_output.stdout);
    
    let mut recent_commits = Vec::new();
    for line in log_str.lines() {
        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.len() == 2 {
            recent_commits.push(GitCommit {
                hash: parts[0].to_string(),
                message: parts[1].to_string(),
            });
        }
    }

    Ok(GitStatusInfo {
        branch: if branch.is_empty() { "Detached / None".to_string() } else { branch },
        uncommitted,
        recent_commits,
    })
}

#[tauri::command]
pub fn git_commit_and_push(repo_path: String, message: String) -> Result<String, String> {
    if repo_path.trim().is_empty() {
        return Err("Repository path cannot be empty".to_string());
    }
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }

    // Git add
    let add_status = Command::new("git")
        .args(&["add", "-A"])
        .current_dir(&repo_path)
        .status()
        .map_err(|e| format!("Failed to run git add: {}", e))?;
    if !add_status.success() {
        return Err("git add failed".to_string());
    }

    // Git commit
    let commit_status = Command::new("git")
        .args(&["commit", "-m", &message])
        .current_dir(&repo_path)
        .status()
        .map_err(|e| format!("Failed to run git commit: {}", e))?;
    if !commit_status.success() {
        return Err("git commit failed".to_string());
    }

    // Git push
    let push_output = Command::new("git")
        .args(&["push"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git push: {}", e))?;
    
    if push_output.status.success() {
        Ok("Changes successfully committed and pushed!".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        Err(format!("git push failed: {}", stderr))
    }
}
