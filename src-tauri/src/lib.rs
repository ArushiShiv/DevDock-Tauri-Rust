// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod state;
pub mod models;
pub mod commands;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
            processes: Arc::new(Mutex::new(HashMap::new())),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::system::get_system_stats,
            commands::docker::get_docker_containers,
            commands::docker::control_container,
            commands::docker::get_container_logs,
            commands::ports::get_active_ports,
            commands::ports::kill_process,
            commands::env::list_env_files,
            commands::env::read_env_file,
            commands::env::save_env_file,
            commands::process::run_process,
            commands::process::stop_process,
            commands::process::send_process_stdin,
            commands::system::log_frontend_error,
            commands::system::get_system_processes,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::docker::start_docker_logs_stream,
            commands::docker::stop_docker_logs_stream,
            commands::system::get_capabilities,
            commands::git::get_git_status,
            commands::git::git_commit_and_push,
            commands::database::get_sqlite_tables,
            commands::database::run_sqlite_query,
            commands::sync::mirror_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
