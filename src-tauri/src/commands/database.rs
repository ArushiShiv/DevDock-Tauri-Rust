use std::process::Command;

#[tauri::command]
pub fn get_sqlite_tables(db_path: String) -> Result<Vec<String>, String> {
    if db_path.trim().is_empty() {
        return Err("Database path cannot be empty".to_string());
    }
    
    let script = r#"
import sqlite3, json, sys
try:
    conn = sqlite3.connect(sys.argv[1])
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = [row[0] for row in cursor.fetchall()]
    print(json.dumps(tables))
except Exception as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
"#;

    let output = Command::new("python3")
        .args(&["-c", script, &db_path])
        .output()
        .map_err(|e| format!("Failed to run python3: {}", e))?;
        
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("SQLite connection error: {}", stderr));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let tables: Vec<String> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse metadata: {}", e))?;
        
    Ok(tables)
}

#[tauri::command]
pub fn run_sqlite_query(db_path: String, query: String) -> Result<String, String> {
    if db_path.trim().is_empty() {
        return Err("Database path cannot be empty".to_string());
    }
    if query.trim().is_empty() {
        return Err("Query cannot be empty".to_string());
    }

    let script = r#"
import sqlite3, json, sys
try:
    conn = sqlite3.connect(sys.argv[1])
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(sys.argv[2])
    if cursor.description:
        rows = [dict(row) for row in cursor.fetchall()]
        print(json.dumps(rows))
    else:
        conn.commit()
        print(json.dumps([{"success": True, "message": f"Query executed successfully. Rows affected: {cursor.rowcount}"}]))
except Exception as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
"#;

    let output = Command::new("python3")
        .args(&["-c", script, &db_path, &query])
        .output()
        .map_err(|e| format!("Failed to run python3 query: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(format!("SQL Error: {}", stderr));
    }

    if stdout.is_empty() {
        Ok("[]".to_string())
    } else {
        Ok(stdout)
    }
}
