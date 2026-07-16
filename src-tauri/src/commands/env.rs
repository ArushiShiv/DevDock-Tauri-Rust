use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use crate::models::EnvPair;

#[tauri::command]
pub fn list_env_files(dir_path: &str) -> Result<Vec<String>, String> {
    let path = Path::new(dir_path);
    if !path.is_dir() {
        return Err("Not a directory".to_string());
    }
    
    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for entry in entries {
        if let Ok(entry) = entry {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if file_name == ".env" || file_name.starts_with(".env.") {
                files.push(file_name);
            }
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn read_env_file(file_path: &str) -> Result<Vec<EnvPair>, String> {
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err("Not a file".to_string());
    }
    
    let file = File::open(path).map_err(|e| e.to_string())?;
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
            let value_part = trimmed[pos+1..].trim();
            
            let mut value = String::new();
            let mut in_quotes = false;
            let mut quote_char = ' ';
            let chars: Vec<char> = value_part.chars().collect();
            let mut i = 0;
            while i < chars.len() {
                let c = chars[i];
                if (c == '"' || c == '\'') && (i == 0 || chars[i-1] != '\\') {
                    if in_quotes {
                        if c == quote_char {
                            in_quotes = false;
                        } else {
                            value.push(c);
                        }
                    } else {
                        in_quotes = true;
                        quote_char = c;
                    }
                } else if c == '#' && !in_quotes {
                    break;
                } else {
                    value.push(c);
                }
                i += 1;
            }
            
            let final_value = value.trim().to_string();
            pairs.push(EnvPair { key, value: final_value });
        }
    }
    
    Ok(pairs)
}

#[tauri::command]
pub fn save_env_file(file_path: &str, pairs: Vec<EnvPair>) -> Result<String, String> {
    let path = Path::new(file_path);
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    
    for pair in pairs {
        let clean_key = pair.key.trim();
        if clean_key.is_empty() {
            continue;
        }
        
        let value = pair.value.trim();
        let formatted_value = if value.contains(' ') && !value.starts_with('"') && !value.starts_with('\'') {
            format!("\"{}\"", value)
        } else {
            value.to_string()
        };
        
        writeln!(file, "{}={}", clean_key, formatted_value).map_err(|e| e.to_string())?;
    }
    
    Ok("Env file saved successfully".to_string())
}
