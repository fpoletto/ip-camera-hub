#!/bin/bash
# ==============================================================================
#                 IP CAMERA HUB - INICIALIZADOR INTEGRADO E TÚNEL
# ==============================================================================
# Este script inicia concorrentemente o backend Flask de mídia (porta 5001),
# o frontend Next.js (porta 3000) e configura opcionalmente um túnel público
# seguro e gratuito do Cloudflare (cloudflared) exibindo o link no terminal.
# ==============================================================================

# Cores para formatação de logs
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # Sem cor

echo -e "${CYAN}======================================================================"
echo -e "            INICIANDO HUB DE CÂMERAS IP - CENTRAL LOCAL                "
echo -e "======================================================================${NC}"

# Função para checar comando
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 1. Configuração do Túnel Público Cloudflare (cloudflared)
setup_cloudflare() {
    if command_exists cloudflared; then
        CLOUDFLARED_BIN="cloudflared"
        return 0
    fi

    # Diretório local para binários standalone
    mkdir -p .bin
    CLOUDFLARED_BIN="./.bin/cloudflared"

    # Se o arquivo local existe mas está corrompido ou contém "Not Found" de um download mal sucedido
    if [ -f "$CLOUDFLARED_BIN" ]; then
        if grep -q "Not Found" "$CLOUDFLARED_BIN" 2>/dev/null || [ ! -s "$CLOUDFLARED_BIN" ]; then
            echo -e "${YELLOW}[TÚNEL] Arquivo local do cloudflared está corrompido. Removendo para baixar novamente...${NC}"
            rm -f "$CLOUDFLARED_BIN"
        else
            return 0
        fi
    fi

    echo -e "${YELLOW}[TÚNEL] cloudflared não está instalado globalmente. Baixando binário standalone oficial...${NC}"
    
    OS_TYPE="$(uname -s)"
    ARCH_TYPE="$(uname -m)"
    DOWNLOAD_URL=""
    IS_TGZ=false
    
    if [ "$OS_TYPE" = "Darwin" ]; then
        IS_TGZ=true
        if [ "$ARCH_TYPE" = "arm64" ] || [ "$ARCH_TYPE" = "aarch64" ]; then
            # Binário macOS nativo para Apple Silicon
            DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz"
        else
            # Binário macOS nativo para Intel
            DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz"
        fi
    elif [ "$OS_TYPE" = "Linux" ]; then
        if [ "$ARCH_TYPE" = "x86_64" ]; then
            DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
        elif [ "$ARCH_TYPE" = "aarch64" ] || [ "$ARCH_TYPE" = "arm64" ]; then
            DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
        else
            DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-386"
        fi
    fi

    if [ -n "$DOWNLOAD_URL" ]; then
        echo -e "Baixando: $DOWNLOAD_URL"
        if [ "$IS_TGZ" = true ]; then
            # Baixar o tarball comprimido para macOS
            curl -L -o ".bin/cloudflared.tgz" "$DOWNLOAD_URL"
            if [ -f ".bin/cloudflared.tgz" ]; then
                if grep -q "Not Found" ".bin/cloudflared.tgz" 2>/dev/null; then
                    echo -e "${RED}[ERRO] Falha ao baixar o cloudflared (URL retornou 404).${NC}"
                    rm -f ".bin/cloudflared.tgz"
                    return 1
                fi
                # Extrair o binário 'cloudflared' do tarball para dentro de .bin/
                tar -xzf ".bin/cloudflared.tgz" -C .bin/ 2>/dev/null
                rm -f ".bin/cloudflared.tgz"
                if [ -f "$CLOUDFLARED_BIN" ]; then
                    chmod +x "$CLOUDFLARED_BIN"
                    echo -e "${GREEN}[OK] cloudflared baixado e extraído com sucesso em .bin/!${NC}"
                    return 0
                else
                    echo -e "${RED}[ERRO] O arquivo tarball baixado não continha o binário 'cloudflared'.${NC}"
                    return 1
                fi
            else
                echo -e "${RED}[ERRO] Falha ao efetuar download do arquivo comprimido do cloudflared.${NC}"
                return 1
            fi
        else
            # Baixar binário direto para Linux
            curl -L -o "$CLOUDFLARED_BIN" "$DOWNLOAD_URL"
            if grep -q "Not Found" "$CLOUDFLARED_BIN" 2>/dev/null; then
                echo -e "${RED}[ERRO] Falha ao baixar o cloudflared (URL retornou 404).${NC}"
                rm -f "$CLOUDFLARED_BIN"
                return 1
            fi
            chmod +x "$CLOUDFLARED_BIN"
            echo -e "${GREEN}[OK] cloudflared baixado localmente em .bin/!${NC}"
            return 0
        fi
    else
        echo -e "${RED}[AVISO] Arquitetura de OS ou plataforma não reconhecida para download automático do cloudflared.${NC}"
        return 1
    fi
}

