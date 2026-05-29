# Roadmap: Migração do Streaming — MJPEG → go2rtc (WebRTC/MSE)

## Contexto do Projeto

O **IP Camera Hub** é um sistema de monitoramento local composto por:
- **Backend**: `stream_server.py` (Python/Flask na porta 5001) — descobre câmeras IP (RTSP) e USB, faz streaming MJPEG, controle PTZ via ONVIF SOAP, captura de snapshots, streaming de áudio via FFmpeg, e autenticação por hash SHA-256.
- **Frontend**: Next.js App Router em `camera-ui/` (porta 3000) — interface de monitoramento com grid de câmeras, HUD overlay, controles PTZ, seletor de perfil (main/sub), sistema adaptativo de qualidade, e logs em tempo real.
- **Proxy**: `next.config.mjs` faz rewrite de `/stream/*`, `/status`, `/capture/*`, `/ptz/*`, `/audio/*`, `/auth/*` para `http://127.0.0.1:5001`.
- **Inicialização**: `start.sh` sobe backend, frontend, e opcionalmente túnel Cloudflare.

### Problema atual
O streaming usa **MJPEG sobre HTTP** (OpenCV `cv2.imencode` para JPEG frame-a-frame). Isso causa:
1. Banda 5-10x maior que H.264 (~15 Mbps vs ~2 Mbps por câmera a 720p/15fps)
2. Latência alta (200-800ms)
3. CPU altíssima no servidor (dupla codificação JPEG + Python GIL)
4. Bugs de polling explosivo e reconexão cascata no frontend

### Objetivo
Migrar para **go2rtc** como proxy de streaming (H.264 passthrough via WebRTC/MSE), mantendo o backend Flask para APIs auxiliares (discovery, PTZ, snapshots, auth, status).

---

## Arquivos-Chave do Projeto

| Arquivo | Função | Caminho Absoluto |
|---|---|---|
| Backend streaming | Servidor Flask + MJPEG + PTZ + Audio | `/Users/fabio.fph/IP camera hub/stream_server.py` |
| Frontend (página única) | Dashboard React completo (1661 linhas) | `/Users/fabio.fph/IP camera hub/camera-ui/src/app/page.js` |
| CSS global | Design system dark theme | `/Users/fabio.fph/IP camera hub/camera-ui/src/app/globals.css` |
| Next.js config | Rewrites proxy para backend | `/Users/fabio.fph/IP camera hub/camera-ui/next.config.mjs` |
| Script de inicialização | Sobe backend + frontend + túnel | `/Users/fabio.fph/IP camera hub/start.sh` |
| Dependências Python | Flask, flask-cors, opencv-python | `/Users/fabio.fph/IP camera hub/requirements.txt` |

---

## FASE 1 — Correções Críticas no Sistema Atual (sem mudar arquitetura)

> **Objetivo**: Estabilizar o MJPEG existente corrigindo bugs que causam degradação visível.
> **Tempo estimado**: 2-4 horas
> **Risco**: Baixo — são fixes cirúrgicos.

---

### 1.1 — Corrigir Polling Explosivo do `/status`

**Arquivo**: `camera-ui/src/app/page.js`
**Linhas**: ~119-263

**Problema**: O `useEffect` que faz polling de `/status` a cada 3 segundos tem `[isBackendOnline, cameraStatus]` como dependências. Como `cameraStatus` muda a cada poll (novo objeto), o efeito é desmontado e remontado a cada ciclo, criando intervalos duplicados que se acumulam. O log do backend mostra **10-14 requests de `/status` por segundo** em vez de 1 a cada 3s.

**Solução**: Usar `useRef` para armazenar os valores mutáveis que o callback precisa, e manter dependências estáveis no `useEffect`.

```javascript
// ANTES (problemático):
useEffect(() => {
  let active = true;
  const checkServerStatus = async () => {
    // ... usa isBackendOnline e cameraStatus diretamente
  };
  checkServerStatus();
  const interval = setInterval(checkServerStatus, 3000);
  return () => { active = false; clearInterval(interval); };
}, [isBackendOnline, cameraStatus]); // ← CAUSA: dependências instáveis

// DEPOIS (corrigido):
const isBackendOnlineRef = useRef(isBackendOnline);
const cameraStatusRef = useRef(cameraStatus);

useEffect(() => {
  isBackendOnlineRef.current = isBackendOnline;
}, [isBackendOnline]);

useEffect(() => {
  cameraStatusRef.current = cameraStatus;
}, [cameraStatus]);

useEffect(() => {
  let active = true;
  const checkServerStatus = async () => {
    // ... usar isBackendOnlineRef.current e cameraStatusRef.current
    // em vez de isBackendOnline e cameraStatus
    // MANTER os setters (setIsBackendOnline, setCameraStatus, etc.) — esses são estáveis
  };
  checkServerStatus();
  const interval = setInterval(checkServerStatus, 3000);
  return () => { active = false; clearInterval(interval); };
}, []); // ← dependências vazias = monta uma vez só
```

