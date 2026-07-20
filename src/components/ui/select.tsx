import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SelectContextValue {
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  contentId: string
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelect() {
  const context = React.useContext(SelectContext)
  if (!context) throw new Error('useSelect must be used within Select')
  return context
}

interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
}

export function Select({ value, defaultValue, onValueChange, children }: SelectProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue || '')
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const contentId = React.useId()
  const currentValue = value !== undefined ? value : internalValue

  const handleValueChange = React.useCallback((newValue: string) => {
    if (value === undefined) setInternalValue(newValue)
    onValueChange?.(newValue)
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [value, onValueChange])

  return (
    <SelectContext.Provider value={{ value: currentValue, onValueChange: handleValueChange, open, setOpen, triggerRef, contentId }}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  )
}

export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, disabled, onClick, onKeyDown, ...props }, forwardedRef) => {
    const { open, setOpen, triggerRef, contentId } = useSelect()
    const assignRef = React.useCallback((node: HTMLButtonElement | null) => {
      triggerRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    }, [forwardedRef, triggerRef])

    return (
      <button
        ref={assignRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={contentId}
        data-state={open ? 'open' : 'closed'}
        disabled={disabled}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented) setOpen(!open)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        {...props}
      >
        <span className="min-w-0 flex-1 truncate text-left">{children}</span>
        <ChevronDown className={cn('ml-2 size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180 text-primary')} />
      </button>
    )
  },
)
SelectTrigger.displayName = 'SelectTrigger'

interface SelectValueProps {
  placeholder?: string
  children?: React.ReactNode
}

export function SelectValue({ placeholder, children }: SelectValueProps) {
  const { value } = useSelect()
  if (children) return <span className={cn(!value && 'text-muted-foreground')}>{children}</span>
  return <span className={cn(!value && 'text-muted-foreground')}>{value || placeholder}</span>
}

interface SelectContentProps {
  children: React.ReactNode
  className?: string
}

interface MenuPosition {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

export function SelectContent({ children, className }: SelectContentProps) {
  const { value, open, setOpen, triggerRef, contentId } = useSelect()
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState<MenuPosition | null>(null)

  React.useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - 8
      const above = rect.top - 8
      const openAbove = below < 120 && above > below
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        ...(openAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
        width: rect.width,
        maxHeight: Math.max(96, Math.min(384, openAbove ? above : below)),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, triggerRef])

  React.useEffect(() => {
    if (!open || !position) return
    const frame = window.requestAnimationFrame(() => {
      const selected = menuRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      const first = menuRef.current?.querySelector<HTMLElement>('[role="option"]:not([aria-disabled="true"])')
      ;(selected || first || menuRef.current)?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, position, value])

  if (!open || typeof document === 'undefined') return null

  const closeAndRestoreFocus = () => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onMouseDown={closeAndRestoreFocus} />
      <div
        ref={menuRef}
        id={contentId}
        role="listbox"
        tabIndex={-1}
        aria-activedescendant={undefined}
        className={cn('fixed z-[9999] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl outline-none', className)}
        style={{
          left: position?.left ?? 0,
          top: position?.top,
          bottom: position?.bottom,
          width: position?.width ?? 0,
          maxHeight: position?.maxHeight ?? 384,
          visibility: position ? 'visible' : 'hidden',
        }}
        onKeyDown={(event) => {
          const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') || [])
          const currentIndex = items.indexOf(document.activeElement as HTMLElement)
          if (event.key === 'Escape') {
            event.preventDefault()
            closeAndRestoreFocus()
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            const nextIndex = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : event.key === 'ArrowDown'
                  ? Math.min(items.length - 1, Math.max(0, currentIndex + 1))
                  : Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1)
            items[nextIndex]?.focus()
          } else if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.getAttribute('role') === 'option') {
            event.preventDefault()
            ;(document.activeElement as HTMLElement).click()
          } else if (event.key === 'Tab') {
            setOpen(false)
          }
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

export interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
  disabled?: boolean
  children: React.ReactNode
}

export function SelectItem({ value, disabled = false, children, className, onClick, ...props }: SelectItemProps) {
  const { value: selectedValue, onValueChange } = useSelect()
  const selected = selectedValue === value
  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-disabled={disabled}
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground',
        selected && 'bg-accent/50',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && !disabled) onValueChange(value)
      }}
      onMouseMove={(event) => event.currentTarget.focus()}
      {...props}
    >
      {selected && <span className="absolute left-2 flex size-3.5 items-center justify-center"><Check className="size-4" /></span>}
      {children}
    </div>
  )
}

export default { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
