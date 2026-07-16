use serde::Serialize;

#[derive(Serialize)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub ram_used: u64,
    pub ram_total: u64,
    pub uptime: u64,
    pub os_name: String,
    pub os_version: String,
    pub hostname: String,
}

#[derive(Serialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
}

#[derive(Serialize)]
pub struct PortInfo {
    pub port: u16,
    pub process_name: String,
    pub pid: u32,
    pub protocol: String,
}

#[derive(Serialize, serde::Deserialize)]
pub struct EnvPair {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Serialize)]
pub struct ProcessOutputPayload {
    pub id: String,
    pub text: String,
    pub is_error: bool,
}

#[derive(Clone, Serialize)]
pub struct ProcessStatusPayload {
    pub id: String,
    pub status: String,
    pub exit_code: Option<i32>,
}

#[derive(Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory: u64,
    pub status: String,
}

#[derive(Serialize, serde::Deserialize, Clone)]
pub struct Settings {
    pub env_dir: String,
    pub cwd_input: String,
    pub cmd_history: Vec<String>,
    pub theme: String,
    pub git_path: Option<String>,
    pub db_path: Option<String>,
    pub mirror_dir: Option<String>,
}

#[derive(Serialize)]
pub struct CapabilitiesInfo {
    pub identifier: String,
    pub description: String,
    pub windows: Vec<String>,
    pub permissions: Vec<String>,
}
