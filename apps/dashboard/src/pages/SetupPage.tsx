import { useState, useCallback } from 'react';
import { Check, Circle, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { api, type SetupStatus } from '../api/client.js';

declare const __APP_VERSION__: string;

type StepStatus = 'pending' | 'running' | 'done' | 'error';
interface Step { id: string; label: string; status: StepStatus; error?: string }
const INITIAL_STEPS: Step[] = [
  { id: 'node', label: 'Installing Node.js v24', status: 'pending' },
  { id: 'ollama', label: 'Installing Ollama', status: 'pending' },
  { id: 'ollama-start', label: 'Starting Ollama', status: 'pending' },
  { id: 'database', label: 'Creating database', status: 'pending' },
  { id: 'model', label: 'Downloading AI model', status: 'pending' },
  { id: 'configure', label: 'Configuring agents', status: 'pending' },
  { id: 'complete', label: 'Finishing setup', status: 'pending' },
];
const SAFE_ERROR = 'This setup step could not finish. Check your connection and system requirements, then retry.';
const REQUESTS: Record<string, () => Promise<{ success: boolean; message?: string }>> = {
  node: api.setupNode, ollama: api.setupOllama, 'ollama-start': api.setupOllamaStart,
  database: api.setupDatabase, model: api.setupModel, configure: api.setupConfigure, complete: api.setupComplete,
};

export function SetupPage({ onComplete }: { onComplete: () => void }) {
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [error, setError] = useState('');

  const setStatus = (id: string, status: StepStatus, message?: string) =>
    setSteps(current => current.map(step => step.id === id ? { ...step, status, error: message } : step));

  const runSetup = useCallback(async (retryStep?: string) => {
    if (running) return;
    setRunning(true); setStarted(true); setError('');
    try {
      let status: SetupStatus;
      try { status = await api.getSetupStatus(); }
      catch { status = { nodeReady: false, ollamaInstalled: false, ollamaRunning: false, databaseReady: false, modelAvailable: false, configsReady: false, sdkReady: false, allReady: false }; }
      const ready: Record<string, boolean> = {
        node: status.nodeReady, ollama: status.ollamaInstalled, 'ollama-start': status.ollamaRunning,
        database: status.databaseReady, model: status.modelAvailable, configure: status.configsReady,
        complete: false,
      };
      const sequence = retryStep ? INITIAL_STEPS.slice(INITIAL_STEPS.findIndex(s => s.id === retryStep)).map(s => s.id) : INITIAL_STEPS.map(s => s.id);
      for (const id of sequence) {
        if (ready[id]) { setStatus(id, 'done'); continue; }
        setActiveStep(id); setStatus(id, 'running');
        try {
          const result = await REQUESTS[id]();
          if (!result.success) throw new Error(result.message || SAFE_ERROR);
          setStatus(id, 'done');
        } catch {
          setStatus(id, 'error', SAFE_ERROR); setError(SAFE_ERROR); return;
        }
      }
      setDone(true); setActiveStep(null);
    } finally { setRunning(false); }
  }, [running]);

  const completed = steps.filter(step => step.status === 'done').length;
  const failed = steps.find(step => step.status === 'error');
  return <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
    <div className="w-full max-w-xl space-y-6">
      <header className="text-center"><h1 className="text-3xl font-semibold tracking-tight">CogniStore setup</h1><p className="mt-2 text-sm text-muted-foreground">Version {__APP_VERSION__} · Prepare your local environment</p></header>
      <Card><CardHeader><CardTitle>Setup progress</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="space-y-2"><div className="flex justify-between text-sm"><span>{started ? 'Steps completed' : 'Ready to set up'}</span><span>{completed}/{steps.length}</span></div><progress aria-label="Setup progress" value={completed} max={steps.length} className="h-2 w-full accent-primary" /></div>
        <ol className="divide-y divide-border" aria-label="Setup steps">{steps.map((step, index) => <li key={step.id} className="flex items-start gap-3 py-3" aria-current={step.status === 'running' ? 'step' : undefined}>
          <span className="mt-0.5 text-muted-foreground">{step.status === 'done' ? <Check className="size-4 text-primary" aria-label="Complete" /> : step.status === 'running' ? <LoaderCircle className="size-4 animate-spin text-primary" aria-label="In progress" /> : step.status === 'error' ? <TriangleAlert className="size-4 text-destructive" aria-label="Error" /> : <Circle className="size-4" aria-label="Pending" />}</span>
          <div className="min-w-0 flex-1"><div className="text-sm font-medium">{index + 1}. {step.label}</div>{step.error && <p role="alert" className="mt-1 text-sm text-destructive">{step.error}</p>}</div>
        </li>)}</ol>
        {error && <p className="sr-only" aria-live="polite">{error}</p>}
        <div className="flex justify-end gap-2">{!started && <Button onClick={() => void runSetup()}>Start setup</Button>}{failed && !running && <Button variant="outline" onClick={() => void runSetup(failed.id)}>Retry step</Button>}{done && <Button onClick={onComplete}>Open dashboard</Button>}</div>
      </CardContent></Card>
      {activeStep && <p className="sr-only" aria-live="polite">Working on {activeStep}</p>}
    </div>
  </div>;
}
