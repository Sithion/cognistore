import { createHash } from 'node:crypto';

export function normalizeHashText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

export function contentHash(title: string, content: string): string {
  return createHash('sha256')
    .update(JSON.stringify([normalizeHashText(title), normalizeHashText(content)]))
    .digest('hex');
}