**Pontos de atenção**:
- Dentro do callback `checkServerStatus`, toda leitura de `isBackendOnline` deve virar `isBackendOnlineRef.current`
- Toda leitura de `cameraStatus` deve virar `cameraStatusRef.current` (ex: na comparação de status antigo vs novo para logs)
- Os `set*` (setIsBackendOnline, setCameraStatus, setProfiles, etc.) **não** precisam de ref — são estáveis por natureza do React

---

### 1.2 — Estabilizar Reconexão Cascata de Streams

**Arquivo**: `camera-ui/src/app/page.js`
**Linhas**: ~838-843

**Problema**: A `key` do `<img>` inclui resolution, fps, quality e refreshKey. Toda vez que o sistema adaptativo muda qualquer parâmetro (a cada 5s), o React destrói e recria o `<img>`, forçando reconexão HTTP/MJPEG. O log mostra conexões/desconexões em cascata rápida com bufsize incrementando.

**Solução**: Separar a key de identidade (que deve recriar o elemento) da URL de configuração (que pode mudar sem recriar).

```jsx
// ANTES (problemático):
<img
  key={`${cam.id}_${profiles[cam.id]}_${streamConfigs[cam.id]?.resolution}_${streamConfigs[cam.id]?.fps}_${streamConfigs[cam.id]?.quality}_${refreshKeys[cam.id]}`}
  src={getFeedSrc(cam.id)}
  alt={`Feed de ${cam.name}`}
  className="camera-feed-img"
/>

// DEPOIS (estável):
<img
  key={`${cam.id}_${profiles[cam.id]}_${refreshKeys[cam.id]}`}
  src={getFeedSrc(cam.id)}
  alt={`Feed de ${cam.name}`}
  className="camera-feed-img"
/>
```

**Lógica**: A key só deve mudar quando o **canal** muda (profile main→sub) ou o usuário clica em "Reiniciar Stream" (refreshKey). Mudanças de quality/fps/resolution devem atualizar apenas a URL `src`, que o browser MJPEG recarrega naturalmente ao detectar mudança de src.

**IMPORTANTE**: Aplicar a mesma correção no `<img>` do fullscreen overlay (~linha 1546):
```jsx
key={`fs_${fullscreenCamera}_${profiles[fullscreenCamera]}_${refreshKeys[fullscreenCamera]}`}
```

---

### 1.3 — Suavizar Sistema Adaptativo (Debounce + Hysteresis)

**Arquivo**: `camera-ui/src/app/page.js`
**Linhas**: ~266-349

**Problema**: O monitoramento de rede roda a cada 5 segundos e aplica mudanças imediatas. Saltos abruptos (ex: 1080p→240p) causam reconexões e flickering. Além disso, em localhost o RTT é sempre <50ms, fazendo o sistema escalar para 1080p/30fps/85% que é overkill para MJPEG.

**Solução**:
1. Adicionar **hysteresis** — só mudar tier se a condição persistir por 3 ciclos consecutivos
2. Adicionar **default razoável para rede local** — se RTT < 50ms, usar 720p/15fps/75% (não 1080p/30fps que sobrecarrega MJPEG)

```javascript
// Adicionar ref para contador de estabilidade
const adaptiveCounterRef = useRef({});

// No monitoramento de rede, em vez de aplicar imediatamente:
// 1. Calcular o tier alvo
// 2. Comparar com tier atual
// 3. Só aplicar se o tier alvo for o mesmo por 3 ciclos consecutivos

// Tier default para rede local (RTT < 50ms):
if (rtt < 50) {
  targetRes = "720p";  // era 1080p
  targetFps = 15;      // era 30
  targetQuality = 75;  // era 85
  targetBufsize = 2;
}
```

---

### 1.4 — Eliminar Dupla Codificação JPEG no Backend

**Arquivo**: `stream_server.py`
**Linhas**: ~88-93 e ~309

