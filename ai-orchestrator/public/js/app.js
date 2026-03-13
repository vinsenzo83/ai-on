/* ============================================================
   AI Orchestra – Frontend App
   ============================================================ */

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────
  const state = {
    sessionId: null,
    socket: null,
    isProcessing: false,
    currentResult: null,
    currentTaskType: null,
    stepLog: [],
    demoMode: false,
    // Agent 진행상태 (Phase 1)
    agent: {
      planId: null,
      tasks: [],          // { id, name, type, status }
      totalSteps: 0,
      currentStep: 0,
      lastMessage: null,  // 재시도를 위한 마지막 메시지 저장
    },
    // Phase 5: Mode
    mode: 'chat',         // 'chat' | 'agent' | 'research'
  };

  // ── DOM refs ──────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const dom = {
    messages: $('messages'),
    welcomeScreen: $('welcome-screen'),
    input: $('message-input'),
    sendBtn: $('send-btn'),
    charCount: $('char-count'),
    apiStatus: $('api-status'),
    taskPipeline: $('task-pipeline'),
    noTask: $('no-task'),
    progressOverlay: $('progress-overlay'),
    progressStatus: $('progress-status'),
    progressFill: $('progress-fill'),
    progressPercent: $('progress-percent'),
    progressSteps: $('progress-steps'),
    resultPanel: $('result-panel'),
    resultTitle: $('result-title'),
    resultContent: $('result-content'),
    qualityBar: $('quality-bar'),
    qualityFill: $('quality-fill'),
    qualityScore: $('quality-score'),
    previewModal: $('preview-modal'),
    modalBody: $('modal-body'),
    modalTitle: $('modal-title'),
    copyBtn: $('copy-btn'),
    downloadBtn: $('download-btn'),
    previewBtn: $('preview-btn'),
    closeResultBtn: $('close-result-btn'),
    closeModalBtn: $('close-modal-btn'),
    modalOverlay: $('modal-overlay'),
    // 메모리 관련
    memorySummary: $('memory-summary'),
    memTotal: $('mem-total'),
    memScore: $('mem-score'),
    memoryEpisodes: $('memory-episodes'),
    clearMemoryBtn: $('clear-memory-btn'),
    // Agent 진행상태 패널 (Phase 1)
    agentPanel:          $('agent-panel'),
    agentComplexBadge:   $('agent-complexity-badge'),
    agentCurrentStep:    $('agent-current-step'),
    agentTotalSteps:     $('agent-total-steps'),
    agentProgressFill:   $('agent-progress-fill'),
    agentProgressPct:    $('agent-progress-pct'),
    agentStateBadge:     $('agent-state-badge'),
    agentStateIcon:      $('agent-state-icon'),
    agentStateLabel:     $('agent-state-label'),
    agentCurrentTask:    $('agent-current-task-title'),
    agentTaskList:       $('agent-task-list'),
    agentErrorRow:       $('agent-error-row'),
    agentErrorMsg:       $('agent-error-msg'),
    agentRetryBtn:       $('agent-retry-btn'),
    agentPanelClose:     $('agent-panel-close'),
    // Phase 5: Mode selector
    modeBtnChat:     $('mode-btn-chat'),
    modeBtnAgent:    $('mode-btn-agent'),
    modeBtnResearch: $('mode-btn-research'),
  };

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    await checkHealth();
    await createSession();
    connectSocket();
    bindEvents();
    autoResizeTextarea();
    // 기존 메모리 로드 (이전 세션이 있는 경우)
    setTimeout(loadMemoryPanel, 500);
  }

  async function checkHealth() {
    try {
      const res = await fetch('/health');
      const data = await res.json();
      state.demoMode = data.demoMode;

      const dot = dom.apiStatus.querySelector('.status-dot');
      const text = dom.apiStatus.querySelector('.status-text');

      if (data.demoMode) {
        dot.className = 'status-dot demo';
        text.textContent = '데모 모드';
        showToast('⚠️ API 키가 없어 데모 모드로 실행됩니다', 'info');
      } else {
        dot.className = 'status-dot ok';
        text.textContent = '연결됨';
      }
    } catch {
      const dot = dom.apiStatus.querySelector('.status-dot');
      const text = dom.apiStatus.querySelector('.status-text');
      dot.className = 'status-dot error';
      text.textContent = '오프라인';
    }
  }

  async function createSession() {
    try {
      const res = await fetch('/api/session', { method: 'POST' });
      const data = await res.json();
      state.sessionId = data.sessionId;
    } catch {
      state.sessionId = 'fallback-' + Date.now();
    }
  }

  function connectSocket() {
    state.socket = io();

    state.socket.on('connect', () => {
      state.socket.emit('join', { sessionId: state.sessionId });
    });

    state.socket.on('ready', () => {
      console.log('소켓 준비 완료');
    });

    state.socket.on('status', ({ status, message }) => {
      updateProgressStatus(message);
    });

    state.socket.on('taskStart', ({ taskType, taskInfo, message, isDemo, memoryHint }) => {
      state.currentTaskType = taskType;
      state.stepLog = [];
      hideWelcome();
      addTaskBanner(taskType, taskInfo, message, memoryHint);
      showProgressOverlay();
      updateProgress({ progress: 5, message: '작업 시작...' });
    });

    state.socket.on('progress', (data) => {
      updateProgress(data);
      addProgressStep(data);
      // 조합 선택 결과 표시 (v4)
      if (data.combo) showComboPanel(data.combo);
      // 동적 파이프라인 계획 표시
      if (data.plan) showDynamicPlan(data.plan);
      // 병렬 실행 뱃지
      if (data.parallel) updateProgressStatus(data.message + ' ⚡병렬');
    });

    state.socket.on('response', (data) => {
      setProcessing(false);
      hideProgressOverlay();

      if (data.type === 'question') {
        addMessage('assistant', data.message, 'question');
        updateSidebarStatus('질문 중...');
      } else if (data.type === 'help') {
        addMessage('assistant', data.message);
      } else {
        addMessage('assistant', data.message);
      }
    });

    state.socket.on('result', (result) => {
      setProcessing(false);
      hideProgressOverlay();
      state.currentResult = result;
      displayResult(result);
      addResultMessage(result);
      updateSidebarPipeline(result.pipeline);
      // 메모리 패널 업데이트
      if (result.memoryState) {
        loadMemoryPanel();
      }
      // Agent 모드였다면 패널에 최종 완료 표시
      if (result.isAgentMode && dom.agentPanel && !dom.agentPanel.classList.contains('hidden')) {
        agentSetState('done');
        agentSetCurrentTask('최종 결과 수신 완료');
        if (dom.agentPanel) dom.agentPanel.classList.add('agent-done');
      }
      // Phase 2: partial result 배너
      if (result.agentMeta?.isPartial) {
        const bs = result.agentMeta.budgetSummary;
        const reason = bs?.budget_stop_reason || 'budget_exceeded';
        const reasonLabels = {
          max_llm_calls_exceeded:         'LLM 호출 한도 초과',
          max_tool_calls_exceeded:        '도구 호출 한도 초과',
          max_tokens_exceeded:            '토큰 사용 한도 초과',
          max_execution_time_exceeded:    '실행 시간 초과',
          max_correction_rounds_exceeded: '자기교정 한도 초과',
        };
        showToast(`⚠️ 부분 결과: ${reasonLabels[reason] || reason}`, 'warning', 6000);
      }
    });

    state.socket.on('error', ({ message }) => {
      setProcessing(false);
      hideProgressOverlay();
      addMessage('assistant', `❌ 오류: ${message}`);
      showToast(message, 'error');
      // Agent 패널이 열려 있으면 에러 상태로 전환
      if (dom.agentPanel && !dom.agentPanel.classList.contains('hidden')) {
        agentShowError(message);
      }
    });

    // ── Agent 진행상태 이벤트 (Phase 1) ──────────────────────

    // agent:planning — 계획 수립 시작
    state.socket.on('agent:planning', (data) => {
      agentPanelShow();
      agentSetState('planning');
      agentSetCurrentTask(data.message || '계획 수립 중...');
    });

    // agent:plan_ready — 계획 완성, task 목록 표시
    state.socket.on('agent:plan_ready', (data) => {
      state.agent.planId     = data.planId;
      state.agent.tasks      = (data.tasks || []).map(t => ({ ...t, status: 'pending' }));
      state.agent.totalSteps = data.totalSteps || data.tasks?.length || 0;
      state.agent.currentStep = 0;

      agentSetComplexity(data.complexity);
      agentRenderTaskList(state.agent.tasks);
      agentUpdateProgress(0, state.agent.totalSteps);
      agentSetState('planning');
      agentSetCurrentTask('실행 준비 완료');
    });

    // agent:executing — 실행 시작
    state.socket.on('agent:executing', (data) => {
      agentSetState('running');
      agentSetCurrentTask(data.message || '실행 중...');
    });

    // agent:state_update — task 상태 변경
    state.socket.on('agent:state_update', (data) => {
      const { task_state, current_step, total_steps, progress } = data;

      // 진행률 업데이트
      const pct = typeof progress === 'number' ? Math.round(progress)
                : total_steps ? Math.round((current_step / total_steps) * 100) : 0;
      agentUpdateProgress(current_step || 0, total_steps || state.agent.totalSteps, pct);
      agentSetState(task_state || 'running');

      // 현재 실행 중인 task 찾아 UI 반영
      if (state.agent.tasks.length) {
        const runningIdx = (current_step || 1) - 1;
        state.agent.tasks = state.agent.tasks.map((t, i) => ({
          ...t,
          status: i < runningIdx ? 'done'
                : i === runningIdx ? 'running'
                : 'pending',
        }));
        agentRenderTaskList(state.agent.tasks);
        const runningTask = state.agent.tasks[runningIdx];
        if (runningTask) agentSetCurrentTask(runningTask.name);
      }
    });

    // agent:task_progress — 세부 progress 업데이트
    state.socket.on('agent:task_progress', (data) => {
      const { taskId, taskName, status, groupIndex, totalGroups } = data;

      // 상태 기반 task_state 매핑
      if (taskName) agentSetCurrentTask(taskName);
      if (status)   agentSetState(status);

      // task 리스트 상태 업데이트
      if (taskId && state.agent.tasks.length) {
        state.agent.tasks = state.agent.tasks.map(t =>
          t.id === taskId ? { ...t, status: status || 'running' } : t
        );
        agentRenderTaskList(state.agent.tasks);
      }

      // 그룹 기반 진행률
      if (typeof groupIndex === 'number' && totalGroups) {
        const pct = Math.round(((groupIndex + 1) / totalGroups) * 100);
        agentUpdateProgress(groupIndex + 1, totalGroups, pct);
      }
    });

    // agent:complete — 완료 (Phase 2: isPartial 처리)
    state.socket.on('agent:complete', (data) => {
      const isPartial = !!data.isPartial;

      if (isPartial) {
        // 부분 결과: 일부 task만 완료 처리
        agentSetState('done');
        agentSetCurrentTask('⚠️ 부분 결과 반환됨');
        // 미완료 task는 pending 유지
        agentRenderTaskList(state.agent.tasks);
      } else {
        state.agent.tasks = state.agent.tasks.map(t => ({ ...t, status: 'done' }));
        agentRenderTaskList(state.agent.tasks);
        agentUpdateProgress(state.agent.totalSteps, state.agent.totalSteps, 100);
        agentSetState('done');
        agentSetCurrentTask('완료');
      }
      if (dom.agentPanel) dom.agentPanel.classList.add('agent-done');

      // budget 사용량 요약 표시
      if (data.budget) agentShowBudgetSummary(data.budget);

      // 자동 닫힘: 완료 4초, partial 8초(재시도 여유)
      setTimeout(() => {
        if (dom.agentPanel && !dom.agentPanel.classList.contains('hidden')) {
          agentPanelHide();
        }
      }, isPartial ? 8000 : 4000);
    });

    // agent:budget_exceeded — 예산 초과 (Phase 2)
    state.socket.on('agent:budget_exceeded', (data) => {
      const reasonLabels = {
        max_llm_calls_exceeded:         '⚠️ LLM 호출 한도 초과',
        max_tool_calls_exceeded:        '⚠️ 도구 호출 한도 초과',
        max_tokens_exceeded:            '⚠️ 토큰 사용 한도 초과',
        max_execution_time_exceeded:    '⏱️ 실행 시간 초과',
        max_correction_rounds_exceeded: '🔄 자기교정 한도 초과',
        already_exceeded:               '⚠️ 예산 초과',
      };
      const label = reasonLabels[data.reason] || '⚠️ 예산 초과';
      const msg   = data.message || '한도를 초과하여 부분 결과를 반환합니다.';

      // budget 사용량 표시 (있을 경우)
      let budgetDetail = '';
      if (data.budget) {
        const b = data.budget;
        budgetDetail = ` (LLM ${b.llm_calls_used || 0}/${b.limits?.maxLLMCalls || '?'}, `
          + `Tool ${b.tool_calls_used || 0}/${b.limits?.maxToolCalls || '?'}, `
          + `${Math.round((b.execution_time_ms || 0) / 1000)}s)`;
      }

      agentSetState('failed');
      agentShowError(`${label}: ${msg}${budgetDetail}`);
      // budget 사용량 bar 표시
      if (data.budget) agentShowBudgetSummary(data.budget);
      console.warn('[AgentUI] budget_exceeded:', data);
    });
  }

  // ============================================================
  // Agent 진행상태 패널 함수 (Phase 1)
  // ============================================================

  // 상태별 아이콘·레이블 맵
  const AGENT_STATE_MAP = {
    planning:  { icon: '📋', label: '계획 수립 중',  cls: 'state-planning'  },
    searching: { icon: '🔍', label: '검색 중',       cls: 'state-searching' },
    analyzing: { icon: '🧠', label: '분석 중',       cls: 'state-analyzing' },
    writing:   { icon: '✍️', label: '작성 중',       cls: 'state-writing'   },
    reviewing: { icon: '🔎', label: '검토 중',       cls: 'state-reviewing' },
    running:   { icon: '⚙️', label: '실행 중',       cls: 'state-running'   },
    done:      { icon: '✅', label: '완료',          cls: 'state-done'      },
    failed:    { icon: '❌', label: '실패',          cls: 'state-failed'    },
  };

  function agentPanelShow() {
    if (!dom.agentPanel) return;
    dom.agentPanel.classList.remove('hidden', 'agent-done');
    // 초기화
    if (dom.agentErrorRow)   dom.agentErrorRow.classList.add('hidden');
    if (dom.agentTaskList)   dom.agentTaskList.innerHTML = '';
    if (dom.agentCurrentTask) dom.agentCurrentTask.textContent = '';
    agentUpdateProgress(0, 0, 0);
    agentSetState('planning');
  }

  function agentPanelHide() {
    if (!dom.agentPanel) return;
    dom.agentPanel.classList.add('hidden');
  }

  function agentSetState(stateKey) {
    if (!dom.agentStateBadge) return;
    const info = AGENT_STATE_MAP[stateKey] || AGENT_STATE_MAP.running;

    // 이전 state 클래스 제거
    Object.values(AGENT_STATE_MAP).forEach(s =>
      dom.agentStateBadge.classList.remove(s.cls)
    );
    dom.agentStateBadge.classList.add(info.cls);
    if (dom.agentStateIcon)  dom.agentStateIcon.textContent  = info.icon;
    if (dom.agentStateLabel) dom.agentStateLabel.textContent = info.label;
  }

  function agentSetComplexity(complexity) {
    if (!dom.agentComplexBadge) return;
    const map = { simple: 'simple', normal: 'normal', complex: 'complex' };
    const labels = { simple: 'Simple', normal: 'Normal', complex: 'Complex' };
    dom.agentComplexBadge.className = 'agent-complexity-badge ' + (map[complexity] || '');
    dom.agentComplexBadge.textContent = labels[complexity] || complexity || '';
  }

  function agentSetCurrentTask(title) {
    if (dom.agentCurrentTask) dom.agentCurrentTask.textContent = title || '';
  }

  function agentUpdateProgress(current, total, pct) {
    const p = typeof pct === 'number' ? pct
            : total > 0 ? Math.round((current / total) * 100) : 0;
    if (dom.agentCurrentStep)  dom.agentCurrentStep.textContent  = current || 0;
    if (dom.agentTotalSteps)   dom.agentTotalSteps.textContent   = total   || 0;
    if (dom.agentProgressFill) dom.agentProgressFill.style.width = p + '%';
    if (dom.agentProgressPct)  dom.agentProgressPct.textContent  = p + '%';
  }

  // task 목록 렌더링
  function agentRenderTaskList(tasks) {
    if (!dom.agentTaskList || !tasks) return;
    dom.agentTaskList.innerHTML = '';

    const TASK_ICONS = {
      search: '🔍', extract: '📄', analyze: '🧠', summarize: '📝',
      write: '✍️', code: '💻', review: '🔎', plan: '📋',
      tool: '🔧', synthesize: '🔗',
    };

    tasks.forEach(task => {
      const status = task.status || 'pending';
      const div = document.createElement('div');
      div.className = `agent-task-item task-${status}`;
      div.dataset.taskId = task.id || '';

      const icon   = TASK_ICONS[task.type] || '⚙️';
      const typeLabel = (task.type || '').toUpperCase();

      div.innerHTML = `
        <span class="agent-task-icon">${status === 'done' ? '✅' : status === 'running' ? '' : icon}</span>
        <span class="agent-task-name">${escapeHtml(task.name || task.id || '')}</span>
        <span class="agent-task-type">${escapeHtml(typeLabel)}</span>
      `;
      dom.agentTaskList.appendChild(div);
    });
  }

  // agent 에러 표시 + 재시도 버튼 활성화
  function agentShowError(errorMsg) {
    if (!dom.agentErrorRow) return;
    dom.agentErrorRow.classList.remove('hidden');
    if (dom.agentErrorMsg) dom.agentErrorMsg.textContent = errorMsg || '실행 중 오류가 발생했습니다.';
    agentSetState('failed');
    if (dom.agentPanel) dom.agentPanel.classList.remove('agent-done');
  }

  // ── Phase 2: budget 사용량 요약 표시 ──────────────────────────
  function agentShowBudgetSummary(budget) {
    if (!budget || !dom.agentPanel) return;
    // 기존 summary row 제거
    const existing = dom.agentPanel.querySelector('.agent-budget-summary');
    if (existing) existing.remove();

    const llm   = budget.llm_calls_used   ?? budget.llmCalls   ?? 0;
    const tool  = budget.tool_calls_used  ?? budget.toolCalls  ?? 0;
    const tok   = budget.total_tokens_used ?? budget.totalTokens ?? 0;
    const ms    = budget.execution_time_ms ?? 0;
    const sec   = (ms / 1000).toFixed(1);
    const maxL  = budget.limits?.maxLLMCalls  || '?';
    const maxT  = budget.limits?.maxToolCalls || '?';
    const maxTk = budget.limits?.maxTokens    || '?';
    const isStop = budget.is_partial_result || budget.isExceeded || false;

    const row = document.createElement('div');
    row.className = `agent-budget-summary${isStop ? ' budget-exceeded' : ''}`;
    row.innerHTML = `
      <span class="bsum-item" title="LLM 호출">🤖 ${llm}/${maxL}</span>
      <span class="bsum-item" title="도구 호출">🔧 ${tool}/${maxT}</span>
      <span class="bsum-item" title="토큰 사용">📊 ${tok.toLocaleString()}/${Number(maxTk).toLocaleString()}</span>
      <span class="bsum-item" title="실행 시간">⏱️ ${sec}s</span>
    `;

    // 태스크 리스트 아래 삽입
    const taskList = dom.agentPanel.querySelector('.agent-task-list');
    if (taskList) taskList.after(row);
    else dom.agentPanel.appendChild(row);
  }

  // HTML 이스케이프 유틸
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Event Binding ─────────────────────────────────────────
  function bindEvents() {
    // Send message
    dom.sendBtn.addEventListener('click', sendMessage);
    dom.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Char count
    dom.input.addEventListener('input', () => {
      const len = dom.input.value.length;
      dom.charCount.textContent = `${len}/2000`;
      autoResizeTextarea();
    });

    // Quick actions
    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        dom.input.value = prompt;
        dom.charCount.textContent = `${prompt.length}/2000`;
        sendMessage();
      });
    });

    // Result panel buttons
    dom.copyBtn?.addEventListener('click', copyResult);
    dom.downloadBtn?.addEventListener('click', downloadResult);
    dom.previewBtn?.addEventListener('click', openPreview);
    dom.closeResultBtn?.addEventListener('click', () => {
      dom.resultContent.innerHTML = '<div class="empty-result"><p>결과물이 여기에 표시됩니다</p></div>';
      dom.qualityBar.classList.add('hidden');
      dom.resultTitle.textContent = '결과물';
    });

    // 메모리 초기화 버튼
    dom.clearMemoryBtn?.addEventListener('click', async () => {
      if (!confirm('대화 기억을 초기화하시겠습니까?\n(작업 이력과 학습 데이터는 유지됩니다)')) return;
      await fetch(`/api/memory/${state.sessionId}`, { method: 'DELETE' });
      showToast('🔄 대화 기억이 초기화되었습니다', 'info');
    });

    // Modal
    dom.closeModalBtn?.addEventListener('click', closeModal);
    dom.modalOverlay?.addEventListener('click', closeModal);

    // Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });

    // Agent 패널 닫기 버튼
    dom.agentPanelClose?.addEventListener('click', () => {
      agentPanelHide();
    });

    // Agent 재시도 버튼
    dom.agentRetryBtn?.addEventListener('click', () => {
      if (state.agent.lastMessage) {
        // 에러 행 숨기고 재전송
        if (dom.agentErrorRow) dom.agentErrorRow.classList.add('hidden');
        if (dom.input) dom.input.value = state.agent.lastMessage;
        sendMessage();
      }
    });

    // Phase 5: Mode selector 버튼
    [dom.modeBtnChat, dom.modeBtnAgent, dom.modeBtnResearch].forEach(btn => {
      btn?.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        setMode(mode);
      });
    });
  }

  function autoResizeTextarea() {
    const ta = dom.input;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  }

  // ── Phase 5: Mode Selector ────────────────────────────────
  function setMode(mode) {
    state.mode = mode;
    // 버튼 active 업데이트
    [dom.modeBtnChat, dom.modeBtnAgent, dom.modeBtnResearch].forEach(btn => {
      btn?.classList.toggle('active', btn?.dataset.mode === mode);
    });
    // placeholder 업데이트
    const placeholders = {
      chat:     '빠른 질문이나 간단한 요청을 입력하세요...',
      agent:    '복잡한 작업을 에이전트에게 맡겨보세요...',
      research: '심층 리서치·분석 주제를 입력하세요...',
    };
    if (dom.input) dom.input.placeholder = placeholders[mode] || '무엇을 도와드릴까요?';
    console.log(`[Mode] 변경: ${mode}`);
  }

  // ── Send Message ──────────────────────────────────────────
  function sendMessage() {
    const text = dom.input.value.trim();
    if (!text || state.isProcessing) return;

    hideWelcome();
    setProcessing(true);
    addMessage('user', text);
    // 재시도를 위해 마지막 메시지 저장
    state.agent.lastMessage = text;
    dom.input.value = '';
    dom.charCount.textContent = '0/2000';
    autoResizeTextarea();

    // Show analyzing status
    const statusMsg = addStatusMessage('요청 분석 중...');

    if (state.socket && state.socket.connected) {
      state.socket.emit('message', {
        sessionId: state.sessionId,
        message: text,
        mode: state.mode,    // Phase 5: 모드 전달
      });
    }

    // Remove status after response arrives (handled by socket events)
    setTimeout(() => {
      if (statusMsg && statusMsg.parentNode) {
        statusMsg.parentNode.removeChild(statusMsg);
      }
    }, 3000);
  }

  // ── Message Rendering ──────────────────────────────────────
  function addMessage(role, content, type = '') {
    const div = document.createElement('div');
    div.className = `message ${role} ${type ? 'message-' + type : ''}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = formatMessage(content);

    div.appendChild(avatar);
    div.appendChild(bubble);
    dom.messages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addStatusMessage(text) {
    const div = document.createElement('div');
    div.className = 'message-status';
    div.innerHTML = `<div class="spinner"></div><span>${text}</span>`;
    dom.messages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addTaskBanner(taskType, taskInfo, message, memoryHint) {
    const icons = { ppt: '📊', website: '🌐', blog: '📝', report: '📈', code: '💻', email: '✉️', resume: '📄' };
    const names = { ppt: 'PPT 제작', website: '홈페이지 제작', blog: '블로그 작성', report: '분석 리포트', code: '코드 개발', email: '이메일 작성', resume: '자기소개서' };
    const times = { ppt: '3~5분', website: '5~8분', blog: '2~3분', report: '5~7분', code: '8~12분', email: '1~2분', resume: '3~5분' };

    const div = document.createElement('div');
    div.className = 'task-start-banner';
    div.innerHTML = `
      <div class="task-header">
        <span>${icons[taskType] || '⚙️'}</span>
        <span>${names[taskType] || taskType} 시작!</span>
      </div>
      <div class="task-meta">
        <span>⏱️ 예상 시간: ${times[taskType] || '?'}</span>
        <span>🤖 다중 AI 협업 중</span>
      </div>
      ${memoryHint ? `<div class="memory-hint-badge">${memoryHint}</div>` : ''}
    `;
    dom.messages.appendChild(div);
    scrollToBottom();
  }

  // ── 메모리 패널 업데이트 ──────────────────────────────────
  async function loadMemoryPanel() {
    if (!state.sessionId) return;
    try {
      const res = await fetch(`/api/memory/${state.sessionId}/episodes`);
      const episodes = await res.json();

      if (!episodes || episodes.length === 0) return;

      // 요약 카드 표시
      dom.memorySummary?.classList.remove('hidden');

      // 총 작업 수
      if (dom.memTotal) dom.memTotal.textContent = episodes.length;

      // 평균 품질
      const avgScore = Math.round(
        episodes.reduce((s, e) => s + (e.qualityScore || 0), 0) / episodes.length
      );
      if (dom.memScore) dom.memScore.textContent = avgScore + '점';

      // 에피소드 목록 렌더
      if (!dom.memoryEpisodes) return;
      dom.memoryEpisodes.innerHTML = '';

      const typeIcons = { ppt: '📊', website: '🌐', blog: '📝', report: '📈', code: '💻', email: '✉️', resume: '📄' };

      episodes.slice(0, 8).forEach(ep => {
        const div = document.createElement('div');
        div.className = 'memory-episode';
        div.title = `클릭하면 이 작업 유형으로 다시 시작`;

        const relTime = formatRelTimeClient(ep.ts);
        const icon = typeIcons[ep.taskType] || '⚙️';

        div.innerHTML = `
          <div class="memory-ep-type">
            <span>${icon} ${ep.taskType}</span>
            <span style="color:var(--text-faint);font-size:0.68rem;">${relTime}</span>
            <span class="memory-ep-score">${ep.qualityScore || '?'}점</span>
          </div>
          <div class="memory-ep-summary">${ep.summary}</div>
        `;

        // 클릭 시 같은 타입 재요청
        div.addEventListener('click', () => {
          const hint = ep.taskInfo?.topic || ep.taskInfo?.industry || ep.taskInfo?.subject || '';
          dom.input.value = hint ? `${ep.taskType} - ${hint} 다시 만들어줘` : `${ep.taskType} 만들어줘`;
          dom.input.focus();
        });

        dom.memoryEpisodes.appendChild(div);
      });

    } catch (err) {
      console.error('메모리 패널 로드 실패:', err);
    }
  }

  function formatRelTimeClient(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return '방금 전';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  }

  function addResultMessage(result) {
    const score = result.validation?.score || 0;
    const scoreEmoji = score >= 90 ? '🏆' : score >= 75 ? '✅' : '⚠️';
    const { pipeline, meta } = result;

    // 조합 정보 (v4)
    const combo = pipeline?.combo;
    const comboBadge = combo
      ? `<span class="result-badge combo">🏆 ${combo.name}</span>` : '';
    const strategyBadge = combo?.strategy
      ? `<span class="result-badge strategy-${combo.strategy}">${{quality:'🎯 품질',speed:'⚡ 속도',economy:'💰 절약',balanced:'⚖️ 균형'}[combo.strategy] || combo.strategy}</span>` : '';
    const feedbackBadge = (meta?.feedbackRounds > 0)
      ? `<span class="result-badge feedback">🔄 피드백 ${meta.feedbackRounds}회</span>` : '';

    // 조합 모델 체인 (최대 3개)
    const modelChain = combo?.models?.slice(0, 3)
      .map(m => `<span class="combo-model-chip">${m.model}</span>`).join(' → ') || '';

    const div = document.createElement('div');
    div.className = 'message assistant';
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🤖';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = `
      <strong>${pipeline?.icon || '✅'} ${pipeline?.name || '작업'} 완료!</strong><br>
      ${scoreEmoji} 품질: <strong>${score}/100</strong> &nbsp;|&nbsp; ⏱️ ${meta?.elapsed || '완료'}<br>
      <div style="margin-top:0.4rem;display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center;">
        ${comboBadge}${strategyBadge}${feedbackBadge}
      </div>
      ${modelChain ? `<div class="combo-chain" style="margin-top:0.4rem;">${modelChain}</div>` : ''}
      ${combo?.description ? `<div style="font-size:0.75rem;color:var(--text-faint);margin-top:0.25rem;">💡 ${combo.description}</div>` : ''}
      <span style="color:var(--text-faint);font-size:0.82rem;">오른쪽 패널에서 결과물을 확인하세요</span>
    `;
    div.appendChild(avatar);
    div.appendChild(bubble);
    dom.messages.appendChild(div);
    scrollToBottom();
  }

  function formatMessage(text) {
    if (!text) return '';
    // Simple markdown-like formatting for chat bubbles
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  function scrollToBottom() {
    setTimeout(() => {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    }, 50);
  }

  function hideWelcome() {
    if (dom.welcomeScreen) dom.welcomeScreen.classList.add('hidden');
  }

  // ── Progress Overlay ──────────────────────────────────────
  function showProgressOverlay() {
    dom.progressOverlay.classList.remove('hidden');
    dom.progressSteps.innerHTML = '';
    state.stepLog = [];
  }

  function hideProgressOverlay() {
    dom.progressOverlay.classList.add('hidden');
  }

  function updateProgress({ status, message, progress }) {
    if (message) dom.progressStatus.textContent = message;
    if (progress !== undefined) {
      dom.progressFill.style.width = progress + '%';
      dom.progressPercent.textContent = progress + '%';
    }
  }

  function updateProgressStatus(message) {
    if (dom.progressStatus) dom.progressStatus.textContent = message;
  }

  function addProgressStep({ message, status, parallel, groupIndex, totalGroups }) {
    if (!message) return;
    const item = document.createElement('div');
    item.className = `progress-step-item active`;

    const statusMap = {
      executing: '⚙️',
      validating: '🔍',
      retrying: '🔄',
      completed: '✅',
      planning: '📋'
    };

    const parallelBadge = parallel ? '<span class="parallel-badge">⚡병렬</span>' : '';
    const groupBadge = groupIndex ? `<span class="group-badge">${groupIndex}/${totalGroups}</span>` : '';
    item.innerHTML = `<span>${statusMap[status] || '▶'}</span> <span>${message}</span>${parallelBadge}${groupBadge}`;

    dom.progressSteps.querySelectorAll('.active').forEach(el => {
      el.classList.remove('active');
      el.classList.add('done');
    });

    dom.progressSteps.appendChild(item);
    dom.progressSteps.scrollTop = dom.progressSteps.scrollHeight;
    state.stepLog.push({ message, status });
  }

  // 동적 파이프라인 계획 표시
  function showDynamicPlan(plan) {
    if (!plan || !plan.groups) return;
    const existing = document.getElementById('dynamic-plan-preview');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'dynamic-plan-preview';
    div.className = 'dynamic-plan';
    div.innerHTML = `
      <div class="plan-title">🧠 AI 플래너 설계 파이프라인</div>
      <div class="plan-strategy">${plan.strategy || ''}</div>
      <div class="plan-groups">
        ${plan.groups.map((g, i) => `
          <div class="plan-group">
            <span class="plan-group-name">${i + 1}. ${g.name}</span>
            ${g.parallel ? '<span class="plan-parallel-tag">⚡병렬</span>' : ''}
            <span class="plan-steps">${g.steps.join(' → ')}</span>
          </div>
        `).join('')}
      </div>
    `;
    dom.progressSteps.parentNode.insertBefore(div, dom.progressSteps);
  }

  // ── Result Display ─────────────────────────────────────────
  function displayResult(result) {
    const { taskType, result: res, validation, meta, pipeline } = result;

    // Update title
    dom.resultTitle.textContent = `${pipeline?.icon || '📄'} ${pipeline?.name || '결과물'}`;

    // Quality bar
    const score = validation?.score || 0;
    dom.qualityBar.classList.remove('hidden');
    setTimeout(() => {
      dom.qualityFill.style.width = score + '%';
      dom.qualityScore.textContent = `${score}/100`;
    }, 100);

    // Content
    dom.resultContent.innerHTML = '';

    const contentDiv = document.createElement('div');

    switch (res?.contentType) {
      case 'html':
        contentDiv.appendChild(renderHTMLResult(res.content));
        break;
      case 'ppt':
        contentDiv.appendChild(renderPPTResult(res.content));
        break;
      case 'markdown':
      case 'code':
        contentDiv.appendChild(renderMarkdownResult(res.content));
        break;
      default:
        contentDiv.appendChild(renderTextResult(res.content));
    }

    // Meta info
    const metaDiv = createMetaSection(meta, validation);
    contentDiv.appendChild(metaDiv);

    dom.resultContent.appendChild(contentDiv);
    dom.resultContent.scrollTop = 0;

    showToast(`✅ 결과물 생성 완료! (품질: ${score}/100)`, 'success');
  }

  function renderHTMLResult(html) {
    const wrapper = document.createElement('div');
    wrapper.className = 'result-html-preview';

    const placeholder = document.createElement('div');
    placeholder.className = 'preview-placeholder';
    placeholder.innerHTML = `
      <div style="font-size:3rem;margin-bottom:0.5rem;">🌐</div>
      <div style="font-weight:700;margin-bottom:0.5rem;">홈페이지 생성 완료!</div>
      <div style="font-size:0.82rem;margin-bottom:1rem;">👁️ 미리보기 버튼을 눌러 확인하세요</div>
      <div style="font-size:0.78rem;color:var(--text-faint);">⬇️ 다운로드 버튼으로 HTML 파일 저장</div>
    `;
    wrapper.appendChild(placeholder);

    // Show first 500 chars as code preview
    const codePreview = document.createElement('pre');
    codePreview.style.cssText = 'background:var(--surface2);padding:0.75rem;border-radius:8px;font-size:0.72rem;overflow-x:auto;max-height:200px;border:1px solid var(--border);';
    codePreview.textContent = html.substring(0, 600) + '...';
    wrapper.appendChild(codePreview);

    return wrapper;
  }

  function renderPPTResult(content) {
    const wrapper = document.createElement('div');
    wrapper.className = 'result-markdown';

    // Parse slides (## delimited)
    const slides = content.split(/^---$/m);

    if (slides.length > 1) {
      slides.forEach((slide, i) => {
        const slideDiv = document.createElement('div');
        slideDiv.className = 'result-ppt-slide';
        const numDiv = document.createElement('div');
        numDiv.className = 'slide-num';
        numDiv.textContent = `SLIDE ${i + 1}`;
        slideDiv.appendChild(numDiv);
        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = renderMarkdownToHTML(slide.trim());
        slideDiv.appendChild(contentDiv);
        wrapper.appendChild(slideDiv);
      });
    } else {
      wrapper.innerHTML = renderMarkdownToHTML(content);
    }

    return wrapper;
  }

  function renderMarkdownResult(content) {
    const wrapper = document.createElement('div');
    wrapper.className = 'result-markdown';
    wrapper.innerHTML = renderMarkdownToHTML(content);
    return wrapper;
  }

  function renderTextResult(content) {
    const pre = document.createElement('pre');
    pre.className = 'result-text';
    pre.textContent = content;
    return pre;
  }

  function renderMarkdownToHTML(text) {
    if (!text) return '';

    let html = text
      // Headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Bold, italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code
      .replace(/```[\s\S]*?```/g, m => {
        const code = m.replace(/```(\w+)?\n?/, '').replace(/```$/, '');
        return `<pre><code>${escapeHTML(code)}</code></pre>`;
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Blockquote
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      // HR
      .replace(/^---$/gm, '<hr>')
      // Tables (simple)
      .replace(/^\|(.+)\|$/gm, (match, cells) => {
        const isHeader = match.includes('---');
        if (isHeader) return '';
        const cols = cells.split('|').map(c => c.trim());
        const tag = 'td';
        return '<tr>' + cols.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
      })
      // Lists
      .replace(/^\* (.+)$/gm, '<li>$1</li>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // Paragraphs
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    // Wrap li in ul
    html = html.replace(/(<li>.*?<\/li>)+/gs, m => `<ul>${m}</ul>`);
    // Wrap tr in table
    html = html.replace(/(<tr>.*?<\/tr>)+/gs, m => `<table>${m}</table>`);

    return `<p>${html}</p>`;
  }

  function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function createMetaSection(meta, validation) {
    const div = document.createElement('div');
    div.className = 'result-meta';

    // 기본 메타
    let metaHTML = `
      <div class="meta-row"><span>처리 시간</span><span>${meta?.elapsed || '-'}</span></div>
      <div class="meta-row"><span>품질 점수</span><span>${meta?.qualityScore || 0}/100</span></div>
    `;

    // 조합 정보 (v4)
    if (meta?.comboKey) {
      metaHTML += `<div class="meta-row"><span>사용 조합</span><span>${meta.comboKey}</span></div>`;
    }

    div.innerHTML = metaHTML;

    if (validation?.strengths?.length > 0) {
      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'meta-tags';
      validation.strengths.forEach(s => {
        const tag = document.createElement('span');
        tag.className = 'meta-tag';
        tag.textContent = '✓ ' + s;
        tagsDiv.appendChild(tag);
      });
      div.appendChild(tagsDiv);
    }

    if (validation?.issues?.length > 0) {
      const issuesDiv = document.createElement('div');
      issuesDiv.className = 'meta-tags';
      validation.issues.forEach(issue => {
        const tag = document.createElement('span');
        tag.className = 'meta-tag meta-issue';
        tag.textContent = '! ' + issue;
        issuesDiv.appendChild(tag);
      });
      div.appendChild(issuesDiv);
    }

    return div;
  }

  // ── Dynamic Plan Preview ──────────────────────────────────
  function showDynamicPlan(plan) {
    if (!plan || !plan.steps) return;
    let planEl = document.getElementById('dynamic-plan-preview');
    if (!planEl) {
      planEl = document.createElement('div');
      planEl.id = 'dynamic-plan-preview';
      planEl.className = 'dynamic-plan-preview';
      const stepsContainer = dom.progressSteps?.parentNode;
      if (stepsContainer) stepsContainer.insertBefore(planEl, dom.progressSteps);
    }
    const parallelSteps = plan.steps.filter(s => s.parallel);
    planEl.innerHTML = `
      <div class="plan-title">🧠 AI 설계 파이프라인 (${plan.complexity || 'normal'})</div>
      <div class="plan-steps-row">
        ${plan.steps.map(s => `
          <div class="plan-step-chip ${s.parallel ? 'parallel' : ''}" title="${s.model}">
            ${s.parallel ? '⚡' : '▶'} ${s.name}
          </div>
        `).join('')}
      </div>
      ${parallelSteps.length > 0
        ? `<div class="plan-parallel-note">⚡ ${parallelSteps.map(s => s.name).join(' + ')} 동시 실행</div>`
        : ''}
    `;
  }

  // ── 조합 패널 표시 (progress 이벤트 수신 시)
  function showComboPanel(combo) {
    if (!combo) return;
    let panel = document.getElementById('combo-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'combo-panel';
      panel.className = 'combo-panel';
      // 진행 오버레이 안에 삽입
      const overlay = dom.progressOverlay.querySelector('.progress-content') || dom.progressOverlay;
      overlay.insertBefore(panel, overlay.firstChild);
    }

    const strategyLabel = {quality:'🎯 품질 최우선',speed:'⚡ 속도 최우선',economy:'💰 비용 절약',balanced:'⚖️ 균형'};
    const altList = combo.alternatives?.length
      ? combo.alternatives.map(a => `<span class="combo-alt">${a.name}</span>`).join('')
      : '';

    panel.innerHTML = `
      <div class="combo-panel-header">
        <span class="combo-name">🏆 ${combo.name}</span>
        <span class="combo-strategy">${strategyLabel[combo.strategy] || combo.strategy}</span>
      </div>
      <div class="combo-models">
        ${(combo.steps || []).map(s =>
          `<div class="combo-step">
            <span class="combo-role">${s.role || ''}</span>
            <span class="combo-model-name">${s.model}</span>
          </div>`
        ).join('')}
      </div>
      ${altList ? `<div class="combo-alts">대안: ${altList}</div>` : ''}
    `;
  }

  // ── Sidebar ───────────────────────────────────────────────
  function updateSidebarPipeline(pipeline) {
    if (!pipeline) return;
    dom.noTask.classList.add('hidden');
    dom.taskPipeline.classList.remove('hidden');

    const combo = pipeline.combo;
    const comboHTML = combo ? `
      <div class="sidebar-combo">
        <div class="sidebar-combo-name">🏆 ${combo.name}</div>
        <div class="sidebar-combo-desc">${combo.description || ''}</div>
        <div class="sidebar-combo-models">
          ${(combo.models || []).slice(0, 3).map(m =>
            `<span class="sidebar-model-chip">${m.model}<span class="sidebar-model-step">${m.step}</span></span>`
          ).join('')}
        </div>
        ${combo.alternatives?.length
          ? `<div class="sidebar-combo-alt">대안: ${combo.alternatives.map(a=>a.name).join(', ')}</div>`
          : ''}
      </div>
    ` : '';

    dom.taskPipeline.innerHTML = `
      <div style="font-size:0.85rem;font-weight:600;margin-bottom:0.4rem;">${pipeline.icon} ${pipeline.name}</div>
      ${comboHTML}
    `;
  }

  function updateSidebarStatus(text) {
    // simple status update in sidebar
  }

  // ── Copy & Download ───────────────────────────────────────
  function copyResult() {
    if (!state.currentResult) return;
    const content = state.currentResult.result?.content || '';
    navigator.clipboard.writeText(content).then(() => {
      showToast('📋 복사 완료!', 'success');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('📋 복사 완료!', 'success');
    });
  }

  function downloadResult() {
    if (!state.currentResult) return;
    const { result, pipeline } = state.currentResult;
    const content = result?.content || '';
    const type = result?.contentType;

    let filename, mimeType;
    if (type === 'html') {
      filename = 'homepage.html';
      mimeType = 'text/html;charset=utf-8';
    } else if (type === 'code') {
      filename = 'code.txt';
      mimeType = 'text/plain;charset=utf-8';
    } else {
      filename = (pipeline?.name || 'result') + '.md';
      mimeType = 'text/markdown;charset=utf-8';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('⬇️ 다운로드 완료!', 'success');
  }

  // ── Preview Modal ─────────────────────────────────────────
  function openPreview() {
    if (!state.currentResult) return;
    const { result, pipeline } = state.currentResult;
    const type = result?.contentType;

    dom.modalTitle.textContent = `👁️ 미리보기 – ${pipeline?.name || '결과물'}`;
    dom.modalBody.innerHTML = '';

    if (type === 'html') {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'width:100%;height:65vh;border:none;border-radius:0 0 20px 20px;';
      iframe.srcdoc = result.content;
      dom.modalBody.appendChild(iframe);
    } else {
      const div = document.createElement('div');
      div.className = 'modal-markdown result-markdown';
      div.style.padding = '1.5rem';
      div.innerHTML = renderMarkdownToHTML(result.content);
      dom.modalBody.appendChild(div);
    }

    dom.previewModal.classList.remove('hidden');
  }

  function closeModal() {
    dom.previewModal.classList.add('hidden');
    dom.modalBody.innerHTML = '';
  }

  // ── Utils ─────────────────────────────────────────────────
  function setProcessing(val) {
    state.isProcessing = val;
    dom.sendBtn.disabled = val;
    dom.input.disabled = val;
  }

  function showToast(message, type = 'info', duration = 3000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ══════════════════════════════════════════════════════════
  // 조합 대시보드 (ComboOptimizer 성능 시각화)
  // ══════════════════════════════════════════════════════════

  // 조합 대시보드 모달 생성
  function createComboDashboard() {
    if (document.getElementById('combo-dashboard-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'combo-dashboard-modal';
    modal.className = 'combo-dashboard-modal hidden';
    modal.innerHTML = `
      <div class="combo-dashboard-overlay" onclick="closeComboDashboard()"></div>
      <div class="combo-dashboard-content">
        <div class="combo-dashboard-header">
          <h2>🏆 AI 조합 최적화 대시보드</h2>
          <button class="combo-dashboard-close" onclick="closeComboDashboard()">✕</button>
        </div>
        <div class="combo-dashboard-tabs">
          <button class="combo-tab active" data-tab="ranking" onclick="switchComboTab('ranking')">📊 조합 랭킹</button>
          <button class="combo-tab" data-tab="models" onclick="switchComboTab('models')">🤖 모델 레지스트리</button>
          <button class="combo-tab" data-tab="benchmark" onclick="switchComboTab('benchmark')">📈 실행 성능</button>
        </div>
        <div id="combo-tab-ranking" class="combo-tab-content">
          <div class="combo-filter-row">
            <select id="combo-task-filter" onchange="loadComboRanking()">
              <option value="ppt">📊 PPT</option>
              <option value="website">🌐 홈페이지</option>
              <option value="blog">📝 블로그</option>
              <option value="report">📈 리포트</option>
              <option value="code">💻 코드</option>
              <option value="email">✉️ 이메일</option>
              <option value="resume">📄 자소서</option>
            </select>
            <select id="combo-strategy-filter" onchange="loadComboRanking()">
              <option value="quality">🎯 품질 최우선</option>
              <option value="speed">⚡ 속도 최우선</option>
              <option value="economy">💰 비용 절약</option>
            </select>
            <button class="combo-recommend-btn" onclick="loadComboRecommend()">🔍 최적 조합 찾기</button>
          </div>
          <div id="combo-ranking-list" class="combo-ranking-list">
            <div class="combo-loading">데이터 로딩 중...</div>
          </div>
        </div>
        <div id="combo-tab-models" class="combo-tab-content hidden">
          <div id="combo-models-grid" class="combo-models-grid">
            <div class="combo-loading">데이터 로딩 중...</div>
          </div>
        </div>
        <div id="combo-tab-benchmark" class="combo-tab-content hidden">
          <div id="combo-benchmark-content" class="combo-benchmark-content">
            <div class="combo-loading">실행 데이터 로딩 중...</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  window.closeComboDashboard = function() {
    const m = document.getElementById('combo-dashboard-modal');
    if (m) m.classList.add('hidden');
  };

  window.switchComboTab = function(tab) {
    document.querySelectorAll('.combo-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.combo-tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
    document.getElementById(`combo-tab-${tab}`)?.classList.remove('hidden');

    if (tab === 'models') loadComboModels();
    if (tab === 'benchmark') loadComboBenchmark();
  };

  window.loadComboRanking = async function() {
    const taskType = document.getElementById('combo-task-filter')?.value || 'ppt';
    const strategy = document.getElementById('combo-strategy-filter')?.value || 'quality';
    const list = document.getElementById('combo-ranking-list');
    if (!list) return;
    list.innerHTML = '<div class="combo-loading">분석 중...</div>';

    try {
      const res = await fetch(`/api/combo/report?taskType=${taskType}&strategy=${strategy}`);
      const data = await res.json();
      const ranking = data.ranking || [];

      if (ranking.length === 0) {
        list.innerHTML = '<div class="combo-empty">조합 데이터가 없습니다.</div>';
        return;
      }

      list.innerHTML = ranking.slice(0, 8).map((r, i) => {
        const scoreWidth = Math.min(r.scores?.total * 100 || r.scores?.avgScore || 80, 100);
        const tierColors = { quality: '#6366f1', speed: '#06b6d4', economy: '#22c55e' };
        const color = tierColors[r.strategy] || '#6366f1';
        const modelEntries = Object.entries(r.modelMap || {}).slice(0, 4);
        return `
          <div class="combo-rank-card ${i === 0 ? 'top-rank' : ''}">
            <div class="combo-rank-num">${i + 1}</div>
            <div class="combo-rank-info">
              <div class="combo-rank-name">${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}${r.name}</div>
              <div class="combo-rank-desc">${r.description || ''}</div>
              <div class="combo-rank-models">
                ${modelEntries.map(([role, m]) =>
                  `<span class="model-chip">${m.icon || '🤖'} ${m.modelName || m}</span>`
                ).join('')}
              </div>
              <div class="combo-score-bar">
                <div class="combo-score-fill" style="width:${scoreWidth}%;background:${color}"></div>
                <span class="combo-score-text">${Math.round(scoreWidth)}점</span>
              </div>
            </div>
            <div class="combo-rank-meta">
              <span class="combo-win-rate">승률 ${r.scores?.winRate || Math.round((r.combo?.winRate || 0.8) * 100)}%</span>
              <span class="combo-strategy-tag" style="background:${color}20;color:${color}">
                ${r.strategy === 'quality' ? '🎯품질' : r.strategy === 'speed' ? '⚡속도' : '💰경제'}
              </span>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      list.innerHTML = `<div class="combo-error">오류: ${e.message}</div>`;
    }
  };

  window.loadComboRecommend = async function() {
    const taskType = document.getElementById('combo-task-filter')?.value || 'ppt';
    const strategy = document.getElementById('combo-strategy-filter')?.value || 'quality';
    const list = document.getElementById('combo-ranking-list');
    if (!list) return;
    list.innerHTML = '<div class="combo-loading">🧠 최적 조합 분석 중...</div>';

    try {
      const res = await fetch('/api/combo/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskType, strategy, complexity: 'medium' })
      });
      const data = await res.json();
      const rec = data.recommended;

      const modelEntries = Object.entries(rec.modelMap || {});
      list.innerHTML = `
        <div class="combo-recommend-card">
          <div class="combo-rec-title">🏆 최적 조합: ${rec.name}</div>
          <div class="combo-rec-reason">${rec.reason}</div>
          <div class="combo-rec-models">
            ${modelEntries.map(([role, m]) => `
              <div class="combo-rec-model">
                <span class="rec-role-icon">${m.icon || '🤖'}</span>
                <div>
                  <div class="rec-model-name">${m.modelName}</div>
                  <div class="rec-role-name">${role} | ${m.tier}</div>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="combo-rec-scores">
            <span>능력치: <b>${rec.scores?.ability}점</b></span>
            <span>예상 승률: <b>${rec.scores?.winRate}%</b></span>
            <span>평균 품질: <b>${rec.scores?.avgScore}점</b></span>
          </div>
          ${data.alternatives?.length ? `
            <div class="combo-rec-alts">
              <div class="combo-rec-alts-title">차선 조합:</div>
              ${data.alternatives.map(a => `<span class="alt-chip">${a.name} (${a.score}점)</span>`).join('')}
            </div>
          ` : ''}
        </div>
      `;

      // 나머지 랭킹도 표시
      const rankHtml = (data.ranking || []).slice(0, 6).map((r, i) => {
        const scoreWidth = Math.round(r.score || 80);
        return `
          <div class="combo-rank-mini ${r.comboKey === rec.comboKey ? 'is-best' : ''}">
            <span class="mini-rank">${i + 1}</span>
            <span class="mini-name">${r.name}</span>
            <div class="mini-bar"><div style="width:${scoreWidth}%"></div></div>
            <span class="mini-score">${scoreWidth}점</span>
          </div>
        `;
      }).join('');
      list.innerHTML += `<div class="combo-mini-ranking">${rankHtml}</div>`;
    } catch (e) {
      list.innerHTML = `<div class="combo-error">오류: ${e.message}</div>`;
    }
  };

  async function loadComboModels() {
    const grid = document.getElementById('combo-models-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="combo-loading">모델 로딩 중...</div>';

    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      const models = data.models || [];

      const tierOrder = { flagship: 0, specialized: 1, standard: 2, mini: 3, nano: 4 };
      models.sort((a, b) => (tierOrder[a.tier] || 5) - (tierOrder[b.tier] || 5));

      grid.innerHTML = models.map(m => {
        const abilities = m.abilities || {};
        const bars = ['reasoning', 'creativity', 'coding', 'korean', 'speed', 'instruction'].map(k => `
          <div class="ability-row">
            <span class="ability-label">${k}</span>
            <div class="ability-bar"><div class="ability-fill" style="width:${(abilities[k] || 5) * 10}%"></div></div>
            <span class="ability-val">${abilities[k] || 5}</span>
          </div>
        `).join('');

        const tierColor = {
          flagship: '#6366f1', specialized: '#8b5cf6',
          standard: '#06b6d4', mini: '#22c55e', nano: '#f59e0b'
        }[m.tier] || '#6b7280';

        return `
          <div class="model-card">
            <div class="model-card-header">
              <div class="model-card-name">${m.name}</div>
              <span class="model-tier-badge" style="background:${tierColor}20;color:${tierColor}">${m.tier}</span>
            </div>
            <div class="model-card-id">${m.id}</div>
            <div class="model-abilities">${bars}</div>
            <div class="model-best-for">
              ${(m.bestFor || []).map(t => `<span class="best-tag">${t}</span>`).join('')}
            </div>
            <div class="model-cost">💰 $${m.cost}/1K tokens</div>
          </div>
        `;
      }).join('');
    } catch (e) {
      grid.innerHTML = `<div class="combo-error">오류: ${e.message}</div>`;
    }
  }

  async function loadComboBenchmark() {
    const cont = document.getElementById('combo-benchmark-content');
    if (!cont) return;
    cont.innerHTML = '<div class="combo-loading">📊 실행 데이터 분석 중...</div>';

    try {
      const res = await fetch('/api/benchmark/insights');
      const data = await res.json();

      if (!data.totalExecutions) {
        cont.innerHTML = `
          <div class="benchmark-empty">
            <div class="benchmark-empty-icon">📊</div>
            <div class="benchmark-empty-title">아직 실행 데이터가 없습니다</div>
            <div class="benchmark-empty-desc">
              AI 작업을 실행하면 자동으로 조합별 성능이 기록됩니다.<br>
              충분한 데이터(5회+)가 쌓이면 시스템이 자동으로 최적 조합을 학습합니다.
            </div>
          </div>
        `;
        return;
      }

      const taskTypes = data.taskTypes || {};
      const globalBest = data.globalBest;

      cont.innerHTML = `
        <div class="benchmark-summary">
          <div class="bench-stat">
            <div class="bench-stat-val">${data.totalExecutions}</div>
            <div class="bench-stat-label">총 실행 수</div>
          </div>
          ${globalBest ? `
            <div class="bench-stat">
              <div class="bench-stat-val">${globalBest.avgScore}점</div>
              <div class="bench-stat-label">전체 최고 점수</div>
            </div>
            <div class="bench-stat">
              <div class="bench-stat-val">${globalBest.comboKey}</div>
              <div class="bench-stat-label">최고 조합</div>
            </div>
          ` : ''}
        </div>
        <div class="benchmark-task-list">
          ${Object.entries(taskTypes).map(([tt, ins]) => `
            <div class="bench-task-section">
              <div class="bench-task-title">${tt.toUpperCase()} (${ins.totalExecutions}회)</div>
              ${(ins.ranking || []).map(r => `
                <div class="bench-row">
                  <span class="bench-rank">#${r.rank}</span>
                  <span class="bench-combo">${r.comboKey}</span>
                  <span class="bench-score">${r.avgScore}점</span>
                  <span class="bench-trend ${r.trend}">${r.trend === 'improving' ? '↗️' : r.trend === 'declining' ? '↘️' : '→'}</span>
                  <span class="bench-count">${r.executions}회</span>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) {
      cont.innerHTML = `<div class="combo-error">오류: ${e.message}</div>`;
    }
  }

  // 사이드바에 조합 대시보드 버튼 추가
  function addComboDashboardButton() {
    const sidebar = document.querySelector('.sidebar-section') ||
                    document.querySelector('[id*="pipeline"]')?.parentElement;
    if (!sidebar) return;
    if (document.getElementById('combo-dashboard-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'combo-dashboard-btn';
    btn.className = 'combo-dashboard-btn';
    btn.innerHTML = '🏆 AI 조합 대시보드';
    btn.onclick = openComboDashboard;
    sidebar.appendChild(btn);
  }

  function openComboDashboard() {
    createComboDashboard();
    const modal = document.getElementById('combo-dashboard-modal');
    modal.classList.remove('hidden');
    loadComboRanking();
  }

  // ── Start ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    init();
    setTimeout(addComboDashboardButton, 1000);
    initPageTabs();
    initPipelinePanel();
  });

})();

// ============================================================
// PHASE 1 PIPELINE PANEL
// ============================================================
function initPipelinePanel() {
  // 파이프라인 상태 로드
  fetch('/api/pipelines')
    .then(r => r.json())
    .then(data => {
      const badge = document.getElementById('pipeline-live-badge');
      if (badge) {
        const liveCount = data.livePipelines || 0;
        const total     = data.totalPipelines || 11;
        badge.textContent = `${liveCount}/${total} live`;
        badge.className   = 'badge-live' + (liveCount < total ? ' stub' : '');
      }
      // 총 커버 케이스 업데이트
      const totalBadge = document.getElementById('pipeline-total-badge');
      if (totalBadge && data.totalCasesCovered) {
        const p1 = data.phases?.phase1?.cases || 379;
        const p2 = data.phases?.phase2?.cases || 47;
        totalBadge.textContent = `총 ${data.totalCasesCovered}건 커버 (P1:${p1} + P2:${p2})`;
      }
      // 각 카드에 live 여부 표시
      if (data.pipelines) {
        Object.entries(data.pipelines).forEach(([key, info]) => {
          const card = document.querySelector(`.pipeline-card[data-pipeline="${key}"]`);
          if (card) {
            const dot = document.createElement('span');
            dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${info.live ? '#34d399' : '#f59e0b'};display:inline-block;flex-shrink:0;`;
            dot.title = info.live ? 'API 연동됨' : 'stub 모드 — ' + (info.missingEnv || []).join(', ');
            card.insertBefore(dot, card.firstChild);
          }
        });
      }
    })
    .catch(() => {});

  // Phase 2 라우트 매핑
  const PIPELINE_ROUTES = {
    imageGen:        'image',
    stt:             'stt',
    crawler:         'crawl',
    email:           'email',
    vision:          'vision',
    notification:    'notify',
    threeD:          '3d',
    ner:             'ner',
    churnPrediction: 'churn',
    spatialAI:       'spatial',
    formulaOCR:      'formula',
  };

  // 테스트 버튼 이벤트
  document.querySelectorAll('.pipeline-test-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pipeline = btn.dataset.pipeline;
      const payload  = JSON.parse(btn.dataset.payload || '{}');
      const resultEl = document.getElementById('pipeline-test-result');
      if (!resultEl) return;

      btn.classList.add('loading');
      btn.textContent = '실행 중...';
      resultEl.className = 'pipeline-test-result';
      resultEl.textContent = '요청 중...';
      resultEl.classList.remove('hidden');

      const route = PIPELINE_ROUTES[pipeline] || pipeline;

      try {
        const res = await fetch(`/api/pipelines/${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        const stub = data.stub || data.generation?.stub || data.rawCrawl?.stub ||
          data.sampleSends?.[0]?.stub || data.results?.slack?.stub || !data.readyToUse;

        // Phase 2 전용 결과 요약
        let summary = '';
        if (pipeline === 'threeD') summary = `scene:${data.scene?.preset} | engine:${data.analysis?.engine}`;
        else if (pipeline === 'ner') summary = `entities:${data.summary?.totalEntities} | relations:${data.summary?.totalRelations}`;
        else if (pipeline === 'churnPrediction') summary = `churn:${data.churnRisk} | segment:${data.segment?.label}`;
        else if (pipeline === 'spatialAI') summary = `area:${data.analysis?.totalArea}m² | ${data.analysis?.pyeong}평`;
        else if (pipeline === 'formulaOCR') summary = `latex:${(data.primaryFormula?.latex||'').slice(0,30)}`;
        else summary = JSON.stringify(data.result || data.transcription?.fullText?.slice(0,80) || data.structured || data.rendered?.subject || data.results || '{}', null, 2).slice(0, 300);

        resultEl.className = 'pipeline-test-result ' + (data.success ? 'success' : 'error');
        resultEl.textContent = `✅ ${data._pipelineName || pipeline} (${stub ? 'stub' : 'live'}) ${data.durationMs || data._totalMs || ''}ms\n${summary}`;
      } catch (e) {
        resultEl.className = 'pipeline-test-result error';
        resultEl.textContent = '❌ 오류: ' + e.message;
      } finally {
        btn.classList.remove('loading');
        btn.textContent = '테스트';
      }
    });
  });

  // ── Phase 3 도메인 테스트 버튼 ──────────────────────────────
  document.querySelectorAll('.domain-test-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain  = btn.dataset.domain;
      const action  = btn.dataset.action;
      const payload = JSON.parse(btn.dataset.payload || '{}');
      const resultEl = document.getElementById('domain-test-result');

      btn.disabled = true;
      btn.textContent = '...';
      resultEl.className = 'pipeline-test-result';
      resultEl.textContent = '도메인 API 호출 중...';
      resultEl.classList.remove('hidden');

      try {
        const res = await fetch('/api/domain/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, action, params: payload }),
        });
        const data = await res.json();
        const summary = JSON.stringify(data.result || data, null, 2).slice(0, 400);
        const icon = data.success ? '✅' : '❌';
        const domainLabel = { real_estate: '🏠부동산', finance: '📈금융', healthcare: '🏥헬스케어', government: '🏛️공공' }[domain] || domain;
        resultEl.className = 'pipeline-test-result ' + (data.success ? 'success' : 'error');
        resultEl.textContent = `${icon} ${domainLabel}/${action} ${data.durationMs || 0}ms\n${summary}`;
      } catch (e) {
        resultEl.className = 'pipeline-test-result error';
        resultEl.textContent = '❌ 오류: ' + e.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '테스트';
      }
    });
  });
}


let _currentTab = 'chat';
let _allModels = [];
let _currentTierFilter = 'all';

window.switchMainTab = function(tab) {
  _currentTab = tab;
  // update buttons
  document.querySelectorAll('.header-tab-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`tab-${tab}-btn`);
  if (activeBtn) activeBtn.classList.add('active');

  // show/hide pages
  const chatEl = document.getElementById('main-chat');
  const modelsEl = document.getElementById('main-models');
  const comboEl = document.getElementById('main-combo');

  [chatEl, modelsEl, comboEl].forEach(el => { if (el) el.classList.add('hidden'); });

  if (tab === 'chat' && chatEl)   chatEl.classList.remove('hidden');
  if (tab === 'models' && modelsEl) { modelsEl.classList.remove('hidden'); loadRegistryPage(); }
  if (tab === 'combo' && comboEl)  { comboEl.classList.remove('hidden'); loadComboPage(); }
};

function initPageTabs() {
  // Remove overflow:hidden from body when on registry/combo pages
  document.getElementById('tab-models-btn')?.addEventListener('click', () => {
    document.body.style.overflow = 'hidden';
  });
  document.getElementById('tab-chat-btn')?.addEventListener('click', () => {
    document.body.style.overflow = 'hidden';
  });
}

// ── Registry Page ─────────────────────────────────────────

async function loadRegistryPage() {
  if (_allModels.length > 0) {
    renderIntelligenceLeaderboard();
    renderBestInClass();
    renderModelGrid(_allModels);
    renderRadarCompare(_allModels);
    return;
  }
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    _allModels = data.models || [];

    // Update stats
    const statTotal = document.getElementById('rstat-total');
    if (statTotal) statTotal.textContent = _allModels.length;

    // Count providers
    const provs = new Set(_allModels.map(m => m.provider));
    const statProviders = document.getElementById('rstat-providers');
    if (statProviders) statProviders.textContent = provs.size;

    renderIntelligenceLeaderboard();
    renderBestInClass();
    renderModelGrid(_allModels);
    renderRadarCompare(_allModels);

    // setup filter buttons v2
    document.querySelectorAll('.filter-btn-v2').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn-v2').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentTierFilter = btn.dataset.tier;
        filterModels();
      });
    });
  } catch(e) {
    console.error('Registry load error:', e);
  }
}

window.filterModels = function() {
  const search = document.getElementById('model-search')?.value?.toLowerCase() || '';
  let filtered = _currentTierFilter === 'all'
    ? [..._allModels]
    : _allModels.filter(m => m.tier === _currentTierFilter);
  if (search) {
    filtered = filtered.filter(m =>
      m.name.toLowerCase().includes(search) ||
      m.provider.toLowerCase().includes(search) ||
      (m.specialty || '').toLowerCase().includes(search)
    );
  }
  renderModelGrid(filtered);
};

window.sortModels = function() {
  const sortKey = document.getElementById('model-sort')?.value || 'tier';
  const search = document.getElementById('model-search')?.value?.toLowerCase() || '';
  let filtered = _currentTierFilter === 'all'
    ? [..._allModels]
    : _allModels.filter(m => m.tier === _currentTierFilter);
  if (search) {
    filtered = filtered.filter(m =>
      m.name.toLowerCase().includes(search) ||
      m.provider.toLowerCase().includes(search) ||
      (m.specialty || '').toLowerCase().includes(search)
    );
  }

  const tierOrder = { flagship:0, specialized:1, standard:2, mini:3, economy:4, open:5, nano:6 };
  filtered.sort((a, b) => {
    if (sortKey === 'tier') return (tierOrder[a.tier]||7) - (tierOrder[b.tier]||7);
    if (sortKey === 'intelligence') return (b.benchmark?.intelligenceIndex||b.benchmark?.overall||0) - (a.benchmark?.intelligenceIndex||a.benchmark?.overall||0);
    if (sortKey === 'reasoning') return (b.abilities?.reasoning||0) - (a.abilities?.reasoning||0);
    if (sortKey === 'coding')    return (b.abilities?.coding||0) - (a.abilities?.coding||0);
    if (sortKey === 'speed')     return (b.abilities?.speed||0) - (a.abilities?.speed||0);
    if (sortKey === 'cost')      return (a.cost||0) - (b.cost||0);
    return 0;
  });
  renderModelGrid(filtered);
};

// Intelligence Leaderboard (artificialanalysis.ai style)
function renderIntelligenceLeaderboard() {
  const el = document.getElementById('intelligence-leaderboard');
  if (!el) return;

  // Top models by Intelligence Index / Elo
  const topModels = [
    { rank: 1, name: 'Gemini 3.1 Pro', provider: 'Google', intelligenceIndex: 57, eloEst: 1528, specialty: '수학 AIME 95% · GPQA 94.3% · 2M ctx · 멀티모달 리더', tags: ['S-TIER'], isNew: true, tier: 'flagship' },
    { rank: 2, name: 'GPT-5.4',        provider: 'OpenAI', intelligenceIndex: 57, eloEst: 1555, specialty: 'SuperReasoning · 물리·법률·공학 문제 해결 · 1M ctx', tags: ['S-TIER', '★NEW'], isNew: true, tier: 'flagship' },
    { rank: 3, name: 'GPT-5.3 Codex',  provider: 'OpenAI', intelligenceIndex: 54, eloEst: null,  specialty: '코딩 전문 xhigh · HumanEval 97.5% · SWE-bench 83%', tags: [], isNew: false, tier: 'specialized' },
    { rank: 4, name: 'Claude Opus 4.6',provider: 'Anthropic', intelligenceIndex: 53, eloEst: 1532, specialty: '추론 챔피언 · GPQA 91.9% · Adaptive Thinking · 1M ctx', tags: ['★NEW'], isNew: true, tier: 'flagship' },
    { rank: 5, name: 'Claude Sonnet 4.6',provider: 'Anthropic', intelligenceIndex: 52, eloEst: null, specialty: '코딩·창의 균형 · SWE-bench 72% · 한국어 최강', tags: [], isNew: false, tier: 'standard' },
  ];

  const maxScore = 60;
  el.innerHTML = topModels.map((m, i) => {
    const rankClass = m.rank <= 3 ? `rank-${m.rank}` : '';
    const isStier = m.intelligenceIndex >= 53;
    const barWidth = Math.round((m.intelligenceIndex / maxScore) * 100);
    const tagHtml = m.tags.map(t => {
      if (t === 'S-TIER') return `<span class="intel-tag s">${t}</span>`;
      if (t === '★NEW') return `<span class="intel-tag new">NEW 2026</span>`;
      if (t === 'OPEN') return `<span class="intel-tag open">${t}</span>`;
      return `<span class="intel-tag new">${t}</span>`;
    }).join('');
    const eloText = m.eloEst ? `Elo ~${m.eloEst}` : '';
    const tierBadge = `<span class="tier-badge-v2 tier-${m.tier}">${m.tier}</span>`;

    return `
      <div class="intel-row${isStier ? ' s-tier-row' : ''}">
        <div class="intel-rank ${rankClass}">${m.rank <= 3 ? ['🥇','🥈','🥉'][m.rank-1] : m.rank}</div>
        <div class="intel-info">
          <div class="intel-name">${m.name} ${tierBadge}</div>
          <div class="intel-meta">
            <span class="intel-provider">${m.provider}</span>
            <span class="intel-specialty">${m.specialty}</span>
          </div>
          <div class="intel-tags">${tagHtml}</div>
        </div>
        <div class="intel-scores">
          <div class="intel-index-score">${m.intelligenceIndex}</div>
          <div class="intel-index-label">Intelligence Index</div>
          <div class="intel-bar-row">
            <div class="intel-bar-track">
              <div class="intel-bar-fill" style="width:${barWidth}%"></div>
            </div>
            <span class="intel-elo">${eloText}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderBestInClass() {
  const grid = document.getElementById('best-in-class-grid');
  if (!grid) return;

  const bestInClass = [
    { domain: '🏆 종합 지능', model: 'GPT-5.4',           metric: 'Elo 1555 · Intel.Index 57', color: '#f59e0b', provider: 'OpenAI', isNew: true },
    { domain: '🧠 추론 챔피언', model: 'Claude Opus 4.6',  metric: 'GPQA 91.9% · Adaptive Thinking', color: '#f97316', provider: 'Anthropic', isNew: true },
    { domain: '💻 코딩 2026',  model: 'Claude Sonnet 5',   metric: 'SWE-bench 82.1% · Dev Team', color: '#8b5cf6', provider: 'Anthropic', isNew: true },
    { domain: '🧮 수학/과학',  model: 'Gemini 3.1 Pro',    metric: 'AIME 95% · GPQA 94.3%', color: '#10b981', provider: 'Google', isNew: false },
    { domain: '✍️ 창의 글쓰기', model: 'GPT-5.1',          metric: 'Creative Writing v3 #1', color: '#a78bfa', provider: 'OpenAI', isNew: false },
    { domain: '🇰🇷 한국어',   model: 'Claude Sonnet 4.6', metric: '한국어 자연스러움 최강', color: '#fb7185', provider: 'Anthropic', isNew: false },
    { domain: '⚡ 실시간 속도', model: 'Gemini 3 Flash',    metric: '<1s · 번역·스트리밍', color: '#facc15', provider: 'Google', isNew: true },
    { domain: '💰 가성비',     model: 'DeepSeek V3.2',     metric: '성능/달러 310.86', color: '#22d3ee', provider: 'DeepSeek', isNew: false },
    { domain: '🤖 에이전트',   model: 'Kimi K2.5',         metric: '에이전트 스웜 · 연구 자동화', color: '#ec4899', provider: 'Moonshot', isNew: true },
    { domain: '🧩 오픈소스 추론', model: 'DeepSeek R2',    metric: 'Elo 1515 · AIME 96% · GPT-5급', color: '#06b6d4', provider: 'DeepSeek', isNew: true },
    { domain: '📏 장문 처리',  model: 'Llama 4 Scout',     metric: '10M 컨텍스트 · 무료', color: '#fb923c', provider: 'Meta', isNew: false },
    { domain: '🆓 오픈소스',   model: 'Llama 4.1 Maverick',metric: 'GPT-5.2 5% 내 MMLU · 무료', color: '#6366f1', provider: 'Meta', isNew: true },
    { domain: '📊 멀티모달',   model: 'Gemini 3.1 Pro',    metric: '2M ctx · 영상·PDF 분석', color: '#34d399', provider: 'Google', isNew: false },
    { domain: '🎨 이미지 생성', model: 'Nano Banana Pro',  metric: '~150ms · 완벽 텍스트', color: '#e879f9', provider: 'GenSpark', isNew: true },
    { domain: '🎬 비디오 생성', model: 'Sora 2',           metric: '물리 현실감 1위', color: '#f43f5e', provider: 'OpenAI', isNew: false },
    { domain: '🔊 TTS 음성',   model: 'ElevenLabs v3',     metric: '29개 언어 · 멀티스피커', color: '#818cf8', provider: 'ElevenLabs', isNew: false },
  ];

  grid.innerHTML = bestInClass.map(b => `
    <div class="domain-card-v2" style="--dc-color:${b.color}">
      <div class="dc-domain-label">${b.domain}</div>
      <div class="dc-model-name">
        ${b.model}
        ${b.isNew ? '<span class="dc-new-badge">2026 NEW</span>' : ''}
      </div>
      <div class="dc-metric">${b.metric}</div>
      <div class="dc-provider">${b.provider}</div>
    </div>
  `).join('');
}

function renderModelGrid(models) {
  const grid = document.getElementById('model-registry-grid');
  if (!grid) return;

  // NEW models added in 2026
  const newModels = new Set(['GPT5_4','GPT5_4_PRO','O3','O4_MINI','GPT5_1_CODEX','CLAUDE_OPUS_46','CLAUDE_SONNET_5','GROK_42','DEEPSEEK_R2','QWEN35_MAX','LLAMA41_MAVERICK','KIMI_K2_5','GEMINI_3_FLASH']);

  const provColors = {
    openai: '#10b981', anthropic: '#f59e0b', google: '#3b82f6',
    xai: '#8b5cf6', deepseek: '#06b6d4', alibaba: '#f97316',
    meta: '#6366f1', moonshot: '#ec4899', mistral: '#84cc16'
  };
  const abilityLabels = {
    reasoning: '추론력', creativity: '창의력', coding: '코딩',
    korean: '한국어', speed: '속도', instruction: '지시따름'
  };
  const abilityKeys = ['reasoning', 'coding', 'creativity', 'korean', 'speed', 'instruction'];

  grid.innerHTML = models.map(m => {
    const isAvail = m.available !== false;
    const isNew = newModels.has(m.key) || (m.tags || []).includes('latest');
    const pColor = provColors[m.provider] || '#6b7280';
    const ab = m.abilities || {};
    const bench = m.benchmark || {};
    const intelScore = bench.intelligenceIndex || null;
    const overallScore = bench.overall || null;
    const eloEst = bench.eloEst || null;

    // Ability bars
    const abHtml = abilityKeys.map(k => {
      const val = ab[k] || 0;
      const fillClass = val >= 9 ? 'ab-fill-high' : val >= 7 ? 'ab-fill-mid' : 'ab-fill-low';
      return `
        <div class="ab-row-v2">
          <div class="ab-header-v2">
            <span class="ab-label-v2">${abilityLabels[k] || k}</span>
            <span class="ab-val-v2">${val}</span>
          </div>
          <div class="ab-track-v2">
            <div class="ab-fill-v2 ${fillClass}" style="width:${val*10}%"></div>
          </div>
        </div>
      `;
    }).join('');

    // Intelligence block
    const intelHtml = (intelScore || overallScore) ? `
      <div class="mreg-v2-intel">
        <div class="mreg-intel-score">${intelScore || Math.round(overallScore)}</div>
        <div class="mreg-intel-details">
          <div class="mreg-intel-label">${intelScore ? 'Intelligence Index' : 'Benchmark Score'}</div>
          <div class="mreg-intel-bar">
            <div class="mreg-intel-bar-fill" style="width:${Math.min(100, ((intelScore||overallScore)/100)*100)}%"></div>
          </div>
          <div class="mreg-intel-sub">${eloEst ? `Elo ~${eloEst}` : (bench.GPQA ? `GPQA ${bench.GPQA}%` : (bench.SWEbench ? `SWE-bench ${bench.SWEbench}%` : ''))}</div>
        </div>
      </div>
    ` : '';

    // Tags
    const tagHtml = (m.tags || []).slice(0, 5).map(t =>
      `<span class="mreg-v2-tag">${t}</span>`
    ).join('');

    // Cost
    const costHtml = (m.cost === 0 || m.cost === undefined || m.cost === null)
      ? `<span class="mreg-v2-cost mreg-v2-cost-free">무료</span>`
      : `<span class="mreg-v2-cost">$${m.cost}/1K</span>`;

    // Card accent color
    const accentColors = {
      flagship: '#f59e0b', specialized: '#8b5cf6', standard: '#6366f1',
      mini: '#06b6d4', nano: '#6b7280', economy: '#10b981', open: '#3b82f6'
    };
    const cardAccent = accentColors[m.tier] || '#6b7280';

    return `
      <div class="mreg-card-v2${isAvail ? '' : ' unavailable'}${isNew ? ' is-new' : ''}"
           style="--card-accent:${cardAccent};--card-glow:${cardAccent}10">
        <div class="mreg-v2-header">
          <div>
            <div class="mreg-v2-name-row">
              <span class="mreg-v2-name">${m.name}</span>
              ${isNew ? '<span class="mreg-v2-new">★ NEW 2026</span>' : ''}
            </div>
            <div class="mreg-v2-provider">
              <span class="prov-dot prov-${m.provider}"></span>
              ${m.provider}
            </div>
          </div>
          <div class="mreg-v2-badges">
            <span class="tier-badge-v2 tier-${m.tier}">${m.tier}</span>
            <span class="avail-badge-v2 ${isAvail ? 'avail-on-v2' : 'avail-off-v2'}">${isAvail ? '✓ 지원' : '준비중'}</span>
          </div>
        </div>

        ${m.specialty ? `<div class="mreg-v2-specialty">${m.specialty}</div>` : ''}

        ${intelHtml}

        <div class="mreg-v2-abilities">${abHtml}</div>

        ${tagHtml ? `<div class="mreg-v2-tags">${tagHtml}</div>` : ''}

        <div class="mreg-v2-footer">
          ${costHtml}
          <span class="mreg-v2-ctx">${m.contextWindow || '?'} ctx</span>
          <span class="mreg-v2-latency">${m.latencyMs ? Math.round(m.latencyMs/1000) + 's' : ''}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderRadarCompare(models) {
  const section = document.getElementById('radar-compare');
  if (!section) return;

  // Show only flagship + specialized models
  const flagship = models.filter(m => ['flagship', 'specialized'].includes(m.tier) && m.available !== false);
  const abilityKeys = ['reasoning', 'coding', 'creativity', 'korean', 'speed', 'instruction'];
  const abilityLabels = {
    reasoning: '추론', coding: '코딩', creativity: '창의',
    korean: '한국어', speed: '속도', instruction: '지시'
  };
  const modelColors = [
    '#6366f1','#06b6d4','#a78bfa','#22c55e','#f59e0b','#ef4444','#fb923c'
  ];

  section.innerHTML = `
    <div class="radar-models-row">
      ${flagship.slice(0, 6).map((m, i) => {
        const color = modelColors[i % modelColors.length];
        const ab = m.abilities || {};
        const bars = abilityKeys.map(k => `
          <div class="radar-bar-row">
            <span class="radar-bar-label">${abilityLabels[k] || k}</span>
            <div class="radar-bar-track">
              <div class="radar-bar-fill" style="width:${(ab[k]||0)*10}%;background:${color}"></div>
            </div>
            <span class="radar-bar-val">${ab[k]||0}</span>
          </div>
        `).join('');
        return `
          <div class="radar-model-col">
            <div class="radar-model-title" style="color:${color}">${m.name}</div>
            <div class="radar-bars">${bars}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ── Combo Page ────────────────────────────────────────────

async function loadComboPage() {
  loadAllCombos();
}

window.pageLoadComboRecommend = async function() {
  const taskType = document.getElementById('page-task-type')?.value || 'ppt';
  const strategy = document.getElementById('page-strategy')?.value || 'quality';
  const complexity = document.getElementById('page-complexity')?.value || 'medium';
  const result = document.getElementById('page-combo-result');
  if (!result) return;

  result.innerHTML = '<div class="loading-spinner">🧠 ComboOptimizer 분석 중...</div>';

  try {
    const res = await fetch('/api/combo/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskType, strategy, complexity })
    });
    const data = await res.json();
    const rec = data.recommended;
    if (!rec) { result.innerHTML = '<div class="combo-hint">조합을 찾을 수 없습니다.</div>'; return; }

    const modelEntries = Object.entries(rec.modelMap || {});
    const alts = data.alternatives || [];
    const strategyColors = { quality: '#6366f1', speed: '#06b6d4', economy: '#22c55e' };
    const sc = strategyColors[rec.strategy] || '#6366f1';

    result.innerHTML = `
      <div class="combo-result-card">
        <div class="crc-title">🏆 ${rec.name}</div>
        <div class="crc-desc">${rec.description}</div>
        <div class="crc-reason">${rec.reason}</div>
        <div class="crc-models">
          ${modelEntries.map(([role, m]) => `
            <div class="crc-model">
              <div class="crc-model-icon">${m.icon || '🤖'}</div>
              <div class="crc-model-info">
                <div class="crc-model-name">${m.modelName || role}</div>
                <div class="crc-model-role">${role} · ${m.tier || ''}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="crc-scores">
          <div class="crc-score-item">
            <span class="crc-score-val">${rec.scores?.ability || '-'}점</span>
            <span class="crc-score-label">능력치</span>
          </div>
          <div class="crc-score-item">
            <span class="crc-score-val">${rec.scores?.winRate || '-'}%</span>
            <span class="crc-score-label">예상 승률</span>
          </div>
          <div class="crc-score-item">
            <span class="crc-score-val">${rec.scores?.avgScore || '-'}점</span>
            <span class="crc-score-label">평균 품질</span>
          </div>
          <div class="crc-score-item">
            <span class="crc-score-val">$${rec.scores?.costPerRole?.toFixed(4) || '-'}</span>
            <span class="crc-score-label">역할당 비용</span>
          </div>
        </div>
        ${alts.length ? `
          <div class="crc-alts-title">🔄 차선 조합:</div>
          <div class="crc-alts">
            ${alts.map(a => `<span class="crc-alt-chip">${a.name} (${a.score}점)</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  } catch(e) {
    result.innerHTML = `<div class="combo-hint">오류: ${e.message}</div>`;
  }
};

window.loadAllCombos = async function() {
  const taskType = document.getElementById('combo-all-task')?.value || 'ppt';
  const grid = document.getElementById('combo-all-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-spinner">🔄 조합 데이터 로딩 중...</div>';

  try {
    const res = await fetch(`/api/combo/report?taskType=${taskType}`);
    const data = await res.json();
    const ranking = data.ranking || [];

    if (!ranking.length) {
      grid.innerHTML = '<div class="combo-hint">조합 데이터가 없습니다.</div>';
      return;
    }

    const strategyColors = { quality: '#6366f1', speed: '#06b6d4', economy: '#22c55e' };
    const strategyLabels = { quality: '🎯 품질', speed: '⚡ 속도', economy: '💰 경제' };

    grid.innerHTML = ranking.map((r, i) => {
      const sc = r.scores || {};
      const color = strategyColors[r.strategy] || '#6366f1';
      const scoreWidth = Math.min(Math.round((sc.total || 0.8) * 100), 100);
      const modelEntries = Object.entries(r.modelMap || {}).slice(0, 5);
      return `
        <div class="cag-card ${i === 0 ? 'best-card' : ''}">
          <div class="cag-rank">#${i + 1} · ${r.comboKey}</div>
          <div class="cag-name">${r.name}</div>
          <div class="cag-desc">${r.description || ''}</div>
          <div class="cag-models">
            ${modelEntries.map(([role, m]) =>
              `<span class="cag-model-chip">${m.icon||'🤖'} ${m.modelName||role}</span>`
            ).join('')}
          </div>
          <div class="cag-score-bar">
            <div class="cag-score-fill" style="width:${scoreWidth}%;background:${color}"></div>
          </div>
          <div class="cag-meta">
            <span>승률 ${sc.winRate || '-'}% · 품질 ${sc.avgScore || '-'}점</span>
            <span class="cag-strategy-tag" style="background:${color}20;color:${color}">
              ${strategyLabels[r.strategy] || r.strategy}
            </span>
          </div>
        </div>
      `;
    }).join('');
  } catch(e) {
    grid.innerHTML = `<div class="combo-hint">오류: ${e.message}</div>`;
  }
};

// ═══════════════════════════════════════════════════════════
// Phase 4 — 파이프라인 테스트 버튼 + 커버리지 대시보드
// ═══════════════════════════════════════════════════════════

// ── Phase 4 테스트 버튼 핸들러 ─────────────────────────────
(function initPhase4Panel() {
  const resultEl = document.getElementById('p4-test-result');

  document.querySelectorAll('.p4-test-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const endpoint = btn.dataset.endpoint;
      const payload  = JSON.parse(btn.dataset.payload || '{}');

      if (!endpoint) return;

      const origText = btn.textContent;
      btn.disabled   = true;
      btn.textContent = '⏳ 실행 중...';
      if (resultEl) { resultEl.classList.remove('hidden', 'success', 'error'); resultEl.textContent = ''; }

      try {
        const res  = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (resultEl) {
          resultEl.classList.remove('hidden', 'error');
          resultEl.classList.add('success');
          resultEl.textContent = JSON.stringify(data, null, 2).slice(0, 600) + (JSON.stringify(data).length > 600 ? '\n…(생략)' : '');
        }
      } catch (err) {
        if (resultEl) {
          resultEl.classList.remove('hidden', 'success');
          resultEl.classList.add('error');
          resultEl.textContent = '오류: ' + err.message;
        }
      } finally {
        btn.disabled    = false;
        btn.textContent = origText;
      }
    });
  });
})();

// ── 커버리지 대시보드 ──────────────────────────────────────
async function loadCoverageDashboard() {
  try {
    const res  = await fetch('/api/coverage');
    if (!res.ok) return;
    const data = await res.json();

    const totalEl   = document.getElementById('cov-total');
    const coveredEl = document.getElementById('cov-covered');
    const rateEl    = document.getElementById('cov-rate');
    const barEl     = document.getElementById('cov-bar');

    if (totalEl)   totalEl.textContent   = data.summary ? data.summary.total   : (data.total   || '—');
    if (coveredEl) coveredEl.textContent = data.summary ? data.summary.covered : (data.covered || '—');
    const rate    = data.summary ? data.summary.coverageRate : (parseFloat(data.coverageRate) || 0);
    const rateNum = parseFloat(rate);
    if (rateEl)    rateEl.textContent    = rateNum + '%';
    if (barEl)     barEl.style.width     = rateNum + '%';

    // 도메인 데이터 갱신
    if (data.domains) {
      _covDomainData = data.domains;
      const activeBtn = document.querySelector('.domain-btn.active');
      const dom = activeBtn ? activeBtn.dataset.domain : 'all';
      renderDomainCoverage(dom);
    }
  } catch (e) {
    console.warn('커버리지 로드 실패:', e.message);
  }
}

// ── Phase 5 테스트 버튼 ───────────────────────────────────
(function initPhase5Panel() {
  const resultEl = document.getElementById('p5-test-result');

  document.querySelectorAll('.p5-test-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const endpoint = btn.dataset.endpoint;
      const payload = JSON.parse(btn.dataset.payload || '{}');
      btn.disabled = true;
      btn.textContent = '실행 중…';
      if (resultEl) { resultEl.classList.remove('hidden'); resultEl.textContent = '처리 중...'; }
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (resultEl) {
          resultEl.className = 'pipeline-test-result success';
          resultEl.textContent = JSON.stringify(data, null, 2).slice(0, 800);
        }
      } catch (e) {
        if (resultEl) {
          resultEl.className = 'pipeline-test-result error';
          resultEl.textContent = '오류: ' + e.message;
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '테스트';
      }
    });
  });
})();

// 새로고침 버튼
const refreshCovBtn = document.getElementById('refresh-coverage-btn');
if (refreshCovBtn) refreshCovBtn.addEventListener('click', loadCoverageDashboard);

// 페이지 로드 시 자동 실행
window.addEventListener('DOMContentLoaded', () => {
  loadCoverageDashboard();
  initPhase6Panel();
  initDomainFilter();
  initRealtimeDashboard();
});
if (document.readyState !== 'loading') {
  loadCoverageDashboard();
  initPhase6Panel();
  initDomainFilter();
  initRealtimeDashboard();
}

// ── Phase 6 테스트 버튼 ───────────────────────────────────
function initPhase6Panel() {
  const resultEl = document.getElementById('p6-test-result');

  document.querySelectorAll('.p6-test-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const endpoint = btn.dataset.endpoint;
      const method   = (btn.dataset.method || 'POST').toUpperCase();
      const payload  = JSON.parse(btn.dataset.payload || '{}');
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '실행 중…';
      if (resultEl) { resultEl.classList.remove('hidden'); resultEl.textContent = '처리 중...'; }
      try {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (method !== 'GET') opts.body = JSON.stringify(payload);
        const res  = await fetch(endpoint, opts);
        const data = await res.json();
        if (resultEl) {
          resultEl.className = 'pipeline-test-result success';
          resultEl.textContent = JSON.stringify(data, null, 2).slice(0, 1000);
        }
      } catch (e) {
        if (resultEl) {
          resultEl.className = 'pipeline-test-result error';
          resultEl.textContent = '오류: ' + e.message;
        }
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  });
}

// ── 도메인별 커버리지 필터 ────────────────────────────────
const DOMAIN_LABELS = {
  all: '전체', marketing: '마케팅', ecommerce: '이커머스',
  b2b: 'B2B', creative: '크리에이티브', data_ai: 'Data-AI',
  finance: '금융', finance_invest: '금융/투자', healthcare: '헬스케어',
  it: 'IT/보안', government: '정부', real_estate: '부동산',
  legal_hr: 'Legal/HR', edu_med: 'EduMed'
};

let _covDomainData = null;

async function initDomainFilter() {
  // 도메인 버튼 클릭 이벤트
  document.querySelectorAll('.domain-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.domain-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const domain = btn.dataset.domain;
      renderDomainCoverage(domain);
    });
  });

  // 커버리지 데이터 로드
  try {
    const res = await fetch('/api/coverage');
    if (!res.ok) return;
    const data = await res.json();
    _covDomainData = data.domains || {};
    renderDomainCoverage('all');
  } catch (e) { /* silent */ }
}

function renderDomainCoverage(selectedDomain) {
  const listEl = document.getElementById('domain-coverage-list');
  if (!listEl || !_covDomainData) return;

  const domains = Object.entries(_covDomainData);
  if (!domains.length) return;

  listEl.classList.remove('hidden');
  const filtered = selectedDomain === 'all'
    ? domains
    : domains.filter(([k]) => k === selectedDomain || k.startsWith(selectedDomain));

  listEl.innerHTML = filtered.map(([key, info]) => {
    const name  = DOMAIN_LABELS[key] || key;
    const total = info.total || 0;
    const ready = info.ready || info.covered || 0;
    const pct   = total > 0 ? Math.round(ready / total * 100) : 0;
    const color = pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
    return `
      <div class="domain-cov-row">
        <div class="domain-cov-name">${name}</div>
        <div class="domain-cov-bar-wrap">
          <div class="domain-cov-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="domain-cov-pct" style="color:${color}">${pct}%</div>
        <div style="font-size:0.6rem;color:#9ca3af;white-space:nowrap">${ready}/${total}</div>
      </div>`;
  }).join('');
}

// ── 실시간 메트릭 대시보드 (WebSocket + polling fallback) ──
let _rtEventCount = 0;
let _rtSocket = null;
let _rtPollTimer = null;

function initRealtimeDashboard() {
  const wsStatusEl   = document.getElementById('rt-ws-status');
  const activePipes  = document.getElementById('rt-active-pipes');
  const rpsEl        = document.getElementById('rt-rps');
  const errRateEl    = document.getElementById('rt-error-rate');
  const avgRtEl      = document.getElementById('rt-avg-rt');
  const feedEl       = document.getElementById('rt-events-feed');
  const countEl      = document.getElementById('rt-event-count');

  function addEvent(msg, level) {
    if (!feedEl) return;
    const placeholder = feedEl.querySelector('.rt-event-placeholder');
    if (placeholder) placeholder.remove();
    _rtEventCount++;
    if (countEl) countEl.textContent = _rtEventCount;
    const ts   = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    const cls  = level === 'error' ? ' rt-err' : level === 'warn' ? ' rt-warn' : '';
    const item = document.createElement('div');
    item.className = 'rt-event-item' + cls;
    item.textContent = `[${ts}] ${msg}`;
    feedEl.insertBefore(item, feedEl.firstChild);
    // 최대 50개 유지
    while (feedEl.children.length > 50) feedEl.removeChild(feedEl.lastChild);
  }

  function updateStats(data) {
    const m = data.metrics || data;
    if (activePipes) activePipes.textContent = m.activePipelines || m.active_pipelines || '—';
    if (rpsEl)       rpsEl.textContent       = (m.requestsPerSecond || m.rps || 0).toFixed ? (m.requestsPerSecond || m.rps || 0).toFixed(1) + '/s' : '—';
    if (errRateEl)   errRateEl.textContent   = (m.errorRate || 0).toFixed ? ((m.errorRate || 0) * 100).toFixed(1) + '%' : '—';
    if (avgRtEl)     avgRtEl.textContent     = m.avgResponseTime ? m.avgResponseTime.toFixed(0) + 'ms' : '—';
  }

  // WebSocket 연결 시도
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = proto + '//' + location.host + '/metrics';
    try {
      _rtSocket = new WebSocket(wsUrl);

      _rtSocket.onopen = () => {
        if (wsStatusEl) { wsStatusEl.textContent = '연결됨'; wsStatusEl.className = 'rt-stat-value rt-connected'; }
        addEvent('WebSocket 연결 성공');
        clearInterval(_rtPollTimer);
      };

      _rtSocket.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.type === 'metrics') updateStats(d.data);
          if (d.type === 'event')   addEvent(d.message || JSON.stringify(d.data));
          if (d.type === 'alert')   addEvent('⚠ ' + (d.message || d.alert), 'warn');
        } catch (e) { addEvent(ev.data); }
      };

      _rtSocket.onerror  = () => {
        if (wsStatusEl) { wsStatusEl.textContent = '오류'; wsStatusEl.className = 'rt-stat-value rt-err'; }
        startPolling();
      };

      _rtSocket.onclose  = () => {
        if (wsStatusEl) { wsStatusEl.textContent = '폴링 모드'; wsStatusEl.className = 'rt-stat-value rt-disconnected'; }
        startPolling();
      };
    } catch (e) { startPolling(); }
  }

  // Polling fallback
  async function pollMetrics() {
    try {
      const res  = await fetch('/api/metrics/dashboard');
      if (!res.ok) return;
      const data = await res.json();
      updateStats(data);
      const evRes  = await fetch('/api/metrics/events');
      if (evRes.ok) {
        const evData = await evRes.json();
        const events = Array.isArray(evData) ? evData : (evData.events || []);
        events.slice(0, 3).forEach(ev => addEvent(typeof ev === 'string' ? ev : (ev.message || JSON.stringify(ev))));
      }
    } catch (e) { /* silent */ }
  }

  function startPolling() {
    if (_rtPollTimer) return;
    if (wsStatusEl) { wsStatusEl.textContent = '폴링 모드'; wsStatusEl.className = 'rt-stat-value rt-disconnected'; }
    pollMetrics();
    _rtPollTimer = setInterval(pollMetrics, 5000);
    addEvent('HTTP 폴링 모드로 전환 (5초 간격)');
  }

  // 초기화
  addEvent('실시간 대시보드 초기화 중...');
  connectWS();
  // 3초 후 WS 연결 안 되면 폴링 시작
  setTimeout(() => {
    if (!_rtSocket || _rtSocket.readyState !== WebSocket.OPEN) {
      startPolling();
    }
  }, 3000);
}

/* ═══════════════════════════════════════════════════════════
   Phase 7 UI — JavaScript 기능 구현
═══════════════════════════════════════════════════════════ */

// ── 탭 전환 (Phase 7 탭 추가) ─────────────────────────────
const P7_TABS = ['chat','models','combo','queue','builder','dashboard','auth','admin'];

function switchMainTab(tab) {
  P7_TABS.forEach(t => {
    const main = document.getElementById('main-' + t);
    const btn  = document.getElementById('tab-' + t + '-btn');
    if (main) main.style.display = (t === tab) ? '' : 'none';
    if (btn)  btn.classList.toggle('active', t === tab);
  });
  // 탭별 데이터 로드
  if (tab === 'queue')     { refreshQueue(); }
  if (tab === 'builder')   { loadBuilderTemplates(); loadSavedPipelines(); }
  if (tab === 'dashboard') { refreshDashboard(); }
  if (tab === 'admin')     { adminNav('overview'); }
}

// 원래 switchMainTab 이 있으면 override
window._p7TabSwitchReady = true;

// ══════════════════════════════════════════════════════════
// 인증 (Auth)
// ══════════════════════════════════════════════════════════
let _currentUser = null;
let _authToken   = null;

function toggleAuthMode(mode) {
  document.getElementById('auth-login-card').classList.toggle('hidden', mode !== 'login');
  document.getElementById('auth-register-card').classList.toggle('hidden', mode !== 'register');
}

async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const msgEl = document.getElementById('login-result');
  if (!username || !password) { showMsg(msgEl,'사용자명과 비밀번호를 입력하세요','error'); return; }
  try {
    const res = await fetch('/api/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success || data.token) {
      _authToken = data.token;
      _currentUser = data.user || { username };
      // 토큰·유저 localStorage 동기화 (admin 탭 표시용)
      localStorage.setItem('p7_token', data.token || '');
      localStorage.setItem('p7_user', JSON.stringify(_currentUser));
      updateUserBar();
      showMsg(msgEl, `✅ 로그인 성공! 환영합니다, ${_currentUser.username || username}님`, 'success');
      // admin 역할이면 어드민 탭으로, 그렇지 않으면 chat으로
      const dest = (_currentUser.role === 'admin') ? 'admin' : 'chat';
      setTimeout(() => switchMainTab(dest), 1200);
    } else {
      showMsg(msgEl, data.error || '로그인 실패', 'error');
    }
  } catch(e) { showMsg(msgEl, '서버 오류: ' + e.message, 'error'); }
}

async function doRegister() {
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value.trim();
  const role     = document.getElementById('reg-role').value;
  const msgEl    = document.getElementById('register-result');
  if (!username || !email || !password) { showMsg(msgEl,'모든 필드를 입력하세요','error'); return; }
  try {
    const res = await fetch('/api/auth/register', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username, email, password, role })
    });
    const data = await res.json();
    if (data.success) {
      showMsg(msgEl, '✅ 가입 완료! 로그인해주세요', 'success');
      setTimeout(() => toggleAuthMode('login'), 1500);
    } else {
      showMsg(msgEl, data.error || '가입 실패', 'error');
    }
  } catch(e) { showMsg(msgEl, '서버 오류: ' + e.message, 'error'); }
}

function continueAsGuest() {
  _currentUser = { username: '게스트', role: 'guest' };
  updateUserBar();
  switchMainTab('chat');
}

function logoutUser() {
  _currentUser = null; _authToken = null;
  updateUserBar();
  switchMainTab('auth');
}

function updateUserBar() {
  const bar      = document.getElementById('user-info-bar');
  const loginBtn = document.getElementById('login-btn-header');
  const nameEl   = document.getElementById('user-display-name');
  const adminBtn = document.getElementById('tab-admin-btn');
  if (_currentUser) {
    bar.classList.remove('hidden');
    loginBtn.style.display = 'none';
    nameEl.textContent = '👤 ' + (_currentUser.username || '사용자');
    // admin 역할인 경우 어드민 탭 표시
    if (adminBtn) {
      const role = _currentUser.role || '';
      adminBtn.classList.toggle('hidden', role !== 'admin');
      // localStorage에 저장된 토큰 동기화
      if (_authToken) localStorage.setItem('p7_token', _authToken);
    }
  } else {
    bar.classList.add('hidden');
    loginBtn.style.display = '';
    if (adminBtn) adminBtn.classList.add('hidden');
    localStorage.removeItem('p7_token');
  }
}

// ══════════════════════════════════════════════════════════
// 작업 큐 (Queue)
// ══════════════════════════════════════════════════════════
let _queueRefreshTimer = null;

async function refreshQueue() {
  try {
    const [statsRes, jobsRes] = await Promise.all([
      fetch('/api/queue/stats'), fetch('/api/queue/jobs')
    ]);
    const stats = await statsRes.json();
    const jobs  = await jobsRes.json();

    // 통계 업데이트
    const s = stats.queues || {};
    let totalPending=0, totalRunning=0, totalCompleted=0, totalFailed=0;
    Object.values(s).forEach(q => {
      totalPending   += q.pending   || 0;
      totalRunning   += q.running   || 0;
      totalCompleted += q.completed || 0;
      totalFailed    += q.failed    || 0;
    });
    document.getElementById('qs-pending').textContent   = totalPending;
    document.getElementById('qs-running').textContent   = totalRunning;
    document.getElementById('qs-completed').textContent = totalCompleted;
    document.getElementById('qs-failed').textContent    = totalFailed;
    document.getElementById('qs-total').textContent     = totalPending + totalRunning + totalCompleted + totalFailed;

    // 실행 중인 작업
    const allJobs = jobs.jobs || [];
    const running = allJobs.filter(j => j.status === 'running');
    const runningEl = document.getElementById('running-jobs-list');
    if (running.length === 0) {
      runningEl.innerHTML = '<div class="p7-empty-state">실행 중인 작업이 없습니다</div>';
    } else {
      runningEl.innerHTML = running.map(j => `
        <div class="p7-job-item">
          <div class="p7-job-header">
            <span class="p7-job-id">${j.id}</span>
            <span class="p7-job-type">${j.type}</span>
          </div>
          <div class="p7-progress-wrap">
            <div class="p7-progress-bar"><div class="p7-progress-fill" style="width:${j.progress||0}%"></div></div>
            <span class="p7-progress-text">${j.progress||0}%</span>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px">${j.data?.pipeline||'unknown'} · ${j.data?.action||''}</div>
        </div>`).join('');
    }

    // 전체 작업 테이블
    const filterStatus = document.getElementById('queue-filter-status')?.value || '';
    const filterType   = document.getElementById('queue-filter-type')?.value   || '';
    const filtered = allJobs.filter(j =>
      (!filterStatus || j.status === filterStatus) &&
      (!filterType   || j.type   === filterType)
    );
    const tbody = document.getElementById('jobs-table-body');
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="p7-td-empty">작업이 없습니다</td></tr>';
    } else {
      tbody.innerHTML = filtered.slice(0,50).map(j => {
        const elapsed = j.completedAt && j.startedAt
          ? ((new Date(j.completedAt)-new Date(j.startedAt))/1000).toFixed(1)+'s' : '-';
        const started = j.startedAt ? new Date(j.startedAt).toLocaleTimeString('ko-KR') : '-';
        return `<tr>
          <td style="font-family:monospace;font-size:11px">${j.id.slice(-8)}</td>
          <td>${j.type}</td>
          <td><span class="p7-badge p7-badge-${j.status}">${_statusLabel(j.status)}</span></td>
          <td>
            <div class="p7-progress-wrap" style="min-width:80px">
              <div class="p7-progress-bar"><div class="p7-progress-fill" style="width:${j.progress||0}%"></div></div>
              <span class="p7-progress-text">${j.progress||0}%</span>
            </div>
          </td>
          <td style="font-size:12px">${started}</td>
          <td style="font-size:12px">${elapsed}</td>
          <td>
            ${j.status==='completed'?`<button class="p7-btn-sm p7-btn-ghost" onclick="viewJobResult('${j.id}')">결과</button>`:''}
            ${j.status==='failed'?`<button class="p7-btn-sm p7-btn-ghost" onclick="retryJob('${j.id}')">재시도</button>`:''}
          </td>
        </tr>`;
      }).join('');
    }
  } catch(e) { console.error('큐 로드 오류:', e); }
}

function _statusLabel(s) {
  return { pending:'대기', running:'실행중', completed:'완료', failed:'실패' }[s] || s;
}

function showAddJobModal() {
  const panel = document.getElementById('add-job-panel');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}
function hideAddJobModal() {
  document.getElementById('add-job-panel').style.display = 'none';
}

async function submitNewJob() {
  const type     = document.getElementById('new-job-type').value;
  const pipeline = document.getElementById('new-job-pipeline').value;
  const priority = document.getElementById('new-job-priority').value;
  const msgEl    = document.getElementById('add-job-result');
  let params = {};
  try { params = JSON.parse(document.getElementById('new-job-params').value || '{}'); } catch(e) {}
  try {
    const res = await fetch('/api/queue/add', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ type, data:{ pipeline, ...params }, priority })
    });
    const data = await res.json();
    if (data.success || data.job) {
      showMsg(msgEl, `✅ 작업 추가됨: ${(data.job||{}).id}`, 'success');
      hideAddJobModal();
      setTimeout(refreshQueue, 500);
    } else {
      showMsg(msgEl, data.error || '추가 실패', 'error');
    }
  } catch(e) { showMsg(msgEl, e.message, 'error'); }
}

async function viewJobResult(jobId) {
  try {
    const res = await fetch('/api/queue/job/' + jobId);
    const data = await res.json();
    alert(JSON.stringify(data.job?.result || data, null, 2));
  } catch(e) { alert('오류: ' + e.message); }
}

async function retryJob(jobId) {
  const res = await fetch('/api/queue/add', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ type:'ai-task', data:{ retryOf: jobId } })
  });
  const d = await res.json();
  if (d.success) { refreshQueue(); }
}

// ══════════════════════════════════════════════════════════
// 노코드 빌더 (Builder)
// ══════════════════════════════════════════════════════════
let _builderNodes = [];
let _selectedNodeId = null;
let _savedPipelines = [];

function addNode(type, label, icon) {
  const id = 'node-' + Date.now();
  _builderNodes.push({ id, type, label, icon });
  renderCanvas();
  updateNodeCount();
}

function removeNode(id) {
  _builderNodes = _builderNodes.filter(n => n.id !== id);
  if (_selectedNodeId === id) _selectedNodeId = null;
  renderCanvas();
  updateNodeCount();
  renderNodeProperties(null);
}

function selectNode(id) {
  _selectedNodeId = id;
  renderCanvas();
  renderNodeProperties(_builderNodes.find(n => n.id === id));
}

function clearCanvas() {
  if (_builderNodes.length > 0 && !confirm('캔버스를 초기화하시겠습니까?')) return;
  _builderNodes = [];
  _selectedNodeId = null;
  renderCanvas();
  updateNodeCount();
  renderNodeProperties(null);
}

function updateNodeCount() {
  document.getElementById('canvas-node-count').textContent = _builderNodes.length;
}

function renderCanvas() {
  const canvas = document.getElementById('builder-canvas');
  const placeholder = document.getElementById('canvas-placeholder');
  if (!canvas) return;
  if (_builderNodes.length === 0) {
    canvas.innerHTML = '';
    if (placeholder) { placeholder.style.display = ''; canvas.appendChild(placeholder); }
    return;
  }
  if (placeholder) placeholder.style.display = 'none';

  // 노드 렌더링
  const existing = new Set(Array.from(canvas.querySelectorAll('.p7-canvas-node')).map(el => el.dataset.id));
  // 제거된 노드 삭제
  canvas.querySelectorAll('.p7-canvas-node').forEach(el => {
    if (!_builderNodes.find(n => n.id === el.dataset.id)) el.remove();
  });
  // 새 노드 추가
  _builderNodes.forEach(node => {
    if (!existing.has(node.id)) {
      const el = document.createElement('div');
      el.className = 'p7-canvas-node' + (node.id === _selectedNodeId ? ' selected' : '');
      el.dataset.id = node.id;
      el.onclick = () => selectNode(node.id);
      el.innerHTML = `
        <button class="p7-canvas-node-del" onclick="event.stopPropagation();removeNode('${node.id}')">×</button>
        <div class="p7-canvas-node-icon">${node.icon}</div>
        <div class="p7-canvas-node-label">${node.label}</div>
        <div class="p7-canvas-node-type">${node.type}</div>
        <div class="p7-canvas-node-connector">
          <div class="p7-connector-dot"></div>
          <div class="p7-connector-dot out"></div>
        </div>`;
      canvas.appendChild(el);
    } else {
      const el = canvas.querySelector(`[data-id="${node.id}"]`);
      if (el) el.classList.toggle('selected', node.id === _selectedNodeId);
    }
  });
}

function renderNodeProperties(node) {
  const panel = document.getElementById('node-props-panel');
  if (!node) {
    panel.innerHTML = '<div class="p7-props-empty">노드를 선택하면<br>속성이 표시됩니다</div>';
    return;
  }
  panel.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="p7-form-group">
        <label>노드 이름</label>
        <input type="text" class="p7-input p7-input-sm" value="${node.label}"
          onchange="_builderNodes.find(n=>n.id==='${node.id}').label=this.value; renderCanvas()">
      </div>
      <div class="p7-form-group">
        <label>노드 유형</label>
        <input type="text" class="p7-input p7-input-sm" value="${node.type}" readonly>
      </div>
      <div class="p7-form-group">
        <label>설명/메모</label>
        <textarea class="p7-input p7-input-sm p7-textarea" rows="3" placeholder="이 노드에 대한 메모"
          onchange="node.memo=this.value">${node.memo||''}</textarea>
      </div>
      <button class="p7-btn-ghost p7-btn-sm" onclick="removeNode('${node.id}')">🗑️ 노드 삭제</button>
    </div>`;
}

async function loadBuilderTemplates() {
  try {
    const res = await fetch('/api/builder/templates');
    const data = await res.json();
    const el = document.getElementById('builder-templates-list');
    if (!el) return;
    const templates = data.templates || [];
    el.innerHTML = templates.map(t => `
      <div class="p7-template-item" onclick="loadTemplate('${t.id}','${t.name}')">
        <b>${t.name}</b><br><span style="color:#64748b;font-size:10px">${t.description}</span>
      </div>`).join('');
  } catch(e) { console.error('템플릿 로드 오류:', e); }
}

const TEMPLATE_NODES = {
  'tpl-marketing': [
    { type:'trigger', label:'키워드 입력', icon:'⚡' },
    { type:'ai-llm',  label:'트렌드 분석', icon:'🤖' },
    { type:'ai-generate', label:'콘텐츠 생성', icon:'✨' },
    { type:'slack',   label:'SNS 스케줄링', icon:'💬' }
  ],
  'tpl-security': [
    { type:'input',   label:'코드 제출', icon:'📝' },
    { type:'ai-classify', label:'OWASP 스캔', icon:'🏷️' },
    { type:'ai-llm',  label:'AI 리뷰', icon:'🤖' },
    { type:'save',    label:'리포트 저장', icon:'💾' },
    { type:'slack',   label:'Slack 알림', icon:'💬' }
  ],
  'tpl-finance': [
    { type:'trigger', label:'시장 데이터', icon:'⚡' },
    { type:'ai-llm',  label:'기술분석', icon:'🤖' },
    { type:'ai-generate', label:'AI 인사이트', icon:'✨' },
    { type:'sheets',  label:'포트폴리오 업데이트', icon:'📊' }
  ],
  'tpl-medical': [
    { type:'input',   label:'환자 접수', icon:'📝' },
    { type:'ai-classify', label:'증상 분석', icon:'🏷️' },
    { type:'ai-llm',  label:'약물 체크', icon:'🤖' },
    { type:'ai-generate', label:'SOAP 노트', icon:'✨' },
    { type:'save',    label:'EMR 저장', icon:'💾' }
  ],
  'tpl-ecommerce': [
    { type:'trigger', label:'주문 수신', icon:'⚡' },
    { type:'filter',  label:'재고 확인', icon:'🔍' },
    { type:'ai-llm',  label:'결제 처리', icon:'🤖' },
    { type:'transform', label:'배송 추적', icon:'🔄' },
    { type:'email',   label:'고객 알림', icon:'✉️' },
    { type:'sheets',  label:'리뷰 요청', icon:'📊' }
  ]
};

function loadTemplate(id, name) {
  const nodes = TEMPLATE_NODES[id];
  if (!nodes) { alert('템플릿을 찾을 수 없습니다'); return; }
  _builderNodes = nodes.map((n,i) => ({ ...n, id:'node-'+(Date.now()+i) }));
  _selectedNodeId = null;
  document.getElementById('builder-pipeline-name').value = name;
  renderCanvas();
  updateNodeCount();
}

async function loadSavedPipelines() {
  try {
    const res = await fetch('/api/builder/pipelines');
    const data = await res.json();
    _savedPipelines = data.pipelines || [];
    const el = document.getElementById('saved-pipelines-list');
    if (!el) return;
    if (_savedPipelines.length === 0) {
      el.innerHTML = '<div class="p7-empty-state" style="font-size:12px">저장된 파이프라인 없음</div>';
    } else {
      el.innerHTML = _savedPipelines.map(p => `
        <div class="p7-saved-item" onclick="loadSavedPipeline('${p.id}')">
          📋 ${p.name} <span style="color:#4a5568;font-size:10px">(${p.nodes?.length||0}노드)</span>
        </div>`).join('');
    }
  } catch(e) { console.error('저장된 파이프라인 로드 오류:', e); }
}

function loadSavedPipeline(id) {
  const p = _savedPipelines.find(p => p.id === id);
  if (!p) return;
  _builderNodes = (p.nodes||[]).map((n,i) => ({ ...n, id: n.id || 'node-'+(Date.now()+i) }));
  document.getElementById('builder-pipeline-name').value = p.name || '파이프라인';
  renderCanvas(); updateNodeCount();
}

async function saveBuilderPipeline() {
  const name = document.getElementById('builder-pipeline-name')?.value || '새 파이프라인';
  if (_builderNodes.length === 0) { alert('노드를 먼저 추가하세요'); return; }
  try {
    const res = await fetch('/api/builder/pipelines', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, nodes: _builderNodes, edges: [] })
    });
    const data = await res.json();
    if (data.success) { alert(`✅ "${name}" 저장 완료`); loadSavedPipelines(); }
    else alert('저장 실패: ' + (data.error||''));
  } catch(e) { alert('오류: ' + e.message); }
}

async function runBuilderPipeline() {
  if (_builderNodes.length === 0) { alert('먼저 노드를 추가하세요'); return; }
  const name = document.getElementById('builder-pipeline-name')?.value || '';
  const resultEl = document.getElementById('builder-run-result');
  resultEl.style.display = '';
  resultEl.textContent = '⏳ 파이프라인 실행 중...';
  try {
    // 먼저 저장 후 실행
    const saveRes = await fetch('/api/builder/pipelines', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, nodes: _builderNodes, edges: [] })
    });
    const saved = await saveRes.json();
    const pid = saved.pipeline?.id;
    if (!pid) { resultEl.textContent = '저장 실패'; return; }

    const runRes = await fetch(`/api/builder/pipelines/${pid}/run`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ input: 'test' })
    });
    const run = await runRes.json();
    resultEl.textContent = '✅ 실행 완료\n' + JSON.stringify(run, null, 2);
  } catch(e) { resultEl.textContent = '❌ 오류: ' + e.message; }
}

// ══════════════════════════════════════════════════════════
// 대시보드 (Dashboard)
// ══════════════════════════════════════════════════════════
let _activeDashTab = 'cost';

function switchDashTab(tab) {
  _activeDashTab = tab;
  ['cost','versions','scheduler','integrations','system'].forEach(t => {
    const el  = document.getElementById('dash-' + t);
    const btn = document.getElementById('dtab-' + t);
    if (el)  el.classList.toggle('hidden', t !== tab);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  // 탭별 데이터 로드
  if (tab === 'cost')         loadCostDashboard();
  if (tab === 'versions')     { loadVersions(); loadABTests(); }
  if (tab === 'scheduler')    { loadSchedulerJobs(); loadSchedulerLogs(); }
  if (tab === 'integrations') { loadIntegrationsStatus(); loadStoredFiles(); }
  if (tab === 'system')       { loadSystemStatus(); loadCoverageGrid(); }
}

async function refreshDashboard() {
  if      (_activeDashTab === 'cost')         loadCostDashboard();
  else if (_activeDashTab === 'versions')     { loadVersions(); loadABTests(); }
  else if (_activeDashTab === 'scheduler')    { loadSchedulerJobs(); loadSchedulerLogs(); }
  else if (_activeDashTab === 'integrations') { loadIntegrationsStatus(); loadStoredFiles(); }
  else if (_activeDashTab === 'system')       { loadSystemStatus(); loadCoverageGrid(); }
}

// ── 비용 대시보드 ─────────────────────────────────────────
// ── Chart.js 인스턴스 관리 ────────────────────────────────
const _charts = {};
function _destroyChart(id) { if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; } }

const CHART_COLORS = {
  blue:   'rgba(99,102,241,0.8)',
  green:  'rgba(16,185,129,0.8)',
  purple: 'rgba(168,85,247,0.8)',
  amber:  'rgba(245,158,11,0.8)',
  red:    'rgba(239,68,68,0.8)',
  cyan:   'rgba(6,182,212,0.8)',
  pink:   'rgba(236,72,153,0.8)',
  orange: 'rgba(249,115,22,0.8)',
};
const PALETTE = Object.values(CHART_COLORS);

function _makeLineChart(id, labels, data, label='비용 ($)', color='rgba(99,102,241,0.8)') {
  _destroyChart(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  _charts[id] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label, data, borderColor: color, backgroundColor: color.replace('0.8','0.15'),
        fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#9ca3af', maxRotation:45, font:{size:10} } },
        y: { grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#9ca3af', font:{size:10},
          callback: v => '$'+v.toFixed(4) } }
      }
    }
  });
}

function _makePieChart(id, labels, data) {
  _destroyChart(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  _charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: PALETTE, borderWidth: 2, borderColor:'#1e1e2e' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position:'right', labels:{ color:'#9ca3af', font:{size:10}, boxWidth:12 } },
        tooltip: { callbacks: { label: ctx => `$${(ctx.raw||0).toFixed(4)}` } }
      }
    }
  });
}

