import os
import time
import threading
import cv2
import urllib.request
import subprocess
from flask import Flask, Response, jsonify, send_file
from flask_cors import CORS
import io

# Force OpenCV/FFmpeg to use TCP for RTSP transport to ensure stable feeds
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
# Disable macOS AVFoundation authorization prompt from background threads to fail gracefully
os.environ["OPENCV_AVFOUNDATION_SKIP_AUTH"] = "1"

app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing for the React frontend

class CameraStreamer:
    def __init__(self, name, ip, stream_path, is_usb=False, usb_index=0):
        self.name = name
        self.ip = ip
        self.stream_path = stream_path
        self.is_usb = is_usb
        self.usb_index = usb_index
        self.rtsp_url = f"rtsp://{ip}/{stream_path}" if not is_usb else f"usb_{usb_index}"
        self.frame = None
        self.started = False
        self.connected = False
        self.thread = None
        self.lock = threading.Lock()
        self.width = 0
        self.height = 0
        self.fps = 0
        self.error_message = ""
        self.frame_count = 0
        self.fps_real = 0.0
        self.last_fps_check = time.time()

    def start(self):
        if self.started:
            return
        self.started = True
        self.thread = threading.Thread(target=self.update, args=())
        self.thread.daemon = True
        self.thread.start()

    def update(self):
        print(f"[STREAMER-{self.name}] Starting thread for {self.rtsp_url}...")
        while self.started:
            if self.is_usb:
                cap = cv2.VideoCapture(self.usb_index)
            else:
                cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
                
            if not cap.isOpened():
                with self.lock:
                    self.connected = False
                    self.error_message = "Câmera USB offline" if self.is_usb else "Conexão falhou"
                print(f"[STREAMER-{self.name}] Failed to connect to {self.rtsp_url}. Retrying in 2 seconds...")
                time.sleep(2)
                continue

            with self.lock:
                self.connected = True
                self.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                self.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                self.fps = int(cap.get(cv2.CAP_PROP_FPS)) if cap.get(cv2.CAP_PROP_FPS) > 0 else 30
                self.error_message = ""
            print(f"[STREAMER-{self.name}] Connected! Size: {self.width}x{self.height} @ {self.fps} FPS")

            self.frame_count = 0
            self.last_fps_check = time.time()

            while self.started:
                ret, frame = cap.read()
                if not ret:
                    print(f"[STREAMER-{self.name}] Frame capture failed or stream disconnected.")
                    with self.lock:
                        self.connected = False
                        self.error_message = "USB sinal perdido" if self.is_usb else "Sinal perdido"
                    break

                # Encode frame to JPEG format
                ret, jpeg = cv2.imencode('.jpg', frame)
                if ret:
                    with self.lock:
                        self.frame = jpeg.tobytes()
                        self.connected = True
                        self.error_message = ""
                        self.frame_count += 1

                # Calculate real-time FPS
                now = time.time()
                elapsed = now - self.last_fps_check
                if elapsed >= 2.0:
                    with self.lock:
                        self.fps_real = round(self.frame_count / elapsed, 1)
                    self.frame_count = 0
                    self.last_fps_check = now

                # Yield CPU slightly to prevent thread saturation (approx 25-30 FPS max)
                time.sleep(0.02)

            cap.release()
            time.sleep(1)

    def get_frame(self):
        with self.lock:
            return self.frame, self.connected

    def get_status(self):
        with self.lock:
            return {
                "name": self.name,
                "ip": self.ip,
                "stream_path": self.stream_path,
                "is_usb": self.is_usb,
                "connected": self.connected,
                "width": self.width,
                "height": self.height,
                "fps_nominal": self.fps,
                "fps_real": self.fps_real,
                "error": self.error_message
            }

    def stop(self):
        self.started = False
        if self.thread:
            self.thread.join(timeout=1.0)


def get_local_subnet():
    """
    Obtém o IP local ativo do sistema host conectando temporariamente um socket UDP ao IP '8.8.8.8'.
    Não envia dados reais para a rede externa.
    Retorna o prefixo da sub-rede de classe C (ex: '192.168.3') e o IP local completo.
    """
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Não estabelece conexão de dados reais, serve apenas para rotear internamente
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
    except Exception as e:
        print(f"[REDE] Não foi possível determinar o IP local: {e}. Usando fallback 127.0.0.1")
        local_ip = "127.0.0.1"
    finally:
        s.close()
    
    parts = local_ip.split('.')
    if len(parts) == 4:
        subnet_prefix = ".".join(parts[:3])
    else:
        subnet_prefix = "192.168.3"  # Fallback histórico seguro
        
    return subnet_prefix, local_ip


