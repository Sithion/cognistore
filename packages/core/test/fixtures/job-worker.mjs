import { parentPort, threadId } from 'node:worker_threads';
let active;
const finish = () => {
  if (!active) return;
  parentPort.postMessage({ type: 'done', id: active.id, result: { n: active.payload.n, threadId } });
  active = undefined;
};
parentPort.on('message', (m) => {
  if (m.type === 'run') {
    active = m;
    if (m.payload.crash) process.exit(9);
    if (m.payload.exitOne) process.exit(1);
    parentPort.postMessage({ type: 'progress', id: m.id, progress: { phase: 'held', done: 0, total: 1 } });
  } else if (m.type === 'continue') {
    finish();
  } else if (m.type === 'cancel' && active?.id === m.id) {
    parentPort.postMessage({ type: 'error', id: m.id, error: { code: 'ABORT_ERR', message: 'Cancelled' } });
    active = undefined;
  } else if (m.type === 'shutdown') {
    parentPort.postMessage({ type: 'closed' });
    parentPort.close();
  }
});