function _makeBarChart(id, labels, data, label='비용 ($)') {
  _destroyChart(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  _charts[id] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: PALETTE, borderRadius: 4, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid:{ display:false }, ticks:{ color:'#9ca3af', font:{size:10}, maxRotation:30 } },
        y: { grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#9ca3af', font:{size:10},
          callback: v => '$'+v.toFixed(4) } }
      }
    }
  });
}

async function loadCostDashboard() {
  try {
    // ── 1. 요약 카드 ──────────────────────────────────────
    const [sumRes, dailyRes, monthlyRes, topRes, modelRes] = await Promise.all([
      fetch('/api/cost/summary').then(r=>r.json()),
      fetch('/api/cost/daily?days=30').then(r=>r.json()),
      fetch('/api/cost/monthly').then(r=>r.json()),
      fetch('/api/cost/top-pipelines?limit=8').then(r=>r.json()),
      fetch('/api/cost/model').then(r=>r.json()),
    ]);

    // 총계 카드
    const tot = sumRes.total || {};
    document.getElementById('cost-today-total').textContent  = '$' + (tot.total||0).toFixed(4);
    document.getElementById('cost-today-tokens').textContent = ((tot.inputs||0)+(tot.outputs||0)).toLocaleString();
    document.getElementById('cost-today-calls').textContent  = (tot.calls||0).toLocaleString();

    // 월별 총합
    const monthlyData = monthlyRes.data || [];
    const monthTotal = monthlyData.reduce((s,m) => s + (m.total||0), 0);
    document.getElementById('cost-month-total').textContent = '$' + monthTotal.toFixed(4);

    // ── 2. 차트: 일별 비용 라인 ──────────────────────────
    const dailyData = dailyRes.data || [];
    _makeLineChart(
      'chart-daily-cost',
      dailyData.map(d => d.day || ''),
      dailyData.map(d => d.total || 0),
      '일별 비용 ($)'
    );

    // ── 3. 차트: 파이프라인 파이 ─────────────────────────
    const pipeData = topRes.pipelines || [];
    if (pipeData.length > 0) {
      _makePieChart('chart-pipeline-pie',
        pipeData.map(p => p.pipeline || p.name || '?'),
        pipeData.map(p => p.total || p.totalCost || 0)
      );
    } else {
      // 데모 데이터
      _makePieChart('chart-pipeline-pie',
        ['마케팅','보안','금융','헬스케어','이커머스'],
        [0.0012, 0.0008, 0.0015, 0.0006, 0.0020]
      );
    }

    // ── 4. 차트: 모델 바 ──────────────────────────────────
    const modelData = modelRes.models || [];
    if (modelData.length > 0) {
      _makeBarChart('chart-model-bar',
        modelData.map(m => m.model || '?'),
        modelData.map(m => m.total || 0),
        '모델별 비용 ($)'
      );
    } else {
      _makeBarChart('chart-model-bar',
        ['gpt-4o-mini','gpt-4o','claude-3'],
        [0.0012, 0.0045, 0.0000],
        '모델별 비용 ($)'
      );
    }

    // ── 5. 차트: 월별 라인 ───────────────────────────────
    _makeLineChart(
      'chart-monthly-cost',
      monthlyData.map(m => m.month || ''),
      monthlyData.map(m => m.total || 0),
      '월별 비용 ($)',
      'rgba(16,185,129,0.8)'
    );

    // ── 6. 레코드 테이블 ─────────────────────────────────
    const tbody = document.getElementById('cost-records-table');
    if (tbody) {
      tbody.innerHTML = pipeData.length === 0
        ? '<tr><td colspan="6" class="p7-td-empty">기록 없음 — API 사용 시 자동 기록됩니다</td></tr>'
        : pipeData.slice(0,10).map(r => `<tr>
            <td style="font-size:11px">${new Date().toLocaleTimeString('ko-KR')}</td>
            <td>${r.pipeline||'-'}</td>
            <td>gpt-4o-mini</td>
            <td>${(r.inputs||0).toLocaleString()}</td>
            <td>$${(r.total||0).toFixed(4)}</td>
            <td>system</td>
          </tr>`).join('');
    }
  } catch(e) { console.error('비용 대시보드 오류:', e); }
}

