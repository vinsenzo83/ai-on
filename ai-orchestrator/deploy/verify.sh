#!/bin/bash
# ============================================================
# AI Orchestrator — 배포 검증 스크립트
# 사용법: bash verify.sh [BASE_URL]
# ============================================================
set -uo pipefail

BASE_URL="${1:-http://localhost}"
PASS=0; FAIL=0; WARN=0

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✅ PASS${NC}  $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC}  $1"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}⚠️  WARN${NC}  $1"; ((WARN++)); }

echo ""
echo "🔍 AI Orchestrator 배포 검증"
echo "   URL: ${BASE_URL}"
echo "============================================="

# 1. 헬스체크
echo -e "\n[1] 기본 헬스체크"
R=$(curl -sf "${BASE_URL}/health" 2>/dev/null || echo "ERR")
if echo "$R" | grep -q '"status":"ok"'; then
  ok "/health → status:ok"
  echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'      OpenAI: {d.get(\"hasOpenAI\")}, Anthropic: {d.get(\"hasAnthropic\")}')" 2>/dev/null || true
else
  fail "/health 응답 실패: $R"
fi

# 2. Admin 페이지
echo -e "\n[2] Admin UI"
S=$(curl -so /dev/null -w "%{http_code}" "${BASE_URL}/admin" 2>/dev/null || echo "0")
[[ "$S" == "200" ]] && ok "/admin → $S" || fail "/admin → $S"

S=$(curl -so /dev/null -w "%{http_code}" "${BASE_URL}/health-dashboard.html" 2>/dev/null || echo "0")
[[ "$S" == "200" ]] && ok "/health-dashboard.html → $S" || fail "/health-dashboard.html → $S"

# 3. 인증 API
echo -e "\n[3] 인증 API"
R=$(curl -sf -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ai-orch.local","password":"admin1234"}' 2>/dev/null || echo "ERR")
if echo "$R" | grep -q '"token"'; then
  ok "POST /api/auth/login → token 발급 성공"
  TOKEN=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "")
else
  fail "POST /api/auth/login 실패"
  TOKEN=""
fi

# 4. AI 상태
echo -e "\n[4] AI 공급자 상태"
R=$(curl -sf "${BASE_URL}/api/ai/status" 2>/dev/null || echo "ERR")
if echo "$R" | grep -q '"success":true'; then
  OPENAI=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['providers'].get('openai',{}).get('available','?'))" 2>/dev/null || echo "?")
  ANTHROPIC=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['providers'].get('anthropic',{}).get('available','?'))" 2>/dev/null || echo "?")
  ok "GET /api/ai/status → OpenAI:${OPENAI}, Anthropic:${ANTHROPIC}"
  if [[ "$OPENAI" != "True" && "$OPENAI" != "true" ]]; then
    warn "OpenAI 공급자 비활성 — .env의 OPENAI_API_KEY 확인 필요"
  fi
else
  fail "GET /api/ai/status 실패"
fi

# 5. 기본 채팅 API
echo -e "\n[5] AI 채팅 API"
R=$(curl -sf -X POST "${BASE_URL}/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say OK"}],"strategy":"fast","maxTokens":5}' 2>/dev/null || echo "ERR")
if echo "$R" | grep -q '"success":true'; then
  MODEL=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('model','?'))" 2>/dev/null || echo "?")
  ok "POST /api/ai/chat → model:${MODEL}"
else
  warn "POST /api/ai/chat 실패 (API 키 미설정 가능) → ${R:0:100}"
fi

# 6. 인증 보안
echo -e "\n[6] 보안 검증"
S=$(curl -so /dev/null -w "%{http_code}" "${BASE_URL}/api/ai/cache/stats" 2>/dev/null || echo "0")
[[ "$S" == "401" ]] && ok "cache/stats 비인증 → 401 차단" || fail "cache/stats 비인증 → ${S} (401 기대)"

S=$(curl -so /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/ai/cache/clear" 2>/dev/null || echo "0")
[[ "$S" == "401" ]] && ok "cache/clear 비인증 → 401 차단" || fail "cache/clear 비인증 → ${S} (401 기대)"

# 7. SSE 스트리밍
echo -e "\n[7] SSE 스트리밍"
CHUNKS=$(curl -sf -X POST "${BASE_URL}/api/ai/chat/stream" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"messages":[{"role":"user","content":"Say hi"}],"strategy":"fast","maxTokens":20}' \
  --max-time 15 2>/dev/null | grep -c "event: chunk" || echo "0")
if [[ "$CHUNKS" -ge 1 ]]; then
  ok "SSE 스트리밍 → ${CHUNKS} 청크 수신"
else
  warn "SSE 스트리밍 응답 없음 (Nginx buffering 확인 필요)"
fi

# 8. Nginx 헤더 확인
echo -e "\n[8] Nginx / 보안 헤더"
HEADERS=$(curl -sI "${BASE_URL}/" 2>/dev/null || echo "")
echo "$HEADERS" | grep -qi "X-Frame-Options" && ok "X-Frame-Options 헤더 존재" || warn "X-Frame-Options 헤더 없음"
echo "$HEADERS" | grep -qi "X-Content-Type-Options" && ok "X-Content-Type-Options 헤더 존재" || warn "X-Content-Type-Options 헤더 없음"

# ── 최종 결과 ──────────────────────────────────────────────
echo ""
echo "============================================="
echo -e "  결과: ${GREEN}${PASS} PASS${NC}  ${YELLOW}${WARN} WARN${NC}  ${RED}${FAIL} FAIL${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}❌ 배포 검증 실패 — 위의 FAIL 항목을 확인하세요.${NC}"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo -e "  ${YELLOW}⚠️  배포 완료 (경고 있음) — .env 파일의 API 키를 확인하세요.${NC}"
  exit 0
else
  echo -e "  ${GREEN}✅ 배포 검증 완료!${NC}"
  exit 0
fi
