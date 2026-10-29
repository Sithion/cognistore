import BetterSqlite3 from 'better-sqlite3';
import { statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { parentPort, threadId, workerData } from 'node:worker_threads';

type VacuumWorkerData = { databasePath: string; operation: 'enable' | 'reclaim'; budgetMs?: number };
type VacuumResult = { ok: true; threadId: number; alreadyIncremental?: boolean; checkpointBusy?: boolean } | { ok: false; code: string; message: string; retryable: boolean };

function redact(error: unknown): VacuumResult {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return { ok: false, code: 'DATABASE_LOCKED', message: 'Database is locked by another process. Close other database clients and retry.', retryable: true };
  }
  return { ok: false, code: 'VACUUM_FAILED', message: 'Incremental vacuum failed. Retry the upgrade or maintenance operation.', retryable: false };
}

let result: VacuumResult;
let connection: InstanceType<typeof BetterSqlite3> | undefined;
try {
  const data = workerData as VacuumWorkerData;
  connection = new BetterSqlite3(data.databasePath);
  if (data.operation === 'enable') {
    connection.pragma('busy_timeout = 5000');
    if (connection.pragma('auto_vacuum', { simple: true }) === 2) {
      result = { ok: true, threadId, alreadyIncremental: true };
    } else {
      const pages = Number(connection.pragma('page_count', { simple: true }));
      const pageSize = Number(connection.pragma('page_size', { simple: true }));
      const stats = statfsSync(dirname(data.databasePath));
      if (Number(stats.bavail) * Number(stats.bsize) < 2 * pages * pageSize) {
        result = { ok: false, code: 'INSUFFICIENT_DISK', message: 'Not enough free disk space to safely rewrite the database for incremental vacuum.', retryable: true };
      } else {
        connection.pragma('auto_vacuum = INCREMENTAL');
        connection.exec('VACUUM');
        let checkpointBusy = true;
        for (let attempt = 0; attempt < 5; attempt++) {
          const checkpoint = (connection.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy?: number }>)[0];
          if (!checkpoint?.busy) { checkpointBusy = false; break; }
          if (attempt < 4) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
        }
        result = { ok: true, threadId, ...(checkpointBusy ? { checkpointBusy: true } : {}) };
      }
    }
  } else {
    connection.pragma('busy_timeout = 500');
    if (connection.pragma('auto_vacuum', { simple: true }) === 2) {
      const budgetMs = data.budgetMs ?? 2000;
      if (!Number.isFinite(budgetMs) || budgetMs < 1) throw new Error('Invalid time budget');
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { connection.pragma('incremental_vacuum(1000)'); }
        catch (error) {
          if ((error as { code?: string })?.code === 'SQLITE_BUSY') break;
          throw error;
        }
        const free = connection.pragma('freelist_count', { simple: true }) as number;
        if (free === 0) break;
        const remaining = deadline - Date.now();
        if (remaining > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(50, remaining));
      }
    }
    result = { ok: true, threadId };
  }
} catch (error) {
  result = redact(error);
} finally {
  try { connection?.close(); } catch (error) { result = redact(error); }
}
parentPort?.postMessage(result!);
