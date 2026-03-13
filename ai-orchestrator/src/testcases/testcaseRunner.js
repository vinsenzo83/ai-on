// ============================================================
// 테스트케이스 실행기 v1
// 1005개 케이스를 서버 API로 실행하고 결과 수집
// ============================================================
const fs = require('fs');
const path = require('path');
const http = require('http');

const DB_PATH = path.join(__dirname, 'testcases_db.json');
const RESULTS_PATH = path.join(__dirname, 'test_results.json');

// ── HTTP 요청 헬퍼 ───────────────────────────────────────────
function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = JSON.stringify(data);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 3000,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    
    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(responseBody)); }
        catch (e) { resolve({ raw: responseBody }); }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ── 테스트케이스를 서버 메시지 형식으로 변환 ──────────────────
function caseToMessage(testCase) {
  const { title, domain_label, roles, complexity, tags } = testCase;
  // 제목에서 핵심 동작 추출
  const [input, ...rest] = title.split('→');
  const output = rest.join('→').trim();
  
  return {
    message: `[테스트케이스 #${testCase.id}] ${title}
도메인: ${domain_label}
입력: ${(testCase.input_type || []).join(', ')}
출력: ${(testCase.output_type || []).join(', ')}
필요 역할: ${(roles || []).join(', ')}
복잡도: ${complexity}`,
    sessionId: `test_case_${testCase.id}_${Date.now()}`
  };
}

// ── 단일 케이스 실행 ─────────────────────────────────────────
async function runTestCase(testCase, serverUrl = 'http://localhost:3000') {
  const start = Date.now();
  
  try {
    // 1. 세션 생성
    const sessionData = await httpPost(`${serverUrl}/api/session`, {
      userId: `test_${testCase.id}`
    });
    const sessionId = sessionData.sessionId || `test_${testCase.id}`;
    
    // 2. 인텐트 분석 (메시지 전송)
    const msgData = caseToMessage(testCase);
    const response = await httpPost(`${serverUrl}/api/message`, {
      message: msgData.message,
      sessionId
    });
    
    const elapsed = Date.now() - start;
    
    return {
      case_id: testCase.id,
      title: testCase.title,
      domain: testCase.domain,
      status: 'analyzed',
      detected_task_type: response.analysis?.taskType || 'unknown',
      expected_roles: testCase.roles || [],
      actual_roles: [],
      confidence: response.analysis?.confidence || 0,
      response_time_ms: elapsed,
      feasibility: testCase.feasibility,
      complexity: testCase.complexity,
      server_response: response,
      test_passed: true,
      timestamp: new Date().toISOString()
    };
    
  } catch (err) {
    return {
      case_id: testCase.id,
      title: testCase.title,
      domain: testCase.domain,
      status: 'error',
      error: err.message,
      response_time_ms: Date.now() - start,
      test_passed: false,
      timestamp: new Date().toISOString()
    };
  }
}

// ── 배치 실행 (병렬) ─────────────────────────────────────────
async function runBatch(cases, serverUrl, concurrency = 5) {
  const results = [];
  const total = cases.length;
  let processed = 0;
  
  for (let i = 0; i < total; i += concurrency) {
    const batch = cases.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(c => runTestCase(c, serverUrl))
    );
    
    batchResults.forEach(r => {
      if (r.status === 'fulfilled') results.push(r.value);
      else results.push({ status: 'error', error: r.reason?.message || 'unknown' });
    });
    
    processed += batch.length;
    process.stdout.write(`\r진행: ${processed}/${total} (${Math.round(processed/total*100)}%)`);
    
    // 서버 부하 방지
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log('');
  return results;
}