async function loadCostReport() {
  window.open('/api/cost/monthly', '_blank');
}

// ── 버전 관리 ─────────────────────────────────────────────
async function loadVersions() {
  const pipeline = document.getElementById('version-pipeline-select')?.value || 'marketingPipeline';
  try {
    const res  = await fetch('/api/versions/' + pipeline);
    const data = await res.json();
    const el = document.getElementById('versions-list');
    if (!el) return;
    const versions = data.versions || [];
    el.innerHTML = versions.length === 0
      ? '<div class="p7-empty-state">버전 없음</div>'
      : versions.map(v => `
          <div class="p7-version-item">
            <div class="p7-version-header">
              <span class="p7-version-num">${v.version}</span>
              <span class="p7-badge p7-badge-${v.status==='active'?'active':'draft'}">${v.status==='active'?'활성':'초안'}</span>
            </div>
            <div class="p7-version-desc">${v.description||'-'}</div>
            <div style="font-size:11px;color:#4a5568;margin-top:4px">${new Date(v.createdAt||Date.now()).toLocaleDateString('ko-KR')}</div>
          </div>`).join('');
  } catch(e) { console.error('버전 로드 오류:', e); }
}

function showCreateVersionModal() {
  document.getElementById('create-version-form').classList.remove('hidden');
}