**Problema**: O thread de captura (`update()`) codifica cada frame para JPEG (linha 89: `cv2.imencode('.jpg', frame)`), e o thread de feed (`generate_mjpeg_feed()`) codifica **novamente** com qualidade customizada (linha 309). São 2+ codificações por frame.

**Solução**: Remover a codificação da thread de captura. Armazenar apenas o `raw_frame`. O `self.frame` (JPEG pré-codificado) só é usado pelo endpoint `/capture/<camera_id>` para snapshots.

```python
# Em update(), REMOVER as linhas 88-95 e substituir por:
if ret:
    with self.lock:
        self.raw_frame = frame
        self.connected = True
        self.error_message = ""
        self.frame_count += 1

# Em get_frame() (usado por /capture), codificar sob demanda:
def get_frame(self):
    with self.lock:
        if self.raw_frame is not None:
            ret, jpeg = cv2.imencode('.jpg', self.raw_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            if ret:
                return jpeg.tobytes(), self.connected
        return None, self.connected
```

---

### 1.5 — Aumentar Qualidade Default do JPEG

**Arquivo**: `camera-ui/src/app/page.js`
**Linhas**: ~181-188

**Problema**: O default de qualidade JPEG é 60%, que produz artefatos visíveis especialmente em texturas e bordas.

**Solução**: Mudar o default para 75%:
```javascript
// Em setStreamConfigs initial defaults:
next[id] = {
  mode: "auto",
  resolution: "720p",
  fps: 15,
  quality: 75,  // era 60
  bufsize: 2,
  rtt: 0
};
```

---

## FASE 2 — Integração do go2rtc (Upgrade Real de Qualidade)

> **Objetivo**: Substituir o pipeline MJPEG por H.264 passthrough via go2rtc.
> **Tempo estimado**: 1-2 dias
> **Risco**: Médio — mudança arquitetural significativa, mas incremental.

---

### 2.1 — Instalar go2rtc

**Ação**: Baixar o binário standalone do go2rtc para o diretório do projeto.

```bash
# No diretório raiz do projeto: /Users/fabio.fph/IP camera hub/

# Detectar arquitetura do macOS
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_darwin_arm64"
else
  GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_darwin_amd64"
fi

# Baixar para .bin/
mkdir -p .bin
curl -L -o .bin/go2rtc "$GO2RTC_URL"
chmod +x .bin/go2rtc
```

**Verificação**: `.bin/go2rtc --version` deve retornar a versão.

**Adicionar ao `.gitignore`**:
```
.bin/go2rtc
go2rtc.yaml
```

---

### 2.2 — Gerar Configuração Dinâmica do go2rtc

**Arquivo NOVO**: `go2rtc_config.py`
**Localização**: `/Users/fabio.fph/IP camera hub/go2rtc_config.py`

Este script deve ser chamado pelo `start.sh` após a discovery de câmeras. Ele gera o `go2rtc.yaml` dinamicamente com as câmeras encontradas.

```python
#!/usr/bin/env python3
"""
Gera go2rtc.yaml dinamicamente a partir das câmeras IP descobertas na rede.
Chamado pelo start.sh após a fase de discovery.
"""
import yaml
import sys
import json

def generate_config(ip_cameras, usb_indices):
    """
    ip_cameras: lista de IPs (ex: ["192.168.3.138", "192.168.3.139"])
    usb_indices: lista de índices USB (ex: [0, 1])
    """
    streams = {}
    
    for ip in ip_cameras:
        cam_id = ip.split('.')[-1]
        # Stream principal (alta qualidade)
        streams[f"camera_{cam_id}_main"] = [
            f"rtsp://{ip}/rtsp_live0"
        ]
        # Sub-stream (baixa qualidade)
        streams[f"camera_{cam_id}_sub"] = [
            f"rtsp://{ip}/rtsp_live1"
        ]
    
    for idx in usb_indices:
        # Para câmeras USB, go2rtc usa FFmpeg como source
        streams[f"camera_usb_{idx}"] = [
            f"ffmpeg:device?video={idx}&input_format=avfoundation#video=h264"
        ]
    
    config = {
        "streams": streams,
        "api": {
            "listen": ":1984"
        },
        "webrtc": {
            "listen": ":8555",
            "candidates": ["stun:stun.l.google.com:19302"]
        }
    }
    
    with open("go2rtc.yaml", "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)
    
    print(f"[GO2RTC-CONFIG] Gerado go2rtc.yaml com {len(streams)} streams.")

if __name__ == "__main__":
    # Recebe argumentos via linha de comando
    # Uso: python3 go2rtc_config.py '["192.168.3.138","192.168.3.139"]' '[0]'
    ip_list = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
    usb_list = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
    generate_config(ip_list, usb_list)
```

