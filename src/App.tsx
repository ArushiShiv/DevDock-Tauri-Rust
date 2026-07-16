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
  AlertTriangle,
  List,
  GitBranch,
  Database
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

interface ProcessInfo {
  pid: number;
  name: string;
  cpu_usage: number;
  memory: number;
  status: string;
}

interface SettingsData {
  env_dir: string;
  cwd_input: string;
  cmd_history: string[];
  theme: string;
  git_path?: string;
  db_path?: string;
  mirror_dir?: string;
}

interface CapabilitiesInfo {
  identifier: string;
  description: string;
  windows: string[];
  permissions: string[];
}

interface GitCommit {
  hash: string;
  message: string;
}

interface GitFileStatus {
  path: string;
  status: string;
}

interface GitStatusInfo {
  branch: string;
  uncommitted: GitFileStatus[];
  recent_commits: GitCommit[];
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

const parseAnsi = (text: string): React.ReactNode[] => {
  const ansiRegex = /[\u001b\u009b]\[[0-9;]*[a-zA-Z]/g;
  const parts = text.split(ansiRegex);
  const matches = text.match(ansiRegex) || [];
  
  let currentStyle: React.CSSProperties = {};
  
  return parts.map((part, index) => {
    if (index > 0) {
      const match = matches[index - 1];
      const codes = match.replace(/[^0-9;]/g, '').split(';').map(Number);
      
      codes.forEach(code => {
        if (code === 0) {
          currentStyle = {};
        } else if (code === 1) {
          currentStyle = { ...currentStyle, fontWeight: 'bold' };
        } else if (code === 3 || code === 4) {
          currentStyle = { ...currentStyle, textDecoration: 'underline' };
        } else if (code >= 30 && code <= 37) {
          const colors = ['#000000', '#ef4444', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#06b6d4', '#f8fafc'];
          currentStyle = { ...currentStyle, color: colors[code - 30] };
        } else if (code >= 90 && code <= 97) {
          const brightColors = ['#4b5563', '#f87171', '#34d399', '#fbbf24', '#60a5fa', '#f472b6', '#22d3ee', '#ffffff'];
          currentStyle = { ...currentStyle, color: brightColors[code - 90] };
        } else if (code >= 40 && code <= 47) {
          const bgColors = ['#000000', '#7f1d1d', '#064e3b', '#78350f', '#1e3a8a', '#701a75', '#164e63', '#475569'];
          currentStyle = { ...currentStyle, backgroundColor: bgColors[code - 40] };
        }
      });
    }
    
    return (
      <span key={index} style={{ ...currentStyle }}>
        {part}
      </span>
    );
  });
};

const getSvgPath = (data: number[], width: number, height: number) => {
  if (data.length === 0) return "";
  const points = data.map((val, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - (val / 100) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
};

const getSvgFillPath = (data: number[], width: number, height: number) => {
  if (data.length === 0) return "";
  const path = getSvgPath(data, width, height);
  return `${path} L ${width.toFixed(1)},${height.toFixed(1)} L 0,${height.toFixed(1)} Z`;
};

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
  const [stdinInput, setStdinInput] = useState("");
  const [cwdInput, setCwdInput] = useState("/home/solar1/Arushi Tauri App");
  const [processes, setProcesses] = useState<ActiveProcess[]>([]);
  const [activeProcessId, setActiveProcessId] = useState<string | null>(null);
  
  // Telemetry histories & Shell Selector state
  const [cpuHistory, setCpuHistory] = useState<number[]>(new Array(15).fill(0));
  const [ramHistory, setRamHistory] = useState<number[]>(new Array(15).fill(0));
  const [selectedShell, setSelectedShell] = useState<string>("sh");
  const [selectedProcessEnvFile, setSelectedProcessEnvFile] = useState<string>("none");
  const [processEnvPairs, setProcessEnvPairs] = useState<EnvPair[]>([]);
  
  // System Process Explorer states
  const [systemProcesses, setSystemProcesses] = useState<ProcessInfo[]>([]);
  const [processesSearch, setProcessesSearch] = useState("");
  const [procSortField, setProcSortField] = useState<"cpu_usage" | "memory" | "pid" | "name">("cpu_usage");
  const [procSortAsc, setProcSortAsc] = useState(false);
  const [processesError, setProcessesError] = useState<string | null>(null);
  
  // Security Config capabilities state
  const [capabilities, setCapabilities] = useState<CapabilitiesInfo | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  
  // Git Workspace Manager states
  const [gitPath, setGitPath] = useState("/home/solar1/Arushi Tauri App");
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const [gitCommitMsg, setGitCommitMsg] = useState("");
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitStatusMsg, setGitStatusMsg] = useState<string | null>(null);
  
  // Database Explorer states
  const [dbPath, setDbPath] = useState("/home/solar1/Arushi Tauri App/devdock.db");
  const [dbTables, setDbTables] = useState<string[]>([]);
  const [selectedDbTable, setSelectedDbTable] = useState<string | null>(null);
  const [dbQuery, setDbQuery] = useState("");
  const [dbQueryResult, setDbQueryResult] = useState<any[]>([]);
  const [dbQueryColumns, setDbQueryColumns] = useState<string[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbSuccessMsg, setDbSuccessMsg] = useState<string | null>(null);
  
  // Workspace Mirror Sync states
  const [mirrorDir, setMirrorDir] = useState("/home/solar1/Downloads/Arushi Work/Predictive Maintenance/predictive-maintenance-system-for-atlas-copco-compressors");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Poll system stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const stats = await invoke<SystemStats>("get_system_stats");
        setSysStats(stats);
        
        // Update history
        setCpuHistory((prev) => [...prev.slice(1), stats.cpu_usage]);
        const ramPct = stats.ram_total > 0 ? (stats.ram_used / stats.ram_total) * 100 : 0;
        setRamHistory((prev) => [...prev.slice(1), ramPct]);
      } catch (err) {
        console.error("Failed to fetch system stats:", err);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  // Load workspace settings on startup
  useEffect(() => {
    const initSettings = async () => {
      try {
        const saved = await invoke<SettingsData>("load_settings");
        if (saved) {
          if (saved.env_dir) setEnvDir(saved.env_dir);
          if (saved.cwd_input) setCwdInput(saved.cwd_input);
          if (saved.git_path) setGitPath(saved.git_path);
          if (saved.db_path) setDbPath(saved.db_path);
          if (saved.mirror_dir) setMirrorDir(saved.mirror_dir);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };
    initSettings();
  }, []);

  const saveWorkspaceSettings = async (
    newEnvDir: string,
    newCwd: string,
    newGitPath?: string,
    newDbPath?: string,
    newMirrorDir?: string
  ) => {
    try {
      await invoke("save_settings", {
        settings: {
          env_dir: newEnvDir,
          cwd_input: newCwd,
          cmd_history: [],
          theme: "dark",
          git_path: newGitPath || gitPath,
          db_path: newDbPath || dbPath,
          mirror_dir: newMirrorDir || mirrorDir,
        }
      });
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  // Synchronize envFiles when envDir changes
  useEffect(() => {
    if (envDir) {
      fetchEnvFiles();
    }
  }, [envDir]);

  // Synchronize envPairs for the selected spawner env preset
  useEffect(() => {
    const loadProcessEnv = async () => {
      if (selectedProcessEnvFile === "none" || !selectedProcessEnvFile) {
        setProcessEnvPairs([]);
        return;
      }
      try {
        const filePath = `${envDir}/${selectedProcessEnvFile}`;
        const pairs = await invoke<EnvPair[]>("read_env_file", { filePath });
        setProcessEnvPairs(pairs);
      } catch (err) {
        console.error("Failed to load process env:", err);
      }
    };
    loadProcessEnv();
  }, [selectedProcessEnvFile, envDir]);

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

      const unlistenDockerLogs = await listen<{ id: string; text: string; is_error: boolean }>(
        "docker-log-line",
        (event) => {
          setSelectedLogs((prev) => {
            if (prev && prev.name === event.payload.id) {
              return {
                ...prev,
                logs: prev.logs ? prev.logs + "\n" + event.payload.text : event.payload.text,
              };
            }
            return prev;
          });
        }
      );

      return () => {
        unlistenOutput();
        unlistenStatus();
        unlistenDockerLogs();
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
      await invoke("start_docker_logs_stream", { containerName: name });
    } catch (err) {
      setSelectedLogs({ id, name, logs: `Failed to fetch logs: ${err}` });
    } finally {
      setLogsLoading(false);
    }
  };

  const closeDockerLogs = async () => {
    if (selectedLogs) {
      try {
        await invoke("stop_docker_logs_stream", { containerName: selectedLogs.name });
      } catch (err) {
        console.error("Failed to stop docker logs stream:", err);
      }
      setSelectedLogs(null);
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

  // System Process Explorer actions
  const fetchSystemProcesses = async () => {
    try {
      setProcessesError(null);
      const list = await invoke<ProcessInfo[]>("get_system_processes");
      setSystemProcesses(list);
    } catch (err) {
      console.error(err);
      setProcessesError(`Failed to load system processes: ${err}`);
    }
  };

  const fetchCapabilities = async () => {
    try {
      setCapabilitiesError(null);
      const caps = await invoke<CapabilitiesInfo>("get_capabilities");
      setCapabilities(caps);
    } catch (err) {
      console.error(err);
      setCapabilitiesError(`Failed to load capabilities: ${err}`);
    }
  };

  const fetchGitStatus = async () => {
    try {
      setGitError(null);
      const res = await invoke<GitStatusInfo>("get_git_status", { repoPath: gitPath });
      setGitStatus(res);
    } catch (err) {
      console.error(err);
      setGitError(`Failed to load Git status: ${err}`);
      setGitStatus(null);
    }
  };

  const handleGitCommitAndPush = async () => {
    if (!gitCommitMsg.trim()) {
      alert("Please enter a commit message.");
      return;
    }
    setGitLoading(true);
    setGitStatusMsg(null);
    try {
      const msg = await invoke<string>("git_commit_and_push", {
        repoPath: gitPath,
        message: gitCommitMsg,
      });
      setGitStatusMsg(msg);
      setGitCommitMsg("");
      fetchGitStatus();
    } catch (err) {
      console.error(err);
      alert(`Git Action Failed: ${err}`);
    } finally {
      setGitLoading(false);
    }
  };

  // Database Explorer actions
  const fetchDbTables = async () => {
    try {
      setDbError(null);
      setDbSuccessMsg(null);
      const tables = await invoke<string[]>("get_sqlite_tables", { dbPath });
      setDbTables(tables);
      if (tables.length > 0 && !selectedDbTable) {
        setSelectedDbTable(tables[0]);
      }
    } catch (err) {
      console.error(err);
      setDbError(String(err));
      setDbTables([]);
    }
  };

  const executeDbQuery = async (queryText?: string) => {
    const q = queryText || dbQuery;
    if (!q.trim()) {
      alert("Please enter a SQL query.");
      return;
    }
    setDbLoading(true);
    setDbError(null);
    setDbSuccessMsg(null);
    try {
      const resStr = await invoke<string>("run_sqlite_query", { dbPath, query: q });
      const records = JSON.parse(resStr);
      setDbQueryResult(records);
      if (records.length > 0) {
        setDbQueryColumns(Object.keys(records[0]));
      } else {
        setDbQueryColumns([]);
        setDbSuccessMsg("Query executed successfully. Result set is empty.");
      }
    } catch (err) {
      console.error(err);
      setDbError(String(err));
      setDbQueryResult([]);
      setDbQueryColumns([]);
    } finally {
      setDbLoading(false);
    }
  };

  const selectDbTableHandler = (tableName: string) => {
    setSelectedDbTable(tableName);
    const sql = `SELECT * FROM ${tableName} LIMIT 50;`;
    setDbQuery(sql);
    executeDbQuery(sql);
  };

  const runWorkspaceSync = async () => {
    setSyncLoading(true);
    setSyncStatusMsg(null);
    setSyncError(null);
    try {
      const res = await invoke<string>("mirror_workspace", { src: cwdInput, dest: mirrorDir });
      setSyncStatusMsg(res);
      saveWorkspaceSettings(envDir, cwdInput, gitPath, dbPath, mirrorDir);
    } catch (err) {
      console.error(err);
      setSyncError(String(err));
    } finally {
      setSyncLoading(false);
    }
  };

  const handleKillExplorerProcess = async (pid: number, name: string) => {
    if (confirm(`Are you sure you want to terminate process "${name}" (PID: ${pid})?`)) {
      try {
        await invoke("kill_process", { pid });
        fetchSystemProcesses();
      } catch (err) {
        alert(`Failed to terminate process: ${err}`);
      }
    }
  };

  const handleSortProcesses = (field: "cpu_usage" | "memory" | "pid" | "name") => {
    if (procSortField === field) {
      setProcSortAsc(!procSortAsc);
    } else {
      setProcSortField(field);
      setProcSortAsc(false);
    }
  };

  const getSortedProcesses = () => {
    let list = [...systemProcesses];
    if (processesSearch.trim()) {
      const q = processesSearch.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.pid.toString().includes(q));
    }
    
    list.sort((a, b) => {
      let valA: any = a[procSortField];
      let valB: any = b[procSortField];
      
      if (procSortField === "name") {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      
      if (valA < valB) return procSortAsc ? -1 : 1;
      if (valA > valB) return procSortAsc ? 1 : -1;
      return 0;
    });
    
    return list;
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
      saveWorkspaceSettings(envDir, cwdInput);
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
      saveWorkspaceSettings(envDir, cwdInput);
      await invoke("run_process", {
        id: newId,
        command: cmdInput,
        cwd: cwdInput,
        shell: selectedShell,
        env_vars: selectedProcessEnvFile !== "none" ? processEnvPairs : null,
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

  const sendStdin = async (procId: string) => {
    if (!stdinInput.trim()) return;
    try {
      setProcesses((prev) =>
        prev.map((p) => {
          if (p.id === procId) {
            return {
              ...p,
              logs: [
                ...p.logs,
                {
                  text: `> ${stdinInput}`,
                  is_error: false,
                  timestamp: new Date().toLocaleTimeString(),
                },
              ].slice(-500),
            };
          }
          return p;
        })
      );
      await invoke("send_process_stdin", { id: procId, input: stdinInput });
      setStdinInput("");
    } catch (err) {
      console.error(err);
      alert(`Failed to write to stdin: ${err}`);
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

  const formatProcessMemory = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb.toFixed(1)} MB`;
  };

  // Load view-specific data
  useEffect(() => {
    if (activeTab === "docker") {
      fetchContainers();
    } else if (activeTab === "ports") {
      fetchPorts();
    } else if (activeTab === "env") {
      fetchEnvFiles();
    } else if (activeTab === "capabilities") {
      fetchCapabilities();
    } else if (activeTab === "git") {
      fetchGitStatus();
    } else if (activeTab === "database") {
      fetchDbTables();
    }
  }, [activeTab]);

  // Watch gitPath change to refresh status and save configuration
  useEffect(() => {
    if (gitPath) {
      fetchGitStatus();
      saveWorkspaceSettings(envDir, cwdInput, gitPath, dbPath);
    }
  }, [gitPath]);

  // Watch dbPath change to refresh tables and save configuration
  useEffect(() => {
    if (dbPath) {
      fetchDbTables();
      saveWorkspaceSettings(envDir, cwdInput, gitPath, dbPath);
    }
  }, [dbPath]);

  // Poll system processes when tab active
  useEffect(() => {
    if (activeTab === "processes_explorer") {
      fetchSystemProcesses();
      const interval = setInterval(fetchSystemProcesses, 3000);
      return () => clearInterval(interval);
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
            className={`nav-item ${activeTab === "processes_explorer" ? "active" : ""}`}
            onClick={() => setActiveTab("processes_explorer")}
          >
            <List />
            System Processes
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
          <li
            className={`nav-item ${activeTab === "capabilities" ? "active" : ""}`}
            onClick={() => setActiveTab("capabilities")}
          >
            <Settings />
            Security Config
          </li>
          <li
            className={`nav-item ${activeTab === "git" ? "active" : ""}`}
            onClick={() => setActiveTab("git")}
          >
            <GitBranch />
            Git Manager
          </li>
          <li
            className={`nav-item ${activeTab === "database" ? "active" : ""}`}
            onClick={() => setActiveTab("database")}
          >
            <Database />
            Database Explorer
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
              {activeTab === "processes_explorer" && "System Process Explorer"}
              {activeTab === "capabilities" && "Security Config"}
              {activeTab === "git" && "Git Workspace Manager"}
              {activeTab === "database" && "Database Explorer"}
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
                    <div className="card card-with-chart">
                      <div className="card-title">
                        <Cpu /> CPU Utilization
                      </div>
                      <div className="stat-display-row">
                        <div className="stat-display">
                          <span className="stat-value">{sysStats.cpu_usage.toFixed(1)}%</span>
                        </div>
                        <div className="card-mini-chart">
                          <svg width="120" height="40" style={{ overflow: "visible" }}>
                            <defs>
                              <linearGradient id="cpu-grad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
                              </linearGradient>
                            </defs>
                            <path
                              d={getSvgFillPath(cpuHistory, 120, 40)}
                              fill="url(#cpu-grad)"
                            />
                            <path
                              d={getSvgPath(cpuHistory, 120, 40)}
                              fill="none"
                              stroke="var(--primary)"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      </div>
                      <div className="progress-bar-container">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${sysStats.cpu_usage}%` }}
                        ></div>
                      </div>
                      <span className="stat-sub">Overall CPU processing workload</span>
                    </div>

                    <div className="card card-with-chart">
                      <div className="card-title">
                        <Activity /> Memory Usage
                      </div>
                      <div className="stat-display-row">
                        <div className="stat-display">
                          <span className="stat-value">
                            {((sysStats.ram_used / sysStats.ram_total) * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="card-mini-chart">
                          <svg width="120" height="40" style={{ overflow: "visible" }}>
                            <defs>
                              <linearGradient id="ram-grad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--secondary)" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="var(--secondary)" stopOpacity="0.0" />
                              </linearGradient>
                            </defs>
                            <path
                              d={getSvgFillPath(ramHistory, 120, 40)}
                              fill="url(#ram-grad)"
                            />
                            <path
                              d={getSvgPath(ramHistory, 120, 40)}
                              fill="none"
                              stroke="var(--secondary)"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
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
                  <div className="input-group" style={{ maxWidth: "120px" }}>
                    <label className="input-label">Shell</label>
                    <select
                      className="txt-input txt-input-mono"
                      value={selectedShell}
                      onChange={(e) => setSelectedShell(e.target.value)}
                      style={{ height: "42px", background: "var(--bg-color)", border: "1px solid var(--border-color)", borderRadius: "8px", color: "var(--text-main)", padding: "0 12px" }}
                    >
                      <option value="sh">sh</option>
                      <option value="bash">bash</option>
                      <option value="zsh">zsh</option>
                      <option value="powershell">powershell</option>
                      <option value="cmd">cmd</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ maxWidth: "200px" }}>
                    <label className="input-label">Environment Preset</label>
                    <select
                      className="txt-input txt-input-mono"
                      value={selectedProcessEnvFile}
                      onChange={(e) => setSelectedProcessEnvFile(e.target.value)}
                      style={{ height: "42px", background: "var(--bg-color)", border: "1px solid var(--border-color)", borderRadius: "8px", color: "var(--text-main)", padding: "0 12px" }}
                    >
                      <option value="none">No Preset</option>
                      {envFiles.map((file) => (
                        <option key={file} value={file}>
                          {file}
                        </option>
                      ))}
                    </select>
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
                              {parseAnsi(log.text)}
                            </div>
                          ))}
                        <div ref={terminalEndRef} />
                      </div>

                      {processes.find((p) => p.id === activeProcessId)?.status === "running" && (
                        <div
                          style={{
                            display: "flex",
                            gap: "10px",
                            marginTop: "10px",
                            padding: "10px",
                            background: "rgba(255, 255, 255, 0.02)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "8px",
                            alignItems: "center"
                          }}
                        >
                          <span style={{ fontFamily: "monospace", color: "var(--primary)", fontSize: "14px", fontWeight: "bold" }}>
                            PTY Stdin &gt;
                          </span>
                          <input
                            type="text"
                            className="txt-input txt-input-mono"
                            style={{ flexGrow: 1, height: "36px", padding: "0 10px" }}
                            placeholder="Type input and press Enter to send to process stdin..."
                            value={stdinInput}
                            onChange={(e) => setStdinInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                sendStdin(activeProcessId);
                              }
                            }}
                          />
                          <button
                            className="btn btn-primary"
                            style={{ height: "36px", padding: "0 16px" }}
                            onClick={() => sendStdin(activeProcessId)}
                          >
                            Send
                          </button>
                        </div>
                      )}
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

          {activeTab === "processes_explorer" && (
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
                    placeholder="Search by PID or name..."
                    style={{ paddingLeft: "36px", width: "100%" }}
                    value={processesSearch}
                    onChange={(e) => setProcessesSearch(e.target.value)}
                  />
                </div>
                <button className="btn" onClick={fetchSystemProcesses}>
                  <RefreshCw style={{ width: "16px", height: "16px" }} /> Refresh List
                </button>
              </div>

              {processesError ? (
                <div className="empty-state" style={{ borderColor: "var(--danger)" }}>
                  <AlertTriangle style={{ color: "var(--danger)" }} />
                  <h3>Process Monitor Error</h3>
                  <p>{processesError}</p>
                </div>
              ) : getSortedProcesses().length === 0 ? (
                <div className="empty-state">
                  <Activity />
                  <h3>No matching processes</h3>
                  <p>Check search query.</p>
                </div>
              ) : (
                <div className="table-container">
                  <table className="inspector-table">
                    <thead>
                      <tr>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSortProcesses("name")}>
                          Process Name {procSortField === "name" && (procSortAsc ? "▲" : "▼")}
                        </th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSortProcesses("pid")}>
                          PID {procSortField === "pid" && (procSortAsc ? "▲" : "▼")}
                        </th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSortProcesses("cpu_usage")}>
                          CPU % {procSortField === "cpu_usage" && (procSortAsc ? "▲" : "▼")}
                        </th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSortProcesses("memory")}>
                          Memory {procSortField === "memory" && (procSortAsc ? "▲" : "▼")}
                        </th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getSortedProcesses().map((p) => (
                        <tr key={p.pid}>
                          <td style={{ fontWeight: "600" }}>{p.name}</td>
                          <td>
                            <span className="pid-badge">{p.pid}</span>
                          </td>
                          <td>
                            <span style={{ fontWeight: "600", color: p.cpu_usage > 50 ? "var(--danger)" : "var(--primary)" }}>
                              {p.cpu_usage.toFixed(1)}%
                            </span>
                          </td>
                          <td>{formatProcessMemory(p.memory)}</td>
                          <td>
                            <span className="status-badge" style={{ color: p.status.toLowerCase().includes("run") ? "var(--success)" : "var(--text-muted)" }}>
                              {p.status}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              className="icon-btn icon-btn-danger"
                              title="Terminate Process"
                              onClick={() => handleKillExplorerProcess(p.pid, p.name)}
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

          {activeTab === "capabilities" && (
            <div className="ports-view">
              {capabilitiesError ? (
                <div className="empty-state" style={{ borderColor: "var(--danger)" }}>
                  <AlertTriangle style={{ color: "var(--danger)" }} />
                  <h3>Capabilities Scan Failed</h3>
                  <p>{capabilitiesError}</p>
                </div>
              ) : !capabilities ? (
                <div className="empty-state">
                  <Activity />
                  <h3>Reading Capability Configuration...</h3>
                  <p>Accessing default.json</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div className="card">
                    <h3 style={{ marginBottom: "16px", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "8px" }}>
                      <Settings style={{ width: "20px", height: "20px", color: "var(--primary)" }} />
                      App Configuration Profile
                    </h3>
                    <div className="telemetry-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px" }}>
                      <div>
                        <p style={{ color: "var(--text-muted)", marginBottom: "4px" }}>Identifier</p>
                        <p style={{ fontWeight: "600", color: "var(--primary)" }}>{capabilities.identifier}</p>
                      </div>
                      <div>
                        <p style={{ color: "var(--text-muted)", marginBottom: "4px" }}>Description</p>
                        <p style={{ fontWeight: "600" }}>{capabilities.description || "N/A"}</p>
                      </div>
                      <div>
                        <p style={{ color: "var(--text-muted)", marginBottom: "4px" }}>Authorized Windows</p>
                        <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                          {capabilities.windows.map(w => (
                            <span key={w} className="status-badge" style={{ background: "rgba(59, 130, 246, 0.1)", color: "var(--primary)", border: "1px solid rgba(59, 130, 246, 0.2)" }}>
                              {w}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <h3 style={{ marginBottom: "16px", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "8px" }}>
                      <Activity style={{ width: "20px", height: "20px", color: "var(--success)" }} />
                      Granted OS Permissions & Capability Scopes ({capabilities.permissions.length})
                    </h3>
                    <p style={{ color: "var(--text-muted)", marginBottom: "20px", fontSize: "14px" }}>
                      Tauri v2 uses explicit opt-in permissions. Below are the permissions declared in your manifest allowing the frontend to access native Rust modules:
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
                      {capabilities.permissions.map(permission => {
                        const isCore = permission.startsWith("core:");
                        const isOpener = permission.startsWith("opener:");
                        return (
                          <div key={permission} style={{ padding: "16px", background: "var(--bg-color)", border: "1px solid var(--border-color)", borderRadius: "10px", display: "flex", alignItems: "flex-start", gap: "12px" }}>
                            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isCore ? "var(--primary)" : isOpener ? "var(--success)" : "var(--text-muted)", marginTop: "6px" }}></div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <span style={{ fontFamily: "monospace", fontSize: "14px", fontWeight: "600", color: "var(--text-main)" }}>
                                {permission}
                              </span>
                              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                {isCore ? "Standard Tauri core API permission" : isOpener ? "Allows opening external URIs and paths" : "Custom capability scope plugin permission"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "git" && (
            <div className="ports-view">
              {/* Repository config */}
              <div className="card" style={{ marginBottom: "20px" }}>
                <div className="form-row">
                  <div className="input-group">
                    <label className="input-label">Git Repository Path</label>
                    <input
                      type="text"
                      className="txt-input txt-input-mono"
                      value={gitPath}
                      onChange={(e) => setGitPath(e.target.value)}
                    />
                  </div>
                  <button className="btn" onClick={fetchGitStatus} style={{ alignSelf: "flex-end", height: "42px" }}>
                    <RefreshCw style={{ width: "16px", height: "16px" }} /> Refresh Status
                  </button>
                </div>
              </div>

              {gitError ? (
                <div className="empty-state" style={{ borderColor: "var(--danger)" }}>
                  <AlertTriangle style={{ color: "var(--danger)" }} />
                  <h3>Git Repository Scan Failed</h3>
                  <p>{gitError}</p>
                </div>
              ) : !gitStatus ? (
                <div className="empty-state">
                  <Activity />
                  <h3>Reading Repository Status...</h3>
                  <p>Running git commands</p>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                  {/* Left Column: Changes */}
                  <div className="card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                    <h3 style={{ marginBottom: "16px", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "8px" }}>
                      <GitBranch style={{ width: "20px", height: "20px", color: "var(--primary)" }} />
                      Active Branch: <span style={{ color: "var(--primary)" }}>{gitStatus.branch}</span>
                    </h3>
                    
                    <h4 style={{ marginBottom: "12px", color: "var(--text-main)" }}>
                      Uncommitted Changes ({gitStatus.uncommitted.length})
                    </h4>

                    {gitStatus.uncommitted.length === 0 ? (
                      <div className="empty-state" style={{ flexGrow: 1, borderStyle: "dashed" }}>
                        <span style={{ fontSize: "28px" }}>✨</span>
                        <h3>Working Tree Clean</h3>
                        <p>No changes detected in this repository.</p>
                      </div>
                    ) : (
                      <div style={{ flexGrow: 1, overflowY: "auto", maxHeight: "400px", paddingRight: "8px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {gitStatus.uncommitted.map((f, idx) => {
                            let color = "var(--text-muted)";
                            let bg = "rgba(255, 255, 255, 0.05)";
                            if (f.status === "M") { color = "#eab308"; bg = "rgba(234, 179, 8, 0.1)"; }
                            else if (f.status === "A" || f.status === "AM") { color = "var(--success)"; bg = "rgba(34, 197, 94, 0.1)"; }
                            else if (f.status === "D") { color = "var(--danger)"; bg = "rgba(239, 68, 68, 0.1)"; }
                            else if (f.status === "??" || f.status === "U") { color = "#a855f7"; bg = "rgba(168, 85, 247, 0.1)"; }

                            return (
                              <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--bg-color)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                                <span style={{ fontFamily: "monospace", fontSize: "14px", color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>
                                  {f.path}
                                </span>
                                <span className="status-badge" style={{ background: bg, color: color, borderColor: "transparent", fontSize: "12px", padding: "2px 8px", minWidth: "30px", textAlign: "center" }}>
                                  {f.status === "??" ? "Untracked" : f.status === "M" ? "Modified" : f.status === "A" ? "Added" : f.status === "D" ? "Deleted" : f.status}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Actions & Log */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    {/* Commit & Sync Form */}
                    <div className="card">
                      <h3 style={{ marginBottom: "16px", color: "var(--text-main)" }}>
                        Commit & Push Changes
                      </h3>
                      <div className="input-group" style={{ marginBottom: "16px" }}>
                        <label className="input-label">Commit Message</label>
                        <textarea
                          className="txt-input txt-input-mono"
                          rows={3}
                          placeholder="Write a clear commit message..."
                          value={gitCommitMsg}
                          onChange={(e) => setGitCommitMsg(e.target.value)}
                          style={{ width: "100%", height: "80px", padding: "10px 12px", resize: "none" }}
                          disabled={gitStatus.uncommitted.length === 0 || gitLoading}
                        />
                      </div>

                      {gitStatusMsg && (
                        <div className="status-badge" style={{ display: "block", background: "rgba(34, 197, 94, 0.1)", color: "var(--success)", borderColor: "rgba(34, 197, 94, 0.2)", padding: "10px 14px", borderRadius: "8px", marginBottom: "16px", whiteSpace: "pre-wrap" }}>
                          {gitStatusMsg}
                        </div>
                      )}

                      <button
                        className="btn btn-primary"
                        onClick={handleGitCommitAndPush}
                        disabled={gitStatus.uncommitted.length === 0 || gitLoading}
                        style={{ width: "100%", height: "42px", justifyContent: "center" }}
                      >
                        {gitLoading ? "Pushing Changes..." : "Commit All & Push"}
                      </button>
                    </div>

                    {/* Mirror & Sync Workspace */}
                    <div className="card">
                      <h3 style={{ marginBottom: "16px", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "8px" }}>
                        <RotateCw style={{ width: "20px", height: "20px", color: "var(--primary)" }} />
                        Mirror & Backup Workspace
                      </h3>
                      
                      <div className="input-group" style={{ marginBottom: "16px" }}>
                        <label className="input-label">Mirror Destination Directory</label>
                        <input
                          type="text"
                          className="txt-input txt-input-mono"
                          value={mirrorDir}
                          onChange={(e) => setMirrorDir(e.target.value)}
                        />
                      </div>

                      {syncStatusMsg && (
                        <div className="status-badge" style={{ display: "block", background: "rgba(34, 197, 94, 0.1)", color: "var(--success)", borderColor: "rgba(34, 197, 94, 0.2)", padding: "10px 14px", borderRadius: "8px", marginBottom: "16px", whiteSpace: "pre-wrap", maxHeight: "120px", overflowY: "auto", fontFamily: "monospace", fontSize: "12px" }}>
                          {syncStatusMsg}
                        </div>
                      )}

                      {syncError && (
                        <div className="status-badge" style={{ display: "block", background: "rgba(239, 68, 68, 0.1)", color: "var(--danger)", borderColor: "rgba(239, 68, 68, 0.2)", padding: "10px 14px", borderRadius: "8px", marginBottom: "16px", whiteSpace: "pre-wrap", fontSize: "13px" }}>
                          {syncError}
                        </div>
                      )}

                      <button
                        className="btn btn-primary"
                        onClick={runWorkspaceSync}
                        disabled={syncLoading}
                        style={{ width: "100%", height: "42px", justifyContent: "center" }}
                      >
                        {syncLoading ? "Synchronizing..." : "Sync Workspace to Mirror"}
                      </button>
                    </div>

                    {/* Recent History */}
                    <div className="card">
                      <h3 style={{ marginBottom: "16px", color: "var(--text-main)" }}>
                        Recent Repository History
                      </h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {gitStatus.recent_commits.map((c) => (
                          <div key={c.hash} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", background: "var(--bg-color)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                            <span style={{ fontFamily: "monospace", fontSize: "13px", fontWeight: "600", color: "var(--primary)", background: "rgba(59, 130, 246, 0.1)", padding: "2px 6px", borderRadius: "4px" }}>
                              {c.hash}
                            </span>
                            <span style={{ fontSize: "14px", color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "database" && (
            <div className="ports-view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              {/* Database config */}
              <div className="card" style={{ marginBottom: "20px" }}>
                <div className="form-row">
                  <div className="input-group">
                    <label className="input-label">SQLite Database Path</label>
                    <input
                      type="text"
                      className="txt-input txt-input-mono"
                      value={dbPath}
                      onChange={(e) => setDbPath(e.target.value)}
                    />
                  </div>
                  <button className="btn" onClick={fetchDbTables} style={{ alignSelf: "flex-end", height: "42px" }}>
                    <RefreshCw style={{ width: "16px", height: "16px" }} /> Connect & Scan
                  </button>
                </div>
              </div>

              {dbError && (
                <div className="empty-state" style={{ borderColor: "var(--danger)", marginBottom: "20px" }}>
                  <AlertTriangle style={{ color: "var(--danger)" }} />
                  <h3>Database Connection Failed</h3>
                  <p>{dbError}</p>
                </div>
              )}

              {!dbError && dbTables.length === 0 && (
                <div className="empty-state">
                  <Database />
                  <h3>No Tables Found</h3>
                  <p>Check database path or ensure sqlite3 client is installed.</p>
                </div>
              )}

              {!dbError && dbTables.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "20px", flexGrow: 1, minHeight: "450px" }}>
                  {/* Tables Sidebar */}
                  <div className="card" style={{ display: "flex", flexDirection: "column", padding: "16px" }}>
                    <h3 style={{ marginBottom: "14px", color: "var(--text-main)", fontSize: "16px" }}>
                      Tables ({dbTables.length})
                    </h3>
                    <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                      {dbTables.map((table) => (
                        <div
                          key={table}
                          onClick={() => selectDbTableHandler(table)}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            background: selectedDbTable === table ? "var(--primary)" : "var(--bg-color)",
                            color: selectedDbTable === table ? "#fff" : "var(--text-main)",
                            cursor: "pointer",
                            fontWeight: selectedDbTable === table ? "600" : "500",
                            border: "1px solid var(--border-color)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {table}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Query Runner & Results Grid */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    {/* SQL Editor */}
                    <div className="card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <h3 style={{ color: "var(--text-main)", fontSize: "16px" }}>SQL Editor</h3>
                        {selectedDbTable && (
                          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                            Active Table: <strong>{selectedDbTable}</strong>
                          </span>
                        )}
                      </div>
                      <div className="input-group" style={{ marginBottom: "12px" }}>
                        <textarea
                          className="txt-input txt-input-mono"
                          rows={3}
                          value={dbQuery}
                          onChange={(e) => setDbQuery(e.target.value)}
                          placeholder="SELECT * FROM table_name LIMIT 50;"
                          style={{ width: "100%", height: "80px", padding: "10px 12px", resize: "vertical" }}
                        />
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={() => executeDbQuery()}
                        disabled={dbLoading}
                        style={{ width: "120px", height: "38px", justifyContent: "center" }}
                      >
                        {dbLoading ? "Running..." : "Run Query"}
                      </button>
                    </div>

                    {/* Query Result Grid */}
                    <div className="card" style={{ flexGrow: 1, display: "flex", flexDirection: "column", minHeight: "300px" }}>
                      <h3 style={{ marginBottom: "14px", color: "var(--text-main)", fontSize: "16px" }}>
                        Results {dbQueryResult.length > 0 && `(${dbQueryResult.length} rows)`}
                      </h3>

                      {dbSuccessMsg && (
                        <div style={{ padding: "12px 16px", background: "rgba(34, 197, 94, 0.1)", color: "var(--success)", border: "1px solid rgba(34, 197, 94, 0.2)", borderRadius: "8px", fontSize: "14px" }}>
                          {dbSuccessMsg}
                        </div>
                      )}

                      {dbQueryResult.length === 0 && !dbSuccessMsg && (
                        <div className="empty-state" style={{ flexGrow: 1, border: "none" }}>
                          <span style={{ fontSize: "28px" }}>📊</span>
                          <p style={{ color: "var(--text-muted)", marginTop: "8px" }}>No results to display. Run a SQL query above.</p>
                        </div>
                      )}

                      {dbQueryResult.length > 0 && (
                        <div className="table-container" style={{ flexGrow: 1, maxHeight: "350px", overflow: "auto" }}>
                          <table className="inspector-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                {dbQueryColumns.map((col) => (
                                  <th key={col} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "2px solid var(--border-color)" }}>
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {dbQueryResult.map((row, idx) => (
                                <tr key={idx}>
                                  {dbQueryColumns.map((col) => (
                                    <td key={col} style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)", fontFamily: "monospace", fontSize: "13px" }}>
                                      {row[col] !== null && row[col] !== undefined ? String(row[col]) : <em style={{ color: "var(--text-dark)" }}>NULL</em>}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
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
        <div className="modal-overlay" onClick={closeDockerLogs}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Logs for container: {selectedLogs.name}</span>
              <button className="icon-btn" onClick={closeDockerLogs}>
                <X style={{ width: "18px", height: "18px" }} />
              </button>
            </div>
            <div className="terminal-console">
              {logsLoading ? (
                <div className="terminal-line status">Streaming docker container logs...</div>
              ) : selectedLogs.logs ? (
                selectedLogs.logs.split("\n").map((line, idx) => (
                  <div className="terminal-line" key={idx}>
                    {parseAnsi(line)}
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