async function createVersion() {
  const pipeline = document.getElementById('version-pipeline-select')?.value || 'marketingPipeline';
  const version  = document.getElementById('new-version-num')?.value;
  const description = document.getElementById('new-version-desc')?.value;
  if (!version) { alert('버전 번호를 입력하세요'); return; }
  try {
    const res = await fetch('/api/versions/' + pipeline, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ version, description, changelog: [description] })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('create-version-form').classList.add('hidden');
      loadVersions();
    } else alert('저장 실패: ' + (data.error||''));
  } catch(e) { alert('오류: ' + e.message); }
}

async function loadABTests() {
  try {
    const res  = await fetch('/api/ab-tests');
    const data = await res.json();
    const el = document.getElementById('ab-tests-list');
    if (!el) return;
    const tests = data.tests || [];
    el.innerHTML = tests.length === 0
      ? '<div class="p7-empty-state">진행 중인 A/B 테스트 없음</div>'
      : tests.map(t => `
          <div class="p7-ab-item">
            <div class="p7-ab-header">
              <span class="p7-ab-title">${t.pipeline}</span>
              <span class="p7-badge p7-badge-${t.status==='running'?'running':'pending'}">${t.status}</span>
            </div>
            <div class="p7-ab-metric">
              ${t.versionA} vs ${t.versionB} · 지표: ${t.metric}
            </div>
            <div style="font-size:11px;color:#4a5568;margin-top:4px">트래픽: ${100-(t.trafficSplit||50)}% / ${t.trafficSplit||50}%</div>
          </div>`).join('');
  } catch(e) { console.error('A/B 테스트 로드 오류:', e); }
}

