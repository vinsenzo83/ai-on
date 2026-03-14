// ============================================================
// Agent Module Index — STEP 10~15
// ============================================================
// Exports all agent components for use in server.js
// ============================================================

'use strict';

const { AgentPlanner, TaskStateEngine, taskStateEngine, TASK_STATE, TASK_TYPES, COMPLEXITY } = require('./agentPlanner');
const { ToolChainExecutor, CHAIN_CONFIG } = require('./toolChainExecutor');
const { SkillLibrary, skillLibrary, SKILLS } = require('./skillLibrary');
const { AgentRuntime, createAgentRuntime, AGENT_CONFIG } = require('./agentRuntime');
const costController  = require('./costController');
const failureStore    = require('./failureStore');
const failureRecorder = require('./failureRecorder');
const cacheLayer      = require('./cacheLayer');
const searchEngine    = require('./searchEngine');       // Phase 5: 멀티 프로바이더 검색
const parallelExecutor = require('./parallelExecutor'); // Phase 4: 병렬 실행

module.exports = {
  // Classes
  AgentPlanner,
  TaskStateEngine,
  ToolChainExecutor,
  SkillLibrary,
  AgentRuntime,

  // Singletons
  taskStateEngine,
  skillLibrary,
  costController,
  failureStore,
  failureRecorder,
  cacheLayer,
  searchEngine,
  parallelExecutor,

  // Factory
  createAgentRuntime,

  // Constants
  TASK_STATE,
  TASK_TYPES,
  COMPLEXITY,
  CHAIN_CONFIG,
  AGENT_CONFIG,
  SKILLS,
};
