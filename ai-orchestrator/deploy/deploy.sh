#!/bin/bash
# ============================================================
# AI Orchestrator — VPS 배포 스크립트
# 사용법: bash deploy.sh [--domain your.domain.com] [--no-ssl]
# 요구사항: Ubuntu 20.04+ / Debian 11+ / CentOS 8+
#           root 또는 sudo 권한
# ============================================================
set -euo pipefail

# ── 색상 출력 ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step()    { echo -e "\n${CYAN}══ $1 ══${NC}"; }

# ── 기본값 ───────────────────────────────────────────────────
DOMAIN=""
NO_SSL=false
APP_DIR="/opt/ai-orchestrator"
APP_USER="aiorch"
NODE_VERSION="20"
REPO_URL="https://github.com/vinsenzo83/kbeauty-autocommerce.git"
BRANCH="genspark_ai_developer"
APP_SUBDIR="ai-orchestrator"
APP_PORT=3000

# ── 인수 파싱 ────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --domain)  DOMAIN="$2"; shift 2 ;;
    --no-ssl)  NO_SSL=true; shift ;;
    --dir)     APP_DIR="$2"; shift 2 ;;
    --branch)  BRANCH="$2"; shift 2 ;;
    --port)    APP_PORT="$2"; shift 2 ;;
    --help)
      echo "사용법: bash deploy.sh [옵션]"
      echo "  --domain  DOMAIN    도메인 설정 (예: api.example.com)"
      echo "  --no-ssl            SSL 설정 건너뜀"
      echo "  --dir     DIR       설치 디렉토리 (기본: /opt/ai-orchestrator)"
      echo "  --branch  BRANCH    Git 브랜치 (기본: genspark_ai_developer)"
      echo "  --port    PORT      앱 포트 (기본: 3000)"
      exit 0 ;;
    *) warn "알 수 없는 옵션: $1"; shift ;;
  esac
done

# ── root 확인 ────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "이 스크립트는 root(또는 sudo)로 실행해야 합니다."
fi

echo -e "${CYAN}"
cat << 'BANNER'
  ___    ___    ___            _                       _             _
 / _ \  |  _\  / __|    ___  | |_   _ _   __ _   ___ | |_   _ _   __ _ | |_  ___  _ _
| (_) | | |   | (__    / _ \ | ' \ | '_| / _` | (_-< |  _| | '_| / _` ||  _|/ _ \| '_|
 \___/  |_|    \___|   \___/ |_||_||_|   \__,_| /__/  \__| |_|   \__,_| \__|\___/|_|
BANNER
echo -e "${NC}"
echo -e "  ${GREEN}AI Orchestrator VPS 자동 배포 스크립트${NC}"
echo -e "  도메인: ${YELLOW}${DOMAIN:-'(미설정 - IP 접근)'}${NC}"
echo -e "  설치 경로: ${YELLOW}${APP_DIR}${NC}"
echo -e "  브랜치: ${YELLOW}${BRANCH}${NC}"
echo ""

# ══════════════════════════════════════════════════════════════
# 1단계: 시스템 패키지 설치
# ══════════════════════════════════════════════════════════════
step "1단계: 시스템 패키지 업데이트"

# OS 감지
if command -v apt-get &>/dev/null; then
  PKG_MGR="apt"
  apt-get update -qq
  apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ufw fail2ban jq
elif command -v yum &>/dev/null; then
  PKG_MGR="yum"
  yum update -y -q
  yum install -y curl git nginx certbot python3-certbot-nginx ufw jq
elif command -v dnf &>/dev/null; then
  PKG_MGR="dnf"
  dnf update -y -q
  dnf install -y curl git nginx certbot python3-certbot-nginx jq
else
  error "지원하지 않는 OS입니다. Ubuntu/Debian/CentOS/RHEL 만 지원합니다."
fi
success "시스템 패키지 설치 완료"

# ══════════════════════════════════════════════════════════════
# 2단계: Node.js 설치
# ══════════════════════════════════════════════════════════════
step "2단계: Node.js ${NODE_VERSION} 설치"

if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt "$NODE_VERSION" ]]; then
  info "Node.js ${NODE_VERSION} 설치 중..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - 2>/dev/null || \
  curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash -
  if [[ "$PKG_MGR" == "apt" ]]; then
    apt-get install -y -qq nodejs
  else
    yum install -y nodejs
  fi
fi
success "Node.js $(node -v) 설치 완료"