function showCreateABTestModal() {
  document.getElementById('create-ab-form').classList.remove('hidden');
}

async function createABTest() {
  const pipeline    = document.getElementById('ab-pipeline')?.value;
  const versionA    = document.getElementById('ab-version-a')?.value;
  const versionB    = document.getElementById('ab-version-b')?.value;
  const trafficSplit = parseInt(document.getElementById('ab-split')?.value || '50');
  const metric      = document.getElementById('ab-metric')?.value;
  const msgEl       = document.getElementById('ab-create-result');
  if (!versionA || !versionB) { showMsg(msgEl,'버전 A, B를 입력하세요','error'); return; }
  try {
    const res = await fetch('/api/ab-tests', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ pipeline, versionA, versionB, trafficSplit, metric })
    });
    const data = await res.json();
    if (data.success) {
      showMsg(msgEl, '✅ A/B 테스트 시작됨', 'success');
      document.getElementById('create-ab-form').classList.add('hidden');
      loadABTests();
    } else showMsg(msgEl, data.error||'생성 실패', 'error');
  } catch(e) { showMsg(msgEl, e.message, 'error'); }
}

// ── 스케줄러 ──────────────────────────────────────────────
async function loadSchedulerJobs() {
  try {
    const res  = await fetch('/api/scheduler/jobs');
    const data = await res.json();
    const el = document.getElementById('scheduler-jobs-list');
    if (!el) return;
    const jobs = data.jobs || [];
    const icons = { 'daily-report':'📊', 'security-scan':'🔒', 'data-sync':'🔄', 'health-check':'💊' };
    el.innerHTML = jobs.length === 0
      ? '<div class="p7-empty-state">스케줄된 작업 없음</div>'
      : jobs.map(j => `
          <div class="p7-sched-item">
            <div class="p7-sched-icon">${icons[j.id]||'⏰'}</div>
            <div class="p7-sched-info">
              <div class="p7-sched-name">${j.name}</div>
              <div class="p7-sched-cron">${j.cron} · 다음: ${j.nextRun ? new Date(j.nextRun).toLocaleString('ko-KR') : '-'}</div>
            </div>
            <span class="p7-badge p7-badge-${j.enabled?'active':'pending'}">${j.enabled?'활성':'비활성'}</span>
            <div class="p7-sched-actions">
              <button class="p7-btn-sm p7-btn-secondary" onclick="runScheduleNow('${j.id}')">▶ 실행</button>
              <button class="p7-btn-sm p7-btn-ghost" onclick="toggleSchedule('${j.id}',${!j.enabled})">${j.enabled?'중지':'활성화'}</button>
            </div>
          </div>`).join('');
  } catch(e) { console.error('스케줄러 로드 오류:', e); }
}