# 1.5. Configuração e Hashing da Senha
echo -e "\n${CYAN}[SEGURANÇA] Configurando senha de acesso para a central...${NC}"
if [ -f "auth_hash.txt" ]; then
    echo -e "Uma senha de acesso já está configurada localmente."
    read -p "Deseja alterar ou remover a senha atual? (s/N): " -n 1 -r CHANGE_PASS
    echo ""
    if [[ $CHANGE_PASS =~ ^[Ss]$ ]]; then
        ASK_PASSWORD=true
    else
        ASK_PASSWORD=false
    fi
else
    ASK_PASSWORD=true
fi

if [ "$ASK_PASSWORD" = true ]; then
    echo -e "${YELLOW}----------------------------------------------------------------------"
    echo -e "Defina uma senha para proteger o monitoramento contra acessos não autorizados."
    echo -e "Essa senha é salva localmente como um hash SHA-256 e validada estritamente"
    echo -e "no navegador (frontend), mantendo seus feeds e dados completamente protegidos."
    echo -e "----------------------------------------------------------------------${NC}"
    
    # Prompt seguro para leitura de senha (oculta caracteres)
    read -s -p "Digite a senha de acesso (ou pressione Enter para NENHUMA senha): " USER_PASS
    echo ""
    
    if [ -n "$USER_PASS" ]; then
        # Gerar hash SHA-256 de forma nativa e sem pular linhas
        if command_exists shasum; then
            echo -n "$USER_PASS" | shasum -a 256 | awk '{print $1}' | tr -d '\n' > auth_hash.txt
        elif command_exists sha256sum; then
            echo -n "$USER_PASS" | sha256sum | awk '{print $1}' | tr -d '\n' > auth_hash.txt
        else
            python3 -c "import hashlib; print(hashlib.sha256(b'$USER_PASS').hexdigest(), end='')" > auth_hash.txt
        fi
        echo -e "${GREEN}[OK] Senha de acesso configurada e salva com sucesso em 'auth_hash.txt'!${NC}\n"
    else
        rm -f auth_hash.txt
        echo -e "${RED}[AVISO] Nenhuma senha definida. A central estará livre para acesso público!${NC}\n"
    fi
fi

# 2. Iniciar o Backend Python
echo -e "${CYAN}[BACKEND] Iniciando servidor de mídia na porta 5001...${NC}"
if [ -f "venv/bin/python" ]; then
    ./venv/bin/python stream_server.py > backend.log 2>&1 &
    BACKEND_PID=$!
else
    python3 stream_server.py > backend.log 2>&1 &
    BACKEND_PID=$!
fi

# Verificar se o backend rodou
sleep 1.5
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}[ERRO] Falha ao iniciar o backend de mídia. Verifique 'backend.log' para detalhes.${NC}"
    exit 1
fi
echo -e "${GREEN}[OK] Backend de mídia ativo (PID: $BACKEND_PID).${NC}"

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
    echo -e "${RED}[AVISO] Binário go2rtc não encontrado em .bin/.${NC}"
fi

# 3. Iniciar o Frontend Next.js
echo -e "${CYAN}[FRONTEND] Iniciando interface de monitoramento na porta 3000...${NC}"
cd camera-ui

# Verifica se existe pasta build (.next), se sim roda em produção (start), senão em dev
if [ -d ".next" ]; then
    echo -e "Executando servidor otimizado de produção..."
    npm run start > ../frontend.log 2>&1 &
    FRONTEND_PID=$!
else
    echo -e "Pasta de produção '.next' não encontrada. Executando em modo de desenvolvimento..."
    npm run dev > ../frontend.log 2>&1 &
    FRONTEND_PID=$!
fi

cd ..

# Verificar se o frontend rodou
sleep 2.0
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo -e "${RED}[ERRO] Falha ao iniciar o frontend Next.js. Verifique 'frontend.log' para detalhes.${NC}"
    # Encerrar backend
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi
echo -e "${GREEN}[OK] Interface Next.js ativa (PID: $FRONTEND_PID).${NC}"

