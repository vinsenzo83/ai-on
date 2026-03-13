#!/bin/bash
# ============================================================
# AI Orchestrator — 코드 업데이트 스크립트 (무중단 배포)
# 사용법: bash update.sh [--branch BRANCH]
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }

APP_DIR="/opt/ai-orchestrator"
APP_USER="aiorch"
BRANCH="${1:-genspark_ai_developer}"
APP_PATH="${APP_DIR}/app/ai-orchestrator"

info "브랜치 '${BRANCH}' 에서 최신 코드 가져오기..."

# 1. Git pull
cd "${APP_DIR}/app"
git fetch origin
git checkout "${BRANCH}"
git pull origin "${BRANCH}"
success "코드 업데이트 완료"

# 2. 의존성 업데이트
cd "${APP_PATH}"
npm ci --only=production --quiet
success "npm 패키지 업데이트 완료"

# 3. PM2 무중단 재시작 (reload = graceful restart)
pm2 reload ai-orchestrator --update-env
success "앱 재시작 완료 (무중단)"

# 4. 헬스체크
sleep 3
if curl -sf http://localhost:3000/health > /dev/null; then
  success "✅ 헬스체크 통과"
  pm2 status
else
  warn "⚠️  헬스체크 실패 — 로그 확인:"
  pm2 logs ai-orchestrator --lines 20 --nostream
fi

