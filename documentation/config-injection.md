# Config Injection System

## Overview

The `@cognistore/config` package manages automatic configuration of AI clients. It uses a **marker-based injection** system to safely add and remove configuration blocks in shared files without overwriting user content.

**File:** `packages/config/src/config-manager.ts`

## Supported Clients

| Client | MCP Config | Instructions File | Skills Location |
|--------|-----------|-------------------|-----------------|
| Claude Code | `~/.claude/mcp-config.json` | `~/.claude/CLAUDE.md` | `~/.claude/skills/cognistore-*/` |
| GitHub Copilot | `~/.copilot/mcp-config.json` | `~/.github/copilot-instructions.md` | `~/.copilot/skills/cognistore-*.md` |
| OpenCode | `~/.config/opencode/opencode.json` | — | — |

## Marker-Based Injection

### How It Works

Instructions and configuration blocks are wrapped in markers:

```markdown
<!-- COGNISTORE:BEGIN -->
... injected content ...
<!-- COGNISTORE:END -->
```

### Injection Logic

```
IF file does not exist:
    Create file with template content between markers

ELSE IF file exists but has no markers:
    Backup file (filename.bak.TIMESTAMP)
    Append markers + template at end of file

ELSE IF markers exist:
    Backup file
    Replace content between markers with new template
```

### Removal Logic

```
1. Find markers in file
2. Remove everything between BEGIN and END markers (inclusive)
3. Trim whitespace
4. If file is now empty → delete file
5. Otherwise → write back trimmed content
```

## MCP Config Injection

### Standard Format (Claude Code, Copilot)

```json
{
  "mcpServers": {
    "cognistore": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cognistore/mcp-server"],
      "env": {
        "SQLITE_PATH": "~/.cognistore/knowledge.db",
        "OLLAMA_HOST": "http://localhost:11434"
      }
    }
  }
}
```

The `setupMcpConfig(path, entry)` function:
1. Reads existing JSON (or creates `{}`)
2. Ensures `mcpServers` object exists
3. Sets `mcpServers['cognistore']` = entry
4. Writes back with 2-space indentation

### OpenCode Format

OpenCode uses a different JSON structure:

```json
{
  "mcp": {
    "cognistore": {
      "type": "local",
      "command": ["npx", "-y", "@cognistore/mcp-server"],
      "enabled": true,
      "environment": {
        "SQLITE_PATH": "~/.cognistore/knowledge.db",
        "OLLAMA_HOST": "http://localhost:11434"
      }
    }
  }
}
```

Key differences:
- Root key is `mcp` (not `mcpServers`)
- `type` is `local` (not `stdio`)
- `command` is an array (not separate `command` + `args`)
- `env` is named `environment`

## Skills Installation

### Claude Code Skills

Copied to `~/.claude/skills/`:

| Skill | Directory | Hook | Purpose |
|-------|-----------|------|---------|
| `cognistore-capture` | `~/.claude/skills/cognistore-capture/SKILL.md` | `Stop` | Capture knowledge after completing tasks |
| `cognistore-query` | `~/.claude/skills/cognistore-query/SKILL.md` | `PreToolUse` | Query knowledge before starting tasks |
| `cognistore-plan` | `~/.claude/skills/cognistore-plan/SKILL.md` | `PostToolUse` (ExitPlanMode) | Save plans to knowledge base with task management workflow |

### Copilot Skills

Copied to `~/.copilot/skills/` (directory format with hooks, same as Claude Code):

| Skill | Directory | Hook | Purpose |
|-------|-----------|------|---------|
| `cognistore-query` | `~/.copilot/skills/cognistore-query/SKILL.md` | `preToolUse` | Query knowledge before starting tasks |
| `cognistore-capture` | `~/.copilot/skills/cognistore-capture/SKILL.md` | `sessionEnd` | Capture knowledge after completing tasks |
| `cognistore-plan` | `~/.copilot/skills/cognistore-plan/SKILL.md` | `postToolUse` | Save plans to knowledge base with task management workflow |

## Instruction Templates

### Claude Code (`~/.claude/CLAUDE.md`)

Injected block teaches Claude Code the knowledge-first protocol:
1. Always query `getKnowledge` before starting work
2. Always capture with `addKnowledge` after completing work
3. Update stale knowledge with `updateKnowledge`
4. Priority order: knowledge base → codebase → web search

### Copilot (`~/.github/copilot-instructions.md`)

Similar protocol adapted for Copilot's instruction format.

### Plan Persistence Rule

Both Claude Code and Copilot instructions include the rule: **plans must be stored in the knowledge base** using `createPlan`, never as local files. The `cognistore-plan` skill reinforces this with a `PostToolUse` hook on `ExitPlanMode` that reminds agents to persist their plans before leaving plan mode.

## Backup Strategy

Before modifying any file, the config manager creates a timestamped backup:

```
~/.claude/CLAUDE.md          →  ~/.claude/CLAUDE.md.bak.1710720000000
~/.claude/mcp-config.json    →  ~/.claude/mcp-config.json.bak.1710720000000
```

During uninstall, backup files matching `*.bak.*` are also cleaned up.

## Removal Entry Points

| Function | What It Removes |
|----------|----------------|
| `removeMarkers(path)` | Content between `COGNISTORE:BEGIN/END` markers |
| `removeMcpEntry(path, 'cognistore')` | `cognistore` key from `mcpServers` object |
| `removeOpenCodeMcp()` | `cognistore` key from OpenCode `mcp` object |
