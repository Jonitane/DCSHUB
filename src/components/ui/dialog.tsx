import * as React from 'react';
import { cn } from '@/lib/utils';

// ============================================================
// Dialog - 简化版
// ============================================================

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialog() {
  const context = React.useContext(DialogContext);
  if (!context) throw new Error('useDialog must be used within Dialog');
  return context;
}

interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, defaultOpen, onOpenChange, children }: DialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen || false);

  const isOpen = open !== undefined ? open : internalOpen;

  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (open === undefined) setInternalOpen(newOpen);
      onOpenChange?.(newOpen);
    },
    [open, onOpenChange],
  );

  return (
    <DialogContext.Provider value={{ open: isOpen, onOpenChange: handleOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

// ============================================================
// DialogTrigger
// ============================================================

interface DialogTriggerProps {
  children: React.ReactElement;
}

export function DialogTrigger({ children }: DialogTriggerProps) {
  const { onOpenChange } = useDialog();
  const props: any = { onClick: () => onOpenChange(true) };
  return React.cloneElement(children, props);
}

// ============================================================
// DialogContent
// ============================================================

interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
  overlayClassName?: string;
}

export function DialogContent({ children, className, overlayClassName }: DialogContentProps) {
  const { open, onOpenChange } = useDialog();
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    contentRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onOpenChange(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className={cn('fixed inset-0 z-[70] flex items-center justify-center', overlayClassName)}>
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* 内容容器 */}
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          'relative z-50 w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg outline-none',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ============================================================
// DialogHeader
// ============================================================

interface DialogHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogHeader({ children, className }: DialogHeaderProps) {
  return (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}>
      {children}
    </div>
  );
}

// ============================================================
// DialogTitle
// ============================================================

interface DialogTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogTitle({ children, className }: DialogTitleProps) {
  return (
    <h2 className={cn('text-lg font-semibold leading-none tracking-tight', className)}>
      {children}
    </h2>
  );
}

// ============================================================
// DialogDescription
// ============================================================

interface DialogDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogDescription({ children, className }: DialogDescriptionProps) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      {children}
    </p>
  );
}

// ============================================================
// DialogFooter
// ============================================================

interface DialogFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return (
    <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}>
      {children}
    </div>
  );
}

// ============================================================
// DialogClose
// ============================================================

interface DialogCloseProps {
  children: React.ReactElement;
}

export function DialogClose({ children }: DialogCloseProps) {
  const { onOpenChange } = useDialog();
  const props: any = { onClick: () => onOpenChange(false) };
  return React.cloneElement(children, props);
}

export default {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
};
