#!/bin/bash
# ============================================================
# AI Orchestrator — VPS .env API 키 업데이트 스크립트
# 사용법: bash update-env.sh
# 실행 위치: VPS (root@144.172.93.226)
#
# ⚠️  주의: 실제 API 키는 이 파일에 직접 기재하지 마세요.
#     대신 아래 방법 중 하나를 사용하세요:
#
#     방법1) 환경변수로 전달:
#       export OPENAI_KEY="sk-proj-..." && bash update-env.sh
#
#     방법2) VPS에서 직접 편집:
#       nano /opt/ai-orchestrator/app/ai-orchestrator/.env
#       pm2 restart ai-orchestrator --update-env
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

ENV_FILE="/opt/ai-orchestrator/app/ai-orchestrator/.env"

if [ ! -f "$ENV_FILE" ]; then
  error ".env 파일이 없습니다: $ENV_FILE"
fi

info ".env API 키 업데이트 시작..."

# sed를 이용해 각 키 값을 교체 (키가 없으면 append)
update_env() {
  local key="$1"
  local val="$2"
  if [ -z "$val" ]; then
    warn "  ${key} — 값이 비어있어 건너뜁니다 (환경변수로 전달하세요)"
    return
  fi
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    success "  ${key} 업데이트 완료"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
    success "  ${key} 추가 완료"
  fi
}

# ── 환경변수에서 API 키 읽기 (직접 실행 시 export로 전달) ──────────
# 사용 예:
#   export OPENAI_KEY="sk-proj-..."
#   export ANTHROPIC_KEY="sk-ant-..."
#   export GOOGLE_KEY="AIzaSy..."
#   export DEEPSEEK_KEY="sk-..."
#   export XAI_KEY="xai-..."
#   export MOONSHOT_KEY="sk-..."
#   export MISTRAL_KEY="lg192..."
#   bash update-env.sh

update_env "OPENAI_API_KEY"    "${OPENAI_KEY:-}"
update_env "ANTHROPIC_API_KEY" "${ANTHROPIC_KEY:-}"
update_env "GOOGLE_API_KEY"    "${GOOGLE_KEY:-}"
update_env "GEMINI_API_KEY"    "${GOOGLE_KEY:-}"
update_env "DEEPSEEK_API_KEY"  "${DEEPSEEK_KEY:-}"
update_env "XAI_API_KEY"       "${XAI_KEY:-}"
update_env "MOONSHOT_API_KEY"  "${MOONSHOT_KEY:-}"
update_env "MISTRAL_API_KEY"   "${MISTRAL_KEY:-}"

# 파일 권한 유지
chmod 600 "$ENV_FILE"
success ".env 파일 권한 설정 완료 (600)"

info "PM2 재시작 (환경변수 적용)..."
pm2 restart ai-orchestrator --update-env
sleep 3

if curl -sf http://localhost:3000/health > /dev/null; then
  success "✅ 헬스체크 통과 — API 키 업데이트 완료!"
  echo ""
  info "Provider 상태 확인:"
  curl -s http://localhost:3000/api/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3000/api/health
else
  warn "⚠️ 헬스체크 실패 — 로그 확인:"
  pm2 logs ai-orchestrator --lines 20 --nostream
fi