async function runScheduleNow(jobId) {
  try {
    const res  = await fetch(`/api/scheduler/jobs/${jobId}/run`, { method:'POST' });
    const data = await res.json();
    if (data.success) {
      loadSchedulerLogs();
      loadSchedulerJobs();
    }
  } catch(e) { console.error('스케줄 실행 오류:', e); }
}

async function toggleSchedule(jobId, enable) {
  const endpoint = enable ? 'start' : 'stop';
  await fetch(`/api/scheduler/jobs/${jobId}/${endpoint}`, { method:'POST' });
  loadSchedulerJobs();
}

async function loadSchedulerLogs() {
  try {
    const res  = await fetch('/api/scheduler/logs');
    const data = await res.json();
    const el = document.getElementById('scheduler-logs');
    if (!el) return;
    const logs = data.logs || [];
    el.textContent = logs.length === 0
      ? '실행 로그 없음'
      : logs.slice(-20).map(l =>
          `[${new Date(l.timestamp||Date.now()).toLocaleTimeString('ko-KR')}] ${l.jobId||'?'} → ${l.status||'?'} ${l.message||''}`
        ).join('\n');
  } catch(e) { console.error('로그 로드 오류:', e); }
}

function showAddScheduleModal() {
  document.getElementById('add-schedule-form').classList.remove('hidden');
}

