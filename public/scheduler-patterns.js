// ========== BUILT-IN SCHEDULER PATTERNS ==========
// Each pattern follows the JSON save format (version 2).
// Steps use duration (seconds) for waits, not minutes/seconds.

const SCHEDULER_PATTERNS = [

  // ═══════════ AI ORCHESTRATION ═══════════

  {
    name: 'Fan-Out Prompt',
    category: 'AI Orchestration',
    description: 'Send the same prompt to all targeted sessions simultaneously.',
    variables: { PROMPT: 'Implement the feature described in the README' },
    steps: [
      { type: 'command', value: '{{PROMPT}}', targets: ['all'] },
    ],
    repeat: { enabled: false, interval: 0, unit: 's', count: 0 },
  },

  {
    name: 'Batch Assignment',
    category: 'AI Orchestration',
    description: 'Assign different tasks to different sessions by role. Tag sessions as @builder, @tester, @reviewer first.',
    variables: {
      BUILDER_TASK: 'Implement the authentication module',
      TESTER_TASK: 'Write comprehensive tests for the auth module',
      REVIEWER_TASK: 'Review the auth module implementation for security issues',
    },
    steps: [
      { type: 'comment', value: 'Assign work to each role' },
      { type: 'command', value: '{{BUILDER_TASK}}', targets: ['@builder'] },
      { type: 'command', value: '{{TESTER_TASK}}', targets: ['@tester'] },
      { type: 'command', value: '{{REVIEWER_TASK}}', targets: ['@reviewer'] },
    ],
  },

  {
    name: 'Pipeline: Build → Review → Test',
    category: 'AI Orchestration',
    description: 'Sequential pipeline: builder implements, reviewer checks, tester validates. Uses watch steps to wait for completion.',
    variables: { TASK: 'Implement the user profile API endpoint' },
    steps: [
      { type: 'comment', value: '── Phase 1: Build ──' },
      { type: 'command', value: '{{TASK}}', targets: ['@builder'] },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 600, targets: ['@builder'] },
      { type: 'gate', message: 'Builder finished. Send to reviewer?' },
      { type: 'comment', value: '── Phase 2: Review ──' },
      { type: 'command', value: 'Review the changes just made by the builder session. Check for bugs, security issues, and code quality.', targets: ['@reviewer'] },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 600, targets: ['@reviewer'] },
      { type: 'gate', message: 'Review complete. Run tests?' },
      { type: 'comment', value: '── Phase 3: Test ──' },
      { type: 'command', value: 'Write and run tests for the changes made by the builder. Ensure full coverage.', targets: ['@tester'] },
    ],
  },

  {
    name: 'Heartbeat Monitor',
    category: 'AI Orchestration',
    description: 'Periodically check status of all sessions. Repeats every 5 minutes.',
    steps: [
      { type: 'command', value: '/status', targets: ['all'] },
    ],
    repeat: { enabled: true, interval: 5, unit: 'm', count: 0 },
  },

  {
    name: 'Staggered Launch',
    category: 'AI Orchestration',
    description: 'Start sessions working one at a time with delays to avoid git conflicts.',
    variables: {
      TASK_1: 'Work on the frontend components',
      TASK_2: 'Work on the API routes',
      TASK_3: 'Work on the database schema',
      DELAY: '30',
    },
    steps: [
      { type: 'command', value: '{{TASK_1}}', targets: ['@builder'] },
      { type: 'wait', duration: 30 },
      { type: 'command', value: '{{TASK_2}}', targets: ['@tester'] },
      { type: 'wait', duration: 30 },
      { type: 'command', value: '{{TASK_3}}', targets: ['@reviewer'] },
    ],
  },

  {
    name: 'Convergence Check',
    category: 'AI Orchestration',
    description: 'Wait for all sessions to finish (shell prompt returns), then send a summary request.',
    steps: [
      { type: 'comment', value: 'Wait for all sessions to return to prompt' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 900, targets: ['@builder'] },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 900, targets: ['@tester'] },
      { type: 'gate', message: 'All sessions appear idle. Request summary?' },
      { type: 'command', value: 'Summarize what you accomplished and list any issues or conflicts.', targets: ['all'] },
    ],
  },

  {
    name: 'Distributed Feature Implementation',
    category: 'AI Orchestration',
    description: 'Full workflow: architect plans, builders implement in parallel, reviewer validates. Requires @architect, @builder, @tester, @reviewer roles.',
    variables: { FEATURE: 'user authentication with OAuth2 and JWT tokens' },
    steps: [
      { type: 'comment', value: '═══ PLANNING PHASE ═══' },
      { type: 'command', value: 'Break down the implementation of "{{FEATURE}}" into 2-3 independent modules. For each module, write a clear spec as a markdown code block with file paths, interfaces, and acceptance criteria.', targets: ['@architect'] },
      { type: 'wait-for-output', pattern: '```', timeout: 600, targets: ['@architect'] },
      { type: 'gate', message: 'Architect has produced specs. Review and assign to builders?' },
      { type: 'comment', value: '═══ BUILD PHASE ═══' },
      { type: 'command', value: 'Implement the FIRST module from the architect spec. Focus only on your assigned module. Do not modify files outside your scope.', targets: ['@builder'] },
      { type: 'command', value: 'Implement the SECOND module from the architect spec. Focus only on your assigned module. Do not modify files outside your scope.', targets: ['@tester'] },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 900, targets: ['@builder'] },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 900, targets: ['@tester'] },
      { type: 'gate', message: 'Builders finished. Send to review?' },
      { type: 'comment', value: '═══ REVIEW PHASE ═══' },
      { type: 'command', value: 'Review ALL changes made by the builder sessions. Check for: 1) Consistency between modules, 2) Integration issues, 3) Security concerns, 4) Missing edge cases. Suggest fixes for any issues found.', targets: ['@reviewer'] },
    ],
  },

  {
    name: 'AI Prompt Retry',
    category: 'AI Orchestration',
    description: 'Send a prompt and retry if the AI responds with an error or refusal.',
    variables: { PROMPT: 'Fix the failing test in src/auth.test.ts' },
    steps: [
      { type: 'command', value: '{{PROMPT}}', retry: { count: 3, delay: 10, pattern: 'error|Error|refuse|cannot' } },
    ],
  },

  // ═══════════ DEVOPS ═══════════

  {
    name: 'Build → Test → Deploy',
    category: 'DevOps',
    description: 'Sequential CI pipeline with approval gate before deploy.',
    variables: {
      BUILD_CMD: 'npm run build',
      TEST_CMD: 'npm test',
      DEPLOY_CMD: 'npm run deploy',
    },
    steps: [
      { type: 'comment', value: '── Build ──' },
      { type: 'command', value: '{{BUILD_CMD}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 300 },
      { type: 'comment', value: '── Test ──' },
      { type: 'command', value: '{{TEST_CMD}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 300 },
      { type: 'gate', message: 'Build and tests complete. Deploy?' },
      { type: 'comment', value: '── Deploy ──' },
      { type: 'command', value: '{{DEPLOY_CMD}}' },
    ],
  },

  {
    name: 'Git Sync All Repos',
    category: 'DevOps',
    description: 'Pull latest and install dependencies across all terminal sessions.',
    steps: [
      { type: 'command', value: 'git pull --rebase && npm install', targets: ['all'] },
    ],
  },

  {
    name: 'Rolling Restart',
    category: 'DevOps',
    description: 'Restart services one at a time across sessions with health check waits.',
    variables: { RESTART_CMD: 'sudo systemctl restart app', HEALTH_CMD: 'curl -sf http://localhost:3000/health' },
    steps: [
      { type: 'comment', value: 'Service 1' },
      { type: 'command', value: '{{RESTART_CMD}}', targets: ['@builder'] },
      { type: 'wait', duration: 15 },
      { type: 'command', value: '{{HEALTH_CMD}}', targets: ['@builder'] },
      { type: 'wait-for-output', pattern: 'ok|healthy|200', timeout: 60, targets: ['@builder'] },
      { type: 'comment', value: 'Service 2' },
      { type: 'command', value: '{{RESTART_CMD}}', targets: ['@tester'] },
      { type: 'wait', duration: 15 },
      { type: 'command', value: '{{HEALTH_CMD}}', targets: ['@tester'] },
      { type: 'wait-for-output', pattern: 'ok|healthy|200', timeout: 60, targets: ['@tester'] },
    ],
  },

  {
    name: 'Log Watch',
    category: 'DevOps',
    description: 'Tail logs in targeted sessions. Repeat to refresh.',
    variables: { LOG_CMD: 'tail -f /var/log/app.log' },
    steps: [
      { type: 'command', value: '{{LOG_CMD}}' },
    ],
  },

  {
    name: 'Database Migration',
    category: 'DevOps',
    description: 'Backup, migrate, verify sequence with approval gates.',
    variables: {
      BACKUP_CMD: 'pg_dump mydb > backup_{{DATE}}.sql',
      MIGRATE_CMD: 'npm run db:migrate',
      VERIFY_CMD: 'npm run db:verify',
    },
    steps: [
      { type: 'command', value: '{{BACKUP_CMD}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 120 },
      { type: 'gate', message: 'Backup complete. Run migrations?' },
      { type: 'command', value: '{{MIGRATE_CMD}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 120 },
      { type: 'command', value: '{{VERIFY_CMD}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 60 },
      { type: 'gate', message: 'Migration complete. Verify results above.' },
    ],
  },

  // ═══════════ UTILITY ═══════════

  {
    name: 'Keep Alive',
    category: 'Utility',
    description: 'Prevent session timeouts by sending a space every 4 minutes.',
    steps: [
      { type: 'command', value: ' ' },
    ],
    repeat: { enabled: true, interval: 4, unit: 'm', count: 0 },
  },

  {
    name: 'Environment Bootstrap',
    category: 'Utility',
    description: 'Set up development environment: install, build, start services.',
    variables: {
      INSTALL_CMD: 'npm install',
      BUILD_CMD: 'npm run build',
      START_CMD: 'npm run dev',
    },
    steps: [
      { type: 'command', value: '{{INSTALL_CMD}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 300 },
      { type: 'command', value: '{{BUILD_CMD}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 300 },
      { type: 'command', value: '{{START_CMD}}' },
    ],
  },

  {
    name: 'Cleanup',
    category: 'Utility',
    description: 'Clear caches and build artifacts across all sessions.',
    steps: [
      { type: 'command', value: 'rm -rf node_modules/.cache dist .next .turbo', targets: ['all'] },
      { type: 'wait', duration: 2 },
      { type: 'command', value: 'npm install', targets: ['all'] },
    ],
  },

  {
    name: 'Benchmark Cycle',
    category: 'Utility',
    description: 'Run benchmarks repeatedly and capture results. Repeats 5 times with 30s intervals.',
    variables: { BENCH_CMD: 'npm run bench' },
    steps: [
      { type: 'command', value: 'echo "=== Benchmark run {{CYCLE}} at {{TIME}} ==="' },
      { type: 'command', value: '{{BENCH_CMD}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 300 },
    ],
    repeat: { enabled: true, interval: 30, unit: 's', count: 5 },
  },

  {
    name: 'Quick Command Burst',
    category: 'Utility',
    description: 'Template for sending multiple commands as fast as possible (queue burst). Fill in your commands.',
    variables: {
      CMD_1: 'echo step 1',
      CMD_2: 'echo step 2',
      CMD_3: 'echo step 3',
    },
    steps: [
      { type: 'command', value: '{{CMD_1}}' },
      { type: 'command', value: '{{CMD_2}}' },
      { type: 'command', value: '{{CMD_3}}' },
    ],
  },

  {
    name: 'Timed Command Sequence',
    category: 'Utility',
    description: 'Template for commands with configurable delays between them.',
    variables: {
      CMD_1: 'echo phase 1',
      CMD_2: 'echo phase 2',
      CMD_3: 'echo phase 3',
    },
    steps: [
      { type: 'command', value: '{{CMD_1}}' },
      { type: 'wait', duration: 60 },
      { type: 'command', value: '{{CMD_2}}' },
      { type: 'wait', duration: 60 },
      { type: 'command', value: '{{CMD_3}}' },
    ],
  },

  {
    name: 'Interactive Setup Wizard',
    category: 'Utility',
    description: 'Step-by-step setup with approval gates between each phase.',
    variables: { STEP_1: 'git clone repo', STEP_2: 'npm install', STEP_3: 'npm run setup' },
    steps: [
      { type: 'command', value: '{{STEP_1}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 120 },
      { type: 'gate', message: 'Step 1 complete. Continue to step 2?' },
      { type: 'command', value: '{{STEP_2}}' },
      { type: 'wait-for-output', pattern: '\\$\\s*$', timeout: 120 },
      { type: 'gate', message: 'Step 2 complete. Continue to step 3?' },
      { type: 'command', value: '{{STEP_3}}' },
    ],
  },
];
