/**
 * autoScheduler.js
 * 24시간 자동 사이클 스케줄러
 * 
 * 실행 방법:
 *   node autoScheduler.js          # 즉시 1회 실행 후 24시간 루프
 *   node autoScheduler.js --now    # 즉시 1회만 실행
 *   node autoScheduler.js --dry    # 드라이런 (DB 저장 없음)
 * 
 * PM2로 데몬 실행:
 *   pm2 start autoScheduler.js --name testcase-scheduler --cron "0 3 * * *"
 */

'use strict';

const path = require('path');
const fs = require('fs');

const { runDailyCycle } = require('./dailyCycleEngine');

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
const CONFIG = {
  // 매일 몇 시에 실행할지 (0~23)
  runHour: 3,          // 새벽 3시
  runMinute: 0,

  // 사이클당 생성할 케이스 수
  targetPerCycle: 50,

  // 로그 경로
  schedulerLogPath: path.join(__dirname, 'scheduler.log'),

  // 상태 파일 (PM2 재시작 시 이전 실행 시간 확인)
  statusPath: path.join(__dirname, 'scheduler_status.json')
};

// ─────────────────────────────────────────────
// 로깅
// ─────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  // 파일에도 append
  try {
    fs.appendFileSync(CONFIG.schedulerLogPath, line + '\n');
  } catch (_) {}
}

// ─────────────────────────────────────────────
// 상태 관리
// ─────────────────────────────────────────────
function loadStatus() {
  if (!fs.existsSync(CONFIG.statusPath)) {
    return { lastRunAt: null, totalCycles: 0, totalCasesAdded: 0 };
  }
  return JSON.parse(fs.readFileSync(CONFIG.statusPath, 'utf8'));
}

function saveStatus(status) {
  fs.writeFileSync(CONFIG.statusPath, JSON.stringify(status, null, 2));
}

// ─────────────────────────────────────────────
// 다음 실행까지 남은 ms 계산
// ─────────────────────────────────────────────
function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(CONFIG.runHour, CONFIG.runMinute, 0, 0);

  // 오늘 실행 시간이 이미 지났으면 내일로
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