# PM2 설치
if ! command -v pm2 &>/dev/null; then
  info "PM2 설치 중..."
  npm install -g pm2 --quiet
fi
success "PM2 $(pm2 -v) 설치 완료"

# ══════════════════════════════════════════════════════════════
# 3단계: 애플리케이션 사용자 및 디렉토리 생성
# ══════════════════════════════════════════════════════════════
step "3단계: 앱 사용자 및 디렉토리 설정"

# 전용 사용자 생성
if ! id "$APP_USER" &>/dev/null; then
  useradd -r -s /bin/bash -d "$APP_DIR" -m "$APP_USER"
  success "사용자 '${APP_USER}' 생성 완료"
else
  info "사용자 '${APP_USER}' 이미 존재"
fi

# 디렉토리 생성
mkdir -p "${APP_DIR}"/{data,logs,backups}
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
success "디렉토리 구성 완료: ${APP_DIR}"

# ══════════════════════════════════════════════════════════════
# 4단계: 코드 배포
# ══════════════════════════════════════════════════════════════
step "4단계: Git 저장소에서 코드 배포"

DEPLOY_DIR="${APP_DIR}/app"

if [[ -d "${DEPLOY_DIR}/.git" ]]; then
  info "기존 저장소 업데이트 중..."
  cd "${DEPLOY_DIR}"
  sudo -u "${APP_USER}" git fetch origin
  sudo -u "${APP_USER}" git checkout "${BRANCH}"
  sudo -u "${APP_USER}" git pull origin "${BRANCH}"
else
  info "저장소 클론 중..."
  sudo -u "${APP_USER}" git clone --branch "${BRANCH}" "${REPO_URL}" "${DEPLOY_DIR}"
fi

# 앱 서브디렉토리
APP_PATH="${DEPLOY_DIR}/${APP_SUBDIR}"
if [[ ! -d "$APP_PATH" ]]; then
  error "앱 디렉토리를 찾을 수 없습니다: ${APP_PATH}"
fi

success "코드 배포 완료: ${APP_PATH}"

# ══════════════════════════════════════════════════════════════
# 5단계: 의존성 설치
# ══════════════════════════════════════════════════════════════
step "5단계: npm 의존성 설치"

cd "${APP_PATH}"
sudo -u "${APP_USER}" npm ci --only=production --quiet
success "npm 의존성 설치 완료"

# ══════════════════════════════════════════════════════════════
# 6단계: 환경변수 설정
# ══════════════════════════════════════════════════════════════
step "6단계: 환경변수 설정"

ENV_FILE="${APP_PATH}/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  warn ".env 파일이 없습니다. .env.example 에서 복사합니다."
  if [[ -f "${APP_PATH}/.env.example" ]]; then
    cp "${APP_PATH}/.env.example" "$ENV_FILE"
    chown "${APP_USER}:${APP_USER}" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    warn "⚠️  ${ENV_FILE} 파일을 편집하여 API 키를 설정하세요!"
    warn "   nano ${ENV_FILE}"
  else
    # 최소 .env 생성
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))" 2>/dev/null || openssl rand -hex 64)
    cat > "$ENV_FILE" << EOF
NODE_ENV=production
PORT=${APP_PORT}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES=24h
ADMIN_EMAIL=admin@${DOMAIN:-localhost}
ADMIN_PASSWORD=$(openssl rand -base64 16)

# ─── AI 공급자 키 (아래에 입력) ───
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
DEEPSEEK_API_KEY=
XAI_API_KEY=
MOONSHOT_API_KEY=
MISTRAL_API_KEY=
EOF
    chown "${APP_USER}:${APP_USER}" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    warn "⚠️  ${ENV_FILE} 파일을 편집하여 API 키를 설정하세요!"
  fi
else
  success ".env 파일 확인 완료"
fi

# data 디렉토리 심링크 (영속성)
if [[ ! -L "${APP_PATH}/data" ]]; then
  rm -rf "${APP_PATH}/data"
  ln -s "${APP_DIR}/data" "${APP_PATH}/data"
  chown -h "${APP_USER}:${APP_USER}" "${APP_PATH}/data"
fi
if [[ ! -L "${APP_PATH}/logs" ]]; then
  rm -rf "${APP_PATH}/logs"
  ln -s "${APP_DIR}/logs" "${APP_PATH}/logs"
  chown -h "${APP_USER}:${APP_USER}" "${APP_PATH}/logs"
fi
success "데이터/로그 디렉토리 심링크 완료"

