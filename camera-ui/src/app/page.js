"use client";

import { useState, useEffect, useRef } from "react";

export default function Home() {
  // Application States
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [cameraStatus, setCameraStatus] = useState({});
  const [profiles, setProfiles] = useState({});
  const [refreshKeys, setRefreshKeys] = useState({});
  const [activeAudios, setActiveAudios] = useState({});

  const [layoutMode, setLayoutMode] = useState("grid"); // "grid" or "list"
  const [fullscreenCamera, setFullscreenCamera] = useState(null); // null, "138", "139", "usb_0", "usb_1", "usb_2"
  const [logs, setLogs] = useState([]);
  const [uptime, setUptime] = useState("00:00:00");
  
  const startTimeRef = useRef(Date.now());
  const logContainerRef = useRef(null);

  // Helper function to push logs with timestamps
  const addLog = (message, type = "info") => {
    const now = new Date();
    const timestamp = now.toTimeString().split(" ")[0];
    setLogs((prev) => [...prev.slice(-49), { timestamp, message, type }]); // Keep last 50 logs
  };

  // Uptime calculator
  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Date.now() - startTimeRef.current;
      const hours = Math.floor(diff / 3600000).toString().padStart(2, "0");
      const minutes = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0");
      const seconds = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0");
      setUptime(`${hours}:${minutes}:${seconds}`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Initial welcome logs
  useEffect(() => {
    addLog("Buscando conexão com o servidor de streaming...", "info");
  }, []);

  // Poll status from python server
  useEffect(() => {
    let active = true;
    
    const checkServerStatus = async () => {
      try {
        const response = await fetch("/status");
        if (!response.ok) throw new Error("HTTP error " + response.status);
        
        const data = await response.json();
        
        if (active) {
          if (!isBackendOnline) {
            setIsBackendOnline(true);
            addLog("Servidor de Streaming detectado com sucesso online!", "success");
          }
          
          setCameraStatus(data);
          
          // Inicializar dinamicamente os estados reativos para chaves novas de câmeras
          const uniqueIds = Array.from(new Set(Object.keys(data).map(key => key.replace("_main", "").replace("_sub", ""))));
          
          setProfiles(prev => {
            const next = { ...prev };
            let changed = false;
            uniqueIds.forEach(id => {
              if (!next[id]) {
                next[id] = "main";
                changed = true;
              }
            });
            return changed ? next : prev;
          });
          
          setRefreshKeys(prev => {
            const next = { ...prev };
            let changed = false;
            uniqueIds.forEach(id => {
              if (next[id] === undefined) {
                next[id] = 0;
                changed = true;
              }
            });
            return changed ? next : prev;
          });
          
          setActiveAudios(prev => {
            const next = { ...prev };
            let changed = false;
            uniqueIds.forEach(id => {
              if (next[id] === undefined) {
                next[id] = false;
                changed = true;
              }
            });
            return changed ? next : prev;
          });
          
          // Check for camera status changes to log
          Object.keys(data).forEach((key) => {
            let camLabel = "";
            if (key.startsWith("usb_")) {
              const slot = key.split("_")[1];
              camLabel = slot === "0" ? "Webcam USB Integrada (Slot 0)" : `Webcam USB Externa ${slot} (Slot ${slot})`;
            } else {
              const ip = data[key]?.ip || `192.168.3.${key.split("_")[0]}`;
              camLabel = `Câmera IP ${ip}`;
            }

            const profileName = key.includes("main") ? "Main" : "Sub";
            const wasConnected = cameraStatus[key]?.connected;
            const isConnected = data[key]?.connected;
            
            if (isConnected && wasConnected === false) {
              addLog(`${camLabel} (${profileName}) conectou com sucesso. Feed ativo.`, "success");
            } else if (isConnected === false && wasConnected) {
              addLog(`Sinal de ${camLabel} (${profileName}) foi perdido!`, "error");
              
              // Automute if camera disconnects to avoid loading errors
              const cameraNum = key.startsWith("usb") ? key.split("_").slice(0, 2).join("_") : key.split("_")[0];
              setActiveAudios((prev) => {
                if (prev[cameraNum]) {
                  addLog(`Áudio de ${camLabel} desativado por perda de sinal.`, "warn");
                  return { ...prev, [cameraNum]: false };
                }
                return prev;
              });
            }
          });
        }
      } catch (err) {
        if (active) {
          if (isBackendOnline) {
            setIsBackendOnline(false);
            addLog("Conexão com o servidor de streaming foi perdida!", "error");
          }
          // Reset cameras connected state on offline server
          setCameraStatus((prev) => {
            const reset = {};
            Object.keys(prev).forEach((k) => {
              reset[k] = { ...prev[k], connected: false, error: "Servidor Offline" };
            });
            return reset;
          });
          // Automute all if server goes offline
          setActiveAudios((prev) => {
            const reset = {};
            Object.keys(prev).forEach((k) => {
              reset[k] = false;
            });
            return reset;
          });
        }
      }
    };

    // Initial check
    checkServerStatus();
    
    // Poll every 3 seconds
    const interval = setInterval(checkServerStatus, 3000);
    
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isBackendOnline, cameraStatus]);

  // Helper to get friendly name
  const getCameraLabel = (camera) => {
    if (camera.startsWith("usb_")) {
      const slot = camera.split("_")[1];
      return slot === "0" ? "Webcam USB Integrada (Slot 0)" : `Webcam USB Externa ${slot} (Slot ${slot})`;
    }
    const ip = cameraStatus[`${camera}_main`]?.ip || `192.168.3.${camera}`;
    if (camera === "138") return "Câmera Principal (Lado A)";
    if (camera === "139") return "Câmera Estacionamento (Lado B)";
    return `Câmera IP ${ip}`;
  };

  // Actions handler
  const handleProfileChange = (camera, profile) => {
    setProfiles((prev) => ({ ...prev, [camera]: profile }));
    addLog(`${getCameraLabel(camera)} alterada para perfil: ${profile.toUpperCase()}`, "info");
  };

  const handleRefresh = (camera) => {
    setRefreshKeys((prev) => ({ ...prev, [camera]: prev[camera] + 1 }));
    addLog(`Reiniciando feed de ${getCameraLabel(camera)}...`, "warn");
  };

  const handleCapture = (camera) => {
    addLog(`Solicitando captura instantânea de ${getCameraLabel(camera)}...`, "info");
    
    const downloadUrl = `/capture/${camera}`;
    
    // Create a temporary anchor to download
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `snapshot_${camera}_${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    addLog(`Download da foto de ${getCameraLabel(camera)} iniciado.`, "success");
  };

  // Audio Toggle
  const handleAudioToggle = (camera) => {
    setActiveAudios((prev) => {
      const newVal = !prev[camera];
      if (newVal) {
        addLog(`Áudio de ${getCameraLabel(camera)} ATIVADO. Escutando canal...`, "success");
      } else {
        addLog(`Áudio de ${getCameraLabel(camera)} DESATIVADO. Canal mudo.`, "info");
      }
      return { ...prev, [camera]: newVal };
    });
  };

  // PTZ Control sender
  const handlePtzMove = async (camera, direction) => {
    if (camera.startsWith("usb")) return; // No PTZ support on local webcams
    try {
      if (direction !== "stop") {
        addLog(`Movendo ${getCameraLabel(camera)} para: ${direction.toUpperCase()}...`, "info");
      }
      const response = await fetch(`/ptz/${camera}/${direction}`, {
        method: "POST"
      });
      if (!response.ok) throw new Error("Erro na comunicação ONVIF PTZ");
      
      if (direction === "stop") {
        addLog(`${getCameraLabel(camera)} parada.`, "success");
      }
    } catch (err) {
      addLog(`Erro ao movimentar ${getCameraLabel(camera)}: ${err.message}`, "error");
    }
  };

  const toggleFullscreen = (camera) => {
    if (fullscreenCamera === camera) {
      setFullscreenCamera(null);
      addLog(`Modo tela cheia desativado.`, "info");
    } else {
      setFullscreenCamera(camera);
      addLog(`${getCameraLabel(camera)} expandida para tela cheia.`, "info");
    }
  };

  // Rendering individual camera feed URL
  const getFeedSrc = (camera) => {
    const profile = profiles[camera];
    const key = refreshKeys[camera];
    return `/stream/${camera}/${profile}?t=${key}`;
  };

  const isCameraOnline = (camera) => {
    const profile = profiles[camera];
    return cameraStatus[`${camera}_${profile}`]?.connected || false;
  };

  const getCameraMetadata = (camera) => {
    const profile = profiles[camera];
    return cameraStatus[`${camera}_${profile}`] || {};
  };

  const isUsbCamera = (camera) => camera?.startsWith("usb") || false;

  // Derivar dinamicamente a configuração das câmeras com base no status do backend
  const camerasConfig = Object.keys(cameraStatus)
    .filter(key => key.endsWith("_main")) // Filtrar apenas os perfis principais
    .map(key => {
      const id = key.replace("_main", "");
      const isUsb = id.startsWith("usb_");
      
      let name = "";
      let details = "";
      if (isUsb) {
        const slot = id.split("_")[1];
        name = slot === "0" ? "Webcam USB Integrada (Slot 0)" : `Webcam USB Externa ${slot} (Slot ${slot})`;
        details = `Dispositivo Local (${id})`;
      } else {
        const ip = cameraStatus[key]?.ip || `192.168.3.${id}`;
        name = id === "138" ? "Câmera Principal (Lado A)" : (id === "139" ? "Câmera Estacionamento (Lado B)" : `Câmera IP ${ip}`);
        details = ip;
      }
      
      return {
        id,
        name,
        type: isUsb ? "usb" : "ip",
        details,
        isUsb
      };
    })
    .sort((a, b) => {
      if (a.isUsb && !b.isUsb) return -1;
      if (!a.isUsb && b.isUsb) return 1;
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });

  return (
    <div className="dashboard-wrapper">
      {/* HIDDEN AUDIO TAGS - Rendered dynamically only when unmuted */}
      {camerasConfig.map((cam) => (
        activeAudios[cam.id] && isCameraOnline(cam.id) && (
          <audio key={cam.id} src={`/audio/${cam.id}`} autoPlay style={{ display: "none" }} />
        )
      ))}

      {/* HEADER */}
      <header className="main-header">
        <div className="brand-section">
          {/* Shield Icon SVG */}
          <svg className="shield-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <div>
            <h1>IP Camera Hub</h1>
            <span>Live Monitor</span>
          </div>
        </div>

        <div className="system-stats">
          <div className="stat-item">
            <span className="stat-label">Uptime Sistema</span>
            <span className="stat-value">{uptime}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Conexão Backend</span>
            <span className={`stat-value ${isBackendOnline ? "online" : "offline"}`}>
              {isBackendOnline ? "CONECTADO" : "OFFLINE"}
            </span>
          </div>
        </div>
      </header>

      {/* SERVER DOWN WARNING OVERLAY */}
      {!isBackendOnline && (
        <section className="server-down-banner">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Servidor de Streaming Offline
          </h2>
          <p>
            O frontend do Next.js está operacional, mas o servidor de streaming Python responsável por receber os fluxos RTSP, transcodificar o áudio e enviá-los ao navegador não está rodando. Inicie-o na pasta raiz com o comando:
          </p>
          <div className="code-box">
            python3 stream_server.py
          </div>
        </section>
      )}

      {/* LAYOUT CONTROLS */}
      <div className="controls-bar">
        <h2 style={{ fontSize: "1.1rem", fontWeight: "600", color: "hsl(var(--text-secondary))" }}>
          Painel de Visualização Direta
        </h2>
        
        <div className="segmented-control">
          <button 
            className={`segmented-btn ${layoutMode === "grid" ? "active" : ""}`}
            onClick={() => setLayoutMode("grid")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
            Mosaico Grid
          </button>
          <button 
            className={`segmented-btn ${layoutMode === "list" ? "active" : ""}`}
            onClick={() => setLayoutMode("list")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            Lista de Câmeras
          </button>
        </div>
      </div>

      {/* CAMERA GRID */}
      <main className={`monitoring-grid ${layoutMode === "grid" ? "grid-cols-2" : "grid-cols-1"}`}>
        
        {camerasConfig.map((cam) => (
          <div className="camera-card" key={cam.id}>
            <div className="card-header">
              <div className="camera-info">
                <span className="camera-name">{cam.name}</span>
                <span className="camera-ip">{cam.details}</span>
              </div>
              <div className={`camera-status-badge ${isCameraOnline(cam.id) ? "online" : (isBackendOnline ? "connecting" : "offline")}`}>
                <div className="status-dot"></div>
                <span>{isCameraOnline(cam.id) ? "LIVE" : (isBackendOnline ? (cam.isUsb ? "OFFLINE" : "CONECTANDO...") : "OFFLINE")}</span>
              </div>
            </div>

            <div className="feed-container">
              {isCameraOnline(cam.id) ? (
                <>
                  <img 
                    src={getFeedSrc(cam.id)} 
                    alt={`Feed de ${cam.name}`} 
                    className="camera-feed-img"
                  />
                  
                  {/* PTZ D-PAD CONTROLLER OVERLAY - IP CAMERAS ONLY */}
                  {!cam.isUsb && (
                    <div className="ptz-overlay">
                      <span className="ptz-label">Controle PTZ</span>
                      <div className="ptz-grid">
                        <div></div>
                        <button 
                          className="ptz-btn" 
                          title="Mover para Cima"
                          onMouseDown={() => handlePtzMove(cam.id, "up")}
                          onMouseUp={() => handlePtzMove(cam.id, "stop")}
                          onMouseLeave={() => handlePtzMove(cam.id, "stop")}
                          onTouchStart={() => handlePtzMove(cam.id, "up")}
                          onTouchEnd={() => handlePtzMove(cam.id, "stop")}
                        >
                          ▲
                        </button>
                        <div></div>
                        
                        <button 
                          className="ptz-btn" 
                          title="Mover para Esquerda"
                          onMouseDown={() => handlePtzMove(cam.id, "left")}
                          onMouseUp={() => handlePtzMove(cam.id, "stop")}
                          onMouseLeave={() => handlePtzMove(cam.id, "stop")}
                          onTouchStart={() => handlePtzMove(cam.id, "left")}
                          onTouchEnd={() => handlePtzMove(cam.id, "stop")}
                        >
                          ◀
                        </button>
                        <button 
                          className="ptz-btn ptz-center" 
                          title="Parar Movimento"
                          onClick={() => handlePtzMove(cam.id, "stop")}
                        >
                          ■
                        </button>
                        <button 
                          className="ptz-btn" 
                          title="Mover para Direita"
                          onMouseDown={() => handlePtzMove(cam.id, "right")}
                          onMouseUp={() => handlePtzMove(cam.id, "stop")}
                          onMouseLeave={() => handlePtzMove(cam.id, "stop")}
                          onTouchStart={() => handlePtzMove(cam.id, "right")}
                          onTouchEnd={() => handlePtzMove(cam.id, "stop")}
                        >
                          ▶
                        </button>
                        
                        <div></div>
                        <button 
                          className="ptz-btn" 
                          title="Baixar Câmera"
                          onMouseDown={() => handlePtzMove(cam.id, "down")}
                          onMouseUp={() => handlePtzMove(cam.id, "stop")}
                          onMouseLeave={() => handlePtzMove(cam.id, "stop")}
                          onTouchStart={() => handlePtzMove(cam.id, "down")}
                          onTouchEnd={() => handlePtzMove(cam.id, "stop")}
                        >
                          ▼
                        </button>
                        <div></div>
                      </div>
                    </div>
                  )}

                  <div className="feed-hud-overlay">
                    <div className="hud-top">
                      <div className="hud-item hud-rec">
                        <div className="hud-rec-dot"></div>
                        REC
                      </div>
                      <div className="hud-item">
                        {cam.isUsb ? "USB DIRECT" : (profiles[cam.id] === "main" ? "HQ H.264" : "LQ H.264")}
                      </div>
                    </div>
                    <div className="hud-bottom">
                      <div className="hud-item">
                        {cam.isUsb ? cam.id.toUpperCase() : `CH0${cam.id === "138" ? "1" : "2"}`} | TCP {activeAudios[cam.id] && " | AUDIO ACTIVE"}
                      </div>
                      <div className="hud-item">
                        {getCameraMetadata(cam.id).width}x{getCameraMetadata(cam.id).height} @ {getCameraMetadata(cam.id).fps_real || getCameraMetadata(cam.id).fps_nominal} FPS
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="feed-offline-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34"/>
                    <path d="M23 7l-7 5 7 5V7z"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                  <h3>{cam.isUsb ? "Webcam Desconectada" : "Sem Sinal de Vídeo"}</h3>
                  <p>
                    {isBackendOnline 
                      ? (cam.isUsb 
                          ? `Canal USB offline. Verifique se o dispositivo está conectado no Slot USB ${cam.id.split("_")[1]} do computador.` 
                          : "Tentando abrir o canal RTSP na porta 554. Verifique a fiação e alimentação da câmera.")
                      : "Servidor de streaming desconectado. Aguardando inicialização."}
                  </p>
                </div>
              )}
            </div>

            <div className="card-controls">
              <div className="profile-selector">
                {!cam.isUsb ? (
                  <>
                    <button 
                      className={`profile-btn ${profiles[cam.id] === "main" ? "active" : ""}`}
                      onClick={() => handleProfileChange(cam.id, "main")}
                      disabled={!isBackendOnline}
                    >
                      Principal (1080p)
                    </button>
                    <button 
                      className={`profile-btn ${profiles[cam.id] === "sub" ? "active" : ""}`}
                      onClick={() => handleProfileChange(cam.id, "sub")}
                      disabled={!isBackendOnline}
                    >
                      Rápido (360p)
                    </button>
                  </>
                ) : (
                  <span className="profile-badge-usb">
                    Slot Local USB
                  </span>
                )}
              </div>
              
              <div className="action-buttons">
                {/* Audio button toggle */}
                <button 
                  className={`action-btn ${activeAudios[cam.id] ? "audio-active" : ""}`}
                  title={activeAudios[cam.id] ? "Mutar canal de áudio" : "Ativar áudio live da câmera"}
                  onClick={() => handleAudioToggle(cam.id)}
                  disabled={!isCameraOnline(cam.id)}
                >
                  {activeAudios[cam.id] ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <line x1="23" y1="9" x2="17" y2="15"/>
                      <line x1="17" y1="9" x2="23" y2="15"/>
                    </svg>
                  )}
                </button>
                <button 
                  className="action-btn" 
                  title="Capturar Foto Instantânea"
                  onClick={() => handleCapture(cam.id)}
                  disabled={!isCameraOnline(cam.id)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </button>
                <button 
                  className="action-btn" 
                  title="Reiniciar Stream"
                  onClick={() => handleRefresh(cam.id)}
                  disabled={!isBackendOnline}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                  </svg>
                </button>
                <button 
                  className="action-btn" 
                  title="Expandir Tela Cheia"
                  onClick={() => toggleFullscreen(cam.id)}
                  disabled={!isCameraOnline(cam.id)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}

      </main>

      {/* DIAGNOSTICS & SYSTEM LOGS GRID */}
      <section className="panel-grid">
        {/* Net diagnostics */}
        <div className="glass-panel">
          <h2 className="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
              <line x1="6" y1="6" x2="6.01" y2="6"/>
              <line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
            Detecção ONVIF & Parâmetros de Rede
          </h2>
          
          <table className="diag-table">
            <thead>
              <tr>
                <th>Item</th>
                {camerasConfig.filter(c => !c.isUsb).map(cam => (
                  <th key={cam.id}>{cam.name}</th>
                ))}
                {camerasConfig.filter(c => !c.isUsb).length === 0 && (
                  <th>Nenhuma Câmera IP Ativa</th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>IP Local</strong></td>
                {camerasConfig.filter(c => !c.isUsb).map(cam => (
                  <td key={cam.id}><span className="text-code">{cam.details}</span></td>
                ))}
                {camerasConfig.filter(c => !c.isUsb).length === 0 && (
                  <td>-</td>
                )}
              </tr>
              <tr>
                <td><strong>Fabricante / Chipset</strong></td>
                {camerasConfig.filter(c => !c.isUsb).map(cam => (
                  <td key={cam.id}>eSmartLink (Hi3518)</td>
                ))}
                {camerasConfig.filter(c => !c.isUsb).length === 0 && (
                  <td>-</td>
                )}
              </tr>
              <tr>
                <td><strong>Porta ONVIF</strong></td>
                {camerasConfig.filter(c => !c.isUsb).map(cam => (
                  <td key={cam.id}><span className="text-code">8080</span> (SOAP/2.8)</td>
                ))}
                {camerasConfig.filter(c => !c.isUsb).length === 0 && (
                  <td>-</td>
                )}
              </tr>
              <tr>
                <td><strong>Porta RTSP</strong></td>
                {camerasConfig.filter(c => !c.isUsb).map(cam => (
                  <td key={cam.id}><span className="text-code">554</span> (LIVE555)</td>
                ))}
                {camerasConfig.filter(c => !c.isUsb).length === 0 && (
                  <td>-</td>
                )}
              </tr>
              <tr>
                <td><strong>Serviço PTZ</strong></td>
                {camerasConfig.filter(c => !c.isUsb).map(cam => (
                  <td key={cam.id}>Ativo (SOAP PTZ v2.0)</td>
                ))}
                {camerasConfig.filter(c => !c.isUsb).length === 0 && (
                  <td>-</td>
                )}
              </tr>
              <tr>
                <td><strong>Caminho RTSP (Main)</strong></td>
                {camerasConfig.filter(c => !c.isUsb).map(cam => (
                  <td key={cam.id}><span className="text-code">rtsp_live0</span></td>
                ))}
                {camerasConfig.filter(c => !c.isUsb).length === 0 && (
                  <td>-</td>
                )}
              </tr>
              <tr>
                <td><strong>Caminho RTSP (Sub)</strong></td>
                {camerasConfig.filter(c => !c.isUsb).map(cam => (
                  <td key={cam.id}><span className="text-code">rtsp_live1</span></td>
                ))}
                {camerasConfig.filter(c => !c.isUsb).length === 0 && (
                  <td>-</td>
                )}
              </tr>
              <tr>
                <td><strong>Transporte RTSP</strong></td>
                {camerasConfig.filter(c => !c.isUsb).map(cam => (
                  <td key={cam.id}>TCP (Forçado)</td>
                ))}
                {camerasConfig.filter(c => !c.isUsb).length === 0 && (
                  <td>-</td>
                )}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Real-time events logs */}
        <div className="glass-panel">
          <h2 className="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            Console do Sistema (Logs)
          </h2>
          
          <div className="log-container" ref={logContainerRef}>
            {logs.map((log, index) => (
              <div key={index} className={`log-entry ${log.type}`}>
                <span className="log-time">[{log.timestamp}]</span>
                <span className="log-msg">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FULLSCREEN CAMERA PORTAL OVERLAY */}
      {fullscreenCamera && (
        <div className="fullscreen-overlay">
          <div className="fullscreen-card">
            <div className="card-header" style={{ background: "hsl(var(--bg-surface))" }}>
              <div className="camera-info">
                <span className="camera-name">
                  {getCameraLabel(fullscreenCamera)} - Tela Cheia
                </span>
                <span className="camera-ip">
                  {isUsbCamera(fullscreenCamera) ? "Dispositivo Local USB" : (cameraStatus[`${fullscreenCamera}_main`]?.ip || cameraStatus[`${fullscreenCamera}_sub`]?.ip || `192.168.3.${fullscreenCamera}`)}
                </span>
                {!isUsbCamera(fullscreenCamera) && (
                  <span className="camera-ip">
                    {profiles[fullscreenCamera] === "main" ? "HQ (1080p)" : "LQ (360p)"}
                  </span>
                )}
              </div>
              
              <button className="close-fullscreen-btn" onClick={() => toggleFullscreen(fullscreenCamera)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                Fechar Tela Cheia
              </button>
            </div>
            
            <div className="feed-container" style={{ flexGrow: 1 }}>
              <img 
                src={getFeedSrc(fullscreenCamera)} 
                alt="Fullscreen Stream" 
                className="camera-feed-img"
                style={{ objectFit: "contain" }}
              />
              
              {/* PTZ D-PAD CONTROLLER OVERLAY FOR FULLSCREEN - IP CAMERAS ONLY */}
              {!isUsbCamera(fullscreenCamera) && (
                <div className="ptz-overlay" style={{ bottom: "1.5rem", right: "1.5rem" }}>
                  <span className="ptz-label">Controle PTZ</span>
                  <div className="ptz-grid">
                    <div></div>
                    <button 
                      className="ptz-btn" 
                      title="Mover para Cima"
                      onMouseDown={() => handlePtzMove(fullscreenCamera, "up")}
                      onMouseUp={() => handlePtzMove(fullscreenCamera, "stop")}
                      onMouseLeave={() => handlePtzMove(fullscreenCamera, "stop")}
                      onTouchStart={() => handlePtzMove(fullscreenCamera, "up")}
                      onTouchEnd={() => handlePtzMove(fullscreenCamera, "stop")}
                    >
                      ▲
                    </button>
                    <div></div>
                    
                    <button 
                      className="ptz-btn" 
                      title="Mover para Esquerda"
                      onMouseDown={() => handlePtzMove(fullscreenCamera, "left")}
                      onMouseUp={() => handlePtzMove(fullscreenCamera, "stop")}
                      onMouseLeave={() => handlePtzMove(fullscreenCamera, "stop")}
                      onTouchStart={() => handlePtzMove(fullscreenCamera, "left")}
                      onTouchEnd={() => handlePtzMove(fullscreenCamera, "stop")}
                    >
                      ◀
                    </button>
                    <button 
                      className="ptz-btn ptz-center" 
                      title="Parar Movimento"
                      onClick={() => handlePtzMove(fullscreenCamera, "stop")}
                    >
                      ■
                    </button>
                    <button 
                      className="ptz-btn" 
                      title="Mover para Direita"
                      onMouseDown={() => handlePtzMove(fullscreenCamera, "right")}
                      onMouseUp={() => handlePtzMove(fullscreenCamera, "stop")}
                      onMouseLeave={() => handlePtzMove(fullscreenCamera, "stop")}
                      onTouchStart={() => handlePtzMove(fullscreenCamera, "right")}
                      onTouchEnd={() => handlePtzMove(fullscreenCamera, "stop")}
                    >
                      ▶
                    </button>
                    
                    <div></div>
                    <button 
                      className="ptz-btn" 
                      title="Baixar Câmera"
                      onMouseDown={() => handlePtzMove(fullscreenCamera, "down")}
                      onMouseUp={() => handlePtzMove(fullscreenCamera, "stop")}
                      onMouseLeave={() => handlePtzMove(fullscreenCamera, "stop")}
                      onTouchStart={() => handlePtzMove(fullscreenCamera, "down")}
                      onTouchEnd={() => handlePtzMove(fullscreenCamera, "stop")}
                    >
                      ▼
                    </button>
                    <div></div>
                  </div>
                </div>
              )}

              <div className="feed-hud-overlay">
                <div className="hud-top">
                  <div className="hud-item hud-rec">
                    <div className="hud-rec-dot"></div>
                    REC MONITORED
                  </div>
                  <div className="hud-item" style={{ fontFamily: "monospace" }}>
                    {isUsbCamera(fullscreenCamera) ? "LOCAL USB INTERFACE" : `LOCAL SUB-NET FEED | ${cameraStatus[`${fullscreenCamera}_main`]?.ip || cameraStatus[`${fullscreenCamera}_sub`]?.ip || `192.168.3.${fullscreenCamera}`}`}
                  </div>
                </div>
                <div className="hud-bottom">
                  <div className="hud-item">
                    {isUsbCamera(fullscreenCamera) ? "DIRECT VIDEO CAPTURE" : `TCP OVER ONVIF PROTOCOL ${activeAudios[fullscreenCamera] ? " | AUDIO ACTIVE" : ""}`}
                  </div>
                  <div className="hud-item">
                    {getCameraMetadata(fullscreenCamera).width}x{getCameraMetadata(fullscreenCamera).height} @ {getCameraMetadata(fullscreenCamera).fps_real || getCameraMetadata(fullscreenCamera).fps_nominal} FPS
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="dashboard-footer">
        <div>
          &copy; {new Date().getFullYear()} IP Camera Hub - Central de Monitoramento Local
        </div>
        <div className="footer-links">
          <span>Protocolo ONVIF v2.4</span>
          <span>&bull;</span>
          <span>RTSP H.264 over TCP c/ Áudio MP3</span>
        </div>
      </footer>
    </div>
  );
}