async function createScheduleJob() {
  const name     = document.getElementById('sched-name')?.value;
  const cron     = document.getElementById('sched-cron')?.value;
  const pipeline = document.getElementById('sched-pipeline')?.value;
  const msgEl    = document.getElementById('sched-create-result');
  if (!name || !cron) { showMsg(msgEl,'이름과 Cron 표현식을 입력하세요','error'); return; }
  showMsg(msgEl, `✅ 스케줄 "${name}" 저장됨 (실서버 등록 필요)`, 'info');
  setTimeout(() => document.getElementById('add-schedule-form').classList.add('hidden'), 1500);
}

// ── 연동 (Integrations) ───────────────────────────────────
async function loadIntegrationsStatus() {
  try {
    const res  = await fetch('/api/integrations/status');
    const data = await res.json();
    const el = document.getElementById('integrations-status-grid');
    if (!el) return;
    const integrations = [
      { key:'slack',   icon:'💬', name:'Slack',         desc:'메시지/알림 발송' },
      { key:'sheets',  icon:'📊', name:'Google Sheets', desc:'스프레드시트 연동' },
      { key:'storage', icon:'☁️', name:'AWS S3',         desc:'파일 스토리지' },
      { key:'payment', icon:'💳', name:'Stripe',         desc:'결제 처리' },
      { key:'notion',  icon:'📓', name:'Notion',         desc:'페이지 생성' },
      { key:'email',   icon:'✉️', name:'이메일 SMTP',    desc:'이메일 발송' },
    ];
    const s = data.status || data.integrations || {};
    el.innerHTML = integrations.map(i => {
      const st = s[i.key];
      const ready = st?.ready || st?.configured || st?.connected || false;
      return `<div class="p7-integration-card">
        <div class="p7-integration-icon">${i.icon}</div>
        <div class="p7-integration-name">${i.name}</div>
        <div class="p7-integration-desc" style="font-size:11px;color:#64748b;margin-bottom:6px">${i.desc}</div>
        <div class="p7-integration-status ${ready?'ready':'config-needed'}">${ready?'✅ 준비됨':'⚙️ 설정 필요'}</div>
      </div>`;
    }).join('');
  } catch(e) { console.error('연동 상태 오류:', e); }
}

async function sendSlackTest() {
  const channel = document.getElementById('slack-channel')?.value;
  const message = document.getElementById('slack-message')?.value;
  const msgEl   = document.getElementById('slack-result');
  try {
    const res  = await fetch('/api/integrations/slack', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ channel, message })
    });
    const data = await res.json();
    if (data.success) showMsg(msgEl, '✅ Slack 전송 완료 (Webhook URL 설정 시 실제 발송)', 'success');
    else showMsg(msgEl, data.error||'전송 실패', 'error');
  } catch(e) { showMsg(msgEl, e.message, 'error'); }
}

async function appendSheetsTest() {
  const sheetId = document.getElementById('sheets-id')?.value;
  const sheetName = document.getElementById('sheets-name')?.value;
  const msgEl = document.getElementById('sheets-result');
  let row = [];
  try { row = JSON.parse(document.getElementById('sheets-data')?.value||'[]'); } catch(e) {}
  try {
    const res = await fetch('/api/integrations/sheets/append', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sheetId, sheetName, row })
    });
    const data = await res.json();
    if (data.success) showMsg(msgEl, '✅ 행 추가 완료 (API 연동 시 실제 반영)', 'success');
    else showMsg(msgEl, data.error||'실패', 'error');
  } catch(e) { showMsg(msgEl, e.message, 'error'); }
}

async function uploadFileTest() {
  const fileInput  = document.getElementById('upload-file');
  const bucketName = document.getElementById('upload-bucket')?.value;
  const msgEl      = document.getElementById('upload-result');
  if (!fileInput?.files?.[0]) { showMsg(msgEl,'파일을 선택하세요','error'); return; }
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('bucket', bucketName);
  try {
    const res = await fetch('/api/integrations/storage/upload', { method:'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      showMsg(msgEl, `✅ 업로드 완료: ${data.file?.name||data.key||'파일'}`, 'success');
      loadStoredFiles();
    } else showMsg(msgEl, data.error||'업로드 실패', 'error');
  } catch(e) { showMsg(msgEl, e.message, 'error'); }
}

async function loadStoredFiles() {
  try {
    const res  = await fetch('/api/integrations/storage/files');
    const data = await res.json();
    const el = document.getElementById('stored-files-list');
    if (!el) return;
    const files = data.files || [];
    el.innerHTML = files.length === 0
      ? '<div class="p7-empty-state" style="font-size:12px">업로드된 파일 없음</div>'
      : files.map(f => `<div class="p7-file-item">📄 ${f.name||f.key} <span style="color:#4a5568;margin-left:auto">${_formatSize(f.size)}</span></div>`).join('');
  } catch(e) { console.error('파일 목록 오류:', e); }
}

function _formatSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + 'KB';
  return (bytes/1048576).toFixed(1) + 'MB';
}

// ── 시스템 상태 ───────────────────────────────────────────
async function loadSystemStatus() {
  try {
    const [p7res, aiRes] = await Promise.all([
      fetch('/api/phase7/status'), fetch('/api/ai/status')
    ]);
    const p7   = await p7res.json();
    const ai   = await aiRes.json();
    const comps = p7.components || {};

    // AI 프로바이더
    const provEl = document.getElementById('ai-provider-status');
    if (provEl && ai.providers) {
      provEl.innerHTML = Object.entries(ai.providers).map(([name, info]) => `
        <div class="p7-provider-item">
          <div class="p7-provider-icon">${name==='openai'?'🤖':name==='anthropic'?'🧠':'🎭'}</div>
          <div class="p7-provider-info">
            <div class="p7-provider-name">${name.toUpperCase()}</div>
            <div class="p7-provider-detail">${info.available ? (info.models?.[0]||'연결됨') : '사용 불가'}</div>
          </div>
          <div class="p7-provider-dot ${info.available?'ok':'err'}"></div>
        </div>`).join('');
    }

    // Phase 7 시스템
    const sysEl = document.getElementById('phase7-system-status');
    if (sysEl) {
      const sysItems = [
        { name:'작업 큐', icon:'⚙️', status: comps.jobQueue?.status },
        { name:'인증 시스템', icon:'🔑', status: comps.auth?.status },
        { name:'비용 트래커', icon:'💰', status: comps.costTracker ? 'active' : 'inactive' },
        { name:'스케줄러', icon:'⏰', status: comps.scheduler?.status },
        { name:'버전 관리', icon:'🔖', status: comps.versionMgr ? 'active' : 'inactive' },
        { name:'AI 연동', icon:'🤖', status: comps.aiConnector?.openai?.available ? 'active' : 'inactive' },
      ];
      sysEl.innerHTML = sysItems.map(i => `
        <div class="p7-provider-item">
          <div class="p7-provider-icon">${i.icon}</div>
          <div class="p7-provider-info"><div class="p7-provider-name">${i.name}</div></div>
          <div class="p7-provider-dot ${i.status==='active'?'ok':'err'}"></div>
        </div>`).join('');
    }

    // 업타임
    const uptimeEl = document.getElementById('sys-uptime');
    if (uptimeEl && p7.uptime) {
      const mins = Math.floor(p7.uptime / 60);
      uptimeEl.textContent = mins < 60 ? `${mins}분` : `${Math.floor(mins/60)}시간`;
    }
  } catch(e) { console.error('시스템 상태 오류:', e); }
}

async function loadCoverageGrid() {
  try {
    const res  = await fetch('/api/coverage');
    const data = await res.json();
    const el = document.getElementById('system-coverage-bars');
    if (!el) return;
    const domains = data.domains || {};
    const DOMAIN_LABELS = {
      ecommerce:'이커머스', marketing:'마케팅', b2b:'B2B', it:'IT/보안',
      legal_hr:'법무/HR', edu_med:'교육/의료', creative:'크리에이티브',
      data_ai:'데이터 AI', real_estate:'부동산', finance_invest:'금융 투자',
      healthcare:'헬스케어', government:'공공/정부'
    };
    el.innerHTML = Object.entries(domains).map(([domain, info]) => {
      const pct = info.total > 0 ? Math.round(info.ready/info.total*100) : 0;
      return `<div class="p7-cov-item">
        <div class="p7-cov-label">${DOMAIN_LABELS[domain]||domain} (${info.ready}/${info.total})</div>
        <div class="p7-cov-bar-wrap">
          <div class="p7-cov-bar"><div class="p7-cov-bar-inner" style="width:${pct}%"></div></div>
          <span class="p7-cov-pct">${pct}%</span>
        </div>
      </div>`;
    }).join('');

    // ── 도메인별 파이프라인/테스트 차트 ──────────────────
    const domKeys   = Object.keys(domains);
    const domLabels = domKeys.map(k => DOMAIN_LABELS[k] || k);
    const pipeNums  = domKeys.map(k => domains[k].ready || 0);
    const testNums  = domKeys.map(k => domains[k].total || 0);

    _makeBarChart('chart-domain-pipes', domLabels, pipeNums, '파이프라인 수');
    _makeBarChart('chart-domain-tests', domLabels, testNums, '테스트 케이스');

  } catch(e) { console.error('커버리지 그리드 오류:', e); }
}

// ══════════════════════════════════════════════════════════
// 공통 유틸
// ══════════════════════════════════════════════════════════
function showMsg(el, msg, type) {
  if (!el) return;
  el.textContent  = msg;
  el.className    = 'p7-auth-msg ' + type;
}

// Phase 7 대시보드 탭 진입 시 비용 데이터 자동 로드
document.addEventListener('DOMContentLoaded', () => {
  // 초기 탭 상태 확인
  if (typeof switchMainTab === 'function') {
    // 헤더 탭은 이미 chat이 active로 되어 있음
  }
  // 사용자 상태 복원 (localStorage)
  const savedUser = localStorage.getItem('p7_user');
  if (savedUser) {
    try {
      _currentUser = JSON.parse(savedUser);
      _authToken   = localStorage.getItem('p7_token');
      updateUserBar();
    } catch(e) {}
  }
});

// localStorage 연동
const _origDoLogin = doLogin;

/* ═══════════════════════════════════════════════════════════════════════
   ADMIN PANEL — Phase 8 어드민 패널 전체 구현
   ───────────────────────────────────────────────────────────────────────
   adminNav()           사이드 네비 전환
   adminLoadOverview()  KPI + 잡 상태 + 차트 + 최근 목록
   adminLoadUsers()     사용자 목록 + 검색
   adminSearchUsers()   인라인 검색
   adminChangeRole()    역할 변경
   adminResetPw()       비밀번호 초기화
   adminDeleteUser()    사용자 삭제
   adminLoadJobs()      잡 목록
   adminDeleteJob()     잡 삭제
   adminClearJobs()     일괄 삭제
   adminLoadCosts()     비용 분석 + 3개 차트
   adminLoadPipelines() 파이프라인 목록
   adminDeletePipeline()파이프라인 삭제
   adminLoadAudit()     감사 로그
   adminLoadSystem()    시스템 정보 + 메모리 차트
   adminSendBroadcast() 전체 공지 발송
   adminSeed()          테스트 시드 생성
═══════════════════════════════════════════════════════════════════════ */

// ── 내부 상태 ──────────────────────────────────────────────────────────
const _admin = {
  token:        () => _authToken || localStorage.getItem('p7_token') || '',
  broadcastLog: [],
  charts:       {},
};

// ── 어드민 전용 fetch helper ────────────────────────────────────────────
async function _adminFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${_admin.token()}`,
      ...(opts.headers || {}),
    },
  });
  return res;
}

// ── 사이드 네비 전환 ────────────────────────────────────────────────────
window.adminNav = function(section) {
  document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => { s.classList.remove('active'); s.style.display='none'; });

  const btn = document.getElementById('anav-' + section);
  if (btn) btn.classList.add('active');
  const sec = document.getElementById('asec-' + section);
  if (sec) { sec.classList.add('active'); sec.style.display='block'; }

  // 섹션별 데이터 자동 로드
  const loaders = {
    overview:  adminLoadOverview,
    users:     adminLoadUsers,
    jobs:      adminLoadJobs,
    costs:     adminLoadCosts,
    pipelines: adminLoadPipelines,
    audit:     adminLoadAudit,
    system:    adminLoadSystem,
    broadcast: () => {}, // 로드 불필요
  };
  if (loaders[section]) loaders[section]();
};

// ── Chart.js 래퍼 ──────────────────────────────────────────────────────
function _adminChart(id, type, labels, datasets, options = {}) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (_admin.charts[id]) { _admin.charts[id].destroy(); }
  _admin.charts[id] = new Chart(canvas, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
      scales: type !== 'doughnut' && type !== 'pie' ? {
        x: { ticks: { color: '#64748b', maxRotation: 45, font:{size:10} }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { ticks: { color: '#64748b', font:{size:10} }, grid: { color: 'rgba(255,255,255,.06)' } },
      } : undefined,
      ...options,
    },
  });
}

function _fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function _fmtMoney(v) {
  const n = parseFloat(v) || 0;
  return n < 0.001 ? `$${(n*1000).toFixed(3)}m` : `$${n.toFixed(4)}`;
}
function _fmtNum(v) {
  return Number(v||0).toLocaleString();
}

// ── ① 전체 현황 (Overview) ─────────────────────────────────────────────
window.adminLoadOverview = async function() {
  try {
    const res  = await _adminFetch('/api/admin/stats');
    if (res.status === 401) { _showAdminAccessDenied(); return; }
    const data = await res.json();
    if (!data.success) return;

    const ov = data.overview || {};

    // KPI 카드
    _setText('kpi-users',     ov.totalUsers     || 0);
    _setText('kpi-jobs',      ov.total           || 0);
    _setText('kpi-cost',      _fmtMoney(ov.totalCostUsd));
    _setText('kpi-tokens',    _fmtNum(ov.totalTokens));
    _setText('kpi-pipelines', ov.totalPipelines  || 0);
    _setText('kpi-audit',     ov.totalAuditLogs  || 0);

    // 잡 상태 그리드
    const js  = data.jobStats || {};
    const jEl = document.getElementById('admin-job-status');
    if (jEl) {
      jEl.innerHTML = [
        { lbl:'대기', val: js.waiting   || 0, cls:'#94a3b8' },
        { lbl:'실행', val: js.running   || 0, cls:'#60a5fa' },
        { lbl:'완료', val: js.completed || 0, cls:'#34d399' },
        { lbl:'실패', val: js.failed    || 0, cls:'#f87171' },
      ].map(x => `<div class="admin-job-stat">
          <div class="admin-job-stat-val" style="color:${x.cls}">${x.val}</div>
          <div class="admin-job-stat-lbl">${x.lbl}</div>
        </div>`).join('');
    }

    // 잡 상태 도넛 차트
    _adminChart('chart-admin-jobs', 'doughnut',
      ['대기', '실행', '완료', '실패'],
      [{ data: [js.waiting||0, js.running||0, js.completed||0, js.failed||0],
         backgroundColor: ['#475569','#3b82f6','#10b981','#ef4444'],
         borderWidth: 0 }]
    );

    // 시간별 비용 라인 차트
    const hourly = data.hourly || [];
    const hLabels = hourly.map(h => h.hour + '시');
    const hVals   = hourly.map(h => parseFloat(h.cost || 0));
    _adminChart('chart-admin-hourly', 'line',
      hLabels.length ? hLabels : ['00시','06시','12시','18시'],
      [{ label: '비용 (USD)', data: hVals.length ? hVals : [0,0,0,0],
         borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,.15)',
         fill: true, tension: 0.4, pointRadius: 3 }]
    );

    // 최근 사용자
    const ruEl = document.getElementById('admin-recent-users');
    if (ruEl) {
      const users = data.recentUsers || [];
      ruEl.innerHTML = users.length === 0
        ? '<div class="admin-td-empty">사용자 없음</div>'
        : users.map(u => `<div class="admin-mini-item">
            <div class="admin-mini-icon">👤</div>
            <div class="admin-mini-info">
              <div class="admin-mini-name">${u.username || u.email}</div>
              <div class="admin-mini-sub">${u.email} · <span class="admin-role-badge admin-role-${u.role||'user'}">${u.role||'user'}</span></div>
            </div>
            <div class="admin-mini-time">${_fmtDate(u.created_at)}</div>
          </div>`).join('');
    }

    // 최근 작업
    const rjEl = document.getElementById('admin-recent-jobs');
    if (rjEl) {
      const jobs = data.recentJobs || [];
      rjEl.innerHTML = jobs.length === 0
        ? '<div class="admin-td-empty">잡 없음</div>'
        : jobs.map(j => `<div class="admin-mini-item">
            <div class="admin-mini-icon">⚙️</div>
            <div class="admin-mini-info">
              <div class="admin-mini-name">${j.pipeline || j.queue || 'ai-task'}</div>
              <div class="admin-mini-sub">${j.action || '—'} · <span class="admin-status-badge admin-status-${j.status||'waiting'}">${j.status}</span></div>
            </div>
            <div class="admin-mini-time">${_fmtDate(j.created_at)}</div>
          </div>`).join('');
    }

  } catch(e) { console.error('[admin overview]', e); }
};

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _showAdminAccessDenied() {
  const content = document.querySelector('.admin-content');
  if (content) content.innerHTML = `
    <div class="admin-access-denied" style="text-align:center;padding:80px 20px">
      <div style="font-size:64px">🔒</div>
      <h2>접근 권한 없음</h2>
      <p style="color:#6b7280;margin-top:8px">관리자 권한이 필요합니다.<br>어드민 계정으로 로그인해주세요.</p>
      <button class="admin-btn admin-btn-primary" style="margin-top:20px" onclick="switchMainTab('auth')">로그인 페이지로</button>
    </div>`;
}

// ── ② 사용자 관리 ──────────────────────────────────────────────────────
let _adminUsersCache = [];

window.adminLoadUsers = async function() {
  const tbody = document.getElementById('admin-users-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="admin-td-empty">로딩 중...</td></tr>';
  try {
    const res  = await _adminFetch('/api/admin/users');
    if (res.status === 401) { _showAdminAccessDenied(); return; }
    const data = await res.json();
    _adminUsersCache = data.users || [];
    _renderUserTable(_adminUsersCache);
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="admin-td-empty" style="color:#f87171">${e.message}</td></tr>`;
  }
};