**Dependência**: Adicionar `pyyaml` ao `requirements.txt`.

**Alternativa sem PyYAML**: Gerar o YAML manualmente com string formatting, já que a estrutura é simples e fixa. Isso evita uma dependência extra.

---

### 2.3 — Modificar `stream_server.py` — Expor Dados de Discovery

**Arquivo**: `stream_server.py`

O go2rtc precisa saber quais câmeras existem. Atualmente, a discovery roda no módulo global do `stream_server.py` e popula a variável `streamers`. Precisamos:

1. **Exportar os IPs e USBs descobertos** para que o `go2rtc_config.py` possa usar
2. **Adicionar um endpoint `/discovery`** que retorne a lista de câmeras encontradas
3. **Manter toda a lógica existente** de PTZ, snapshot, audio, auth — não remover nada

**Novo endpoint** (adicionar após o endpoint `/health`):

```python
@app.route('/discovery')
def get_discovery():
    """Retorna a lista de câmeras IP e USB descobertas na inicialização."""
    return jsonify({
        "ip_cameras": active_ip_addresses,
        "usb_cameras": active_usb_indices,
        "subnet": subnet_prefix,
        "local_ip": local_ip_full
    })
```

**Também**: Salvar os resultados da discovery em um JSON na inicialização para o `start.sh` poder gerar o config do go2rtc:

```python
# Após as linhas de discovery (após linha ~245), adicionar:
import json
discovery_data = {
    "ip_cameras": active_ip_addresses,
    "usb_cameras": active_usb_indices
}
with open("discovery_cache.json", "w") as f:
    json.dump(discovery_data, f)
print(f"[DISCOVERY] Cache salvo em discovery_cache.json")
```

---

### 2.4 — Modificar `start.sh` — Adicionar go2rtc ao Pipeline

**Arquivo**: `start.sh`

Adicionar a inicialização do go2rtc **após** o backend (que faz a discovery) e **antes** do frontend.

**Inserir após o bloco do backend (após ~linha 175)**:

```bash
# 2.5 Gerar configuração do go2rtc a partir da discovery do backend
echo -e "${CYAN}[GO2RTC] Gerando configuração de streams...${NC}"
sleep 2  # Aguardar backend completar discovery e salvar cache

if [ -f "discovery_cache.json" ]; then
    IP_CAMERAS=$(python3 -c "import json; d=json.load(open('discovery_cache.json')); print(json.dumps(d['ip_cameras']))")
    USB_CAMERAS=$(python3 -c "import json; d=json.load(open('discovery_cache.json')); print(json.dumps(d['usb_cameras']))")
    python3 go2rtc_config.py "$IP_CAMERAS" "$USB_CAMERAS"
else
    echo -e "${YELLOW}[AVISO] Cache de discovery não encontrado. Gerando config mínimo do go2rtc.${NC}"
    python3 go2rtc_config.py '[]' '[]'
fi

# 2.6 Iniciar go2rtc
echo -e "${CYAN}[GO2RTC] Iniciando proxy de streaming go2rtc na porta 1984...${NC}"
if [ -f ".bin/go2rtc" ]; then
    ./.bin/go2rtc -config go2rtc.yaml > go2rtc.log 2>&1 &
    GO2RTC_PID=$!
    sleep 1.5
    if kill -0 $GO2RTC_PID 2>/dev/null; then
        echo -e "${GREEN}[OK] go2rtc ativo (PID: $GO2RTC_PID). WebRTC porta 8555, API porta 1984.${NC}"
    else
        echo -e "${RED}[ERRO] Falha ao iniciar go2rtc. Verifique go2rtc.log.${NC}"
    fi
else
    echo -e "${RED}[AVISO] Binário go2rtc não encontrado em .bin/. Execute install.sh para baixar.${NC}"
fi
```

**Também modificar**:
- A função `cleanup()` para incluir `kill "$GO2RTC_PID"` 
- O bloco de informações finais para mostrar a porta do go2rtc

---

### 2.5 — Modificar `next.config.mjs` — Proxy para go2rtc

**Arquivo**: `camera-ui/next.config.mjs`

Adicionar rewrites para o go2rtc (porta 1984):

