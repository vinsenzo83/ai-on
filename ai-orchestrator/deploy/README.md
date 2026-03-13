# 🚀 AI Orchestrator — VPS 배포 가이드

## 요구사항

| 항목 | 최소 사양 | 권장 사양 |
|------|-----------|-----------|
| OS | Ubuntu 20.04 LTS | Ubuntu 22.04 LTS |
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| 디스크 | 10 GB | 20 GB |
| Node.js | 18.x | 20.x LTS |

---

## 방법 1: 자동 배포 스크립트 (권장)

```bash
# 1. 스크립트 다운로드
curl -fsSL https://raw.githubusercontent.com/vinsenzo83/kbeauty-autocommerce/genspark_ai_developer/ai-orchestrator/deploy/deploy.sh -o deploy.sh

# 2. 도메인 없이 바로 배포 (IP 접근)
sudo bash deploy.sh --no-ssl

# 3. 도메인 + SSL 자동 발급
sudo bash deploy.sh --domain api.your-domain.com

# 4. 배포 후 환경변수 설정 (필수!)
sudo nano /opt/ai-orchestrator/app/ai-orchestrator/.env
```

---

## 방법 2: 수동 배포 (단계별)

### 1단계: Node.js 설치

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
node -v && pm2 -v
```

### 2단계: 앱 배포

```bash
# 디렉토리 생성
sudo mkdir -p /opt/ai-orchestrator/{data,logs,backups}
sudo useradd -r -s /bin/bash -d /opt/ai-orchestrator -m aiorch
sudo chown -R aiorch:aiorch /opt/ai-orchestrator

# 저장소 클론
sudo -u aiorch git clone \
  --branch genspark_ai_developer \
  https://github.com/vinsenzo83/kbeauty-autocommerce.git \
  /opt/ai-orchestrator/app

# 의존성 설치
cd /opt/ai-orchestrator/app/ai-orchestrator
sudo -u aiorch npm ci --only=production

# 데이터 디렉토리 심링크
sudo -u aiorch ln -s /opt/ai-orchestrator/data ./data
sudo -u aiorch ln -s /opt/ai-orchestrator/logs ./logs
```

### 3단계: 환경변수 설정

```bash
# 환경변수 파일 생성
sudo cp deploy/.env.production .env
sudo nano .env  # API 키 입력

# 권한 설정 (보안!)
sudo chmod 600 .env
sudo chown aiorch:aiorch .env
```

**필수 설정 항목:**
```bash
NODE_ENV=production
PORT=3000
JWT_SECRET=<64자 랜덤 문자열>  # node -e "require('crypto').randomBytes(64).toString('hex')|console.log"
ADMIN_EMAIL=admin@your-domain.com
ADMIN_PASSWORD=<강력한 비밀번호>
OPENAI_API_KEY=sk-proj-...        # 최소 1개 이상 필요
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 4단계: PM2로 앱 시작

```bash
# PM2 시작
sudo -u aiorch pm2 start deploy/ecosystem.vps.config.js

# 부팅 자동시작
sudo -u aiorch pm2 startup
# (출력된 sudo 명령어 실행)
sudo -u aiorch pm2 save

# 상태 확인
sudo -u aiorch pm2 status
```

### 5단계: Nginx 설정

```bash
# 설정 파일 복사
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ai-orchestrator
sudo ln -s /etc/nginx/sites-available/ai-orchestrator /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 설정 검증 및 적용
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl enable nginx
```

### 6단계: SSL 인증서 (도메인 있을 경우)

```bash
sudo certbot --nginx -d your-domain.com \
  --email admin@your-domain.com \
  --agree-tos --no-eff-email
```

### 7단계: 배포 검증

```bash
bash deploy/verify.sh http://YOUR_SERVER_IP
# 또는
bash deploy/verify.sh https://your-domain.com
```

---

## 업데이트 배포

```bash
# 최신 코드 무중단 배포
sudo bash /opt/ai-orchestrator/app/ai-orchestrator/deploy/update.sh

# 또는 수동
cd /opt/ai-orchestrator/app
sudo -u aiorch git pull origin genspark_ai_developer
cd ai-orchestrator && sudo -u aiorch npm ci --only=production
sudo -u aiorch pm2 reload ai-orchestrator
```

---

## 관리 명령어

```bash
# PM2 상태 / 로그
sudo -u aiorch pm2 status
sudo -u aiorch pm2 logs ai-orchestrator --lines 100
sudo -u aiorch pm2 logs ai-orchestrator --lines 50 --nostream  # 최근 50줄

# 앱 재시작 / 정지
sudo -u aiorch pm2 restart ai-orchestrator
sudo -u aiorch pm2 stop ai-orchestrator

# DB 백업
cp /opt/ai-orchestrator/data/orchestrator.db \
   /opt/ai-orchestrator/backups/orchestrator_$(date +%Y%m%d_%H%M%S).db

# Nginx 로그
sudo tail -f /var/log/nginx/ai-orchestrator-access.log
sudo tail -f /var/log/nginx/ai-orchestrator-error.log
```

---

## 엔드포인트 목록

| URL | 설명 |
|-----|------|
| `/` | 메인 앱 |
| `/admin` | Admin 패널 |
| `/health` | 헬스체크 |
| `/health-dashboard.html` | Provider 헬스 대시보드 |
| `POST /api/auth/login` | 로그인 |
| `POST /api/beta/register` | 베타 가입 (초대 코드) |
| `POST /api/ai/chat` | AI 채팅 |
| `POST /api/ai/chat/stream` | SSE 스트리밍 |
| `GET /api/ai/status` | Provider 상태 |

---

## 방화벽 설정

```bash
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 문제 해결

### 앱이 시작되지 않는 경우
```bash
sudo -u aiorch pm2 logs ai-orchestrator --err --lines 30
# → .env 파일 확인, API 키 형식 오류 여부 체크
```

### SSE 스트리밍이 작동하지 않는 경우
Nginx 설정에 `proxy_buffering off` 및 `X-Accel-Buffering: no` 헤더 확인:
```nginx
location /api/ai/chat/stream {
    proxy_buffering off;
    add_header X-Accel-Buffering "no";
}
```

### 포트 3000 방화벽 오류
```bash
# 외부 직접 접근 차단 (nginx 통해서만 접근)
sudo ufw deny 3000/tcp
```

### DB 초기화 필요시
```bash
sudo -u aiorch pm2 stop ai-orchestrator
sudo rm /opt/ai-orchestrator/data/orchestrator.db
sudo -u aiorch pm2 start ai-orchestrator
# → 새 DB 자동 생성 + 어드민 계정 재생성
```
