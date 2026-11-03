import * as React from 'react';
import { cn } from '@/lib/utils';

const SidebarContext = React.createContext<{ open: boolean; toggle: () => void } | null>(null);
function useSidebar() { const context = React.useContext(SidebarContext); if (!context) throw new Error('useSidebar must be used within SidebarProvider'); return context; }
function SidebarProvider({ defaultOpen = true, children, className }: React.PropsWithChildren<{ defaultOpen?: boolean; className?: string }>) {
  const [open, setOpen] = React.useState(defaultOpen);
  const toggle = React.useCallback(() => setOpen((value) => !value), []);
  return <SidebarContext.Provider value={{ open, toggle }}><div data-sidebar="wrapper" className={cn('flex min-h-svh w-full', className)}>{children}</div></SidebarContext.Provider>;
}
const Sidebar = React.forwardRef<HTMLElement, React.ComponentProps<'aside'>>(({ className, ...props }, ref) => { const { open } = useSidebar(); return <aside ref={ref} data-state={open ? 'expanded' : 'collapsed'} className={cn('flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200', open ? 'w-64' : 'w-[68px]', className)} {...props} />; });
Sidebar.displayName = 'Sidebar';
const SidebarTrigger = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(({ className, children, ...props }, ref) => { const { toggle } = useSidebar(); return <button ref={ref} type="button" aria-label="Toggle sidebar" onClick={toggle} className={cn('inline-flex items-center justify-center rounded-md p-2 hover:bg-sidebar-accent', className)} {...props}>{children}</button>; });
SidebarTrigger.displayName = 'SidebarTrigger';
function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) { return <main className={cn('min-w-0 flex-1', className)} {...props} />; }
function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('flex items-center gap-2 p-4', className)} {...props} />; }
function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2', className)} {...props} />; }
function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('relative flex w-full min-w-0 flex-col p-2', className)} {...props} />; }
function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/60', className)} {...props} />; }
function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) { return <ul className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />; }
function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) { return <li className={cn('group/menu-item relative', className)} {...props} />; }
function SidebarMenuButton({ className, active, ...props }: React.ComponentProps<'button'> & { active?: boolean }) { return <button data-active={active || undefined} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-sidebar-accent data-[active]:bg-sidebar-accent data-[active]:font-medium data-[active]:text-sidebar-primary [&_svg]:size-4', className)} {...props} />; }
export { Sidebar, SidebarProvider, SidebarTrigger, SidebarInset, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar };
