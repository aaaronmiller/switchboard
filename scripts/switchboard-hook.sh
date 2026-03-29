#!/bin/bash
# Switchboard PostToolUse Hook for Claude Code
#
# Reports tool call events to Switchboard's session activity endpoint.
# Install: Add to Claude Code hooks in ~/.claude/settings.json:
#
#   "hooks": {
#     "PostToolUse": [
#       {
#         "matcher": "",
#         "hooks": [{
#           "type": "command",
#           "command": "/path/to/switchboard-hook.sh"
#         }]
#       }
#     ]
#   }
#
# Environment variables available from Claude Code hooks:
#   CLAUDE_SESSION_ID — current session UUID
#   CLAUDE_TOOL_NAME  — tool that was just used (Read, Write, Bash, etc.)
#   CLAUDE_TOOL_INPUT — JSON string of tool input (may be large)
#   CLAUDE_TOOL_RESULT — first 500 chars of tool output
#   CLAUDE_PROJECT_DIR — project working directory

SWITCHBOARD_PORT="${SWITCHBOARD_PEERS_PORT:-7899}"
SWITCHBOARD_URL="http://127.0.0.1:${SWITCHBOARD_PORT}/session-event"

# Bail fast if Switchboard isn't running
curl -sf --max-time 0.3 "http://127.0.0.1:${SWITCHBOARD_PORT}/health" >/dev/null 2>&1 || exit 0

# Build the JSON payload (minimal — just what sparklines need)
SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
TOOL_NAME="${CLAUDE_TOOL_NAME:-unknown}"
# Truncate tool result to avoid huge payloads
TOOL_RESULT="${CLAUDE_TOOL_RESULT:0:200}"

# Use jq if available, otherwise manual JSON (safe for simple strings)
if command -v jq &>/dev/null; then
  PAYLOAD=$(jq -n \
    --arg sid "$SESSION_ID" \
    --arg tool "$TOOL_NAME" \
    --arg result "$TOOL_RESULT" \
    --arg agent "claude" \
    '{session_id: $sid, tool_name: $tool, tool_result: $result, agent: $agent}')
else
  # Escape quotes in values for safe JSON
  SESSION_ID="${SESSION_ID//\"/\\\"}"
  TOOL_NAME="${TOOL_NAME//\"/\\\"}"
  TOOL_RESULT="${TOOL_RESULT//\"/\\\"}"
  PAYLOAD="{\"session_id\":\"${SESSION_ID}\",\"tool_name\":\"${TOOL_NAME}\",\"tool_result\":\"${TOOL_RESULT}\",\"agent\":\"claude\"}"
fi

# Fire and forget — don't block the CLI
curl -sf --max-time 0.5 -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$SWITCHBOARD_URL" >/dev/null 2>&1 &

exit 0
