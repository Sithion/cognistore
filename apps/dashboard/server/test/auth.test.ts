import { describe, expect, it } from 'vitest';
import {
  allowedOrigins,
  authorize,
  isAllowedHost,
  isAllowedOrigin,
  isPublicPath,
  isStaticPath,
  tokenMatches,
} from '../auth.js';

const PORT = 4317;
const CFG = { token: 'a'.repeat(64), port: PORT, dev: false };
const BASE = { method: 'GET', pathname: '/api/entries', host: `localhost:${PORT}` };

describe('isStaticPath', () => {
  it.each(['/', '/index.html', '/assets/app.js', '/widgets/panel', '/fonts/body.woff', '/image.PNG'])('allows static path %s', (path) => {
    expect(isStaticPath(path)).toBe(true);
  });

  it.each(['/api/health', '/assets', '/widgets', '/app.js/extra', '/file.json'])('does not classify %s as static', (path) => {
    expect(isStaticPath(path)).toBe(false);
  });
});

describe('public paths', () => {
  it('allows only exact health path', () => {
    expect(isPublicPath('/api/health')).toBe(true);
    expect(isPublicPath('/api/health/')).toBe(false);
    expect(isPublicPath('/api/health?detail=1')).toBe(false);
    expect(isPublicPath('/api/other')).toBe(false);
  });

  it('authorizes health without a token after checking Host and Origin', () => {
    expect(authorize({ ...BASE, pathname: '/api/health' }, CFG)).toEqual({ ok: true });
    expect(authorize({ ...BASE, pathname: '/api/health', host: 'evil.test:4317' }, CFG).ok).toBe(false);
    expect(authorize({ ...BASE, pathname: '/api/health', origin: 'http://localhost:1' }, CFG).ok).toBe(false);
  });
});

describe('origin and host allow lists', () => {
  it('pins allowed origins and hosts to the configured port', () => {
    expect(allowedOrigins(PORT)).toEqual([
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
      `http://[::1]:${PORT}`,
    ]);
    for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]) {
      expect(isAllowedHost(host, PORT)).toBe(true);
    }
    expect(isAllowedHost('localhost:4318', PORT)).toBe(false);
    expect(isAllowedHost(undefined, PORT)).toBe(false);
  });

  it('accepts tauri origins and rejects missing or unlisted origins', () => {
    expect(isAllowedOrigin(undefined, PORT)).toBe(false);
    expect(isAllowedOrigin(`http://127.0.0.1:${PORT}`, PORT)).toBe(true);
    expect(isAllowedOrigin('tauri://localhost', PORT)).toBe(true);
    expect(isAllowedOrigin('tauri:custom-app', PORT)).toBe(true);
    expect(isAllowedOrigin(`http://localhost:${PORT + 1}`, PORT)).toBe(false);
  });

  it('requires a valid Host even when Origin is absent or tauri', () => {
    expect(authorize({ ...BASE, host: undefined, token: CFG.token }, CFG).ok).toBe(false);
    expect(authorize({ ...BASE, origin: 'tauri://localhost', token: CFG.token }, CFG).ok).toBe(true);
    expect(authorize({ ...BASE, origin: 'http://evil.test', token: CFG.token }, CFG).ok).toBe(false);
  });
});

describe('token matching', () => {
  it('requires a nonempty expected token and exact same-length value', () => {
    expect(tokenMatches('secret', 'secret')).toBe(true);
    expect(tokenMatches('secreT', 'secret')).toBe(false);
    expect(tokenMatches('short', 'secret')).toBe(false);
    expect(tokenMatches(undefined, 'secret')).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
  });

  it('authorizes a token match and rejects missing or incorrect tokens', () => {
    expect(authorize({ ...BASE, token: CFG.token }, CFG)).toEqual({ ok: true });
    expect(authorize(BASE, CFG)).toEqual({ ok: false, code: 403, reason: 'Forbidden' });
    expect(authorize({ ...BASE, token: 'wrong' }, CFG).ok).toBe(false);
  });
});

describe('authorize decision table', () => {
  it('allows static paths before Host, Origin and token checks', () => {
    expect(authorize({ method: 'GET', pathname: '/assets/main.js', host: 'evil', origin: 'https://evil', token: 'wrong' }, CFG)).toEqual({ ok: true });
  });

  it('only permits unauthenticated requests in explicitly enabled tokenless dev mode', () => {
    expect(authorize(BASE, { ...CFG, token: '', dev: true })).toEqual({ ok: true });
    expect(authorize(BASE, { ...CFG, token: '', dev: false }).ok).toBe(false);
    expect(authorize({ ...BASE, token: 'wrong' }, { ...CFG, token: '', dev: true })).toEqual({ ok: true });
    expect(authorize({ ...BASE, host: 'bad:4317' }, { ...CFG, token: '', dev: true }).ok).toBe(false);
  });

  it('requires the token when dev mode has a configured token', () => {
    expect(authorize(BASE, { ...CFG, dev: true }).ok).toBe(false);
    expect(authorize({ ...BASE, token: CFG.token }, { ...CFG, dev: true })).toEqual({ ok: true });
  });
});
