"use client";

import { useEffect, useRef } from "react";

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

  // Manter a referência do callback atualizada sem re-disparar o useEffect de ciclo de vida
  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);

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

  // Mapeamento de modos para o go2rtc
  const streamMode = mode === "webrtc" ? "webrtc" : (mode === "mse" ? "mse" : "mp4");
  const iframeSrc = `/go2rtc/stream.html?src=${encodeURIComponent(streamName)}&mode=${encodeURIComponent(streamMode)}`;

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
