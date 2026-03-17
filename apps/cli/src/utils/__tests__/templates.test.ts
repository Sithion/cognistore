import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { resolveTemplatesDir } from '../resolve-root.js';

describe('template files completeness', () => {
  const templatesDir = resolveTemplatesDir();

  it('templates directory exists', () => {
    expect(existsSync(templatesDir)).toBe(true);
  });

  it('docker-compose.yml exists and is non-empty', () => {
    const file = resolve(templatesDir, 'docker-compose.yml');
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('services');
  });

  it('init/001-schema.sql exists and is non-empty', () => {
    const file = resolve(templatesDir, 'init', '001-schema.sql');
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('.env.example exists', () => {
    const file = resolve(templatesDir, '.env.example');
    expect(existsSync(file)).toBe(true);
  });

  it('Claude Code skill templates exist', () => {
    const querySkill = resolve(templatesDir, 'skills', 'claude-code', 'ai-knowledge-query', 'SKILL.md');
    const captureSkill = resolve(templatesDir, 'skills', 'claude-code', 'ai-knowledge-capture', 'SKILL.md');
    expect(existsSync(querySkill)).toBe(true);
    expect(existsSync(captureSkill)).toBe(true);
  });

  it('Copilot skill templates exist', () => {
    const querySkill = resolve(templatesDir, 'skills', 'copilot', 'ai-knowledge-query.md');
    const captureSkill = resolve(templatesDir, 'skills', 'copilot', 'ai-knowledge-capture.md');
    expect(existsSync(querySkill)).toBe(true);
    expect(existsSync(captureSkill)).toBe(true);
  });
});
