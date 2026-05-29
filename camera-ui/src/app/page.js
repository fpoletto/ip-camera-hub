"use client";

import { useState, useEffect, useRef } from "react";
import Go2RTCPlayer from "./Go2RTCPlayer";

export default function Home() {
  // Application States
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [cameraStatus, setCameraStatus] = useState({});
  const [profiles, setProfiles] = useState({});
  const [refreshKeys, setRefreshKeys] = useState({});
  const [activeAudios, setActiveAudios] = useState({});
  const [streamConfigs, setStreamConfigs] = useState({});
  const [showSettings, setShowSettings] = useState({});
  const [visibleCameras, setVisibleCameras] = useState({});

  // Authentication States
  const [isAuthenticated, setIsAuthenticated] = useState(true); // Default true to avoid flash of lock screen
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [correctHash, setCorrectHash] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  const [layoutMode, setLayoutMode] = useState("grid"); // "grid" or "list"
  const [fullscreenCamera, setFullscreenCamera] = useState(null); // null, "138", "139", "usb_0", "usb_1", "usb_2"
  const [logs, setLogs] = useState([]);
  const [uptime, setUptime] = useState("00:00:00");
  
  const [go2rtcAvailable, setGo2rtcAvailable] = useState(false);
  const [streamingMode, setStreamingMode] = useState("mp4"); // "mp4", "mse", "webrtc", "mjpeg"
  const [individualStreamingModes, setIndividualStreamingModes] = useState({});
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [globalSettings, setGlobalSettings] = useState({
    mode: "auto",
    resolution: "720p",
    fps: 15,
    quality: 65,
    bufsize: 2
  });
  
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

  // Check auth status on mount
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const response = await fetch("/auth/status");
        if (response.ok) {
          const data = await response.json();
          if (data.password_required) {
            setPasswordRequired(true);
            setCorrectHash(data.hash);
            // Verify if already unlocked in this session
            const savedUnlock = sessionStorage.getItem("ip_camera_hub_unlocked");
            if (savedUnlock === data.hash) {
              setIsAuthenticated(true);
            } else {
              setIsAuthenticated(false);
            }
          } else {
            setIsAuthenticated(true);
          }
        }
      } catch (err) {
        console.error("Erro ao verificar autenticação:", err);
      }
    };
    checkAuthStatus();
  }, []);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!passwordInput) return;

    try {
      // Compute SHA-256 hash using Web Crypto API
      const msgUint8 = new TextEncoder().encode(passwordInput);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

      if (hashHex === correctHash) {
        sessionStorage.setItem("ip_camera_hub_unlocked", correctHash);
        setIsAuthenticated(true);
        setAuthError(false);
        addLog("Autenticação realizada com sucesso!", "success");
      } else {
        setAuthError(true);
        setIsShaking(true);
        addLog("Falha na tentativa de login: senha incorreta.", "error");
        setTimeout(() => setIsShaking(false), 500); // Reset shake animation
      }
    } catch (err) {
      console.error("Erro ao processar hash:", err);
    }
  };

  // Refs for stable dependencies in polling
  const isBackendOnlineRef = useRef(isBackendOnline);
  const cameraStatusRef = useRef(cameraStatus);
  const adaptiveTiersRef = useRef({});

  useEffect(() => {
    isBackendOnlineRef.current = isBackendOnline;
  }, [isBackendOnline]);

  useEffect(() => {
    cameraStatusRef.current = cameraStatus;
  }, [cameraStatus]);

  // Check go2rtc availability
  useEffect(() => {
    const checkGo2rtc = async () => {
      try {
        const res = await fetch("/go2rtc/api/streams");
        if (res.ok) {
          setGo2rtcAvailable(true);
          console.log("[GO2RTC] Proxy de streaming detectado e online.");
        } else {
          setGo2rtcAvailable(false);
        }
      } catch {
        setGo2rtcAvailable(false);
        console.log("[GO2RTC] Proxy não detectado. Usando fallback MJPEG.");
      }
    };
    checkGo2rtc();
    const interval = setInterval(checkGo2rtc, 15000);
    return () => clearInterval(interval);
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
          if (!isBackendOnlineRef.current) {
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

          setStreamConfigs(prev => {
            const next = { ...prev };
            let changed = false;
            uniqueIds.forEach(id => {
              if (!next[id]) {
                next[id] = {
                  mode: "auto",
                  resolution: "720p",
                  fps: 15,
                  quality: 75,
                  bufsize: 2,
                  rtt: 0
                };
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
            const wasConnected = cameraStatusRef.current[key]?.connected;
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
          if (isBackendOnlineRef.current) {
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
  }, []);

  // Network monitor & auto-adaptive quality adjustment with Hysteresis
  useEffect(() => {
    if (!isBackendOnline) return;
    
    const monitorNetwork = async () => {
      const start = Date.now();
      try {
        const res = await fetch("/health");
        if (res.ok) {
          const rtt = Date.now() - start;
          
          let downlink = 10;
          if (typeof navigator !== "undefined" && navigator.connection) {
            downlink = navigator.connection.downlink || 10;
          }
          
          // Determine target tier (0 to 4)
          let targetTier = 4;
          if (rtt > 400 || downlink < 1.0) {
            targetTier = 0; // 240p
          } else if (rtt > 200 || downlink < 2.5) {
            targetTier = 1; // 360p
          } else if (rtt > 100 || downlink < 5.0) {
            targetTier = 2; // 480p
          } else if (rtt < 50) {
            targetTier = 3; // 720p (Local network limit to avoid MJPEG choke)
          } else {
            targetTier = 4; // 1080p
          }
          
          setStreamConfigs(prev => {
            const next = { ...prev };
            let changed = false;
            
            Object.keys(next).forEach(id => {
              if (next[id].mode === "auto") {
                // Initialize ref state for this camera if not exists
                if (!adaptiveTiersRef.current[id]) {
                  adaptiveTiersRef.current[id] = { lastTarget: targetTier, count: 0 };
                }
                
                const state = adaptiveTiersRef.current[id];
                if (state.lastTarget !== targetTier) {
                  state.lastTarget = targetTier;
                  state.count = 1;
                } else {
                  state.count += 1;
                }
                
                // Only apply if target has been stable for 3 consecutive cycles (~15s)
                if (state.count >= 3) {
                  const TIERS = {
                    0: { resolution: "240p", fps: 5, quality: 25, bufsize: 1 },
                    1: { resolution: "360p", fps: 10, quality: 45, bufsize: 2 },
                    2: { resolution: "480p", fps: 15, quality: 60, bufsize: 2 },
                    3: { resolution: "720p", fps: 15, quality: 75, bufsize: 2 },
                    4: { resolution: "1080p", fps: 30, quality: 85, bufsize: 2 }
                  };
                  const tier = TIERS[targetTier];
                  
                  if (
                    next[id].resolution !== tier.resolution ||
                    next[id].fps !== tier.fps ||
                    next[id].quality !== tier.quality ||
                    next[id].bufsize !== tier.bufsize ||
                    next[id].rtt !== rtt
                  ) {
                    next[id] = {
                      ...next[id],
                      resolution: tier.resolution,
                      fps: tier.fps,
                      quality: tier.quality,
                      bufsize: tier.bufsize,
                      rtt: rtt
                    };
                    changed = true;
                  }
                } else {
                  if (next[id].rtt !== rtt) {
                    next[id] = { ...next[id], rtt: rtt };
                    changed = true;
                  }
                }
              } else {
                if (next[id].rtt !== rtt) {
                  next[id] = { ...next[id], rtt: rtt };
                  changed = true;
                }
              }
            });
            
            return changed ? next : prev;
          });
        }
      } catch (err) {
        console.error("Network monitoring failed:", err);
      }
    };
    
    const interval = setInterval(monitorNetwork, 5000);
    return () => clearInterval(interval);
  }, [isBackendOnline]);

  const observerRef = useRef(null);

  // Initialize the IntersectionObserver once on mount
  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const cameraId = entry.target.getAttribute("data-camera-id");
          if (cameraId) {
            const isIntersecting = entry.isIntersecting;
            setVisibleCameras((prev) => {
              // Only update if visibility state actually changed to avoid infinite renders
              if (prev[cameraId] === isIntersecting) return prev;
              
              if (isIntersecting) {
                addLog(`Câmera ${getCameraLabel(cameraId)} em campo de visão. Retomando feed.`, "info");
              } else {
                addLog(`Câmera ${getCameraLabel(cameraId)} fora de visão. Suspendendo feed para poupar rede.`, "info");
              }
              
              return { ...prev, [cameraId]: isIntersecting };
            });
          }
        });
      },
      {
        root: null,
        rootMargin: "250px", // Generous margin so it pre-loads well in advance
        threshold: 0.01 // Trigger as soon as 1% is visible
      }
    );

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  // Callback ref to dynamically observe cards as they are rendered by React
  const cardRefCallback = (element) => {
    if (element && observerRef.current) {
      observerRef.current.observe(element);
    }
  };

  // Helper to get friendly name
  function getCameraLabel(camera) {
    if (camera.startsWith("usb_")) {
      const slot = camera.split("_")[1];
      return slot === "0" ? "Webcam USB Integrada (Slot 0)" : `Webcam USB Externa ${slot} (Slot ${slot})`;
    }
    const ip = cameraStatus[`${camera}_main`]?.ip || `192.168.3.${camera}`;
    if (camera === "138") return "Câmera Principal (Lado A)";
    if (camera === "139") return "Câmera Estacionamento (Lado B)";
    return `Câmera IP ${ip}`;
  }

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
    const config = streamConfigs[camera];
    
    if (config) {
      const resMap = {
        "1080p": { w: 1920, h: 1080 },
        "720p": { w: 1280, h: 720 },
        "480p": { w: 854, h: 480 },
        "360p": { w: 640, h: 360 },
        "240p": { w: 426, h: 240 }
      };
      const dimensions = resMap[config.resolution] || { w: 1280, h: 720 };
      return `/stream/${camera}/${profile}?t=${key}&width=${dimensions.w}&height=${dimensions.h}&fps=${config.fps}&quality=${config.quality}&bufsize=${config.bufsize}`;
    }
    
    return `/stream/${camera}/${profile}?t=${key}`;
  };

  const getGo2rtcStreamName = (cameraId) => {
    const profile = profiles[cameraId] || "main";
    if (cameraId.startsWith("usb_")) {
      return `camera_${cameraId}`;
    }
    return `camera_${cameraId}_${profile}`;
  };

  const getCameraStreamingMode = (cameraId) => {
    if (!cameraId) return streamingMode;
    const individualMode = individualStreamingModes[cameraId];
    if (individualMode && individualMode !== "default") {
      return individualMode;
    }
    return streamingMode;
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

  if (!isAuthenticated) {
    return (
      <div className="lock-screen-wrapper">
        <style>{`
          .lock-screen-wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: radial-gradient(circle at center, #0f172a 0%, #020617 100%);
            font-family: 'Outfit', 'Inter', sans-serif;
            color: #f8fafc;
            padding: 20px;
          }
          .lock-card {
            background: rgba(15, 23, 42, 0.55);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 20px;
            width: 100%;
            max-width: 420px;
            padding: 40px 30px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), 0 0 50px rgba(6, 182, 212, 0.05);
            text-align: center;
            position: relative;
            overflow: hidden;
            transition: all 0.3s ease;
          }
          .lock-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, #06b6d4, #8b5cf6);
          }
          .lock-icon-container {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 70px;
            height: 70px;
            background: rgba(6, 182, 212, 0.1);
            border: 1px solid rgba(6, 182, 212, 0.2);
            border-radius: 50%;
            color: #06b6d4;
            margin-bottom: 25px;
            box-shadow: 0 0 20px rgba(6, 182, 212, 0.1);
          }
          .lock-title {
            font-size: 1.75rem;
            font-weight: 700;
            letter-spacing: -0.025em;
            margin-bottom: 8px;
            background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .lock-subtitle {
            font-size: 0.875rem;
            color: #94a3b8;
            line-height: 1.5;
            margin-bottom: 30px;
          }
          .lock-form {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .input-group {
            position: relative;
          }
          .lock-input {
            width: 100%;
            background: rgba(15, 23, 42, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 14px 16px;
            font-size: 1rem;
            color: #ffffff;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            text-align: center;
            letter-spacing: 0.2em;
          }
          .lock-input:focus {
            outline: none;
            border-color: #06b6d4;
            box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.15), 0 0 15px rgba(6, 182, 212, 0.1);
            background: rgba(15, 23, 42, 0.95);
          }
          .lock-button {
            background: linear-gradient(90deg, #06b6d4, #0891b2);
            color: #ffffff;
            border: none;
            border-radius: 12px;
            padding: 14px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.25s ease;
            box-shadow: 0 4px 12px rgba(6, 182, 212, 0.2);
          }
          .lock-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(6, 182, 212, 0.35), 0 0 15px rgba(6, 182, 212, 0.2);
            background: linear-gradient(90deg, #0891b2, #06b6d4);
          }
          .lock-button:active {
            transform: translateY(1px);
          }
          .error-message {
            color: #f43f5e;
            font-size: 0.825rem;
            font-weight: 500;
            margin-top: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            animation: fadeIn 0.2s ease;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-5px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .shake {
            animation: shake 0.4s ease-in-out;
          }
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20%, 60% { transform: translateX(-8px); }
            40%, 80% { transform: translateX(8px); }
          }
        `}</style>

        <div className={`lock-card ${isShaking ? "shake" : ""}`}>
          <div className="lock-icon-container">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h2 className="lock-title">IP Camera Hub</h2>
          <p className="lock-subtitle">
            Este painel de monitoramento está protegido.<br />
            Insira a senha de acesso para continuar.
          </p>
          <form className="lock-form" onSubmit={handlePasswordSubmit}>
            <div className="input-group">
              <input
                type="password"
                className="lock-input"
                placeholder="••••••"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoFocus
              />
            </div>
            {authError && (
              <div className="error-message">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                Senha incorreta! Tente novamente.
              </div>
            )}
            <button type="submit" className="lock-button">
              Desbloquear Central
            </button>
          </form>
        </div>
      </div>
    );
  }

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

        {go2rtcAvailable && (
          <div className="segmented-control" style={{ marginLeft: "12px" }}>
            <button
              className={`segmented-btn ${streamingMode === "mp4" ? "active" : ""}`}
              onClick={() => setStreamingMode("mp4")}
            >
              fMP4 (Túnel/Proxy)
            </button>
            <button
              className={`segmented-btn ${streamingMode === "mse" ? "active" : ""}`}
              onClick={() => setStreamingMode("mse")}
            >
              MSE (H.264 Local)
            </button>
            <button
              className={`segmented-btn ${streamingMode === "webrtc" ? "active" : ""}`}
              onClick={() => setStreamingMode("webrtc")}
            >
              WebRTC (Ultra-low)
            </button>
            <button
              className={`segmented-btn ${streamingMode === "mjpeg" ? "active" : ""}`}
              onClick={() => setStreamingMode("mjpeg")}
            >
              MJPEG (Legacy)
            </button>
          </div>
        )}

        {go2rtcAvailable && (
          <button
            className={`segmented-btn ${showGlobalSettings ? "active" : ""}`}
            onClick={() => setShowGlobalSettings(!showGlobalSettings)}
            style={{
              marginLeft: "12px",
              padding: "8px 12px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: showGlobalSettings ? "rgba(6, 182, 212, 0.15)" : "#1e1e24",
              color: showGlobalSettings ? "#06b6d4" : "#a0aec0",
              border: showGlobalSettings ? "1px solid #06b6d4" : "1px solid #2d2d3a",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
            title="Configurações Globais das Câmeras"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={showGlobalSettings ? "spin-animation" : ""}>
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            Ajustes Gerais
          </button>
        )}
      </div>

      {/* CAMERA SETTINGS MODAL */}
      {showGlobalSettings && go2rtcAvailable && (
        <div className="settings-modal-overlay" onClick={() => setShowGlobalSettings(false)}>
          <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <span className="settings-modal-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                Ajustes Gerais (Todas as Câmeras)
              </span>
              <button className="close-modal-btn" onClick={() => setShowGlobalSettings(false)} title="Fechar Ajustes">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="settings-modal-body">
              <span style={{ fontSize: "0.8rem", color: "hsl(var(--text-muted))", marginTop: "-4px", marginBottom: "8px", display: "block", lineHeight: "1.4" }}>
                Qualquer alteração feita aqui será aplicada instantaneamente a todos os canais ativos.
              </span>

              <div className="settings-row">
                <span className="settings-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                  Modo de Transmissão Geral
                </span>
                
                <select 
                  className="settings-select"
                  value={globalSettings.mode}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGlobalSettings(prev => ({ ...prev, mode: val }));
                    setStreamConfigs(prev => {
                      const updated = {};
                      Object.keys(prev).forEach(id => {
                        updated[id] = { ...prev[id], mode: val };
                      });
                      return updated;
                    });
                    addLog(`Modo global de qualidade alterado para: ${val === "auto" ? "AUTO-ADAPTATIVO" : "MANUAL"}`, "info");
                  }}
                >
                  <option value="auto">Auto (Adaptativo)</option>
                  <option value="manual">Manual / Fixo</option>
                </select>
              </div>

              <div className="settings-row" style={{ marginTop: "12px" }}>
                <span className="settings-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "6px", verticalAlign: "middle" }}>
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                  </svg>
                  Protocolo de Vídeo Geral
                </span>
                
                <select 
                  className="settings-select"
                  value={streamingMode}
                  onChange={(e) => {
                    const val = e.target.value;
                    setStreamingMode(val);
                    addLog(`Protocolo global de transmissão alterado para: ${val.toUpperCase()}`, "info");
                  }}
                >
                  <option value="mp4">fMP4 (Túnel/Proxy)</option>
                  <option value="mse">MSE (H.264 Local)</option>
                  <option value="webrtc">WebRTC (Ultra-low)</option>
                  <option value="mjpeg">MJPEG (Legacy)</option>
                </select>
              </div>

              {globalSettings.mode === "auto" ? (
                <div style={{
                  background: "rgba(6, 182, 212, 0.05)",
                  border: "1px solid rgba(6, 182, 212, 0.15)",
                  borderRadius: "8px",
                  padding: "12px",
                  color: "#94a3b8",
                  lineHeight: "1.4",
                  fontSize: "0.775rem",
                  marginTop: "16px"
                }}>
                  <strong style={{ color: "#06b6d4" }}>Adaptação Automática Ativa (Global):</strong> Todas as câmeras gerenciam suas próprias qualidades dinamicamente com base em suas respectivas latências de rede e limites de banda local.
                </div>
              ) : (
                <div style={{ animation: "fadeIn 0.2s", marginTop: "16px" }}>
                  <div className="settings-col" style={{ marginBottom: "16px" }}>
                    <span className="settings-label">Presets Globais Rápidos</span>
                    <div className="preset-grid">
                      <button 
                        className={`preset-btn ${
                          globalSettings.resolution === "1080p" && globalSettings.fps === 30 && globalSettings.quality === 85 ? "active" : ""
                        }`}
                        onClick={() => {
                          setGlobalSettings(prev => ({ ...prev, resolution: "1080p", fps: 30, quality: 85 }));
                          setStreamConfigs(prev => {
                            const updated = {};
                            Object.keys(prev).forEach(id => {
                              updated[id] = { ...prev[id], resolution: "1080p", fps: 30, quality: 85, bufsize: 2 };
                            });
                            return updated;
                          });
                          addLog("Preset global de Alta Qualidade (1080p) aplicado a todas as câmeras.", "success");
                        }}
                      >
                        HD 1080p
                      </button>
                      <button 
                        className={`preset-btn ${
                          globalSettings.resolution === "720p" && globalSettings.fps === 15 && globalSettings.quality === 65 ? "active" : ""
                        }`}
                        onClick={() => {
                          setGlobalSettings(prev => ({ ...prev, resolution: "720p", fps: 15, quality: 65 }));
                          setStreamConfigs(prev => {
                            const updated = {};
                            Object.keys(prev).forEach(id => {
                              updated[id] = { ...prev[id], resolution: "720p", fps: 15, quality: 65, bufsize: 2 };
                            });
                            return updated;
                          });
                          addLog("Preset global de Médio Desempenho (720p) aplicado a todas as câmeras.", "success");
                        }}
                      >
                        Médio 720p
                      </button>
                      <button 
                        className={`preset-btn ${
                          globalSettings.resolution === "480p" && globalSettings.fps === 10 && globalSettings.quality === 50 ? "active" : ""
                        }`}
                        onClick={() => {
                          setGlobalSettings(prev => ({ ...prev, resolution: "480p", fps: 10, quality: 50 }));
                          setStreamConfigs(prev => {
                            const updated = {};
                            Object.keys(prev).forEach(id => {
                              updated[id] = { ...prev[id], resolution: "480p", fps: 10, quality: 50, bufsize: 2 };
                            });
                            return updated;
                          });
                          addLog("Preset global de Economia (480p) aplicado a todas as câmeras.", "success");
                        }}
                      >
                        Economia 480p
                      </button>
                      <button 
                        className={`preset-btn ${
                          globalSettings.resolution === "240p" && globalSettings.fps === 5 && globalSettings.quality === 30 ? "active" : ""
                        }`}
                        onClick={() => {
                          setGlobalSettings(prev => ({ ...prev, resolution: "240p", fps: 5, quality: 30 }));
                          setStreamConfigs(prev => {
                            const updated = {};
                            Object.keys(prev).forEach(id => {
                              updated[id] = { ...prev[id], resolution: "240p", fps: 5, quality: 30, bufsize: 2 };
                            });
                            return updated;
                          });
                          addLog("Preset global de Baixo Consumo (240p) aplicado a todas as câmeras.", "success");
                        }}
                      >
                        Mínimo 240p
                      </button>
                    </div>
                  </div>

                  <div className="preset-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                    <div className="settings-col">
                      <label className="settings-label">Resolução Geral</label>
                      <select 
                        className="settings-select"
                        value={globalSettings.resolution}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGlobalSettings(prev => ({ ...prev, resolution: val }));
                          setStreamConfigs(prev => {
                            const updated = {};
                            Object.keys(prev).forEach(id => {
                              updated[id] = { ...prev[id], resolution: val };
                            });
                            return updated;
                          });
                          addLog(`Resolução global alterada para: ${val}`, "info");
                        }}
                      >
                        <option value="1080p">1920x1080 (HD 1080p)</option>
                        <option value="720p">1280x720 (Médio 720p)</option>
                        <option value="480p">854x480 (Economia 480p)</option>
                        <option value="240p">426x240 (Mínimo 240p)</option>
                      </select>
                    </div>

                    <div className="settings-col">
                      <label className="settings-label">Frame Rate Geral (FPS)</label>
                      <select 
                        className="settings-select"
                        value={globalSettings.fps}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setGlobalSettings(prev => ({ ...prev, fps: val }));
                          setStreamConfigs(prev => {
                            const updated = {};
                            Object.keys(prev).forEach(id => {
                              updated[id] = { ...prev[id], fps: val };
                            });
                            return updated;
                          });
                          addLog(`FPS global alterado para: ${val} FPS`, "info");
                        }}
                      >
                        <option value="30">30 FPS (Fluidez Máxima)</option>
                        <option value="20">20 FPS (Intermediário)</option>
                        <option value="15">15 FPS (Padrão CFTV)</option>
                        <option value="10">10 FPS (Econômico)</option>
                        <option value="5">5 FPS (Mínimo)</option>
                      </select>
                    </div>
                  </div>

                  <div className="preset-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginTop: "16px" }}>
                    <div className="settings-col">
                      <div className="settings-row" style={{ justifyContent: "space-between" }}>
                        <label className="settings-label">Qualidade Geral</label>
                        <span className="settings-value">{globalSettings.quality}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="10" 
                        max="95" 
                        value={globalSettings.quality}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setGlobalSettings(prev => ({ ...prev, quality: val }));
                          setStreamConfigs(prev => {
                            const updated = {};
                            Object.keys(prev).forEach(id => {
                              updated[id] = { ...prev[id], quality: val };
                            });
                            return updated;
                          });
                        }}
                        className="settings-slider"
                      />
                    </div>

                    <div className="settings-col">
                      <div className="settings-row" style={{ justifyContent: "space-between" }}>
                        <label className="settings-label">Buffer Geral</label>
                        <span className="settings-value">{globalSettings.bufsize} frames</span>
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="10" 
                        value={globalSettings.bufsize}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setGlobalSettings(prev => ({ ...prev, bufsize: val }));
                          setStreamConfigs(prev => {
                            const updated = {};
                            Object.keys(prev).forEach(id => {
                              updated[id] = { ...prev[id], bufsize: val };
                            });
                            return updated;
                          });
                        }}
                        className="settings-slider"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CAMERA GRID */}
      <main className={`monitoring-grid ${layoutMode === "grid" ? "grid-cols-2" : "grid-cols-1"}`}>
        
        {camerasConfig.map((cam) => (
          <div className="camera-card" key={cam.id} data-camera-id={cam.id} ref={cardRefCallback}>
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
                (visibleCameras[cam.id] !== false || fullscreenCamera === cam.id) ? (
                  <>
                    {go2rtcAvailable && getCameraStreamingMode(cam.id) !== "mjpeg" ? (
                      <Go2RTCPlayer
                        streamName={getGo2rtcStreamName(cam.id)}
                        mode={getCameraStreamingMode(cam.id)}
                        className="camera-feed-img"
                        onConnectionChange={(connected) => {
                          if (!connected) {
                            addLog(`Stream go2rtc de ${cam.name} desconectou. Reconectando...`, "warn");
                          }
                        }}
                      />
                    ) : (
                      <img 
                        key={`${cam.id}_${profiles[cam.id]}_${refreshKeys[cam.id]}`}
                        src={getFeedSrc(cam.id)} 
                        alt={`Feed de ${cam.name}`} 
                        className="camera-feed-img"
                      />
                    )}
                  
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
                        {streamConfigs[cam.id] ? (
                          `${streamConfigs[cam.id].resolution} (${streamConfigs[cam.id].mode === "auto" ? "Auto" : "Manual"}) @ ${streamConfigs[cam.id].fps} FPS`
                        ) : (
                          `${getCameraMetadata(cam.id).width}x${getCameraMetadata(cam.id).height} @ ${getCameraMetadata(cam.id).fps_real || getCameraMetadata(cam.id).fps_nominal} FPS`
                        )}
                      </div>
                    </div>
                    </div>
                  </>
                ) : (
                  <div className="feed-offline-placeholder feed-suspended">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "hsl(var(--text-secondary))", opacity: 0.6 }}>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                    <h3 style={{ fontSize: "1.05rem", fontWeight: "600", marginTop: "12px", color: "hsl(var(--text-primary))" }}>Feed em Espera</h3>
                    <p style={{ fontSize: "0.825rem", color: "hsl(var(--text-secondary))", maxWidth: "260px", textAlign: "center", marginTop: "4px" }}>
                      Transmissão pausada para poupar dados móveis e processamento. Role para retomar instantaneamente.
                    </p>
                  </div>
                )
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
                  className={`action-btn ${showSettings[cam.id] ? "audio-active" : ""}`}
                  title="Configurações de Transmissão"
                  onClick={() => setShowSettings(prev => ({ ...prev, [cam.id]: !prev[cam.id] }))}
                  disabled={!isBackendOnline}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
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

            {showSettings[cam.id] && streamConfigs[cam.id] && (
              <div className="stream-settings-panel">
                <div className="settings-row">
                  <span className="settings-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    Modo de Transmissão
                  </span>
                  
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span className={`latency-badge ${
                      streamConfigs[cam.id].rtt < 150 ? "latency-good" : (streamConfigs[cam.id].rtt < 300 ? "latency-medium" : "latency-bad")
                    }`}>
                      RTT: {streamConfigs[cam.id].rtt}ms
                    </span>
                    
                    <select 
                      className="settings-select"
                      value={streamConfigs[cam.id].mode}
                      onChange={(e) => {
                        const newMode = e.target.value;
                        setStreamConfigs(prev => ({
                          ...prev,
                          [cam.id]: { ...prev[cam.id], mode: newMode }
                        }));
                        addLog(`${getCameraLabel(cam.id)} configurada para modo: ${newMode === "auto" ? "AUTO-ADAPTATIVO" : "MANUAL"}`, "info");
                      }}
                    >
                      <option value="auto">Auto (Adaptativo)</option>
                      <option value="manual">Manual / Fixo</option>
                    </select>
                  </div>
                </div>

                <div className="settings-row" style={{ marginTop: "12px" }}>
                  <span className="settings-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "6px", verticalAlign: "middle" }}>
                      <polygon points="23 7 16 12 23 17 23 7"></polygon>
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                    </svg>
                    Protocolo de Vídeo
                  </span>
                  
                  <select 
                    className="settings-select"
                    value={individualStreamingModes[cam.id] || "default"}
                    onChange={(e) => {
                      const val = e.target.value;
                      setIndividualStreamingModes((prev) => ({
                        ...prev,
                        [cam.id]: val,
                      }));
                      addLog(`Câmera ${cam.name} configurada para protocolo: ${val === "default" ? "GLOBAL (" + streamingMode.toUpperCase() + ")" : val.toUpperCase()}`, "info");
                    }}
                  >
                    <option value="default">Global ({streamingMode.toUpperCase()})</option>
                    <option value="mp4">fMP4 (Túnel)</option>
                    <option value="mse">MSE (H.264)</option>
                    <option value="webrtc">WebRTC (Ultra)</option>
                    <option value="mjpeg">MJPEG (Legacy)</option>
                  </select>
                </div>

                {streamConfigs[cam.id].mode === "auto" ? (
                  <div style={{
                    background: "rgba(6, 182, 212, 0.05)",
                    border: "1px solid rgba(6, 182, 212, 0.15)",
                    borderRadius: "8px",
                    padding: "10px",
                    color: "#94a3b8",
                    lineHeight: "1.4",
                    fontSize: "0.775rem"
                  }}>
                    <strong style={{ color: "#06b6d4" }}>Adaptação Automática Ativa:</strong> O sistema ajusta resolução, taxa de quadros e qualidade com base na sua latência de rede e desempenho de processamento.
                    <div style={{ display: "flex", gap: "12px", marginTop: "6px", flexWrap: "wrap" }}>
                      <span>Resolução: <span className="settings-value">{streamConfigs[cam.id].resolution}</span></span>
                      <span>FPS: <span className="settings-value">{streamConfigs[cam.id].fps} FPS</span></span>
                      <span>Qualidade: <span className="settings-value">{streamConfigs[cam.id].quality}%</span></span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="settings-col">
                      <span className="settings-label">Presets Rápidos de Qualidade</span>
                      <div className="preset-grid">
                        <button 
                          className={`preset-btn ${
                            streamConfigs[cam.id].resolution === "1080p" && streamConfigs[cam.id].fps === 30 && streamConfigs[cam.id].quality === 85 ? "active" : ""
                          }`}
                          onClick={() => {
                            setStreamConfigs(prev => ({
                              ...prev,
                              [cam.id]: { ...prev[cam.id], resolution: "1080p", fps: 30, quality: 85, bufsize: 2 }
                            }));
                            addLog(`Preset Alta Qualidade (1080p) aplicado a ${getCameraLabel(cam.id)}`, "success");
                          }}
                        >
                          HD 1080p
                        </button>
                        <button 
                          className={`preset-btn ${
                            streamConfigs[cam.id].resolution === "720p" && streamConfigs[cam.id].fps === 15 && streamConfigs[cam.id].quality === 65 ? "active" : ""
                          }`}
                          onClick={() => {
                            setStreamConfigs(prev => ({
                              ...prev,
                              [cam.id]: { ...prev[cam.id], resolution: "720p", fps: 15, quality: 65, bufsize: 2 }
                            }));
                            addLog(`Preset Médio (720p) aplicado a ${getCameraLabel(cam.id)}`, "success");
                          }}
                        >
                          Médio 720p
                        </button>
                        <button 
                          className={`preset-btn ${
                            streamConfigs[cam.id].resolution === "480p" && streamConfigs[cam.id].fps === 10 && streamConfigs[cam.id].quality === 50 ? "active" : ""
                          }`}
                          onClick={() => {
                            setStreamConfigs(prev => ({
                              ...prev,
                              [cam.id]: { ...prev[cam.id], resolution: "480p", fps: 10, quality: 50, bufsize: 2 }
                            }));
                            addLog(`Preset Economia (480p) aplicado a ${getCameraLabel(cam.id)}`, "success");
                          }}
                        >
                          Econômico
                        </button>
                        <button 
                          className={`preset-btn ${
                            streamConfigs[cam.id].resolution === "240p" && streamConfigs[cam.id].fps === 5 && streamConfigs[cam.id].quality === 30 ? "active" : ""
                          }`}
                          onClick={() => {
                            setStreamConfigs(prev => ({
                              ...prev,
                              [cam.id]: { ...prev[cam.id], resolution: "240p", fps: 5, quality: 30, bufsize: 1 }
                            }));
                            addLog(`Preset Mínimo (240p) aplicado a ${getCameraLabel(cam.id)}`, "success");
                          }}
                        >
                          Ultra Leve
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "4px" }}>
                      <div className="settings-col">
                        <label className="settings-label">Resolução</label>
                        <select 
                          className="settings-select"
                          value={streamConfigs[cam.id].resolution}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStreamConfigs(prev => ({
                              ...prev,
                              [cam.id]: { ...prev[cam.id], resolution: val }
                            }));
                          }}
                        >
                          <option value="1080p">1920x1080 (HD)</option>
                          <option value="720p">1280x720 (SD)</option>
                          <option value="480p">854x480 (480p)</option>
                          <option value="360p">640x360 (360p)</option>
                          <option value="240p">426x240 (240p)</option>
                        </select>
                      </div>

                      <div className="settings-col">
                        <label className="settings-label">Frame Rate (FPS)</label>
                        <select 
                          className="settings-select"
                          value={streamConfigs[cam.id].fps}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setStreamConfigs(prev => ({
                              ...prev,
                              [cam.id]: { ...prev[cam.id], fps: val }
                            }));
                          }}
                        >
                          <option value={30}>30 FPS (Fluido)</option>
                          <option value={20}>20 FPS</option>
                          <option value={15}>15 FPS (Padrão)</option>
                          <option value={10}>10 FPS</option>
                          <option value={5}>5 FPS (Leve)</option>
                          <option value={2}>2 FPS</option>
                          <option value={1}>1 FPS (Slideshow)</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                      <div className="settings-col">
                        <div className="settings-row" style={{ justifyContent: "space-between" }}>
                          <label className="settings-label">Qualidade (Bitrate)</label>
                          <span className="settings-value">{streamConfigs[cam.id].quality}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="10" 
                          max="100" 
                          step="5"
                          className="settings-slider"
                          value={streamConfigs[cam.id].quality}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setStreamConfigs(prev => ({
                              ...prev,
                              [cam.id]: { ...prev[cam.id], quality: val }
                            }));
                          }}
                        />
                      </div>

                      <div className="settings-col">
                        <div className="settings-row" style={{ justifyContent: "space-between" }}>
                          <label className="settings-label">Buffer Canal</label>
                          <span className="settings-value">{streamConfigs[cam.id].bufsize} frames</span>
                        </div>
                        <input 
                          type="range" 
                          min="1" 
                          max="10" 
                          step="1"
                          className="settings-slider"
                          value={streamConfigs[cam.id].bufsize}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            setStreamConfigs(prev => ({
                              ...prev,
                              [cam.id]: { ...prev[cam.id], bufsize: val }
                            }));
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
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
              {go2rtcAvailable && getCameraStreamingMode(fullscreenCamera) !== "mjpeg" ? (
                <Go2RTCPlayer
                  streamName={getGo2rtcStreamName(fullscreenCamera)}
                  mode={getCameraStreamingMode(fullscreenCamera)}
                  className="camera-feed-img"
                  style={{ objectFit: "contain" }}
                  onConnectionChange={(connected) => {
                    if (!connected) {
                      addLog(`Stream fullscreen de ${getCameraLabel(fullscreenCamera)} desconectou.`, "warn");
                    }
                  }}
                />
              ) : (
                <img 
                  key={`${fullscreenCamera}_${profiles[fullscreenCamera]}_${refreshKeys[fullscreenCamera]}`}
                  src={getFeedSrc(fullscreenCamera)} 
                  alt="Fullscreen Stream" 
                  className="camera-feed-img"
                  style={{ objectFit: "contain" }}
                />
              )}
              
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
                    {streamConfigs[fullscreenCamera] ? (
                      `${streamConfigs[fullscreenCamera].resolution} (${streamConfigs[fullscreenCamera].mode === "auto" ? "Auto" : "Manual"}) @ ${streamConfigs[fullscreenCamera].fps} FPS`
                    ) : (
                      `${getCameraMetadata(fullscreenCamera).width}x${getCameraMetadata(fullscreenCamera).height} @ ${getCameraMetadata(fullscreenCamera).fps_real || getCameraMetadata(fullscreenCamera).fps_nominal} FPS`
                    )}
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