# ══════════════════════════════════════════════════════════════
# 7단계: PM2 설정 및 서비스 시작
# ══════════════════════════════════════════════════════════════
step "7단계: PM2로 앱 서비스 시작"

PM2_CONFIG="${APP_DIR}/ecosystem.config.js"
cat > "$PM2_CONFIG" << PMEOF
module.exports = {
  apps: [{
    name: 'ai-orchestrator',
    script: '${APP_PATH}/src/server.js',
    cwd: '${APP_PATH}',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env_file: '${ENV_FILE}',
    env: {
      NODE_ENV: 'production',
      PORT: ${APP_PORT}
    },
    error_file: '${APP_DIR}/logs/app-error.log',
    out_file: '${APP_DIR}/logs/app-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true
  }]
};
PMEOF

chown "${APP_USER}:${APP_USER}" "$PM2_CONFIG"

# PM2 시작/재시작
if sudo -u "${APP_USER}" pm2 list | grep -q 'ai-orchestrator'; then
  info "기존 PM2 프로세스 재시작..."
  sudo -u "${APP_USER}" pm2 reload "$PM2_CONFIG" --update-env
else
  info "PM2 프로세스 시작..."
  sudo -u "${APP_USER}" pm2 start "$PM2_CONFIG"
fi

# PM2 부팅 자동시작 설정
PM2_STARTUP=$(sudo -u "${APP_USER}" pm2 startup | tail -1)
if [[ "$PM2_STARTUP" == *"sudo"* ]]; then
  eval "$PM2_STARTUP"
fi
sudo -u "${APP_USER}" pm2 save
success "PM2 서비스 시작 완료"

# ══════════════════════════════════════════════════════════════
# 8단계: Nginx 설정
# ══════════════════════════════════════════════════════════════
step "8단계: Nginx 리버스 프록시 설정"

SERVER_NAME="${DOMAIN:-_}"
NGINX_CONF="/etc/nginx/sites-available/ai-orchestrator"

cat > "$NGINX_CONF" << NGINXEOF
# AI Orchestrator — Nginx 설정 (생성일: $(date))
upstream ai_backend {
    server 127.0.0.1:${APP_PORT};
    keepalive 32;
}