function formatDuration(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

// ─────────────────────────────────────────────
// 단일 사이클 실행
// ─────────────────────────────────────────────
async function executeCycle(isDry = false) {
  log('=== 사이클 시작 ===');

  if (isDry) {
    log('[DRY RUN] 실제 DB 변경 없음');
    return { success: true, dry: true };
  }

  try {
    const result = await runDailyCycle({ targetPerCycle: CONFIG.targetPerCycle });

    const status = loadStatus();
    status.lastRunAt = new Date().toISOString();
    status.totalCycles = (status.totalCycles || 0) + 1;
    status.totalCasesAdded = (status.totalCasesAdded || 0) + (result.summary?.added || 0);
    status.lastResult = {
      cycleId: result.cycleId,
      success: result.success,
      added: result.summary?.added,
      durationMs: result.durationMs
    };
    saveStatus(status);

    log(`=== 사이클 완료: 케이스 +${result.summary?.added || 0}, 총 ${status.totalCasesAdded}개 추가 ===`);
    return result;

  } catch (err) {
    log(`=== 사이클 오류: ${err.message} ===`);
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────
// 24시간 루프
// ─────────────────────────────────────────────
async function startScheduler(options = {}) {
  log('📅 24시간 자동 스케줄러 시작');
  log(`   실행 시각: 매일 ${String(CONFIG.runHour).padStart(2,'0')}:${String(CONFIG.runMinute).padStart(2,'0')}`);
  log(`   케이스/사이클: ${CONFIG.targetPerCycle}개`);

  const status = loadStatus();
  log(`   누적 사이클: ${status.totalCycles || 0}회, 누적 케이스: ${status.totalCasesAdded || 0}개`);
  if (status.lastRunAt) log(`   마지막 실행: ${status.lastRunAt}`);

  // --now 플래그: 즉시 1회 실행 후 종료
  if (options.runNow) {
    log('--now 플래그: 즉시 1회 실행');
    const r = await executeCycle(options.dry);
    printSummary(r);
    return;
  }

  // 즉시 1회 실행 (첫 시작 시)
  if (options.runOnStart) {
    log('서버 시작 즉시 1회 실행');
    await executeCycle(options.dry);
  }

  // 24시간 반복 루프
  const scheduleNext = () => {
    const waitMs = msUntilNextRun();
    log(`⏰ 다음 실행까지: ${formatDuration(waitMs)} (${new Date(Date.now() + waitMs).toISOString()})`);

    setTimeout(async () => {
      await executeCycle(options.dry);
      scheduleNext(); // 재스케줄
    }, waitMs);
  };

  scheduleNext();
}

// ─────────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────────
function printSummary(result) {
  if (!result) return;
  console.log('\n' + '='.repeat(50));
  console.log('📊 사이클 결과 요약');
  console.log('='.repeat(50));
  if (result.dry) {
    console.log('  DRY RUN - 실제 변경 없음');
    return;
  }
  if (!result.success) {
    console.log('  ❌ 실패:', result.error);
    return;
  }
  const s = result.summary || {};
  console.log(`  ✅ 성공`);
  console.log(`  📁 케이스: ${s.before} → ${s.after} (+${s.added})`);
  if (s.patchResult) {
    const p = s.patchResult;
    console.log(`  🔧 패치: roles +${p.rolesAdded}, combos +${p.combosAdded}, tasks +${p.taskTypesAdded}`);
  }
  if (s.topMissingTech && s.topMissingTech.length > 0) {
    console.log(`  🔍 Top 부족기술: ${s.topMissingTech.slice(0,3).map(x=>x[0]).join(', ')}`);
  }
  console.log(`  ⏱  소요: ${result.durationMs}ms`);
  console.log('='.repeat(50) + '\n');
}

// ─────────────────────────────────────────────
// 현재 상태 조회
// ─────────────────────────────────────────────
function showStatus() {
  const status = loadStatus();
  console.log('\n📊 스케줄러 상태:');
  console.log(JSON.stringify(status, null, 2));

  // testcases_db.json 확인
  const dbPath = path.join(__dirname, 'testcases_db.json');
  if (fs.existsSync(dbPath)) {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    console.log(`\n📁 DB 현황: ${db.cases?.length || 0}개 케이스`);
    console.log('  도메인별:', JSON.stringify(db.stats?.by_domain || {}));
  }

  // 마지막 리포트
  const reportPath = path.join(__dirname, 'daily_report.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log(`\n📋 마지막 리포트: ${report.generatedAt}`);
    console.log('  요약:', JSON.stringify(report.summary || {}));
  }
}

// ─────────────────────────────────────────────
// PM2 ecosystem 설정 생성
// ─────────────────────────────────────────────
function generatePM2Config() {
  const config = {
    apps: [{
      name: 'testcase-scheduler',
      script: path.join(__dirname, 'autoScheduler.js'),
      args: '--run-on-start',
      cwd: path.join(__dirname, '../..'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production'
      },
      log_file: path.join(__dirname, 'pm2_combined.log'),
      out_file: path.join(__dirname, 'pm2_out.log'),
      error_file: path.join(__dirname, 'pm2_err.log'),
      time: true,
      // cron: 매일 새벽 3시 실행 (백업 방어장치)
      cron_restart: `${CONFIG.runMinute} ${CONFIG.runHour} * * *`
    }]
  };

  const configPath = path.join(__dirname, '../../ecosystem.testcases.config.js');
  fs.writeFileSync(configPath, `module.exports = ${JSON.stringify(config, null, 2)};\n`);
  console.log(`PM2 설정 저장: ${configPath}`);
  console.log('\n실행 방법:');
  console.log('  pm2 start ecosystem.testcases.config.js');
  console.log('  pm2 logs testcase-scheduler');
  console.log('  pm2 status');
  return configPath;
}

// ─────────────────────────────────────────────
// CLI 진입점
// ─────────────────────────────────────────────
const args = process.argv.slice(2);

if (require.main === module) {
  if (args.includes('--status')) {
    showStatus();
  } else if (args.includes('--gen-pm2')) {
    generatePM2Config();
  } else {
    const isDry = args.includes('--dry');
    const runNow = args.includes('--now');
    const runOnStart = args.includes('--run-on-start');

    startScheduler({
      runNow,
      runOnStart,
      dry: isDry
    }).catch(err => {
      console.error('스케줄러 오류:', err);
      process.exit(1);
    });
  }
}

module.exports = { startScheduler, executeCycle, loadStatus, showStatus, generatePM2Config };
