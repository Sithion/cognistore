import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownUp, BookOpen, Command as CommandIcon, Database, FileText, LayoutGrid, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings2, Sparkles, Sun, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { applyTheme, getThemeMode, type ThemeMode } from './theme';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';

type KnowledgeEntry = { id: string; title: string; content?: string; type?: string; scope?: string; tags?: string[]; createdAt?: string; updatedAt?: string; source?: string };
const groups = [
  { title: 'Knowledge', items: [{ label: 'All entries', icon: BookOpen, path: '/_design' }, { label: 'Collections', icon: Database, path: '/_design' }] },
  { title: 'Plans', items: [{ label: 'Active plans', icon: FileText, path: '/_design' }] },
  { title: 'Telemetry', items: [{ label: 'Overview', icon: Sparkles, path: '/_design' }] },
  { title: 'Settings', items: [{ label: 'Design system', icon: Settings2, path: '/_design/gallery' }] },
];

export default function DesignWorkspace() {
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [detailEntry, setDetailEntry] = useState<KnowledgeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // This component sits under the `/_design/*` splat route, so `:id` is not a named param here:
  // read it from the splat (`k/<id>`).
  const splat = useParams()['*'] ?? '';
  const selectedId = /^k\/([^/]+)/.exec(splat)?.[1] ?? '';

  const changeTheme = useCallback((mode: ThemeMode) => { setTheme(mode); applyTheme(mode); }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setEntries(await api.listRecent(60) as KnowledgeEntry[]); }
    catch { setEntries([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!selectedId) { setDetailEntry(null); return; }
    let cancelled = false;
    setDetailEntry(null);
    api.getById(selectedId).then((entry) => { if (!cancelled) setDetailEntry(entry as KnowledgeEntry); }).catch(() => { if (!cancelled) setDetailEntry(null); });
    return () => { cancelled = true; };
  }, [selectedId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); }
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const filtered = useMemo(() => entries.filter((entry) => `${entry.title} ${entry.content ?? ''} ${(entry.tags ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase())), [entries, query]);
  const selected = useMemo(() => detailEntry ?? entries.find((entry) => entry.id === selectedId) ?? null, [detailEntry, entries, selectedId]);

  return <TooltipProvider delayDuration={300}><div className="design-shell flex h-screen overflow-hidden bg-background font-sans text-foreground">
    <SidebarProvider defaultOpen className="min-h-0">
      <DesignSidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
          <SidebarTrigger><PanelLeftClose className="size-4" /></SidebarTrigger>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Workspace</span><span className="text-muted-foreground">/</span><span className="font-medium">Knowledge</span></div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)} className="gap-2 text-muted-foreground"><Search className="size-3.5" /><span>Search</span><kbd className="ml-3 rounded border border-border px-1.5 py-0.5 text-[10px]">⌘ K</kbd></Button>
            <ThemeControl theme={theme} onChange={changeTheme} />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Routes>
            <Route index element={<KnowledgeView entries={filtered} selected={selected} query={query} setQuery={setQuery} loading={loading} onRefresh={refresh} />} />
            <Route path="k/:id" element={<KnowledgeView entries={filtered} selected={selected ?? detailEntry} query={query} setQuery={setQuery} loading={loading} onRefresh={refresh} />} />
            <Route path="gallery" element={<Gallery theme={theme} onChange={changeTheme} />} />
          </Routes>
        </div>
      </main>
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Search knowledge or navigate…" />
        <CommandList><CommandEmpty>No results found.</CommandEmpty><CommandGroup heading="Knowledge">{entries.slice(0, 8).map((entry) => <CommandItem key={entry.id} onSelect={() => { navigate(`/_design/k/${entry.id}`); setPaletteOpen(false); }}><BookOpen className="mr-2 size-4" />{entry.title}<span className="ml-auto font-mono text-[10px] text-muted-foreground">{entry.id.slice(0, 8)}</span></CommandItem>)}</CommandGroup><CommandGroup heading="Navigate"><CommandItem onSelect={() => { navigate('/_design/gallery'); setPaletteOpen(false); }}><LayoutGrid className="mr-2 size-4" />Component gallery</CommandItem></CommandGroup></CommandList>
      </CommandDialog>
    </SidebarProvider>
  </div></TooltipProvider>;
}

function DesignSidebar() {
  const { open } = useSidebar();
  return <Sidebar className="shrink-0">
    <SidebarHeader className="h-14 border-b border-sidebar-border px-4"><span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"><Sparkles className="size-4" /></span>{open && <><span className="font-semibold tracking-tight">CogniStore</span><Badge variant="secondary" className="ml-auto text-[10px]">2.6</Badge></>}</SidebarHeader>
    <SidebarContent className="p-3">
      {groups.map((group) => <SidebarGroup key={group.title} className="p-0 pb-3"><SidebarGroupLabel>{open ? group.title : <span className="sr-only">{group.title}</span>}</SidebarGroupLabel><SidebarMenu>{group.items.map((item, index) => <SidebarMenuItem key={item.label}><Link to={item.path} className="block"><SidebarMenuButton active={group.title === 'Knowledge' && index === 0}>{<item.icon />}{open && <span>{item.label}</span>}</SidebarMenuButton></Link></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>)}
      <div className="mt-auto"><Separator className="mb-3" />{open && <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3"><div className="mb-1 flex items-center gap-2 text-xs font-medium"><Database className="size-3.5 text-primary" />Local knowledge base</div><p className="text-[11px] leading-relaxed text-muted-foreground">Private by default. Your knowledge stays on this device.</p></div>}<SidebarTrigger className="mt-3 w-full justify-start text-xs text-muted-foreground">{open ? <><PanelLeftClose className="size-4" />Collapse sidebar</> : <PanelLeftOpen className="size-4" />}</SidebarTrigger></div>
    </SidebarContent>
  </Sidebar>;
}

function ThemeControl({ theme, onChange }: { theme: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return <Select value={theme} onValueChange={(value) => onChange(value as ThemeMode)}><SelectTrigger aria-label="Theme" className="h-8 w-[118px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dark"><span className="inline-flex items-center gap-2"><Moon className="size-3.5" />Dark</span></SelectItem><SelectItem value="light"><span className="inline-flex items-center gap-2"><Sun className="size-3.5" />Light</span></SelectItem><SelectItem value="system">System</SelectItem></SelectContent></Select>;
}

function KnowledgeView({ entries, selected, query, setQuery, loading, onRefresh }: { entries: KnowledgeEntry[]; selected: KnowledgeEntry | null; query: string; setQuery: (value: string) => void; loading: boolean; onRefresh: () => void }) {
  const navigate = useNavigate();
  const params = useParams();
  const activeId = params.id;
  return <div className="flex min-h-0 flex-1 overflow-hidden">
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-end justify-between border-b border-border px-6 py-5"><div><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span>Knowledge</span><span>/</span><span className="text-foreground">All entries</span></div><h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1><p className="mt-1 text-sm text-muted-foreground">A quiet space for everything your agents have learned.</p></div><div className="flex gap-2"><Dialog><DialogTrigger asChild><Button variant="outline" size="sm">About this preview</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Design system preview</DialogTitle><DialogDescription>This private route previews the shadcn/ui component foundation for the next dashboard iteration.</DialogDescription></DialogHeader><div className="rounded-lg bg-muted p-3 text-sm">Existing dashboard screens continue to use their current layout and styles.</div></DialogContent></Dialog><Sheet><SheetTrigger asChild><Button size="sm" className="gap-2"><Sparkles className="size-4" />New entry</Button></SheetTrigger><SheetContent><SheetHeader><SheetTitle>Create a knowledge entry</SheetTitle><SheetDescription>Capture something useful for your future self.</SheetDescription></SheetHeader><div className="mt-6 grid gap-4"><Input placeholder="Entry title" /><Input placeholder="Scope, e.g. workspace:project" /><Button onClick={() => toast.success('Draft ready to save')}>Continue</Button></div></SheetContent></Sheet></div></div>
      <div className="flex items-center gap-3 border-b border-border px-6 py-3"><div className="relative max-w-sm flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Filter knowledge" placeholder="Filter entries…" value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 pl-9" /></div><Button variant="outline" size="sm" onClick={onRefresh} className="gap-2"><ArrowDownUp className="size-3.5" />Recent first</Button><span className="text-xs text-muted-foreground">{entries.length} entries</span></div>
      <ScrollArea className="min-h-0 flex-1"><div className="divide-y divide-border">{loading ? <div className="space-y-3 p-6">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-16 w-full" />)}</div> : entries.map((entry) => <button type="button" key={entry.id} onClick={() => navigate(`/_design/k/${entry.id}`)} className={`w-full px-6 py-4 text-left transition-colors hover:bg-accent/50 ${activeId === entry.id ? 'bg-accent/70' : ''}`}><div className="flex items-start gap-3"><div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><BookOpen className="size-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{entry.title || 'Untitled entry'}</span><Badge variant="outline" className="shrink-0 text-[10px] uppercase">{entry.type ?? 'knowledge'}</Badge></div><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{entry.content ?? 'No preview available'}</p><div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground"><span>{entry.scope ?? 'global'}</span><span>·</span><span>{formatDate(entry.updatedAt ?? entry.createdAt)}</span>{(entry.tags ?? []).slice(0, 2).map((tag) => <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[9px]">{tag}</Badge>)}</div></div><span className="font-mono text-[10px] text-muted-foreground">{entry.id.slice(0, 8)}</span></div></button>)}</div></ScrollArea>
    </section>
    {activeId && <aside data-testid="knowledge-detail" className="flex min-h-0 w-[360px] shrink-0 flex-col overflow-hidden border-l border-border bg-card/50"><div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5"><div className="flex items-center gap-2 text-sm font-medium"><BookOpen className="size-4 text-primary" />Entry details</div><Button variant="ghost" size="icon" aria-label="Close detail" onClick={() => navigate('/_design')}><X className="size-4" /></Button></div>{selected ? <ScrollArea className="min-h-0 flex-1"><div className="space-y-5 p-5"><div><Badge variant="secondary" className="mb-3 text-[10px] uppercase">{selected.type ?? 'knowledge'}</Badge><h2 className="text-lg font-semibold leading-snug">{selected.title}</h2><p className="mt-2 text-xs text-muted-foreground">{selected.scope ?? 'global'}</p></div><Separator /><div><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Content</h3><p className="whitespace-pre-wrap text-sm leading-6">{selected.content}</p></div><div><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</h3><div className="flex flex-wrap gap-1.5">{(selected.tags ?? []).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div></div><Separator /><div><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Metadata</h3><dl className="space-y-2 text-xs"><Meta label="ID" value={selected.id} mono /><Meta label="Source" value={selected.source ?? '—'} /><Meta label="Created" value={formatDate(selected.createdAt)} /><Meta label="Updated" value={formatDate(selected.updatedAt)} /></dl></div></div></ScrollArea> : <div className="p-5 text-sm text-muted-foreground">Loading entry…</div>}</aside>}
  </div>;
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="grid grid-cols-[65px_1fr] gap-2"><dt className="text-muted-foreground">{label}</dt><dd className={`truncate ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</dd></div>; }
function formatDate(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

function Gallery({ theme, onChange }: { theme: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return <div className="min-h-0 flex-1 overflow-auto p-6 lg:p-10"><div className="mx-auto max-w-5xl"><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-medium uppercase tracking-widest text-primary">Foundation · 01</p><h1 className="text-3xl font-semibold tracking-tight">Component gallery</h1><p className="mt-2 text-sm text-muted-foreground">A visual inventory of the dashboard's UI primitives.</p></div><div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"><span className="text-sm">Dark mode</span><Switch aria-label="Toggle dark theme" checked={theme === 'dark'} onCheckedChange={(checked) => onChange(checked ? 'dark' : 'light')} /></div></div>
    <div className="grid gap-5 md:grid-cols-2">
      <Card><CardHeader><CardTitle>Buttons & badges</CardTitle><CardDescription>Actions, hierarchy, status, and labels.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-2"><Button>Primary action</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Delete</Button><Badge>Active</Badge><Badge variant="secondary">Pattern</Badge><Badge variant="outline">Workspace</Badge></CardContent></Card>
      <Card><CardHeader><CardTitle>Form controls</CardTitle><CardDescription>Inputs, selection, and settings.</CardDescription></CardHeader><CardContent className="space-y-4"><Input placeholder="Search your knowledge…" /><Select defaultValue="patterns"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="patterns">Patterns</SelectItem><SelectItem value="decisions">Decisions</SelectItem><SelectItem value="notes">Notes</SelectItem></SelectContent></Select><div className="flex items-center gap-3"><input id="remember" type="checkbox" defaultChecked className="size-4 accent-primary" /><label htmlFor="remember" className="text-sm">Keep this filter</label><Switch aria-label="Enable notifications" defaultChecked /><span className="text-sm">Notifications</span></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Tabs & separators</CardTitle><CardDescription>Compact navigation within a page.</CardDescription></CardHeader><CardContent><Tabs defaultValue="overview"><TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger><TabsTrigger value="sources">Sources</TabsTrigger></TabsList><TabsContent value="overview" className="text-sm text-muted-foreground">Entry activity at a glance.</TabsContent><TabsContent value="activity" className="text-sm text-muted-foreground">Recent reads and updates.</TabsContent><TabsContent value="sources" className="text-sm text-muted-foreground">Connected agent sources.</TabsContent></Tabs><Separator className="mt-4" /></CardContent></Card>
      <Card><CardHeader><CardTitle>Overlay primitives</CardTitle><CardDescription>Contextual actions and focused tasks.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Tooltip><TooltipTrigger asChild><Button variant="outline">Hover tooltip</Button></TooltipTrigger><TooltipContent>Short, helpful context</TooltipContent></Tooltip><Dialog><DialogTrigger asChild><Button variant="outline">Open dialog</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Archive this entry?</DialogTitle><DialogDescription>The entry remains searchable in your archive.</DialogDescription></DialogHeader><div className="flex justify-end"><Button onClick={() => toast.success('Entry archived')}>Archive entry</Button></div></DialogContent></Dialog><Sheet><SheetTrigger asChild><Button variant="outline">Open sheet</Button></SheetTrigger><SheetContent><SheetHeader><SheetTitle>Quick settings</SheetTitle><SheetDescription>Adjust your workspace preferences.</SheetDescription></SheetHeader><div className="mt-6 flex items-center gap-3"><Switch defaultChecked />Show entry previews</div></SheetContent></Sheet><Button variant="outline" onClick={() => toast.success('Your changes have been saved')}>Show toast</Button></CardContent></Card>
      <Card><CardHeader><CardTitle>Loading states</CardTitle><CardDescription>Reserved space while data arrives.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex items-center gap-3"><Skeleton className="size-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-2/3" /></div></div><Skeleton className="h-16 w-full" /></CardContent></Card>
      <Card><CardHeader><CardTitle>Keyboard navigation</CardTitle><CardDescription>Find an entry anywhere in the workspace.</CardDescription></CardHeader><CardContent><div className="flex items-center gap-3 rounded-lg border border-border p-3"><CommandIcon className="size-4 text-muted-foreground" /><span className="flex-1 text-sm">Open command palette</span><kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">⌘ K</kbd></div></CardContent></Card>
    </div><div className="mt-6 rounded-lg border border-border bg-muted/50 p-4 text-xs text-muted-foreground">Theme is set to <span className="font-mono text-foreground">{theme}</span> and saved in <span className="font-mono text-foreground">cognistore.theme</span>.</div>
  </div></div>;
}