# 4. Perguntar e Configurar o Túnel Público Cloudflare
echo -e "\n${YELLOW}----------------------------------------------------------------------"
echo -e "Deseja expor seu monitor ao vivo publicamente na Internet?"
echo -e "Isso criará uma URL criptografada e segura (HTTPS) para visualizar suas"
echo -e "câmeras pelo celular ou computadores externos, sem abrir portas."
echo -e "----------------------------------------------------------------------${NC}"
read -p "Ativar Túnel Externo? (s/N): " -n 1 -r
echo ""

TUNNEL_PID=""
if [[ $REPLY =~ ^[Ss]$ ]]; then
    if setup_cloudflare; then
        echo -e "${CYAN}[TÚNEL] Inicializando túnel seguro do Cloudflare...${NC}"
        
        # Iniciar o túnel apontando para o frontend na porta 3000 (que faz rewrites internos ao backend)
        $CLOUDFLARED_BIN tunnel --url http://localhost:3000 > cloudflare.log 2>&1 &
        TUNNEL_PID=$!
        
        # Aguardar e capturar a URL gerada
        echo -n "Obtendo endereço de acesso público..."
        for i in {1..20}; do
            echo -n "."
            sleep 1
            TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' cloudflare.log | head -n 1)
            if [ -n "$TUNNEL_URL" ]; then
                echo -e "\n"
                echo -e "${GREEN}======================================================================${NC}"
                echo -e "${GREEN}            SISTEMA DE MONITORAMENTO PÚBLICO ATIVO!                   ${NC}"
                echo -e "${GREEN}======================================================================${NC}"
                echo -e "Acesse seu painel com segurança de qualquer lugar do mundo no link:"
                echo -e "  URL Pública: ${CYAN}${TUNNEL_URL}${NC}"
                echo -e "======================================================================"
                break
            fi
        done
        
        if [ -z "$TUNNEL_URL" ]; then
            echo -e "\n${RED}[AVISO] Não foi possível capturar a URL pública automaticamente.${NC}"
            echo -e "Verifique o arquivo 'cloudflare.log' para localizar a URL ou ver erros."
        fi
    else
        echo -e "${RED}[AVISO] Não foi possível ativar o túnel por falta do cloudflared.${NC}"
    fi
fi

# 5. Dashboard Operacional Local
IP_LOCAL=$(ipconfig getifaddr en0 2>/dev/null || ifconfig | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -n 1 | awk '{print $2}')
echo -e "\n${GREEN}======================================================================${NC}"
echo -e "    IP CAMERA HUB ATIVO LOCALMENTE!"
echo -e "======================================================================"
echo -e "Acesse em sua rede local:"
echo -e "  Dashboard Local: ${CYAN}http://localhost:3000${NC}"
if [ -n "$IP_LOCAL" ]; then
    echo -e "  Outros computadores da mesma rede: ${CYAN}http://${IP_LOCAL}:3000${NC}"
fi
echo -e "  Streaming go2rtc API: ${CYAN}http://localhost:1984${NC}"
echo -e "----------------------------------------------------------------------"
echo -e "Logs do backend:   ${YELLOW}tail -f backend.log${NC}"
echo -e "Logs do frontend:  ${YELLOW}tail -f frontend.log${NC}"
echo -e "Logs do go2rtc:    ${YELLOW}tail -f go2rtc.log${NC}"
echo -e "----------------------------------------------------------------------"
echo -e "Pressione ${RED}[Ctrl+C]${NC} a qualquer momento para desligar todos os servidores."
echo -e "${GREEN}======================================================================${NC}"

# Função de encerramento limpo de todos os processos
cleanup() {
    echo -e "\n\n${YELLOW}[SHUTDOWN] Desligando serviços de monitoramento...${NC}"
    if [ -n "$GO2RTC_PID" ]; then
        kill "$GO2RTC_PID" 2>/dev/null
    fi
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill "$FRONTEND_PID" 2>/dev/null
    fi
    if [ -n "$TUNNEL_PID" ]; then
        kill "$TUNNEL_PID" 2>/dev/null
    fi
    echo -e "${GREEN}[SHUTDOWN] Todos os processos encerrados de forma limpa. Até breve!${NC}"
    exit 0
}

# Capturar sinais de saída para realizar o cleanup
trap cleanup SIGINT SIGTERM

# Loop infinito silencioso para manter o script ativo e aguardar interrupção
while true; do
    sleep 1
done
