use std::collections::HashMap;
use std::process::Child;
use std::sync::{Arc, Mutex};
use sysinfo::System;

pub struct AppState {
    pub sys: Mutex<System>,
    pub processes: Arc<Mutex<HashMap<String, Child>>>,
}
