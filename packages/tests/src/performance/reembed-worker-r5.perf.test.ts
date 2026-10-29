import { test } from '@playwright/test';
import { exercise } from './fixtures/worker-eventloop-r5.js';

test('@perf SDK reembed worker overlaps token scanning and stays within 100ms', async () => {
  test.setTimeout(600000);
  await exercise('reembed');
});