# HTTP → HTTPS 리다이렉트 (SSL 사용시)
server {
    listen 80;
    server_name ${SERVER_NAME};

    # Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # SSL 미사용시 아래 블록이 메인으로 동작
    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS 메인 서버
server {
    listen 443 ssl http2;
    server_name ${SERVER_NAME};

    # SSL (certbot 설치 후 자동 채워짐)
    # ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    # include /etc/letsencrypt/options-ssl-nginx.conf;
    # ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # 보안 헤더
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 업로드 최대 크기
    client_max_body_size 50M;

    # SSE 스트리밍 (버퍼링 비활성화 필수!)
    location /api/ai/chat/stream {
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
        chunked_transfer_encoding on;
        add_header Cache-Control "no-cache";
        add_header X-Accel-Buffering "no";
    }

    # WebSocket (Socket.IO)
    location /socket.io/ {
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # API 엔드포인트
    location /api/ {
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 120s;
    }

    # 정적 파일 캐시
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)\$ {
        proxy_pass http://ai_backend;
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=86400";
        expires 1d;
    }

    # 헬스체크 (로그 제외)
    location /health {
        proxy_pass http://ai_backend;
        access_log off;
    }

    # 메인 앱
    location / {
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # 로그
    access_log /var/log/nginx/ai-orchestrator-access.log;
    error_log  /var/log/nginx/ai-orchestrator-error.log warn;
}
NGINXEOF

# HTTP 전용 fallback (SSL 미사용시)
if [[ "$NO_SSL" == "true" || -z "$DOMAIN" ]]; then
  cat > "$NGINX_CONF" << NGINXEOF2
# AI Orchestrator — Nginx HTTP 전용 설정
upstream ai_backend {
    server 127.0.0.1:${APP_PORT};
    keepalive 32;
}

server {
    listen 80;
    server_name ${SERVER_NAME};

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    client_max_body_size 50M;

    # SSE 스트리밍
    location /api/ai/chat/stream {
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
        add_header Cache-Control "no-cache";
        add_header X-Accel-Buffering "no";
    }

    # WebSocket
    location /socket.io/ {
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }

    # API
    location /api/ {
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

    location /health {
        proxy_pass http://ai_backend;
        access_log off;
    }

    location / {
        proxy_pass http://ai_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    access_log /var/log/nginx/ai-orchestrator-access.log;
    error_log  /var/log/nginx/ai-orchestrator-error.log warn;
}
NGINXEOF2
fi

# sites-enabled 심링크
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ai-orchestrator
# default 제거
rm -f /etc/nginx/sites-enabled/default

# nginx 문법 검사 및 재시작
nginx -t && systemctl reload nginx || warn "nginx 재시작 실패 - 설정 확인 필요"
systemctl enable nginx
success "Nginx 설정 완료"

# ══════════════════════════════════════════════════════════════
# 9단계: 방화벽 설정
# ══════════════════════════════════════════════════════════════
step "9단계: 방화벽 (UFW) 설정"

if command -v ufw &>/dev/null; then
  ufw --force enable 2>/dev/null || true
  ufw allow ssh
  ufw allow 80/tcp
  ufw allow 443/tcp
  # 앱 포트는 내부에서만 (nginx 프록시 사용)
  ufw deny "${APP_PORT}/tcp" 2>/dev/null || true
  success "UFW 방화벽 설정 완료 (80, 443, SSH 허용)"
else
  warn "UFW를 찾을 수 없습니다. 수동으로 방화벽을 설정하세요."
fi

# ══════════════════════════════════════════════════════════════
# 10단계: SSL 인증서 (도메인이 있을 경우)
# ══════════════════════════════════════════════════════════════
if [[ -n "$DOMAIN" && "$NO_SSL" != "true" ]]; then
  step "10단계: Let's Encrypt SSL 인증서 발급"

  if command -v certbot &>/dev/null; then
    ADMIN_EMAIL_SSL="${ADMIN_EMAIL:-admin@${DOMAIN}}"
    certbot --nginx -d "$DOMAIN" \
      --email "$ADMIN_EMAIL_SSL" \
      --agree-tos --no-eff-email \
      --non-interactive 2>&1 || warn "SSL 발급 실패 - 수동 설정 필요"

    # 자동 갱신
    systemctl enable certbot.timer 2>/dev/null || \
      (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
    success "SSL 인증서 발급 및 자동 갱신 설정 완료"
  else
    warn "certbot이 없습니다. 수동으로 SSL을 설정하세요."
  fi
fi

# ══════════════════════════════════════════════════════════════
# 완료 요약
# ══════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          🎉 AI Orchestrator 배포 완료!               ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""

# 헬스체크
sleep 3
if curl -sf "http://localhost:${APP_PORT}/health" >/dev/null 2>&1; then
  success "✅ 앱 헬스체크 통과 (http://localhost:${APP_PORT}/health)"
else
  warn "⚠️  앱이 아직 시작 중이거나 문제가 있습니다. 로그를 확인하세요:"
  echo "    sudo -u ${APP_USER} pm2 logs ai-orchestrator"
fi

BASE_URL="http://${DOMAIN:-$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP')}"
if [[ -n "$DOMAIN" && "$NO_SSL" != "true" ]]; then
  BASE_URL="https://${DOMAIN}"
fi

echo ""
echo -e "  📡 서비스 URL:       ${CYAN}${BASE_URL}${NC}"
echo -e "  🔧 Admin 패널:       ${CYAN}${BASE_URL}/admin${NC}"
echo -e "  📊 Health Dashboard: ${CYAN}${BASE_URL}/health-dashboard.html${NC}"
echo -e "  💚 헬스체크:         ${CYAN}${BASE_URL}/health${NC}"
echo ""
echo -e "  📁 앱 경로:     ${YELLOW}${APP_PATH}${NC}"
echo -e "  📄 환경변수:    ${YELLOW}${ENV_FILE}${NC}"
echo -e "  📋 PM2 설정:    ${YELLOW}${PM2_CONFIG}${NC}"
echo ""
echo -e "  ${YELLOW}⚠️  다음 작업이 필요합니다:${NC}"
echo -e "    1. ${ENV_FILE} 편집 → AI API 키 입력"
echo -e "    2. sudo -u ${APP_USER} pm2 restart ai-orchestrator"
echo -e "    3. 브라우저에서 ${BASE_URL}/admin 접속 확인"
echo ""
echo -e "  🛠️  유용한 명령어:"
echo -e "    pm2 status                              # 앱 상태 확인"
echo -e "    sudo -u ${APP_USER} pm2 logs --lines 50 # 최근 로그"
echo -e "    sudo -u ${APP_USER} pm2 restart ai-orchestrator  # 재시작"
echo -e "    nginx -t && systemctl reload nginx      # nginx 설정 재적용"
echo ""
