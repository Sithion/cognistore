import { test } from '@playwright/test';
import { exercise } from './fixtures/worker-eventloop-r5.js';

test('@perf SDK duplicate worker overlaps token scanning and stays within 100ms', async () => {
  test.setTimeout(300000);
  await exercise('duplicates');
});
