import { startServer } from '../../../../../apps/mcp-server/src/startup.js';

await startServer({
  openSdk: async () => {
    throw Object.assign(
      new Error('NODE_MODULE_VERSION 127; this version of Node.js requires NODE_MODULE_VERSION 137'),
      { code: 'ERR_DLOPEN_FAILED' },
    );
  },
});