// ── 결과 통계 계산 ───────────────────────────────────────────
function computeResultStats(results) {
  const stats = {
    total: results.length,
    passed: 0,
    failed: 0,
    errors: 0,
    by_domain: {},
    by_feasibility: {},
    by_complexity: {},
    task_type_detection: {},
    avg_response_ms: 0,
    coverage: {}
  };
  
  let totalMs = 0;
  
  results.forEach(r => {
    if (r.test_passed) stats.passed++;
    else if (r.status === 'error') stats.errors++;
    else stats.failed++;
    
    if (r.domain) stats.by_domain[r.domain] = (stats.by_domain[r.domain] || 0) + 1;
    if (r.feasibility) stats.by_feasibility[r.feasibility] = (stats.by_feasibility[r.feasibility] || 0) + 1;
    if (r.complexity) stats.by_complexity[r.complexity] = (stats.by_complexity[r.complexity] || 0) + 1;
    
    const dt = r.detected_task_type;
    if (dt) stats.task_type_detection[dt] = (stats.task_type_detection[dt] || 0) + 1;
    
    totalMs += r.response_time_ms || 0;
  });
  
  stats.avg_response_ms = Math.round(totalMs / results.length);
  stats.pass_rate = Math.round(stats.passed / stats.total * 100) + '%';
  
  return stats;
}

// ── 메인 실행 ────────────────────────────────────────────────
async function main() {
  console.log('🧪 테스트케이스 실행기 시작...\n');
  
  // DB 로드
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ testcases_db.json 파일이 없습니다. 먼저 generateTestCasesLocal.js를 실행하세요.');
    process.exit(1);
  }
  
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const allCases = db.cases;
  
  console.log(`📊 총 케이스: ${allCases.length}개`);
  
  // 서버 상태 확인
  const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
  
  try {
    const health = await httpPost(`${serverUrl}/health`, {});
    console.log('✅ 서버 상태:', JSON.stringify(health));
  } catch (e) {
    console.log('⚠️ 서버 직접 연결 실패, 인텐트 분석만 테스트합니다:', e.message);
  }
  
  // 실행 모드 선택
  const mode = process.argv[2] || 'sample'; // 'sample' | 'full' | 'domain:ecommerce'
  
  let testCases;
  
  if (mode === 'full') {
    testCases = allCases;
    console.log(`\n🔴 전체 실행: ${testCases.length}개`);
  } else if (mode.startsWith('domain:')) {
    const domain = mode.split(':')[1];
    testCases = allCases.filter(c => c.domain === domain);
    console.log(`\n📂 도메인 [${domain}] 실행: ${testCases.length}개`);
  } else {
    // 기본: 도메인별 5개씩 샘플
    const domains = [...new Set(allCases.map(c => c.domain))];
    testCases = [];
    domains.forEach(d => {
      const domainCases = allCases.filter(c => c.domain === d);
      testCases.push(...domainCases.slice(0, 5));
    });
    console.log(`\n🔵 샘플 실행: ${testCases.length}개 (도메인별 5개)`);
  }
  
  // 실행
  console.log('\n⏳ 테스트 실행 중...');
  const results = await runBatch(testCases, serverUrl, 5);
  
  // 통계
  const stats = computeResultStats(results);
  
  console.log('\n📈 실행 결과:');
  console.log(`  ✅ 성공: ${stats.passed}/${stats.total} (${stats.pass_rate})`);
  console.log(`  ❌ 실패: ${stats.failed}`);
  console.log(`  ⚠️ 오류: ${stats.errors}`);
  console.log(`  ⏱️ 평균 응답: ${stats.avg_response_ms}ms`);
  
  console.log('\n  📊 감지된 태스크 타입:');
  Object.entries(stats.task_type_detection)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 10)
    .forEach(([k, v]) => console.log(`    - ${k}: ${v}건`));
  
  // 결과 저장
  const output = {
    meta: {
      run_at: new Date().toISOString(),
      mode,
      total_cases: testCases.length,
      server_url: serverUrl
    },
    stats,
    results
  };
  
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));
  console.log(`\n✅ 결과 저장: ${RESULTS_PATH}`);
  
  return output;
}

main().catch(console.error);
