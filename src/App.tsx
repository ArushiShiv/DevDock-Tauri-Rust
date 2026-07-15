import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Activity,
  Cpu,
  Terminal,
  Container,
  Power,
  RotateCw,
  X,
  Play,
  Square,
  Trash2,
  Plus,
  Save,
  FileText,
  Search,
  Network,
  RefreshCw,
  Clock,
  Settings,
  AlertTriangle
} from "lucide-react";
import "./App.css";

interface SystemStats {
  cpu_usage: number;
  ram_used: number;
  ram_total: number;
  uptime: number;
  os_name: string;
  os_version: string;
  hostname: string;
}

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
}

interface PortInfo {
  port: number;
  process_name: string;
  pid: number;
  protocol: string;
}

interface EnvPair {
  key: string;
  value: string;
}

interface ProcessLog {
  text: string;
  is_error: boolean;
  timestamp: string;
}

interface ActiveProcess {
  id: string;
  command: string;
  cwd: string;
  logs: ProcessLog[];
  status: "running" | "stopped" | "error";
  exitCode?: number;
}

function App() {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [sysStats, setSysStats] = useState<SystemStats | null>(null);
  
  // Docker view state
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [dockerError, setDockerError] = useState<string | null>(null);
  const [selectedLogs, setSelectedLogs] = useState<{ id: string; name: string; logs: string } | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [dockerSearch, setDockerSearch] = useState("");
  
  // Ports view state
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [portsError, setPortsError] = useState<string | null>(null);
  const [portsSearch, setPortsSearch] = useState("");
  
  // Env view state
  const [envDir, setEnvDir] = useState("/home/solar1/Arushi Tauri App");
  const [envFiles, setEnvFiles] = useState<string[]>([]);
  const [selectedEnvFile, setSelectedEnvFile] = useState("");
  const [envPairs, setEnvPairs] = useState<EnvPair[]>([]);
  const [envStatus, setEnvStatus] = useState<string | null>(null);
  const [envSearch, setEnvSearch] = useState("");
  
  // Processes view state
  const [cmdInput, setCmdInput] = useState("");
  const [cwdInput, setCwdInput] = useState("/home/solar1/Arushi Tauri App");
  const [processes, setProcesses] = useState<ActiveProcess[]>([]);
  const [activeProcessId, setActiveProcessId] = useState<string | null>(null);
  
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Poll system stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const stats = await invoke<SystemStats>("get_system_stats");
        setSysStats(stats);
      } catch (err) {
        console.error("Failed to fetch system stats:", err);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  // Listen to background process events
  useEffect(() => {
    const setupListeners = async () => {
      const unlistenOutput = await listen<{ id: string; text: string; is_error: boolean }>(
        "process-output",
        (event) => {
          setProcesses((prev) =>
            prev.map((p) => {
              if (p.id === event.payload.id) {
                return {
                  ...p,
                  logs: [
                    ...p.logs,
                    {
                      text: event.payload.text,
                      is_error: event.payload.is_error,
                      timestamp: new Date().toLocaleTimeString(),
                    },
                  ].slice(-500), // limit to last 500 lines
                };
              }
              return p;
            })
          );
        }
      );

      const unlistenStatus = await listen<{ id: string; status: string; exit_code: number | null }>(
        "process-status",
        (event) => {
          setProcesses((prev) =>
            prev.map((p) => {
              if (p.id === event.payload.id) {
                const status = event.payload.status === "exit" ? "stopped" : "error";
                return {
                  ...p,
                  status,
                  exitCode: event.payload.exit_code ?? undefined,
                  logs: [
                    ...p.logs,
                    {
                      text: `[System] Process terminated with status: ${event.payload.status}${
                        event.payload.exit_code !== null ? ` (exit code: ${event.payload.exit_code})` : ""
                      }`,
                      is_error: event.payload.status === "error",
                      timestamp: new Date().toLocaleTimeString(),
                    },
                  ],
                };
              }
              return p;
            })
          );
        }
      );

      return () => {
        unlistenOutput();
        unlistenStatus();
      };
    };

    const cleanup = setupListeners();
    return () => {
      cleanup.then((fn) => fn && fn());
    };
  }, []);

  // Auto-scroll terminal to bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [processes, activeProcessId]);

  // Fetch Docker containers
  const fetchContainers = async () => {
    try {
      setDockerError(null);
      const res = await invoke<DockerContainer[]>("get_docker_containers");
      setContainers(res);
    } catch (err) {
      setDockerError(String(err));
    }
  };

  const handleContainerAction = async (id: string, action: string) => {
    try {
      await invoke("control_container", { id, action });
      fetchContainers();
    } catch (err) {
      alert(`Failed to ${action} container: ${err}`);
    }
  };

  const viewContainerLogs = async (id: string, name: string) => {
    setLogsLoading(true);
    setSelectedLogs({ id, name, logs: "" });
    try {
      const logs = await invoke<string>("get_container_logs", { id, tail: 150 });
      setSelectedLogs({ id, name, logs });
    } catch (err) {
      setSelectedLogs({ id, name, logs: `Failed to fetch logs: ${err}` });
    } finally {
      setLogsLoading(false);
    }
  };

  // Fetch listening ports
  const fetchPorts = async () => {
    try {
      setPortsError(null);
      const res = await invoke<PortInfo[]>("get_active_ports");
      setPorts(res);
    } catch (err) {
      setPortsError(String(err));
    }
  };

  const handleKillProcess = async (pid: number, port: number) => {
    if (confirm(`Are you sure you want to kill the process on port ${port} (PID: ${pid})?`)) {
      try {
        await invoke("kill_process", { pid });
        fetchPorts();
      } catch (err) {
        alert(`Failed to kill process: ${err}`);
      }
    }
  };

  // Env Manager actions
  const fetchEnvFiles = async () => {
    try {
      setEnvStatus(null);
      const files = await invoke<string[]>("list_env_files", { dirPath: envDir });
      setEnvFiles(files);
      if (files.length > 0 && !selectedEnvFile) {
        setSelectedEnvFile(files[0]);
        loadEnvFile(files[0]);
      }
    } catch (err) {
      console.error(err);
      setEnvFiles([]);
      setEnvPairs([]);
      setEnvStatus(`Error scanning directory: ${err}`);
    }
  };

  const loadEnvFile = async (fileName: string) => {
    if (!fileName) return;
    try {
      const filePath = `${envDir}/${fileName}`;
      const pairs = await invoke<EnvPair[]>("read_env_file", { filePath });
      setEnvPairs(pairs);
      setEnvStatus(null);
    } catch (err) {
      setEnvPairs([]);
      setEnvStatus(`Failed to read env file: ${err}`);
    }
  };

  const saveEnvFile = async () => {
    if (!selectedEnvFile) return;
    try {
      const filePath = `${envDir}/${selectedEnvFile}`;
      await invoke("save_env_file", { filePath, pairs: envPairs });
      setEnvStatus("Env file saved successfully!");
      setTimeout(() => setEnvStatus(null), 3000);
    } catch (err) {
      setEnvStatus(`Error: ${err}`);
    }
  };

  // Process Runner actions
  const startProcess = async () => {
    if (!cmdInput.trim()) return;
    const newId = `proc_${Date.now()}`;
    const newProcess: ActiveProcess = {
      id: newId,
      command: cmdInput,
      cwd: cwdInput,
      logs: [
        {
          text: `[System] Spawning command: ${cmdInput} in ${cwdInput}...`,
          is_error: false,
          timestamp: new Date().toLocaleTimeString(),
        },
      ],
      status: "running",
    };

    setProcesses((prev) => [...prev, newProcess]);
    setActiveProcessId(newId);
    setCmdInput("");

    try {
      await invoke("run_process", {
        id: newId,
        command: cmdInput,
        cwd: cwdInput,
      });
    } catch (err) {
      setProcesses((prev) =>
        prev.map((p) =>
          p.id === newId
            ? {
                ...p,
                status: "error",
                logs: [
                  ...p.logs,
                  {
                    text: `[System] Error spawning process: ${err}`,
                    is_error: true,
                    timestamp: new Date().toLocaleTimeString(),
                  },
                ],
              }
            : p
        )
      );
    }
  };

  const stopProcess = async (id: string) => {
    try {
      await invoke("stop_process", { id });
      setProcesses((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "stopped",
                logs: [
                  ...p.logs,
                  {
                    text: `[System] Process killed by user.`,
                    is_error: false,
                    timestamp: new Date().toLocaleTimeString(),
                  },
                ],
              }
            : p
        )
      );
    } catch (err) {
      alert(`Failed to stop process: ${err}`);
    }
  };

  const removeProcessTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const proc = processes.find((p) => p.id === id);
    if (proc && proc.status === "running") {
      if (!confirm("This process is still running. Kill and close tab?")) {
        return;
      }
      stopProcess(id);
    }
    setProcesses((prev) => prev.filter((p) => p.id !== id));
    if (activeProcessId === id) {
      setActiveProcessId(processes.length > 1 ? processes[0].id : null);
    }
  };

  // Helper formats
  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  // Load view-specific data
  useEffect(() => {
    if (activeTab === "docker") {
      fetchContainers();
    } else if (activeTab === "ports") {
      fetchPorts();
    } else if (activeTab === "env") {
      fetchEnvFiles();
    }
  }, [activeTab]);

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="logo-section">
          <Activity className="logo-icon" />
          <span className="logo-text">DevDock</span>
        </div>

        <ul className="nav-links">
          <li
            className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            <Cpu />
            Dashboard
          </li>
          <li
            className={`nav-item ${activeTab === "docker" ? "active" : ""}`}
            onClick={() => setActiveTab("docker")}
          >
            <Container />
            Docker Containers
          </li>
          <li
            className={`nav-item ${activeTab === "processes" ? "active" : ""}`}
            onClick={() => setActiveTab("processes")}
          >
            <Terminal />
            CLI Runner
          </li>
          <li
            className={`nav-item ${activeTab === "ports" ? "active" : ""}`}
            onClick={() => setActiveTab("ports")}
          >
            <Network />
            Port Inspector
          </li>
          <li
            className={`nav-item ${activeTab === "env" ? "active" : ""}`}
            onClick={() => setActiveTab("env")}
          >
            <FileText />
            Env Manager
          </li>
        </ul>

        <div className="sidebar-footer">
          <span>v0.1.0</span>
          <span>Offline Core</span>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="main-content">
        {/* Dynamic Header */}
        <header className="main-header">
          <div className="header-title">
            <h2>
              {activeTab === "dashboard" && "Workspace Dashboard"}
              {activeTab === "docker" && "Docker Containers"}
              {activeTab === "processes" && "Process Orchestrator"}
              {activeTab === "ports" && "Network Port Inspector"}
              {activeTab === "env" && "Environment Variable Sheet"}
            </h2>
          </div>

          <div className="telemetry-summary">
            {sysStats && (
              <>
                <div className="telemetry-mini-card">
                  <span className="telemetry-mini-label">CPU</span>
                  <span className="telemetry-mini-val">{sysStats.cpu_usage.toFixed(1)}%</span>
                </div>
                <div className="telemetry-mini-card">
                  <span className="telemetry-mini-label">RAM</span>
                  <span className="telemetry-mini-val">
                    {((sysStats.ram_used / sysStats.ram_total) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="telemetry-mini-card">
                  <span className="telemetry-mini-label">Uptime</span>
                  <span className="telemetry-mini-val">{formatUptime(sysStats.uptime)}</span>
                </div>
              </>
            )}
          </div>
        </header>

        {/* View switching logic */}
        <div className="view-area">
          {activeTab === "dashboard" && (
            <div className="dashboard-view">
              {sysStats ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
                  {/* Stats Grid */}
                  <div className="grid-3">
                    <div className="card">
                      <div className="card-title">
                        <Cpu /> CPU Utilization
                      </div>
                      <div className="stat-display">
                        <span className="stat-value">{sysStats.cpu_usage.toFixed(1)}%</span>
                      </div>
                      <div className="progress-bar-container">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${sysStats.cpu_usage}%` }}
                        ></div>
                      </div>
                      <span className="stat-sub">Overall CPU processing workload</span>
                    </div>

                    <div className="card">
                      <div className="card-title">
                        <Activity /> Memory Usage
                      </div>
                      <div className="stat-display">
                        <span className="stat-value">
                          {((sysStats.ram_used / sysStats.ram_total) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="progress-bar-container">
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: `${(sysStats.ram_used / sysStats.ram_total) * 100}%`,
                          }}
                        ></div>
                      </div>
                      <span className="stat-sub">
                        {formatBytes(sysStats.ram_used)} of {formatBytes(sysStats.ram_total)} used
                      </span>
                    </div>

                    <div className="card">
                      <div className="card-title">
                        <Clock /> System Uptime
                      </div>
                      <div className="stat-display">
                        <span style={{ fontSize: "20px", fontWeight: "700", fontFamily: "var(--font-mono)" }}>
                          {formatUptime(sysStats.uptime)}
                        </span>
                      </div>
                      <span className="stat-sub" style={{ marginTop: "32px", display: "block" }}>
                        Continuous system operation
                      </span>
                    </div>
                  </div>

                  {/* System details card */}
                  <div className="card">
                    <div className="card-title">
                      <Settings /> System Telemetry Info
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", fontSize: "14px" }}>
                      <div>
                        <p style={{ color: "var(--text-muted)", marginBottom: "4px" }}>Hostname</p>
                        <p style={{ fontWeight: "600" }}>{sysStats.hostname}</p>
                      </div>
                      <div>
                        <p style={{ color: "var(--text-muted)", marginBottom: "4px" }}>Operating System</p>
                        <p style={{ fontWeight: "600" }}>
                          {sysStats.os_name} {sysStats.os_version}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <Cpu />
                  <p>Loading system statistics telemetry...</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "docker" && (
            <div className="docker-view">
              <div className="docker-header">
                <div style={{ position: "relative", flexGrow: 1, maxWidth: "300px" }}>
                  <Search
                    style={{
                      position: "absolute",
                      left: "12px",
                      top: "12px",
                      width: "16px",
                      height: "16px",
                      color: "var(--text-dark)",
                    }}
                  />
                  <input
                    type="text"
                    className="txt-input"
                    placeholder="Search containers..."
                    style={{ paddingLeft: "36px", width: "100%" }}
                    value={dockerSearch}
                    onChange={(e) => setDockerSearch(e.target.value)}
                  />
                </div>
                <button className="btn" onClick={fetchContainers}>
                  <RefreshCw style={{ width: "16px", height: "16px" }} /> Refresh List
                </button>
              </div>

              {dockerError ? (
                <div className="empty-state" style={{ borderColor: "var(--danger)" }}>
                  <AlertTriangle style={{ color: "var(--danger)" }} />
                  <h3>Docker Service Error</h3>
                  <p>{dockerError}</p>
                  <button className="btn" onClick={fetchContainers}>
                    Try Again
                  </button>
                </div>
              ) : containers.length === 0 ? (
                <div className="empty-state">
                  <Container />
                  <h3>No Containers Found</h3>
                  <p>Check if Docker daemon is running locally.</p>
                </div>
              ) : (
                <div className="container-grid">
                  {containers
                    .filter(
                      (c) =>
                        c.name.toLowerCase().includes(dockerSearch.toLowerCase()) ||
                        c.image.toLowerCase().includes(dockerSearch.toLowerCase())
                    )
                    .map((container) => {
                      const isRunning = container.state === "running";
                      const isPaused = container.state === "paused";
                      return (
                        <div className="container-card" key={container.id}>
                          <div className="container-meta">
                            <div className="container-info">
                              <span className="container-name" title={container.name}>
                                {container.name}
                              </span>
                              <span className="container-image" title={container.image}>
                                {container.image}
                              </span>
                            </div>
                            <span
                              className={`badge ${
                                isRunning
                                  ? "badge-running"
                                  : isPaused
                                  ? "badge-paused"
                                  : "badge-stopped"
                              }`}
                            >
                              {container.state}
                            </span>
                          </div>

                          <div className="container-ports">
                            <p style={{ color: "var(--text-dark)", marginBottom: "4px" }}>Ports</p>
                            <p>{container.ports || "None"}</p>
                          </div>

                          <div className="container-actions">
                            {isRunning ? (
                              <button
                                className="icon-btn icon-btn-danger"
                                title="Stop Container"
                                onClick={() => handleContainerAction(container.id, "stop")}
                              >
                                <Power style={{ width: "16px", height: "16px" }} />
                              </button>
                            ) : (
                              <button
                                className="icon-btn"
                                style={{ color: "var(--success)" }}
                                title="Start Container"
                                onClick={() => handleContainerAction(container.id, "start")}
                              >
                                <Play style={{ width: "16px", height: "16px" }} />
                              </button>
                            )}

                            <button
                              className="icon-btn"
                              title="Restart Container"
                              onClick={() => handleContainerAction(container.id, "restart")}
                            >
                              <RotateCw style={{ width: "16px", height: "16px" }} />
                            </button>

                            <button
                              className="btn btn-secondary"
                              style={{ padding: "6px 12px", marginLeft: "auto", fontSize: "12px" }}
                              onClick={() => viewContainerLogs(container.id, container.name)}
                            >
                              <Terminal style={{ width: "14px", height: "14px" }} /> Logs
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {activeTab === "processes" && (
            <div className="processes-view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              {/* Spawner form */}
              <div className="card" style={{ marginBottom: "20px" }}>
                <div className="form-row">
                  <div className="input-group">
                    <label className="input-label">Command to execute</label>
                    <input
                      type="text"
                      className="txt-input txt-input-mono"
                      placeholder="e.g. npm run dev"
                      value={cmdInput}
                      onChange={(e) => setCmdInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && startProcess()}
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Working Directory</label>
                    <input
                      type="text"
                      className="txt-input txt-input-mono"
                      value={cwdInput}
                      onChange={(e) => setCwdInput(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn"
                    style={{ alignSelf: "flex-end", height: "42px" }}
                    onClick={startProcess}
                  >
                    <Play style={{ width: "16px", height: "16px" }} /> Run Process
                  </button>
                </div>
              </div>

              {/* Running tabs */}
              {processes.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flexGrow: 1,
                    background: "var(--card-bg)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "12px",
                    overflow: "hidden",
                  }}
                >
                  <div className="tabs-container" style={{ padding: "8px 12px 0 12px", marginBottom: 0 }}>
                    {processes.map((p) => (
                      <button
                        key={p.id}
                        className={`tab-btn ${activeProcessId === p.id ? "active" : ""}`}
                        onClick={() => setActiveProcessId(p.id)}
                      >
                        <span
                          className={`status-dot ${p.status === "running" ? "pulse" : ""}`}
                          style={{
                            background:
                              p.status === "running"
                                ? "var(--success)"
                                : p.status === "error"
                                ? "var(--danger)"
                                : "var(--text-dark)",
                          }}
                        ></span>
                        <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.command}
                        </span>
                        <span className="tab-close" onClick={(e) => removeProcessTab(p.id, e)}>
                          <X style={{ width: "10px", height: "10px" }} />
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Terminal console */}
                  {activeProcessId && (
                    <div
                      style={{
                        flexGrow: 1,
                        display: "flex",
                        flexDirection: "column",
                        background: "#04060a",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          padding: "8px 16px",
                          borderBottom: "1px solid var(--border-color)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: "12px",
                          color: "var(--text-muted)",
                        }}
                      >
                        <span>CWD: {processes.find((p) => p.id === activeProcessId)?.cwd}</span>
                        {processes.find((p) => p.id === activeProcessId)?.status === "running" ? (
                          <button
                            className="btn btn-danger"
                            style={{ padding: "4px 8px", fontSize: "11px" }}
                            onClick={() => stopProcess(activeProcessId)}
                          >
                            <Square style={{ width: "12px", height: "12px" }} /> Stop Process
                          </button>
                        ) : (
                          <span>Finished</span>
                        )}
                      </div>

                      <div className="terminal-console">
                        {processes
                          .find((p) => p.id === activeProcessId)
                          ?.logs.map((log, idx) => (
                            <div
                              className={`terminal-line ${log.is_error ? "error" : ""}`}
                              key={idx}
                            >
                              <span style={{ color: "var(--text-dark)", marginRight: "8px" }}>
                                [{log.timestamp}]
                              </span>
                              {log.text}
                            </div>
                          ))}
                        <div ref={terminalEndRef} />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <Terminal />
                  <h3>No Active Processes</h3>
                  <p>Type a shell command above to execute and monitor logs.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "ports" && (
            <div className="ports-view">
              <div className="docker-header">
                <div style={{ position: "relative", flexGrow: 1, maxWidth: "300px" }}>
                  <Search
                    style={{
                      position: "absolute",
                      left: "12px",
                      top: "12px",
                      width: "16px",
                      height: "16px",
                      color: "var(--text-dark)",
                    }}
                  />
                  <input
                    type="text"
                    className="txt-input"
                    placeholder="Filter by port or name..."
                    style={{ paddingLeft: "36px", width: "100%" }}
                    value={portsSearch}
                    onChange={(e) => setPortsSearch(e.target.value)}
                  />
                </div>
                <button className="btn" onClick={fetchPorts}>
                  <RefreshCw style={{ width: "16px", height: "16px" }} /> Refresh List
                </button>
              </div>

              {portsError ? (
                <div className="empty-state" style={{ borderColor: "var(--danger)" }}>
                  <AlertTriangle style={{ color: "var(--danger)" }} />
                  <h3>Port Inspector Error</h3>
                  <p>{portsError}</p>
                </div>
              ) : ports.length === 0 ? (
                <div className="empty-state">
                  <Network />
                  <h3>No Active Ports found</h3>
                  <p>No listening TCP sockets detected.</p>
                </div>
              ) : (
                <div className="table-container">
                  <table className="inspector-table">
                    <thead>
                      <tr>
                        <th>Port</th>
                        <th>Process</th>
                        <th>PID</th>
                        <th>Protocol</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ports
                        .filter(
                          (p) =>
                            p.port.toString().includes(portsSearch) ||
                            p.process_name.toLowerCase().includes(portsSearch.toLowerCase())
                        )
                        .map((portInfo) => (
                          <tr key={`${portInfo.port}-${portInfo.pid}`}>
                            <td>
                              <span className="port-number">{portInfo.port}</span>
                            </td>
                            <td>{portInfo.process_name}</td>
                            <td>
                              <span className="pid-badge">{portInfo.pid}</span>
                            </td>
                            <td>{portInfo.protocol}</td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                className="icon-btn icon-btn-danger"
                                title="Kill Process"
                                onClick={() => handleKillProcess(portInfo.pid, portInfo.port)}
                              >
                                <Trash2 style={{ width: "16px", height: "16px" }} />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "env" && (
            <div className="env-view">
              <div className="card" style={{ marginBottom: "20px" }}>
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <div className="input-group">
                    <label className="input-label">Project Directory</label>
                    <div style={{ display: "flex", gap: "12px" }}>
                      <input
                        type="text"
                        className="txt-input txt-input-mono"
                        style={{ flexGrow: 1 }}
                        value={envDir}
                        onChange={(e) => setEnvDir(e.target.value)}
                      />
                      <button className="btn" onClick={fetchEnvFiles}>
                        Scan Directory
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {envFiles.length > 0 ? (
                <div className="card">
                  <div className="env-toolbar">
                    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                      <select
                        className="env-file-select"
                        value={selectedEnvFile}
                        onChange={(e) => {
                          setSelectedEnvFile(e.target.value);
                          loadEnvFile(e.target.value);
                        }}
                      >
                        {envFiles.map((file) => (
                          <option key={file} value={file}>
                            {file}
                          </option>
                        ))}
                      </select>

                      <div style={{ position: "relative", width: "200px" }}>
                        <Search
                          style={{
                            position: "absolute",
                            left: "10px",
                            top: "10px",
                            width: "14px",
                            height: "14px",
                            color: "var(--text-dark)",
                          }}
                        />
                        <input
                          type="text"
                          className="txt-input"
                          placeholder="Search keys..."
                          style={{ paddingLeft: "30px", paddingTop: "6px", height: "34px", fontSize: "12px" }}
                          value={envSearch}
                          onChange={(e) => setEnvSearch(e.target.value)}
                        />
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "12px" }}>
                      <button
                        className="btn btn-secondary"
                        onClick={() =>
                          setEnvPairs((prev) => [...prev, { key: "NEW_KEY", value: "" }])
                        }
                      >
                        <Plus style={{ width: "16px", height: "16px" }} /> Add Entry
                      </button>
                      <button className="btn" onClick={saveEnvFile}>
                        <Save style={{ width: "16px", height: "16px" }} /> Save Changes
                      </button>
                    </div>
                  </div>

                  {envStatus && (
                    <div
                      style={{
                        padding: "10px 16px",
                        borderRadius: "8px",
                        background: envStatus.startsWith("Error")
                          ? "var(--danger-glow)"
                          : "var(--success-glow)",
                        color: envStatus.startsWith("Error") ? "var(--danger)" : "var(--success)",
                        border: `1px solid ${
                          envStatus.startsWith("Error") ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)"
                        }`,
                        marginBottom: "16px",
                        fontSize: "13px",
                      }}
                    >
                      {envStatus}
                    </div>
                  )}

                  <div className="env-scroll-area">
                    {envPairs
                      .filter((p) => p.key.toLowerCase().includes(envSearch.toLowerCase()))
                      .map((pair, idx) => (
                        <div className="env-row" key={idx}>
                          <input
                            type="text"
                            className="txt-input txt-input-mono env-key-input"
                            value={pair.key}
                            onChange={(e) => {
                              const next = [...envPairs];
                              next[idx].key = e.target.value.toUpperCase();
                              setEnvPairs(next);
                            }}
                            placeholder="KEY"
                          />
                          <input
                            type="text"
                            className="txt-input txt-input-mono env-val-input"
                            value={pair.value}
                            onChange={(e) => {
                              const next = [...envPairs];
                              next[idx].value = e.target.value;
                              setEnvPairs(next);
                            }}
                            placeholder="VALUE"
                          />
                          <button
                            className="icon-btn icon-btn-danger"
                            onClick={() =>
                              setEnvPairs((prev) => prev.filter((_, i) => i !== idx))
                            }
                          >
                            <Trash2 style={{ width: "16px", height: "16px" }} />
                          </button>
                        </div>
                      ))}

                    {envPairs.length === 0 && (
                      <div className="empty-state" style={{ border: "none" }}>
                        <p>No keys in this environment file. Click "Add Entry" to create one.</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <FileText />
                  <h3>No Environment Files Found</h3>
                  <p>Scan directory for `.env` or `.env.local` files.</p>
                  {envStatus && (
                    <p style={{ color: "var(--danger)", fontSize: "13px", marginTop: "12px" }}>
                      {envStatus}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dynamic Status Bar */}
        <footer className="status-bar">
          <div className="status-indicator">
            <span className="status-dot pulse"></span>
            <span>Tauri Backend Connected</span>
          </div>
          <div>DevDock Console • Localhost Session</div>
        </footer>
      </main>

      {/* Docker Logs Modal Overlay */}
      {selectedLogs && (
        <div className="modal-overlay" onClick={() => setSelectedLogs(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Logs for container: {selectedLogs.name}</span>
              <button className="icon-btn" onClick={() => setSelectedLogs(null)}>
                <X style={{ width: "18px", height: "18px" }} />
              </button>
            </div>
            <div className="terminal-console">
              {logsLoading ? (
                <div className="terminal-line status">Streaming docker container logs...</div>
              ) : selectedLogs.logs ? (
                selectedLogs.logs.split("\n").map((line, idx) => (
                  <div className="terminal-line" key={idx}>
                    {line}
                  </div>
                ))
              ) : (
                <div className="terminal-line status">No log output returned from container.</div>
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
