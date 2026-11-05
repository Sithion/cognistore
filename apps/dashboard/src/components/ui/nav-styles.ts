export const sectionTabList = 'flex gap-1 overflow-x-auto border-b border-border';

export function sectionTab(active: boolean): string {
  return '-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    (active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground');
}

export const segmentGroup = 'inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1';

export function segment(active: boolean): string {
  return 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md h-7 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ' +
    (active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground');
}
