import * as React from 'react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { PanelLeftIcon } from 'lucide-react';

// ============================================================
// Context
// ============================================================

type SidebarContextProps = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }
  return context;
}

// ============================================================
// Provider
// ============================================================

interface SidebarProviderProps extends React.ComponentProps<'div'> {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: SidebarProviderProps) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }
    },
    [setOpenProp, open],
  );

  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((o) => !o) : setOpen((o) => !o);
  }, [isMobile, setOpen, setOpenMobile]);

  const state = open ? 'expanded' : 'collapsed';

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        style={
          {
            '--sidebar-width': '16rem',
            '--sidebar-width-icon': '3rem',
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          'group/sidebar-wrapper flex min-h-svh w-full',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

// ============================================================
// Sidebar
// ============================================================

interface SidebarProps extends React.ComponentProps<'div'> {
  side?: 'left' | 'right';
  variant?: 'sidebar' | 'floating' | 'inset';
  collapsible?: 'offcanvas' | 'icon' | 'none';
}

export function Sidebar({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  className,
  children,
  ...props
}: SidebarProps) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (collapsible === 'none') {
    return (
      <div
        className={cn(
          'bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  // 移动端：简单的抽屉实现
  if (isMobile) {
    return (
      <>
        {openMobile && (
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setOpenMobile(false)}
          />
        )}
        <div
          className={cn(
            'fixed inset-y-0 z-50 w-(--sidebar-width) bg-sidebar text-sidebar-foreground transition-transform duration-200',
            side === 'left' ? 'left-0' : 'right-0',
            openMobile ? 'translate-x-0' : side === 'left' ? '-translate-x-full' : 'translate-x-full',
            className,
          )}
          {...props}
        >
          <div className="flex h-full w-full flex-col">{children}</div>
        </div>
      </>
    );
  }

  // 桌面端
  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state={state}
      data-collapsible={state === 'collapsed' ? collapsible : ''}
      data-variant={variant}
      data-side={side}
    >
      {/* 侧边栏占位 */}
      <div
        className={cn(
          'relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear',
          collapsible === 'offcanvas' && state === 'collapsed' && 'w-0',
          collapsible === 'icon' && state === 'collapsed' && 'w-(--sidebar-width-icon)',
        )}
      />
      {/* 侧边栏主体 */}
      <div
        className={cn(
          'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex',
          side === 'left' ? 'left-0' : 'right-0',
          collapsible === 'offcanvas' && state === 'collapsed' && (side === 'left' ? 'left-[calc(var(--sidebar-width)*-1)]' : 'right-[calc(var(--sidebar-width)*-1)]'),
          collapsible === 'icon' && state === 'collapsed' && 'w-(--sidebar-width-icon)',
          side === 'left' && 'border-r',
          side === 'right' && 'border-l',
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'bg-sidebar flex h-full w-full flex-col',
            variant === 'floating' && 'rounded-lg border shadow-sm',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      className={cn('size-7 flex items-center justify-center rounded-md hover:bg-sidebar-accent', className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon className="size-4" />
      <span className="sr-only">Toggle Sidebar</span>
    </button>
  );
}

export function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      className={cn(
        'bg-background relative flex w-full flex-1 flex-col',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      className={cn('flex w-full min-w-0 flex-col gap-1', className)}
      {...props}
    />
  );
}

export function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  );
}

interface SidebarMenuButtonProps extends React.ComponentProps<'button'> {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string;
}

export function SidebarMenuButton({
  asChild = false,
  isActive = false,
  tooltip,
  className,
  children,
  ...props
}: SidebarMenuButtonProps) {
  const { isMobile, state } = useSidebar();

  const buttonContent = (
    <button
      data-active={isActive}
      className={cn(
        'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground',
        'group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!',
        '[&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      title={typeof tooltip === 'string' && state === 'collapsed' && !isMobile ? tooltip : undefined}
      {...props}
    >
      {children}
    </button>
  );

  if (asChild) {
    // 简化版：直接渲染 children，不使用 Slot
    return <>{children}</>;
  }

  return buttonContent;
}

// 导出 useSidebar
export { useSidebar };

// 默认导出
export default {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
  SidebarHeader,
  SidebarFooter,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
};
