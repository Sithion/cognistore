import { useState, useEffect, useCallback } from 'react';

/** How often to check for updates (30 minutes) */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

export function UpdateChecker() {
  const [state, setState] = useState<UpdateState>('idle');
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdate = useCallback(async () => {
    // Only works inside Tauri
    if (!(window as any).__TAURI__) return;

    try {
      setState('checking');
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();

      if (update) {
        setVersion(update.version);
        setState('available');

        // Store the update object for later download
        (window as any).__pendingUpdate = update;
      } else {
        setState('idle');
      }
    } catch (err) {
      console.warn('Update check failed:', err);
      setState('idle'); // Silently fail — don't bother the user
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    const update = (window as any).__pendingUpdate;
    if (!update) return;

    try {
      setState('downloading');
      setProgress(0);

      let downloaded = 0;
      const contentLength = update.rawInfo?.contentLength ?? 0;

      await update.downloadAndInstall((event: any) => {
        if (event.event === 'Started') {
          // event.data.contentLength
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setProgress(Math.round((downloaded / contentLength) * 100));
          }
        } else if (event.event === 'Finished') {
          setProgress(100);
        }
      });

      setState('ready');

      // Relaunch after a short delay
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
      setState('error');
    }
  }, []);

  // Check on mount + every 30 minutes
  useEffect(() => {
    // Delay first check by 5 seconds (let the app load)
    const initial = setTimeout(checkForUpdate, 5000);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  // Don't render anything if idle/checking or dismissed
  if (state === 'idle' || state === 'checking' || dismissed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        backgroundColor: state === 'error' ? '#7f1d1d' : '#1e1b4b',
        borderBottom: '1px solid var(--border)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
        animation: 'slideDown 0.3s ease-out',
      }}
    >
      <style>{`@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }`}</style>

      {state === 'available' && (
        <>
          <span style={{ color: '#c4b5fd' }}>
            ✨ Version <strong style={{ color: '#e9d5ff' }}>v{version}</strong> is available
          </span>
          <button
            onClick={downloadAndInstall}
            style={{
              backgroundColor: '#8b5cf6',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              padding: '4px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Update now
          </button>
          <button
            onClick={() => setDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#a78bfa',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
              lineHeight: 1,
            }}
            title="Dismiss"
          >
            ×
          </button>
        </>
      )}

      {state === 'downloading' && (
        <>
          <span style={{ color: '#c4b5fd' }}>Downloading update...</span>
          <div
            style={{
              width: 120,
              height: 6,
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                backgroundColor: '#8b5cf6',
                borderRadius: 3,
                transition: 'width 0.3s',
              }}
            />
          </div>
          <span style={{ color: '#a78bfa', fontSize: 11 }}>{progress}%</span>
        </>
      )}

      {state === 'ready' && (
        <span style={{ color: '#a3e635' }}>✓ Update installed — restarting...</span>
      )}

      {state === 'error' && (
        <>
          <span style={{ color: '#fca5a5' }}>Update failed: {error}</span>
          <button
            onClick={() => { setState('idle'); setDismissed(true); }}
            style={{
              background: 'none',
              border: 'none',
              color: '#fca5a5',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
