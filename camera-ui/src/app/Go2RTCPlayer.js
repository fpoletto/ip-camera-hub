"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Go2RTCPlayer - Reproduz stream de câmera usando o reprodutor oficial e robusto do go2rtc (stream.html) via iframe.
 * 
 * Props:
 *   streamName: string  — nome do stream no go2rtc (ex: "camera_usb_0")
 *   mode: "webrtc" | "mse" | "mp4" | "mjpeg"  — protocolo/método de streaming
 *   onConnectionChange: (connected: boolean) => void
 *   className: string
 *   style: object
 */
export default function Go2RTCPlayer({
  streamName,
  mode = "mp4",
  onConnectionChange,
  className = "",
  style = {},
}) {
  const onConnectionChangeRef = useRef(onConnectionChange);
  const [directHost, setDirectHost] = useState(null);

  // Manter a referência do callback atualizada sem re-disparar o useEffect de ciclo de vida
  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);

  // Detectar dinamicamente se o host é local para conectar diretamente na porta do go2rtc (porta 1984)
  // Isso contorna a limitação do Next.js que não faz proxy de WebSockets (ws://)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname;
      const isLocal = 
        hostname === "localhost" || 
        hostname === "127.0.0.1" || 
        hostname.startsWith("192.168.") || 
        hostname.startsWith("10.") || 
        hostname.startsWith("172.");
      
      if (isLocal) {
        setDirectHost(`http://${hostname}:1984`);
      } else {
        setDirectHost(null);
      }
    }
  }, []);

  // Notificar estritamente ao montar, desmontar ou alterar o nome da stream
  useEffect(() => {
    onConnectionChangeRef.current?.(true);
    return () => {
      onConnectionChangeRef.current?.(false);
    };
  }, [streamName]);

  if (mode === "mjpeg") {
    // Fallback MJPEG legado (endpoint original do Flask)
    const cameraNum = streamName.replace("camera_", "").replace("_main", "").replace("_sub", "");
    const profile = streamName.includes("_sub") ? "sub" : "main";
    return (
      <img
        src={`/stream/${cameraNum}/${profile}`}
        alt={`Feed de ${streamName}`}
        className={className}
        style={style}
      />
    );
  }

  // Se o modo for MP4 e não tivermos um host direto (ex: acesso remoto via túnel),
  // usamos uma tag <video> nativa apontando para a rota do proxy HTTP do Next.js.
  // Isso funciona perfeitamente sem requerer WebSockets!
  if (mode === "mp4" && !directHost) {
    const videoSrc = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(streamName)}`;
    return (
      <video
        src={videoSrc}
        autoPlay
        playsInline
        muted
        controls
        className={className}
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "#000",
          objectFit: "contain",
          ...style,
        }}
      />
    );
  }

  // Mapeamento de modos para o go2rtc
  const streamMode = mode === "webrtc" ? "webrtc" : (mode === "mse" ? "mse" : "mp4");
  
  // Se estiver local, conecta diretamente na porta 1984 para permitir WebSockets nativos de WebRTC/MSE!
  // Se estiver remoto, usa o proxy HTTP do Next.js (com a limitação do WebSocket)
  const baseHost = directHost || "";
  const pathPrefix = directHost ? "" : "/go2rtc";
  const iframeSrc = `${baseHost}${pathPrefix}/stream.html?src=${encodeURIComponent(streamName)}&mode=${encodeURIComponent(streamMode)}`;

  return (
    <iframe
      src={iframeSrc}
      className={className}
      style={{
        border: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "#000",
        display: "block",
        ...style,
      }}
      allow="autoplay; fullscreen; picture-in-picture"
      title={`Stream ${streamName}`}
    />
  );
}

