/**
 * ecosystem.vps.config.js — VPS 프로덕션 PM2 설정
 * 사용법:
 *   pm2 start ecosystem.vps.config.js
 *   pm2 start ecosystem.vps.config.js --env production
 *
 * ⚠️  API 키는 이 파일에 직접 입력하지 말고
 *     .env 파일 또는 시스템 환경변수를 사용하세요.
 */

const path = require('path');

// 앱 루트 (이 파일 위치 기준)
const APP_ROOT = path.join(__dirname, '..');

module.exports = {
  apps: [
    // ── 메인 서버 ────────────────────────────────────────
    {
      name: 'ai-orchestrator',
      script: path.join(APP_ROOT, 'src/server.js'),
      cwd: APP_ROOT,
      instances: 1,           // CPU 코어 수에 맞게 조절 (cluster mode: 'max')
      exec_mode: 'fork',      // cluster 모드 필요시 'cluster'로 변경
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      // 환경변수 (.env 파일 우선 적용)
      env_file: path.join(APP_ROOT, '.env'),

      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },

      // 로그
      error_file: '/opt/ai-orchestrator/logs/app-error.log',
      out_file:   '/opt/ai-orchestrator/logs/app-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      log_type: 'json',

      // 안정성
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,

      // 종료 시그널
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 15000,
    }
  ]
};
