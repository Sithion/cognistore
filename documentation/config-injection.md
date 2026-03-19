# Config Injection System

## Overview

The `@ai-knowledge/config` package manages automatic configuration of AI clients. It uses a **marker-based injection** system to safely add and remove configuration blocks in shared files without overwriting user content.

**File:** `packages/config/src/config-manager.ts`

## Supported Clients

| Client | MCP Config | Instructions File | Skills Location |
|--------|-----------|-------------------|-----------------|
| Claude Code | `~/.claude/mcp-config.json` | `~/.claude/CLAUDE.md` | `~/.claude/skills/ai-knowledge-*/` |
| GitHub Copilot | `~/.copilot/mcp-config.json` | `~/.github/copilot-instructions.md` | `~/.copilot/skills/ai-knowledge-*.md` |
| OpenCode | `~/.config/opencode/opencode.json` | — | — |

## Marker-Based Injection

### How It Works

Instructions and configuration blocks are wrapped in markers:

```markdown
<!-- AI-KNOWLEDGE:BEGIN -->
... injected content ...
<!-- AI-KNOWLEDGE:END -->
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
    "ai-knowledge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@ai-knowledge/mcp-server"],
      "env": {
        "SQLITE_PATH": "~/.ai-knowledge/knowledge.db",
        "OLLAMA_HOST": "http://localhost:11434"
      }
    }
  }
}
```

The `setupMcpConfig(path, entry)` function:
1. Reads existing JSON (or creates `{}`)
2. Ensures `mcpServers` object exists
3. Sets `mcpServers['ai-knowledge']` = entry
4. Writes back with 2-space indentation

### OpenCode Format

OpenCode uses a different JSON structure:

```json
{
  "mcp": {
    "ai-knowledge": {
      "type": "local",
      "command": ["npx", "-y", "@ai-knowledge/mcp-server"],
      "enabled": true,
      "environment": {
        "SQLITE_PATH": "~/.ai-knowledge/knowledge.db",
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
| `ai-knowledge-capture` | `~/.claude/skills/ai-knowledge-capture/SKILL.md` | `Stop` | Capture knowledge after completing tasks |
| `ai-knowledge-query` | `~/.claude/skills/ai-knowledge-query/SKILL.md` | `PreToolUse` | Query knowledge before starting tasks |
| `ai-knowledge-plan` | `~/.claude/skills/ai-knowledge-plan/SKILL.md` | `PostToolUse` (ExitPlanMode) | Save plans to knowledge base with task management workflow |

### Copilot Skills

Copied to `~/.copilot/skills/`:

| Skill | File | Purpose |
|-------|------|---------|
| `ai-knowledge-capture` | `~/.copilot/skills/ai-knowledge-capture.md` | Capture knowledge after tasks |
| `ai-knowledge-query` | `~/.copilot/skills/ai-knowledge-query.md` | Query knowledge before tasks |
| `ai-knowledge-plan` | `~/.copilot/skills/ai-knowledge-plan.md` | Save plans to knowledge base with task tracking |

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

Both Claude Code and Copilot instructions include the rule: **plans must be stored in the knowledge base** using `createPlan`, never as local files. The `ai-knowledge-plan` skill reinforces this with a `PostToolUse` hook on `ExitPlanMode` that reminds agents to persist their plans before leaving plan mode.

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
| `removeMarkers(path)` | Content between `AI-KNOWLEDGE:BEGIN/END` markers |
| `removeMcpEntry(path, 'ai-knowledge')` | `ai-knowledge` key from `mcpServers` object |
| `removeOpenCodeMcp()` | `ai-knowledge` key from OpenCode `mcp` object |