def discover_usb_cameras():
    """
    Varre os slots USB de 0 a 7 tentando abrir um VideoCapture com o OpenCV.
    Retorna uma lista dos índices dos dispositivos disponíveis.
    """
    print("[DISCOVERY-USB] Iniciando varredura por webcams USB (Slots 0 a 7)...")
    active_slots = []
    # A abertura de slots fechados no OpenCV/macOS costuma falhar instantaneamente.
    for index in range(8):
        cap = cv2.VideoCapture(index)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret:
                print(f" -> [DISCOVERY-USB] Webcam detectada no Slot {index}!")
                active_slots.append(index)
            else:
                # O slot abriu mas não retornou frame (pode estar em uso ou ocupado)
                # No macOS, consideramos conectada se o cap abriu.
                print(f" -> [DISCOVERY-USB] Slot {index} abriu com sucesso (mas falhou ao capturar frame - presumindo ativa).")
                active_slots.append(index)
            cap.release()
    print(f"[DISCOVERY-USB] Varredura USB concluída. Slots encontrados: {active_slots}")
    return active_slots


def check_camera_ip(ip, timeout=0.6):
    """
    Testa se um IP tem as portas de vídeo comuns abertas (554 para RTSP ou 8080 para ONVIF).
    """
    import socket
    ports_to_try = [554, 8080]
    discovered_ports = []
    for port in ports_to_try:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(timeout)
            s.connect((ip, port))
            s.close()
            discovered_ports.append(port)
        except Exception:
            pass
    return ip, discovered_ports


def discover_ip_cameras(subnet_prefix):
    """
    Varre a sub-rede ativa descobrindo quais IPs estão com portas RTSP (554) ou ONVIF (8080) abertas.
    """
    import concurrent.futures
    print(f"[DISCOVERY-IP] Iniciando varredura concorrente na rede {subnet_prefix}.0/24...")
    active_ips = []
    
    ips_to_check = [f"{subnet_prefix}.{i}" for i in range(1, 255)]
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        futures = {executor.submit(check_camera_ip, ip): ip for ip in ips_to_check}
        for future in concurrent.futures.as_completed(futures):
            try:
                ip, ports = future.result()
                if ports:
                    # Se tiver a porta 554 ou 8080 aberta, é um dispositivo de interesse (câmera IP)
                    print(f" -> [DISCOVERY-IP] Câmera IP ativa detectada em {ip} (Portas abertas: {ports})")
                    active_ips.append(ip)
            except Exception:
                pass
                
    print(f"[DISCOVERY-IP] Varredura de Rede concluída. Dispositivos IP encontrados: {active_ips}")
    return sorted(active_ips, key=lambda ip: int(ip.split('.')[-1]))


# Realizar as varreduras de descoberta automática na inicialização
subnet_prefix, local_ip_full = get_local_subnet()
print(f"\n[REDE] Host IP Local: {local_ip_full} | Prefixo da Sub-rede: {subnet_prefix}.0/24")

# 1. Varredura USB Primeiro
active_usb_indices = discover_usb_cameras()

# 2. Varredura IP Imediatamente Depois
active_ip_addresses = discover_ip_cameras(subnet_prefix)

# Construir os streamers dinamicamente
streamers = {}

# Adicionar Webcams USB ativas (usando uma única instância de streamer para evitar conflito de hardware)
for usb_idx in active_usb_indices:
    usb_streamer = CameraStreamer(f"usb_{usb_idx}", "local", f"usb_{usb_idx}", is_usb=True, usb_index=usb_idx)
    streamers[f"usb_{usb_idx}_main"] = usb_streamer
    streamers[f"usb_{usb_idx}_sub"] = usb_streamer

