export type CurationAutonomy = 'off' | 'suggest' | 'auto-safe' | 'auto';
export type CurationTaskKind = 'cluster' | 'aging' | 'tags' | 'title';
export type CurationVerdict = 'duplicate' | 'supersedes' | 'complementary' | 'distinct' | 'still_valid' | 'outdated' | 'unsure' | 'proposal';

export interface JudgeEntryData {
  id: string; title: string; content: string; tags: string[]; scope: string; type: string;
  version: number; contentHash: string | null;
}
export interface JudgeInput {
  taskKind: CurationTaskKind;
  entries: JudgeEntryData[];
  candidateIds: string[];
  hashes: Record<string, string | null>;
  versions: Record<string, number>;
  neighbours?: Pick<JudgeEntryData, 'id' | 'title' | 'content' | 'version' | 'contentHash'>[];
}
export interface JudgeResult {
  verdict: CurationVerdict; confidence: number; reason: string; candidateIds: string[];
  payload?: { title?: string; tags?: string[]; sourceId?: string; targetId?: string };
  model?: string;
}
export interface CurationJudge {
  judge(input: JudgeInput, signal?: AbortSignal): Promise<JudgeResult | null>;
}
export interface CurationOptions {
  autonomy: CurationAutonomy;
  budgetMs: number;
  maxClusters: number;
  maxItems: number;
  trashRetentionDays: number;
  clusterThreshold: number;
  deprecatedUnreadDays: number;
  model: string;
  trigger: string;
  runId?: string;
}
export interface CurationRunResult {
  runId: string; status: 'completed' | 'paused' | 'failed'; proposed: number; applied: number;
  processed: number; failures: { phase: string; error: string }[];
}
