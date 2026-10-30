import { parentPort } from 'node:worker_threads';
parentPort.postMessage({ type: 'error', id: null, error: { code: 'WORKER_STARTUP_ERROR', message: 'fixture startup failure' } });
parentPort.close();
