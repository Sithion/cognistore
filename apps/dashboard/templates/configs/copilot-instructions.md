<!-- AI-KNOWLEDGE:BEGIN -->
## Knowledge Base Integration (ai-knowledge)

> **MANDATORY** — These rules apply to EVERY task, EVERY interaction. No exceptions.
> Tools are provided by the `ai-knowledge` MCP server.

### Protocol: Knowledge-First

1. **BEFORE starting ANY work**, query the knowledge base:
   ```
   mcp__ai_knowledge__getKnowledge(query: "<describe the task or problem>")
   ```
   - Results with similarity > 0.50: **Use directly** — skip redundant analysis
   - Similarity 0.30–0.50: **Review** — combine with targeted fresh analysis
   - No results or < 0.30: Proceed with full analysis

2. **AFTER completing ANY work**, capture knowledge:
   ```
   mcp__ai_knowledge__addKnowledge(
     content: "<what was learned/decided/fixed>",
     tags: ["tag1", "tag2", ...],   // MANDATORY — tags are vectorized for semantic search
     type: "pattern|decision|fix|constraint|gotcha",
     scope: "global" or "workspace:<project-name>",
     source: "<origin of this knowledge>"
   )
   ```

3. **If existing knowledge is outdated**, update it:
   ```
   mcp__ai_knowledge__updateKnowledge(id: "<uuid>", content: "...", tags: [...])
   ```

4. **NEVER skip the knowledge query** — a single query costs ~30 tokens; missing a cache hit wastes 2,000–8,000 tokens on redundant work.

5. **All knowledge entries MUST be in English** — regardless of conversation language.

6. **Manage knowledge, don't duplicate** — if a query returns an existing entry and your work updates that topic, use `updateKnowledge(id, ...)` instead of creating a new entry. Only use `addKnowledge` for genuinely new knowledge.

7. **Only store high-value knowledge** — capture hard-won insights, non-obvious gotchas, project-specific decisions, and architectural constraints. Do NOT store trivial fixes, standard API docs, or anything a web search answers in 30 seconds.

8. **Plans go in the knowledge base** — when creating implementation plans, use `createPlan()` to store them. Never save plans to local files. The knowledge base is the single source of truth for all plans.

### Quick Reference

| Tool | Required Params | When |
|------|----------------|------|
| `getKnowledge` | `query` | Before ANY task |
| `addKnowledge` | `content`, `tags`, `type`, `scope`, `source` | After ANY task |
| `updateKnowledge` | `id` + fields to update | When existing knowledge is stale |
| `deleteKnowledge` | `id` | When knowledge is wrong or obsolete |
| `listTags` | (none) | To discover existing tag taxonomy |
| `healthCheck` | (none) | To verify database and Ollama connectivity |

### When to Capture

| Event | Type | Example Tags |
|-------|------|-------------|
| Bug fixed | `fix` | error-name, module, root-cause |
| Architecture choice | `decision` | component, approach, trade-off |
| Code pattern found | `pattern` | language, pattern-name, where-used |
| Limitation discovered | `constraint` | tool, version, workaround |
| Unexpected behavior | `gotcha` | tool, symptom, fix |

### Priority Order for Information

1. **Knowledge base** (`getKnowledge`) — always first
2. **Project codebase** — files, patterns, existing code
3. **Web search** — only if knowledge base and codebase insufficient
<!-- AI-KNOWLEDGE:END -->