```javascript
const nextConfig = {
  async rewrites() {
    return [
      // Rewrites existentes para o backend Flask (manter todos)
      { source: '/status', destination: 'http://127.0.0.1:5001/status' },
      { source: '/auth/:path*', destination: 'http://127.0.0.1:5001/auth/:path*' },
      { source: '/capture/:path*', destination: 'http://127.0.0.1:5001/capture/:path*' },
      { source: '/ptz/:path*', destination: 'http://127.0.0.1:5001/ptz/:path*' },
      { source: '/audio/:path*', destination: 'http://127.0.0.1:5001/audio/:path*' },
      { source: '/discovery', destination: 'http://127.0.0.1:5001/discovery' },
      { source: '/health', destination: 'http://127.0.0.1:5001/health' },
      
      // NOVOS: Rewrites para go2rtc (porta 1984)
      { source: '/go2rtc/api/:path*', destination: 'http://127.0.0.1:1984/api/:path*' },
      { source: '/go2rtc/stream/:path*', destination: 'http://127.0.0.1:1984/api/stream.mp4?src=:path*' },
      
      // MANTER como fallback: stream MJPEG antigo (para transição gradual)
      { source: '/stream/:path*', destination: 'http://127.0.0.1:5001/stream/:path*' },
    ];
  },
};

export default nextConfig;
```

**NOTA IMPORTANTE sobre WebRTC**: O Next.js rewrite NÃO funciona para WebRTC porque WebRTC usa negociação direta via `RTCPeerConnection`. O frontend precisará se conectar diretamente ao go2rtc na porta 1984 para WebRTC, ou usar MSE via o proxy. Veja a seção 2.6 para detalhes.

---

### 2.6 — Modificar Frontend — Substituir `<img>` MJPEG por `<video>` WebRTC/MSE

**Arquivo**: `camera-ui/src/app/page.js`

Esta é a mudança mais substancial. O objetivo é:
1. Criar um componente `Go2RTCPlayer` que negocia WebRTC com go2rtc
2. Substituir o `<img src={mjpeg_url}>` pelo novo player
3. Manter fallback para MJPEG caso go2rtc não esteja disponível

#### 2.6.1 — Criar componente Go2RTCPlayer

**Arquivo NOVO**: `camera-ui/src/app/Go2RTCPlayer.js`

