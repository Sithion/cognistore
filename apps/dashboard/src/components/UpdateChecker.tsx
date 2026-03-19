import { useState, useEffect, useCallback, useRef } from 'react';

/** How often to check for updates (30 minutes) */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

type UpdateState = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'ready' | 'error' | 'unavailable';

/** Global event target for cross-component communication */
const updateEvents = new EventTarget();

/** Whether the check was triggered manually (shows error/upToDate feedback) */
let isManualCheck = false;

/** Trigger an update check from anywhere (manual = shows feedback) */
export function triggerUpdateCheck() {
  isManualCheck = true;
  updateEvents.dispatchEvent(new Event('check'));
}

/** Subscribe to update state changes */
export function onUpdateState(cb: (state: UpdateState) => void) {
  const handler = (e: Event) => cb((e as CustomEvent).detail);
  updateEvents.addEventListener('state', handler);
  return () => updateEvents.removeEventListener('state', handler);
}

export function UpdateChecker() {
  const [state, setState] = useState<UpdateState>('idle');
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const manualRef = useRef(false);

  const broadcastState = useCallback((s: UpdateState) => {
    setState(s);
    updateEvents.dispatchEvent(new CustomEvent('state', { detail: s }));
  }, []);

  const checkForUpdate = useCallback(async () => {
    const manual = isManualCheck;
    isManualCheck = false;
    manualRef.current = manual;

    // Outside Tauri — report unavailable for manual checks
    if (!(window as any).__TAURI__) {
      if (manual) {
        broadcastState('unavailable');
        setTimeout(() => broadcastState('idle'), 3000);
      }
      return;
    }

    try {
      broadcastState('checking');
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();

      if (update) {
        setVersion(update.version);
        broadcastState('available');
        setDismissed(false);
        (window as any).__pendingUpdate = update;
      } else {
        // No update available
        if (manual) {
          broadcastState('upToDate');
          setTimeout(() => broadcastState('idle'), 3000);
        } else {
          broadcastState('idle');
        }
      }
    } catch (err: any) {
      console.warn('Update check failed:', err);
      if (manual) {
        // Manual check — show error to user
        setError(err?.message || 'Check failed');
        broadcastState('error');
      } else {
        // Automatic check — fail silently
        broadcastState('idle');
      }
    }
  }, [broadcastState]);

  const downloadAndInstall = useCallback(async () => {
    const update = (window as any).__pendingUpdate;
    if (!update) return;

    try {
      broadcastState('downloading');
      setProgress(0);

      let downloaded = 0;
      const contentLength = update.rawInfo?.contentLength ?? 0;

      await update.downloadAndInstall((event: any) => {
        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setProgress(Math.round((downloaded / contentLength) * 100));
          }
        } else if (event.event === 'Finished') {
          setProgress(100);
        }
      });

      broadcastState('ready');

      setTimeout(async () => {
        try {
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
        } catch {
          // Fallback: just tell the user to restart
        }
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Download failed');
      broadcastState('error');
    }
  }, [broadcastState]);

  // Check on mount + every 30 minutes (automatic, silent)
  useEffect(() => {
    const initial = setTimeout(checkForUpdate, 5000);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [checkForUpdate]);

  // Listen for external check triggers (manual)
  useEffect(() => {
    const handler = () => checkForUpdate();
    updateEvents.addEventListener('check', handler);
    return () => updateEvents.removeEventListener('check', handler);
  }, [checkForUpdate]);

  // Don't render banner for idle/checking/upToDate/unavailable or if dismissed
  if (state === 'idle' || state === 'checking' || state === 'upToDate' || state === 'unavailable' || dismissed) return null;

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        backgroundColor: state === 'error' ? '#7f1d1d' : '#1e1b4b',
        borderBottom: '1px solid var(--border)',
        padding: '8px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        fontSize: 13, fontFamily: 'system-ui, sans-serif',
        animation: 'slideDown 0.3s ease-out',
      }}
    >
      <style>{`@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }`}</style>

      {state === 'available' && (
        <>
          <span style={{ color: '#c4b5fd' }}>
            Version <strong style={{ color: '#e9d5ff' }}>v{version}</strong> is available
          </span>
          <button onClick={downloadAndInstall} style={{ backgroundColor: '#8b5cf6', color: 'white', border: 'none', borderRadius: 6, padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Update now
          </button>
          <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }} title="Dismiss">×</button>
        </>
      )}

      {state === 'downloading' && (
        <>
          <span style={{ color: '#c4b5fd' }}>Downloading update...</span>
          <div style={{ width: 120, height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', backgroundColor: '#8b5cf6', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
          <span style={{ color: '#a78bfa', fontSize: 11 }}>{progress}%</span>
        </>
      )}

      {state === 'ready' && (
        <span style={{ color: '#a3e635' }}>Update installed — restarting...</span>
      )}

      {state === 'error' && (
        <>
          <span style={{ color: '#fca5a5' }}>Update failed: {error}</span>
          <button onClick={() => { broadcastState('idle'); setDismissed(true); }} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
        </>
      )}
    </div>
  );
}
