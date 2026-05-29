#!/bin/bash
# ==============================================================================
#                 IP CAMERA HUB - INSTALADOR UNIVERSAL AUTÔNOMO
# ==============================================================================
# Este script detecta o sistema operacional, instala as dependências necessárias
# (Node.js, Python 3, FFmpeg), configura o ambiente virtual Python isolado e
# compila o painel Next.js para produção.
# ==============================================================================

# Cores para formatação de logs
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # Sem cor

echo -e "${CYAN}======================================================================"
echo -e "          INICIALIZANDO INSTALADOR DO IP CAMERA HUB LIVE              "
echo -e "======================================================================${NC}"

# 1. Detecção do Sistema Operacional
OS_TYPE="$(uname -s)"
echo -e "Sistema Operacional detectado: ${YELLOW}${OS_TYPE}${NC}"

# Função para checar comando
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 2. Instalação das dependências do sistema de acordo com o OS
if [ "$OS_TYPE" = "Darwin" ]; then
    echo -e "${CYAN}[SISTEMA] Verificando dependências no macOS...${NC}"
    
    if ! command_exists brew; then
        echo -e "${YELLOW}[WARNING] Homebrew não detectado. Ele é necessário para instalar as dependências no macOS.${NC}"
        echo -e "Instalando Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    
    echo -e "Atualizando e instalando pacotes necessários (Node.js, Python, FFmpeg)..."
    brew install node python3 ffmpeg
    
elif [ "$OS_TYPE" = "Linux" ]; then
    echo -e "${CYAN}[SISTEMA] Verificando dependências no Linux...${NC}"
    
    if command_exists apt-get; then
        echo -e "Distribuição baseada em Debian/Ubuntu detectada."
        echo -e "Atualizando índices de pacotes..."
        sudo apt-get update
        echo -e "Instalando Node.js, NPM, Python3, Pip, Venv e FFmpeg..."
        sudo apt-get install -y nodejs npm python3 python3-pip python3-venv ffmpeg
        
    elif command_exists dnf; then
        echo -e "Distribuição baseada em Fedora/RHEL detectada."
        echo -e "Instalando dependências..."
        sudo dnf install -y nodejs npm python3 python3-pip ffmpeg
        
    elif command_exists pacman; then
        echo -e "Distribuição baseada em Arch Linux detectada."
        echo -e "Instalando dependências..."
        sudo pacman -S --noconfirm nodejs npm python python-pip ffmpeg
        
    else
        echo -e "${RED}[ERRO] Gerenciador de pacotes compatível não encontrado.${NC}"
        echo -e "Por favor, instale manualmente: Node.js, NPM, Python 3, Pip e FFmpeg."
        exit 1
    fi
else
    echo -e "${RED}[ERRO] Sistema operacional não suportado de forma direta.${NC}"
    echo -e "Por favor, execute em macOS ou Linux."
    exit 1
fi

# Validar se as ferramentas mínimas foram instaladas
if ! command_exists node; then
    echo -e "${RED}[ERRO] Falha ao instalar Node.js.${NC}"
    exit 1
fi
if ! command_exists python3; then
    echo -e "${RED}[ERRO] Falha ao instalar Python 3.${NC}"
    exit 1
fi
if ! command_exists ffmpeg; then
    echo -e "${RED}[ERRO] Falha ao instalar FFmpeg (necessário para áudio).${NC}"
    exit 1
fi

echo -e "${GREEN}[OK] Dependências do sistema (NodeJS, Python3, FFmpeg) estão prontas!${NC}"

# 3. Configuração do ambiente virtual Python (Venv)
echo -e "\n${CYAN}[BACKEND] Configurando ambiente virtual Python...${NC}"
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "Ambiente virtual 'venv' criado com sucesso."
else
    echo -e "Ambiente virtual 'venv' já existente."
fi

# Instalar dependências Python no venv
echo -e "Instalando/Atualizando dependências do Backend (OpenCV, Flask, requests)..."
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

echo -e "${GREEN}[OK] Dependências do Backend Python instaladas no venv!${NC}"

# 4. Configuração e Compilação do Frontend (Next.js)
echo -e "\n${CYAN}[FRONTEND] Configurando e compilando interface Next.js...${NC}"
if [ -d "camera-ui" ]; then
    cd camera-ui
    echo -e "Instalando dependências locais do NodeJS..."
    npm install
    
    echo -e "Compilando painel Next.js para produção (isso gera o bundle estático otimizado)..."
    npm run build
    
    cd ..
else
    echo -e "${RED}[ERRO] Diretório 'camera-ui' não encontrado.${NC}"
    exit 1
fi

echo -e "${GREEN}[OK] Interface Next.js compilada e pronta para produção!${NC}"

# 4.5 Download do binário autônomo do go2rtc
echo -e "\n${CYAN}[GO2RTC] Verificando e instalando proxy de streaming go2rtc...${NC}"
mkdir -p .bin

GO2RTC_BIN=".bin/go2rtc"
if [ -f "$GO2RTC_BIN" ]; then
    echo -e "go2rtc já instalado localmente em .bin/go2rtc"
else
    ARCH_TYPE="$(uname -m)"
    OS_TYPE="$(uname -s)"
    GO2RTC_URL=""
    
    if [ "$OS_TYPE" = "Darwin" ]; then
        if [ "$ARCH_TYPE" = "arm64" ] || [ "$ARCH_TYPE" = "aarch64" ]; then
            GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_mac_arm64.zip"
        else
            GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_mac_amd64.zip"
        fi
    elif [ "$OS_TYPE" = "Linux" ]; then
        if [ "$ARCH_TYPE" = "x86_64" ]; then
            GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64"
        elif [ "$ARCH_TYPE" = "aarch64" ] || [ "$ARCH_TYPE" = "arm64" ]; then
            GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm64"
        fi
    fi
    
    if [ -n "$GO2RTC_URL" ]; then
        echo -e "Baixando go2rtc de: $GO2RTC_URL"
        if [[ "$GO2RTC_URL" == *.zip ]]; then
            curl -L -o ".bin/go2rtc.zip" "$GO2RTC_URL"
            if [ -f ".bin/go2rtc.zip" ]; then
                unzip -o ".bin/go2rtc.zip" -d .bin >/dev/null 2>&1
                rm -f ".bin/go2rtc.zip"
                chmod +x "$GO2RTC_BIN"
                echo -e "${GREEN}[OK] go2rtc instalado com sucesso!${NC}"
            else
                echo -e "${RED}[ERRO] Falha ao baixar zip do go2rtc.${NC}"
            fi
        else
            curl -L -o "$GO2RTC_BIN" "$GO2RTC_URL"
            if [ -f "$GO2RTC_BIN" ]; then
                chmod +x "$GO2RTC_BIN"
                echo -e "${GREEN}[OK] go2rtc instalado com sucesso!${NC}"
            else
                echo -e "${RED}[ERRO] Falha ao baixar binário do go2rtc.${NC}"
            fi
        fi
    else
        echo -e "${RED}[AVISO] Arquitetura de OS ou plataforma não reconhecida para download do go2rtc.${NC}"
    fi
fi

# 5. Garantir permissões de execução para start.sh
if [ -f "start.sh" ]; then
    chmod +x start.sh
fi

echo -e "\n${GREEN}======================================================================"
echo -e "    IP CAMERA HUB INSTALADO COM SUCESSO E PRONTO PARA INICIALIZAR!     "
echo -e "======================================================================${NC}"
echo -e "Para iniciar o monitor de câmeras (local + túnel público externo), rode:"
echo -e "  ${YELLOW}./start.sh${NC}"
echo -e "======================================================================"
