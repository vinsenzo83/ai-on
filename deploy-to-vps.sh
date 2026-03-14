#!/bin/bash
# ============================================
# VPS 자동 배포 스크립트 v2
# 수정 완료 후 자동 호출됨
# 사용법: ./deploy-to-vps.sh "커밋 메시지"
# ============================================

set -e

VPS_IP="144.172.93.226"
VPS_PW="4AqMC9n7TbJ3Cb"
VPS_DIR="/opt/ai-orchestrator/app/ai-orchestrator"
REPO="https://github.com/vinsenzo83/ai-on.git"
BRANCH="genspark_ai_developer"
COMMIT_MSG="${1:-chore: auto-deploy}"

echo "🚀 배포 시작: $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ──────────────────────────────────────────
# STEP 1: Sandbox → GitHub push
# ──────────────────────────────────────────
echo ""
echo "📦 [1/5] Sandbox → GitHub (ai-on.git / $BRANCH)"
cd /home/user/webapp

# 브랜치 확인
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  git checkout $BRANCH 2>/dev/null || git checkout -b $BRANCH
fi

# 변경사항 커밋
if git diff --quiet && git diff --cached --quiet; then
  echo "  ℹ️  변경사항 없음 - 커밋 스킵"
else
  git add -A
  git commit -m "$COMMIT_MSG"
  echo "  ✅ 커밋: $COMMIT_MSG"
fi

# GitHub push
git push origin $BRANCH 2>&1
echo "  ✅ GitHub 푸시 완료"

# ──────────────────────────────────────────
# STEP 2: VPS → GitHub pull (hard reset)
# ──────────────────────────────────────────
echo ""
echo "🖥️  [2/5] VPS 코드 동기화 (github → vps)"
sshpass -p "$VPS_PW" ssh -o StrictHostKeyChecking=no root@$VPS_IP "
  set -e
  cd $VPS_DIR
  git remote set-url origin $REPO 2>/dev/null
  git fetch origin
  git reset --hard origin/$BRANCH
  echo '  ✅ VPS 코드 동기화 완료'
  echo \"  현재 커밋: \$(git log --oneline -1)\"
"

# ──────────────────────────────────────────
# STEP 3: 문법 체크
# ──────────────────────────────────────────
echo ""
echo "🔍 [3/5] 문법 체크"
SYNTAX_OK=$(sshpass -p "$VPS_PW" ssh -o StrictHostKeyChecking=no root@$VPS_IP "
  cd $VPS_DIR
  ERR=0
  node --check src/server.js 2>&1 && echo 'server.js OK' || { echo 'server.js ERROR'; ERR=1; }
  node --check src/types/index.js 2>&1 && echo 'types/index.js OK' || { echo 'types/index.js ERROR'; ERR=1; }
  node --check src/services/aiConnector.js 2>&1 && echo 'aiConnector.js OK' || { echo 'aiConnector.js ERROR'; ERR=1; }
  exit \$ERR
")
echo "$SYNTAX_OK" | sed 's/^/  /'
if echo "$SYNTAX_OK" | grep -q "ERROR"; then
  echo "  ❌ 문법 오류 발견 - 배포 중단!"
  exit 1
fi
echo "  ✅ 모든 파일 문법 OK"

# ──────────────────────────────────────────
# STEP 4: PM2 재시작
# ──────────────────────────────────────────
echo ""
echo "🔄 [4/5] PM2 재시작"
sshpass -p "$VPS_PW" ssh -o StrictHostKeyChecking=no root@$VPS_IP "
  pm2 restart ai-orchestrator --update-env 2>&1 | grep -E '(✓|error|online|errored)' | head -5
  sleep 4
  STATUS=\$(pm2 jlist 2>/dev/null | node -e \"
    const d=[];process.stdin.on('data',c=>d.push(c));
    process.stdin.on('end',()=>{
      try{
        const list=JSON.parse(d.join(''));
        const p=list.find(x=>x.name==='ai-orchestrator');
        console.log(p ? p.pm2_env.status : 'not found');
      }catch(e){console.log('parse error');}
    })
  \")
  echo \"  PM2 상태: \$STATUS\"
"

# ──────────────────────────────────────────
# STEP 5: 헬스체크
# ──────────────────────────────────────────
echo ""
echo "❤️  [5/5] 헬스체크"
HEALTH=$(sshpass -p "$VPS_PW" ssh -o StrictHostKeyChecking=no root@$VPS_IP "
  sleep 2
  curl -s --max-time 10 http://localhost:3000/health 2>/dev/null || echo '{\"status\":\"unreachable\"}'
")
echo "  응답: $HEALTH"

if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "  ✅ 서버 정상 작동"
else
  echo "  ❌ 서버 응답 이상 - PM2 로그 확인 필요"
  sshpass -p "$VPS_PW" ssh -o StrictHostKeyChecking=no root@$VPS_IP "pm2 logs ai-orchestrator --nostream --lines 5 2>&1 | tail -8"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 배포 완료: $(date '+%Y-%m-%d %H:%M:%S')"
echo "   브랜치: $BRANCH"
echo "   커밋: $(cd /home/user/webapp && git log --oneline -1)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