# Adicionar Câmeras IP ativas
for ip in active_ip_addresses:
    # Usamos o último octeto do IP como ID da câmera
    cam_id = ip.split('.')[-1]
    streamers[f"{cam_id}_main"] = CameraStreamer(f"{cam_id}_main", ip, "rtsp_live0")
    streamers[f"{cam_id}_sub"] = CameraStreamer(f"{cam_id}_sub", ip, "rtsp_live1")

if not streamers:
    print("\n[AVISO] Nenhuma câmera USB ou IP ativa foi detectada na inicialização.")
    print("[AVISO] Iniciando o servidor sem canais ativos.\n")
else:
    print(f"\n[INICIALIZAÇÃO] {len(streamers) // 2} canais de vídeo instanciados e prontos para conexão.")

# Start streaming threads in the background
for streamer in streamers.values():
    streamer.start()



def generate_mjpeg_feed(streamer_key):
    streamer = streamers.get(streamer_key)
    if not streamer:
        return
    
    print(f"[FEED] Client connected to: {streamer_key}")
    while True:
        frame, connected = streamer.get_frame()
        if connected and frame is not None:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
            # Rate limit the client stream to prevent browser tab choking
            time.sleep(0.03)
        else:
            time.sleep(0.1)


def send_ptz_command(ip, action):
    """
    Sends raw ONVIF SOAP PTZ commands directly to the camera's ptz_service.
    """
    url = f"http://{ip}:8080/onvif/ptz_service"
    
    if action == "stop":
        soap_action = "http://www.onvif.org/ver20/ptz/wsdl/Stop"
        payload = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">'
            '<soap:Body>'
            '<tptz:Stop>'
            '<tptz:ProfileToken>media_profile0</tptz:ProfileToken>'
            '<tptz:PanTilt>true</tptz:PanTilt>'
            '<tptz:Zoom>true</tptz:Zoom>'
            '</tptz:Stop>'
            '</soap:Body>'
            '</soap:Envelope>'
        )
    else:
        x, y = 0.0, 0.0
        # Configure move velocity vector (-1.0 to 1.0)
        # eSmartLink responds very well to 0.6 speed
        speed = 0.6
        if action == "up":
            y = speed
        elif action == "down":
            y = -speed
        elif action == "left":
            x = -speed
        elif action == "right":
            x = speed
            
        soap_action = "http://www.onvif.org/ver20/ptz/wsdl/ContinuousMove"
        payload = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">'
            '<soap:Body>'
            '<tptz:ContinuousMove>'
            '<tptz:ProfileToken>media_profile0</tptz:ProfileToken>'
            '<tptz:Velocity>'
            f'<tt:PanTilt x="{x}" y="{y}" />'
            '</tptz:Velocity>'
            '</tptz:ContinuousMove>'
            '</soap:Body>'
            '</soap:Envelope>'
        )

    try:
        req = urllib.request.Request(
            url,
            data=payload.encode('utf-8'),
            headers={
                'Content-Type': 'application/soap+xml; charset=utf-8',
                'User-Agent': 'Antigravity-ONVIF-PTZ/1.0',
                'SOAPAction': soap_action
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=3) as response:
            return True, response.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"[PTZ ERROR] Action {action} on {ip} failed: {e}")
        return False, str(e)


