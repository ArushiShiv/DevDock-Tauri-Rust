import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { invoke } from "@tauri-apps/api/core";

// Send frontend JS errors to Rust backend console for debugging
window.onerror = (message, source, lineno, colno, error) => {
  const errStr = `JS Error: ${message} at ${source}:${lineno}:${colno} - Error Obj: ${error}`;
  invoke("log_frontend_error", { message: errStr }).catch(() => {});
};

window.onunhandledrejection = (event) => {
  const errStr = `Unhandled Promise Rejection: ${event.reason}`;
  invoke("log_frontend_error", { message: errStr }).catch(() => {});
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
