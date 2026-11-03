import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = (props: ToasterProps) => <Sonner theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'} className="toaster group" toastOptions={{ classNames: { toast: 'group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border', description: 'group-[.toast]:text-muted-foreground', actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground', cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground' } }} {...props} />;
export { Toaster };
