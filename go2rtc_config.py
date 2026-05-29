#!/usr/bin/env python3
"""
Gera go2rtc.yaml dinamicamente a partir das câmeras IP descobertas na rede.
Chamado pelo start.sh após a fase de discovery.
"""
import sys
import json

def generate_config(ip_cameras, usb_indices):
    lines = []
    lines.append("streams:")
    
    for ip in ip_cameras:
        cam_id = ip.split('.')[-1]
        # Stream principal (alta qualidade)
        lines.append(f"  camera_{cam_id}_main:")
        lines.append(f"    - rtsp://{ip}/rtsp_live0")
        # Sub-stream (baixa qualidade)
        lines.append(f"  camera_{cam_id}_sub:")
        lines.append(f"    - rtsp://{ip}/rtsp_live1")
        
    is_mac = sys.platform == "darwin"
    for idx in usb_indices:
        lines.append(f"  camera_usb_{idx}:")
        if is_mac:
            # Para evitar conflito de travamento exclusivo do hardware USB no macOS, o go2rtc consome o feed MJPEG local do Flask
            # com baixa latência (-fflags nobuffer -flags low_delay) e o transcodifica em H.264 usando aceleração de hardware (h264_videotoolbox).
            lines.append(f"    - exec:ffmpeg -fflags nobuffer -flags low_delay -i http://127.0.0.1:5001/stream/usb_{idx}/main -c:v h264_videotoolbox -pix_fmt yuv420p -realtime 1 -f mpegts pipe:1")
        else:
            # No Linux, faz o mesmo consumo local via rede, transcodificando usando libx264 de baixa latência
            lines.append(f"    - exec:ffmpeg -fflags nobuffer -flags low_delay -i http://127.0.0.1:5001/stream/usb_{idx}/main -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -f mpegts pipe:1")
        
    lines.append("")
    lines.append("api:")
    lines.append("  listen: :1984")
    lines.append("  origin: \"*\"")
    lines.append("")
    lines.append("webrtc:")
    lines.append("  listen: :8555")
    lines.append("  candidates:")
    lines.append("    - stun:stun.l.google.com:19302")
    lines.append("")
    
    with open("go2rtc.yaml", "w") as f:
        f.write("\n".join(lines))
        
    print(f"[GO2RTC-CONFIG] Gerado go2rtc.yaml com {len(ip_cameras)*2 + len(usb_indices)} streams.")

if __name__ == "__main__":
    ip_list = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
    usb_list = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
    generate_config(ip_list, usb_list)