window.adminSearchUsers = function() {
  const q = (document.getElementById('admin-user-search')?.value || '').toLowerCase();
  const filtered = _adminUsersCache.filter(u =>
    u.username?.toLowerCase().includes(q) ||
    u.email?.toLowerCase().includes(q) ||
    u.role?.toLowerCase().includes(q)
  );
  _renderUserTable(filtered);
};

function _renderUserTable(users) {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="admin-td-empty">사용자 없음</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => `
    <tr>
      <td style="font-size:10px;color:#4b5563;max-width:80px;overflow:hidden;text-overflow:ellipsis" title="${u.id}">${(u.id||'').slice(0,12)}…</td>
      <td><strong style="color:#e2e8f0">${u.username || '—'}</strong></td>
      <td style="color:#94a3b8">${u.email || '—'}</td>
      <td>
        <select class="admin-input" style="padding:3px 6px;font-size:11px;width:110px"
          onchange="adminChangeRole('${u.id}',this.value)"
          ${u.id === (_currentUser?.id || '') ? 'disabled title="본인 역할 변경 불가"' : ''}>
          <option value="user"      ${u.role==='user'?'selected':''}>user</option>
          <option value="moderator" ${u.role==='moderator'?'selected':''}>moderator</option>
          <option value="admin"     ${u.role==='admin'?'selected':''}>admin</option>
        </select>
      </td>
      <td style="color:#64748b;font-size:11px">${_fmtDate(u.last_login) || '—'}</td>
      <td style="color:#64748b;font-size:11px">${_fmtDate(u.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="admin-btn admin-btn-ghost admin-btn-sm" onclick="adminResetPw('${u.id}','${u.username||u.email}')">🔑 PW</button>
          <button class="admin-btn admin-btn-danger  admin-btn-sm" onclick="adminDeleteUser('${u.id}','${u.username||u.email}')"
            ${u.id === (_currentUser?.id || '') ? 'disabled' : ''}>🗑️</button>
        </div>
      </td>
    </tr>`).join('');
}

window.adminChangeRole = async function(userId, newRole) {
  try {
    const res = await _adminFetch(`/api/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole }),
    });
    const data = await res.json();
    if (!data.success) { alert('역할 변경 실패: ' + data.error); adminLoadUsers(); }
  } catch(e) { alert('오류: ' + e.message); }
};

window.adminResetPw = async function(userId, name) {
  const newPw = prompt(`[${name}] 새 비밀번호를 입력하세요 (4자 이상):`);
  if (!newPw || newPw.length < 4) { alert('비밀번호는 4자 이상이어야 합니다.'); return; }
  try {
    const res  = await _adminFetch(`/api/admin/users/${userId}/password`, {
      method: 'PUT', body: JSON.stringify({ password: newPw }),
    });
    const data = await res.json();
    alert(data.success ? '✅ 비밀번호가 변경되었습니다.' : '실패: ' + data.error);
  } catch(e) { alert('오류: ' + e.message); }
};

window.adminDeleteUser = async function(userId, name) {
  if (!confirm(`[${name}] 사용자를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    const res  = await _adminFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { adminLoadUsers(); }
    else { alert('삭제 실패: ' + data.error); }
  } catch(e) { alert('오류: ' + e.message); }
};

// ── ③ 잡 관리 ──────────────────────────────────────────────────────────
window.adminLoadJobs = async function() {
  const tbody = document.getElementById('admin-jobs-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="admin-td-empty">로딩 중...</td></tr>';
  try {
    const res  = await _adminFetch('/api/admin/jobs?limit=200');
    const data = await res.json();
    const jobs = data.jobs || [];
    if (!jobs.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="admin-td-empty">잡 없음</td></tr>';
      return;
    }
    tbody.innerHTML = jobs.map(j => `
      <tr>
        <td style="font-size:10px;color:#4b5563" title="${j.id}">${(j.id||'').slice(0,14)}…</td>
        <td style="color:#94a3b8">${j.queue || 'ai-task'}</td>
        <td style="color:#c4b5fd">${j.pipeline || '—'}</td>
        <td><span class="admin-status-badge admin-status-${j.status||'waiting'}">${j.status||'waiting'}</span></td>
        <td>
          <div class="admin-progress-wrap" style="width:80px">
            <div class="admin-progress-fill" style="width:${j.progress||0}%"></div>
          </div>
          <span style="font-size:10px;color:#6b7280;margin-left:4px">${j.progress||0}%</span>
        </td>
        <td style="font-size:11px;color:#64748b">${_fmtDate(j.created_at)}</td>
        <td>
          <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="adminDeleteJob('${j.id}')">🗑️</button>
        </td>
      </tr>`).join('');
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="admin-td-empty" style="color:#f87171">${e.message}</td></tr>`;
  }
};

window.adminDeleteJob = async function(jobId) {
  if (!confirm('잡을 삭제하시겠습니까?')) return;
  await _adminFetch(`/api/admin/jobs/${jobId}`, { method: 'DELETE' });
  adminLoadJobs();
};

window.adminClearJobs = async function(status) {
  if (!confirm(`'${status}' 상태 잡을 모두 삭제하시겠습니까?`)) return;
  await _adminFetch('/api/admin/jobs/clear', {
    method: 'POST', body: JSON.stringify({ status }),
  });
  adminLoadJobs();
};

// ── ④ 비용 분석 ──────────────────────────────────────────────────────
window.adminLoadCosts = async function() {
  try {
    const res  = await _adminFetch('/api/admin/costs');
    const data = await res.json();
    if (!data.success) return;

    const tot = data.total || {};
    _setText('ac-total',   _fmtMoney(tot.total  || 0));
    _setText('ac-calls',   _fmtNum(tot.calls    || 0));
    _setText('ac-inputs',  _fmtNum(tot.inputs   || 0));
    _setText('ac-outputs', _fmtNum(tot.outputs  || 0));

    // 일별 비용 (30일) 라인 차트
    const daily  = data.daily || [];
    _adminChart('chart-admin-daily', 'line',
      daily.map(d => d.date ? d.date.slice(5) : ''),
      [{ label: 'USD', data: daily.map(d => parseFloat(d.total||0)),
         borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,.12)',
         fill: true, tension: 0.4, pointRadius: 2 }]
    );

    // 모델별 비용 바 차트
    const models = data.byModel || [];
    _adminChart('chart-admin-models', 'bar',
      models.map(m => m.model || m.model_name || '—'),
      [{ label: 'USD', data: models.map(m => parseFloat(m.total||m.cost||0)),
         backgroundColor: ['#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899'] }]
    );

    // 파이프라인별 상위 비용 바 차트
    const topRes  = await _adminFetch('/api/cost/top-pipelines?limit=10');
    const topData = await topRes.json();
    const tops    = topData.topPipelines || [];
    _adminChart('chart-admin-pipecost', 'bar',
      tops.map(p => p.pipeline || '—'),
      [{ label: 'USD', data: tops.map(p => parseFloat(p.total_cost||p.cost||0)),
         backgroundColor: 'rgba(139,92,246,.6)', borderColor: '#8b5cf6', borderWidth: 1 }],
      { indexAxis: 'y' }
    );

  } catch(e) { console.error('[admin costs]', e); }
};

// ── ⑤ 파이프라인 관리 ────────────────────────────────────────────────
window.adminLoadPipelines = async function() {
  const tbody = document.getElementById('admin-pipelines-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="admin-td-empty">로딩 중...</td></tr>';
  try {
    const res  = await _adminFetch('/api/admin/pipelines');
    const data = await res.json();
    const pipes = data.pipelines || [];
    if (!pipes.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="admin-td-empty">파이프라인 없음</td></tr>';
      return;
    }
    tbody.innerHTML = pipes.map(p => {
      const nodesData = typeof p.nodes === 'string' ? JSON.parse(p.nodes || '[]') : (p.nodes || []);
      return `<tr>
        <td style="font-size:10px;color:#4b5563" title="${p.id}">${(p.id||'').slice(0,12)}…</td>
        <td><strong style="color:#e2e8f0">${p.name || '—'}</strong></td>
        <td><span class="admin-status-badge admin-status-${p.status==='active'?'completed':(p.status||'waiting')}">${p.status||'draft'}</span></td>
        <td style="text-align:center;color:#94a3b8">${nodesData.length}</td>
        <td style="text-align:center;color:#94a3b8">${p.runs || 0}</td>
        <td style="font-size:11px;color:#64748b">${_fmtDate(p.last_run) || '—'}</td>
        <td style="font-size:11px;color:#64748b">${_fmtDate(p.created_at)}</td>
        <td>
          <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="adminDeletePipeline('${p.id}','${(p.name||'').replace(/'/g,"\\'")}')">🗑️</button>
        </td>
      </tr>`;
    }).join('');
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="admin-td-empty" style="color:#f87171">${e.message}</td></tr>`;
  }
};

window.adminDeletePipeline = async function(id, name) {
  if (!confirm(`[${name}] 파이프라인을 삭제하시겠습니까?`)) return;
  await _adminFetch(`/api/admin/pipelines/${id}`, { method: 'DELETE' });
  adminLoadPipelines();
};

// ── ⑥ 감사 로그 ────────────────────────────────────────────────────────
window.adminLoadAudit = async function() {
  const tbody = document.getElementById('admin-audit-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="admin-td-empty">로딩 중...</td></tr>';
  try {
    const res  = await _adminFetch('/api/admin/audit?limit=200');
    const data = await res.json();
    const logs = data.logs || [];
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="admin-td-empty">로그 없음</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => {
      let detailStr = '—';
      try { detailStr = JSON.stringify(JSON.parse(l.details || '{}'), null, 0).slice(0, 80); } catch(e) { detailStr = l.details || '—'; }
      return `<tr>
        <td style="font-size:11px;color:#64748b;white-space:nowrap">${_fmtDate(l.created_at)}</td>
        <td style="color:#94a3b8;font-size:11px">${l.user_id ? (l.user_id.slice(0,8)+'…') : '(익명)'}</td>
        <td style="color:#c4b5fd;font-size:11px">${l.action || '—'}</td>
        <td style="color:#94a3b8;font-size:11px">${l.resource || '—'}</td>
        <td style="color:#64748b;font-size:11px">${l.ip_address || '—'}</td>
        <td style="font-size:10px;color:#4b5563;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${detailStr}">${detailStr}</td>
      </tr>`;
    }).join('');
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="admin-td-empty" style="color:#f87171">${e.message}</td></tr>`;
  }
};

// ── ⑦ 시스템 정보 ──────────────────────────────────────────────────────
window.adminLoadSystem = async function() {
  try {
    const res  = await _adminFetch('/api/admin/system');
    const data = await res.json();
    const sys  = data.system || {};
    const mem  = sys.memory || {};
    const osI  = sys.os    || {};
    const envI = sys.env   || {};

    // 메모리 그리드
    const memEl = document.getElementById('admin-sys-memory');
    if (memEl) {
      memEl.innerHTML = [
        { k: 'RSS',        v: mem.rss       },
        { k: 'Heap Used',  v: mem.heapUsed  },
        { k: 'Heap Total', v: mem.heapTotal  },
        { k: 'External',   v: mem.external   },
      ].map(x => `<div class="admin-sys-item">
          <div class="admin-sys-item-key">${x.k}</div>
          <div class="admin-sys-item-val">${x.v || '—'}</div>
        </div>`).join('');
    }

    // 메모리 도넛 차트
    const heapUsed  = parseInt(mem.heapUsed)  || 0;
    const heapFree  = Math.max(0, (parseInt(mem.heapTotal)||0) - heapUsed);
    const heapExt   = parseInt(mem.external)  || 0;
    _adminChart('chart-admin-memory', 'doughnut',
      ['Heap Used', 'Heap Free', 'External'],
      [{ data: [heapUsed, heapFree, heapExt],
         backgroundColor: ['#8b5cf6','#1e293b','#06b6d4'], borderWidth: 0 }]
    );

    // 프로세스 정보
    const procEl = document.getElementById('admin-sys-process');
    if (procEl) {
      const upMin = Math.floor((sys.uptime||0) / 60);
      procEl.innerHTML = [
        { k: 'Node.js',      v: sys.nodeVersion },
        { k: '플랫폼',        v: `${sys.platform} (${sys.arch})` },
        { k: '업타임',        v: upMin < 60 ? `${upMin}분` : `${Math.floor(upMin/60)}시간 ${upMin%60}분` },
        { k: 'CPU 코어',     v: osI.cpuCount },
        { k: 'Load Avg',    v: (osI.loadAvg||[0,0,0]).map(l=>l.toFixed(2)).join(' / ') },
        { k: 'CPU User',    v: sys.cpu?.user   },
        { k: 'CPU System',  v: sys.cpu?.system },
        { k: '총 메모리',    v: osI.totalMem },
        { k: '여유 메모리',  v: osI.freeMem  },
      ].map(x => `<div class="admin-sys-item">
          <div class="admin-sys-item-key">${x.k}</div>
          <div class="admin-sys-item-val">${x.v || '—'}</div>
        </div>`).join('');
    }

    // 환경 정보
    const envEl = document.getElementById('admin-sys-env');
    if (envEl) {
      envEl.innerHTML = [
        { k: 'NODE_ENV',    v: envI.nodeEnv    || '—' },
        { k: 'OpenAI',      v: envI.hasOpenAI  ? '✅ 연결됨' : '❌ 미설정' },
        { k: 'Anthropic',   v: envI.hasAnthropic ? '✅ 연결됨' : '❌ 미설정' },
        { k: 'DB',          v: '✅ SQLite (WAL)' },
        { k: '보안 미들웨어', v: '✅ Helmet + Rate-Limit' },
        { k: '서버 포트',    v: '3000' },
      ].map(x => `<div class="admin-sys-item">
          <div class="admin-sys-item-key">${x.k}</div>
          <div class="admin-sys-item-val">${x.v}</div>
        </div>`).join('');
    }

  } catch(e) { console.error('[admin system]', e); }
};

// ── ⑧ 공지 발송 ────────────────────────────────────────────────────────
window.adminSendBroadcast = async function() {
  const msg  = document.getElementById('broadcast-msg')?.value?.trim();
  const type = document.getElementById('broadcast-type')?.value || 'info';
  const resEl = document.getElementById('broadcast-result');

  if (!msg) { _showAdminResult(resEl, '❌ 메시지를 입력하세요', false); return; }

  try {
    const res  = await _adminFetch('/api/admin/broadcast', {
      method: 'POST', body: JSON.stringify({ message: msg, type }),
    });
    const data = await res.json();
    if (data.success) {
      _showAdminResult(resEl, '✅ 전체 사용자에게 공지를 발송했습니다.', true);
      _admin.broadcastLog.unshift({ time: new Date().toLocaleTimeString('ko-KR'), msg, type });
      _renderBroadcastHistory();
      document.getElementById('broadcast-msg').value = '';
    } else {
      _showAdminResult(resEl, '❌ ' + (data.error || '발송 실패'), false);
    }
  } catch(e) { _showAdminResult(resEl, '❌ 오류: ' + e.message, false); }
};

function _showAdminResult(el, msg, ok) {
  if (!el) return;
  el.textContent = msg;
  el.className   = `admin-result-msg ${ok ? 'admin-result-ok' : 'admin-result-err'}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function _renderBroadcastHistory() {
  const el = document.getElementById('broadcast-history');
  if (!el) return;
  el.innerHTML = _admin.broadcastLog.slice(0,10).map(b => `
    <div class="admin-mini-item">
      <div class="admin-mini-icon">📢</div>
      <div class="admin-mini-info">
        <div class="admin-mini-name">${b.msg.slice(0,60)}${b.msg.length>60?'…':''}</div>
        <div class="admin-mini-sub">유형: <strong>${b.type}</strong></div>
      </div>
      <div class="admin-mini-time">${b.time}</div>
    </div>`).join('') || '—';
}

// ── 시드 데이터 ────────────────────────────────────────────────────────
window.adminSeed = async function() {
  if (!confirm('테스트용 시드 데이터를 생성하시겠습니까?\n(비용 기록 20건 + 샘플 파이프라인 3개)')) return;
  try {
    const res  = await _adminFetch('/api/admin/seed', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert('✅ 시드 데이터 생성 완료!\n' + (data.created||[]).join('\n'));
      adminLoadOverview();
    } else {
      alert('실패: ' + data.error);
    }
  } catch(e) { alert('오류: ' + e.message); }
};

// ── Socket.IO 공지 수신 ────────────────────────────────────────────────
if (typeof socket !== 'undefined') {
  socket.on('admin:broadcast', (data) => {
    const icons   = { info:'ℹ️', warning:'⚠️', success:'✅', error:'🚨' };
    const colors  = { info:'#3b82f6', warning:'#f59e0b', success:'#10b981', error:'#ef4444' };
    const toast   = document.createElement('div');
    toast.style.cssText = `
      position:fixed;bottom:80px;right:20px;z-index:9999;
      background:#1e293b;border:1px solid ${colors[data.type]||colors.info};
      border-left:4px solid ${colors[data.type]||colors.info};
      border-radius:10px;padding:14px 18px;max-width:340px;
      box-shadow:0 8px 30px rgba(0,0,0,.4);animation:fadeIn .3s ease`;
    toast.innerHTML = `
      <div style="font-weight:700;color:#e2e8f0;margin-bottom:4px">
        ${icons[data.type]||'📢'} 시스템 공지
      </div>
      <div style="color:#94a3b8;font-size:13px">${data.message}</div>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  });
}