@app.route('/stream/<camera_id>/<profile>')
def stream_video(camera_id, profile):
    streamer_key = f"{camera_id}_{profile}"
    if streamer_key not in streamers:
        return "Camera or profile not found", 404
        
    return Response(
        generate_mjpeg_feed(streamer_key),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@app.route('/status')
def status():
    camera_status = {}
    for key, streamer in streamers.items():
        camera_status[key] = streamer.get_status()
    return jsonify(camera_status)


@app.route('/capture/<camera_id>')
def capture_snapshot(camera_id):
    streamer_key = f"{camera_id}_main"
    if streamer_key not in streamers:
        return jsonify({"error": "Camera not found"}), 404

    streamer = streamers[streamer_key]
    frame, connected = streamer.get_frame()
    
    if not connected or frame is None:
        return jsonify({"error": "Camera is offline or feed is not ready"}), 500
        
    return send_file(
        io.BytesIO(frame),
        mimetype='image/jpeg',
        as_attachment=True,
        download_name=f"snapshot_{camera_id}_{int(time.time())}.jpg"
    )


@app.route('/ptz/<camera_id>/<action>', methods=['POST'])
def ptz_control(camera_id, action):
    """
    Executes a PTZ action on the target camera.
    Supported actions: up, down, left, right, stop
    """
    if camera_id.startswith("usb_"):
        return jsonify({"error": "Controle PTZ não suportado para webcams USB"}), 400
        
    main_key = f"{camera_id}_main"
    if main_key not in streamers:
        return jsonify({"error": f"Câmera {camera_id} não encontrada ou offline"}), 400
        
    if action not in ["up", "down", "left", "right", "stop"]:
        return jsonify({"error": "Invalid action"}), 400
        
    # Obtém o IP correspondente da câmera a partir do streamer instanciado
    ip = streamers[main_key].ip
    success, details = send_ptz_command(ip, action)
    
    if success:
        return jsonify({"status": "success", "action": action})
    else:
        return jsonify({"status": "error", "message": details}), 500


@app.route('/audio/<camera_id>')
def stream_audio(camera_id):
    """
    Exposes an MP3 live audio stream by extracting and encoding the RTSP audio track or local USB AVFoundation mic.
    """
    USB_AUDIO_DEVICES = {
        "usb_0": ":1",  # MacBook Pro Microphone
        "usb_1": ":0",  # Microsoft® LifeCam Cinema(TM)
        "usb_2": ":2",  # HD spkear 
    }

    if camera_id.startswith("usb_"):
        audio_device = USB_AUDIO_DEVICES.get(camera_id)
        if not audio_device:
            # Fallback incremental dinâmico se for outro slot USB
            try:
                idx = int(camera_id.split('_')[-1])
                audio_device = f":{idx}"
            except Exception:
                audio_device = ":0"
            
        print(f"[AUDIO] Spawning AVFoundation FFmpeg capture for: {camera_id} device {audio_device}")
        cmd = [
            "/opt/homebrew/bin/ffmpeg",
            "-f", "avfoundation",
            "-i", audio_device,
            "-vn",                      # Audio only (disable video)
            "-acodec", "libmp3lame",    # Convert on the fly to MP3
            "-ab", "64k",               # Bitrate
            "-ar", "16000",             # Audio sample rate
            "-ac", "1",                 # Mono channel
            "-f", "mp3",                # Output format
            "pipe:1"                    # Output to stdout
        ]
    else:
        main_key = f"{camera_id}_main"
        if main_key not in streamers:
            return jsonify({"error": f"Câmera {camera_id} não encontrada ou offline"}), 400
            
        ip_address = streamers[main_key].ip
        rtsp_url = f"rtsp://{ip_address}/rtsp_live0"
        
        print(f"[AUDIO] Spawning FFmpeg extraction for: {rtsp_url}")
        
        # We use -rtsp_transport tcp for reliable packet delivery
        cmd = [
            "/opt/homebrew/bin/ffmpeg",
            "-rtsp_transport", "tcp",
            "-i", rtsp_url,
            "-vn",                      # Audio only (disable video)
            "-acodec", "libmp3lame",    # Convert on the fly to MP3
            "-ab", "64k",               # Bitrate
            "-ar", "16000",             # Audio sample rate
            "-ac", "1",                 # Mono channel
            "-f", "mp3",                # Output format
            "pipe:1"                    # Output to stdout
        ]
    
    try:
        # Spawn the process in a non-blocking pipe
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        
        def generate():
            try:
                while True:
                    chunk = process.stdout.read(4096)
                    if not chunk:
                        break
                    yield chunk
            except Exception as e:
                print(f"[AUDIO] Stream reader detached: {e}")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    process.kill()
                    
        return Response(generate(), mimetype='audio/mpeg')
    except Exception as e:
        print(f"[AUDIO ERROR] Failed to start FFmpeg: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/health')
def health():
    return jsonify({"status": "ok", "timestamp": time.time()})


if __name__ == '__main__':
    print("\n" + "="*50)
    print("  IP CAMERA HUB - STREAMING SERVER WITH AUDIO & PTZ")
    print("  Port: 5001 | CORS: Enabled | Auto-Reconnect: Active")
    print("  FFmpeg Audio: Enabled | ONVIF PTZ SOAP: Active")
    print("="*50 + "\n")
    app.run(host='0.0.0.0', port=5001, threaded=True, debug=False)