```jsx
"use client";

import { useRef, useEffect, useState, useCallback } from "react";

/**
 * Go2RTCPlayer - Reproduz stream de câmera via WebRTC ou MSE usando go2rtc.
 * 
 * Props:
 *   streamName: string  — nome do stream no go2rtc (ex: "camera_138_main")
 *   go2rtcHost: string  — host:port do go2rtc (ex: "localhost:1984" ou window.location.host)
 *   mode: "webrtc" | "mse" | "mjpeg"  — protocolo preferido
 *   onConnectionChange: (connected: boolean) => void
 *   className: string
 *   style: object
 */
export default function Go2RTCPlayer({
  streamName,
  go2rtcHost = null,
  mode = "mse",
  onConnectionChange,
  className = "",
  style = {},
}) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);         // RTCPeerConnection para WebRTC
  const wsRef = useRef(null);         // WebSocket para MSE
  const sourceBufferRef = useRef(null);
  const mediaSourceRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const reconnectTimerRef = useRef(null);

  // Determinar o host do go2rtc
  // Em produção local: usar localhost:1984 direto
  // Via túnel: usar o proxy do Next.js
  const resolvedHost = go2rtcHost || "127.0.0.1:1984";

  const updateConnection = useCallback((state) => {
    setConnected(state);
    onConnectionChange?.(state);
  }, [onConnectionChange]);

  // ========================
  // MSE Mode (Media Source Extensions)
  // ========================
  const connectMSE = useCallback(() => {
    if (!videoRef.current) return;

    const wsUrl = `ws://${resolvedHost}/api/ws?src=${streamName}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    let mediaSource = null;
    let sourceBuffer = null;
    let pendingBuffers = [];

    ws.onopen = () => {
      console.log(`[Go2RTC-MSE] Connected to ${streamName}`);
      
      mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      videoRef.current.src = URL.createObjectURL(mediaSource);

      mediaSource.addEventListener("sourceopen", () => {
        try {
          // go2rtc envia codec info no primeiro message
          // A inicialização real do SourceBuffer acontece no primeiro data message
        } catch (err) {
          console.error("[Go2RTC-MSE] Error creating source buffer:", err);
          setError(err.message);
        }
      });
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // JSON message (codec info, etc.)
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "mse") {
            // Codec info: create SourceBuffer
            const codecs = msg.value;
            if (mediaSource && mediaSource.readyState === "open") {
              try {
                sourceBuffer = mediaSource.addSourceBuffer(
                  `video/mp4; codecs="${codecs}"`
                );
                sourceBufferRef.current = sourceBuffer;
                sourceBuffer.mode = "segments";
                sourceBuffer.addEventListener("updateend", () => {
                  if (pendingBuffers.length > 0 && !sourceBuffer.updating) {
                    sourceBuffer.appendBuffer(pendingBuffers.shift());
                  }
                });
                updateConnection(true);
              } catch (err) {
                console.error("[Go2RTC-MSE] SourceBuffer error:", err);
                setError(`Codec não suportado: ${codecs}`);
              }
            }
          }
        } catch (e) {
          // Ignore non-JSON strings
        }
      } else {
        // Binary data (video segments)
        if (sourceBuffer) {
          if (sourceBuffer.updating || pendingBuffers.length > 0) {
            // Buffer limit to prevent memory growth
            if (pendingBuffers.length < 100) {
              pendingBuffers.push(event.data);
            }
          } else {
            try {
              sourceBuffer.appendBuffer(event.data);
            } catch (err) {
              console.error("[Go2RTC-MSE] Append error:", err);
            }
          }
        }
      }
    };

    ws.onerror = (err) => {
      console.error(`[Go2RTC-MSE] WebSocket error for ${streamName}:`, err);
      updateConnection(false);
      setError("Conexão WebSocket falhou");
    };

    ws.onclose = () => {
      console.log(`[Go2RTC-MSE] Disconnected from ${streamName}`);
      updateConnection(false);
      // Auto-reconnect após 3 segundos
      reconnectTimerRef.current = setTimeout(() => {
        connectMSE();
      }, 3000);
    };
  }, [streamName, resolvedHost, updateConnection]);

  // ========================
  // WebRTC Mode
  // ========================
  const connectWebRTC = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
          updateConnection(true);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          updateConnection(false);
          // Auto-reconnect
          reconnectTimerRef.current = setTimeout(() => {
            connectWebRTC();
          }, 3000);
        }
      };

      // Add transceivers for receiving
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering
      await new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        } else {
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === "complete") resolve();
          };
          // Timeout after 3 seconds
          setTimeout(resolve, 3000);
        }
      });

      // Send offer to go2rtc via WHEP-like endpoint
      const response = await fetch(
        `http://${resolvedHost}/api/webrtc?src=${streamName}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: pc.localDescription.sdp,
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const answerSDP = await response.text();
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp: answerSDP })
      );

      console.log(`[Go2RTC-WebRTC] Connected to ${streamName}`);
    } catch (err) {
      console.error(`[Go2RTC-WebRTC] Error for ${streamName}:`, err);
      setError(err.message);
      updateConnection(false);
      // Auto-reconnect
      reconnectTimerRef.current = setTimeout(() => {
        connectWebRTC();
      }, 5000);
    }
  }, [streamName, resolvedHost, updateConnection]);

  // ========================
  // Lifecycle
  // ========================
  useEffect(() => {
    if (mode === "webrtc") {
      connectWebRTC();
    } else if (mode === "mse") {
      connectMSE();
    }

    return () => {
      // Cleanup
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (mediaSourceRef.current && mediaSourceRef.current.readyState === "open") {
        try {
          mediaSourceRef.current.endOfStream();
        } catch (e) {}
      }
    };
  }, [mode, connectWebRTC, connectMSE]);

  // Keep video playing (auto-resume after tab switch)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleVisibility = () => {
      if (!document.hidden && video.paused) {
        video.play().catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  if (mode === "mjpeg") {
    // Fallback MJPEG — usar o endpoint antigo do Flask
    return (
      <img
        src={`/stream/${streamName.replace("camera_", "").replace("_main", "/main").replace("_sub", "/sub")}`}
        alt="Camera feed"
        className={className}
        style={style}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={className}
      style={{ ...style, backgroundColor: "#000" }}
    />
  );
}
```

#### 2.6.2 — Integrar o Go2RTCPlayer na página principal

**Arquivo**: `camera-ui/src/app/page.js`

**Passo 1**: Importar o componente no topo do arquivo:
```javascript
import Go2RTCPlayer from "./Go2RTCPlayer";
```

**Passo 2**: Adicionar estado para controlar modo de streaming e detecção do go2rtc:
```javascript
const [go2rtcAvailable, setGo2rtcAvailable] = useState(false);
const [streamingMode, setStreamingMode] = useState("mse"); // "mse", "webrtc", "mjpeg"
```

**Passo 3**: Adicionar check de disponibilidade do go2rtc (novo useEffect):
```javascript
useEffect(() => {
  const checkGo2rtc = async () => {
    try {
      const res = await fetch("http://127.0.0.1:1984/api/streams");
      if (res.ok) {
        setGo2rtcAvailable(true);
        console.log("[GO2RTC] Proxy de streaming detectado e online.");
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
```

**Passo 4**: Construir o nome do stream go2rtc a partir do camera ID:
```javascript
const getGo2rtcStreamName = (cameraId) => {
  const profile = profiles[cameraId] || "main";
  if (cameraId.startsWith("usb_")) {
    return `camera_${cameraId}`;
  }
  return `camera_${cameraId}_${profile}`;
};
```

**Passo 5**: Substituir o bloco `<img>` do feed (~linhas 838-843) por:
```jsx
{go2rtcAvailable ? (
  <Go2RTCPlayer
    streamName={getGo2rtcStreamName(cam.id)}
    mode={streamingMode}
    className="camera-feed-img"
    onConnectionChange={(connected) => {
      if (!connected) {
        addLog(`Stream go2rtc de ${getCameraLabel(cam.id)} desconectou. Reconectando...`, "warn");
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
```

**Passo 6**: Aplicar a mesma substituição no bloco de fullscreen overlay (~linhas 1544-1551).

**Passo 7**: Adicionar seletor de modo de streaming nos controles globais (perto do seletor Grid/Lista):
```jsx
{go2rtcAvailable && (
  <div className="segmented-control" style={{ marginLeft: "12px" }}>
    <button
      className={`segmented-btn ${streamingMode === "mse" ? "active" : ""}`}
      onClick={() => setStreamingMode("mse")}
    >
      MSE (H.264)
    </button>
    <button
      className={`segmented-btn ${streamingMode === "webrtc" ? "active" : ""}`}
      onClick={() => setStreamingMode("webrtc")}
    >
      WebRTC
    </button>
    <button
      className={`segmented-btn ${streamingMode === "mjpeg" ? "active" : ""}`}
      onClick={() => setStreamingMode("mjpeg")}
    >
      MJPEG (Legacy)
    </button>
  </div>
)}
```

---

### 2.7 — Adicionar CSS para `<video>` (análogo ao `<img>`)

**Arquivo**: `camera-ui/src/app/globals.css`

Adicionar regra para que o `<video>` se comporte igual ao `<img>` no feed container:

```css
/* Video feed (go2rtc WebRTC/MSE) */
.camera-feed-img,
video.camera-feed-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
```

---

### 2.8 — Atualizar `install.sh` — Incluir Download do go2rtc

**Arquivo**: `install.sh`

Adicionar seção de download do go2rtc no script de instalação. Usar a mesma lógica de detecção de arquitetura que já existe para o cloudflared:

```bash
# Download go2rtc
echo "[INSTALL] Baixando go2rtc..."
mkdir -p .bin
ARCH=$(uname -m)
OS=$(uname -s)

if [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_darwin_arm64"
  else
    GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_darwin_amd64"
  fi
elif [ "$OS" = "Linux" ]; then
  if [ "$ARCH" = "x86_64" ]; then
    GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64"
  elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm64"
  fi
fi

if [ -n "$GO2RTC_URL" ]; then
  curl -L -o .bin/go2rtc "$GO2RTC_URL"
  chmod +x .bin/go2rtc
  echo "[OK] go2rtc instalado em .bin/go2rtc"
fi
```

---

### 2.9 — Simplificação Opcional do `stream_server.py` (Pós-Validação)

> [!WARNING]
> **Executar esta etapa SOMENTE após validar que go2rtc está funcionando corretamente.**

Após confirmar que o streaming via go2rtc funciona, o `stream_server.py` pode ser simplificado:

1. **Remover** a classe `CameraStreamer` inteira (linhas 19-140)
2. **Remover** a função `generate_mjpeg_feed` (linhas 275-333)
3. **Remover** o endpoint `/stream/<camera_id>/<profile>` (linhas 403-422)
4. **Manter** o endpoint `/capture/<camera_id>` — adaptar para pedir snapshot ao go2rtc via API:
   ```python
   @app.route('/capture/<camera_id>')
   def capture_snapshot(camera_id):
       # Pedir snapshot ao go2rtc
       stream_name = f"camera_{camera_id}_main"
       try:
           resp = urllib.request.urlopen(f"http://127.0.0.1:1984/api/frame.jpeg?src={stream_name}", timeout=5)
           return send_file(io.BytesIO(resp.read()), mimetype='image/jpeg', 
                          as_attachment=True, download_name=f"snapshot_{camera_id}_{int(time.time())}.jpg")
       except Exception as e:
           return jsonify({"error": str(e)}), 500
   ```
5. **Manter** os endpoints de PTZ, audio, auth, status, discovery, health
6. **Remover** o loop de `for streamer in streamers.values(): streamer.start()` (linha 270-271)
7. **Manter** a discovery (ela é necessária para gerar o go2rtc.yaml)

Isso reduz o `stream_server.py` de ~590 linhas para ~250 linhas e elimina toda a dependência de `cv2` no servidor de streaming.

---

## Plano de Verificação

### Fase 1 (Fixes)
- [ ] Verificar log do backend: `/status` deve aparecer a cada 3s, não dezenas por segundo
- [ ] Verificar que mudar qualidade/fps nas configurações NÃO causa desconexão/reconexão do feed
- [ ] Verificar que JPEG quality visual melhorou (menos artefatos)
- [ ] Rodar por 5 minutos e confirmar que não há acúmulo de intervalos ou memory leak

### Fase 2 (go2rtc)
- [ ] `curl http://127.0.0.1:1984/api/streams` retorna lista de câmeras
- [ ] Abrir `http://localhost:1984` no browser e verificar que go2rtc UI mostra os streams
- [ ] Dashboard mostra vídeo via `<video>` MSE com latência sub-segundo
- [ ] Testar troca entre MSE, WebRTC e MJPEG (fallback) no seletor de modo
- [ ] PTZ continua funcionando (controles do Flask backend)
- [ ] Snapshot download continua funcionando
- [ ] Audio continua funcionando
- [ ] Login/auth continua funcionando
- [ ] Tunnel Cloudflare continua funcionando (testar acesso externo)
- [ ] `start.sh` sobe os 3 serviços (backend + go2rtc + frontend) e encerra limpo com Ctrl+C

---

## Resumo dos Arquivos

| Ação | Arquivo |
|---|---|
| **MODIFICAR** | `stream_server.py` — corrigir dupla codificação, expor discovery, endpoint `/discovery` |
| **MODIFICAR** | `camera-ui/src/app/page.js` — corrigir polling, estabilizar keys, integrar Go2RTCPlayer |
| **MODIFICAR** | `camera-ui/src/app/globals.css` — CSS para `<video>` |
| **MODIFICAR** | `camera-ui/next.config.mjs` — rewrites para go2rtc |
| **MODIFICAR** | `start.sh` — adicionar go2rtc ao pipeline de inicialização |
| **MODIFICAR** | `install.sh` — download do go2rtc |
| **MODIFICAR** | `requirements.txt` — adicionar pyyaml (se usar) |
| **MODIFICAR** | `.gitignore` — adicionar go2rtc.yaml, discovery_cache.json |
| **CRIAR** | `camera-ui/src/app/Go2RTCPlayer.js` — componente React de player WebRTC/MSE |
| **CRIAR** | `go2rtc_config.py` — gerador dinâmico de configuração |

---

## Ordem de Execução

```
1. Fase 1.1 → Fix polling explosivo (page.js useEffect deps)
2. Fase 1.2 → Fix reconexão cascata (page.js img key)
3. Fase 1.3 → Suavizar adaptativo (page.js debounce)
4. Fase 1.4 → Fix dupla codificação (stream_server.py)
5. Fase 1.5 → Qualidade default (page.js)
   → TESTAR FASE 1 COMPLETA
6. Fase 2.1 → Instalar go2rtc (.bin/)
7. Fase 2.2 → Criar go2rtc_config.py
8. Fase 2.3 → Modificar stream_server.py (discovery endpoint)
9. Fase 2.4 → Modificar start.sh (pipeline go2rtc)
10. Fase 2.5 → Modificar next.config.mjs (rewrites)
11. Fase 2.6 → Criar Go2RTCPlayer.js + integrar em page.js
12. Fase 2.7 → CSS para <video>
13. Fase 2.8 → Atualizar install.sh
    → TESTAR FASE 2 COMPLETA
14. Fase 2.9 → Simplificar stream_server.py (SOMENTE após validação)
    → TESTE FINAL COMPLETO
```
