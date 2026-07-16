import * as React from 'react';
import { cn } from '@/lib/utils';

// ============================================================
// ToggleGroup - 简化版
// ============================================================

interface ToggleGroupContextValue {
  value: string;
  onValueChange: (value: string) => void;
  type: 'single' | 'multiple';
}

const ToggleGroupContext = React.createContext<ToggleGroupContextValue | null>(null);

function useToggleGroup() {
  const context = React.useContext(ToggleGroupContext);
  if (!context) throw new Error('useToggleGroup must be used within ToggleGroup');
  return context;
}

interface ToggleGroupProps {
  type: 'single' | 'multiple';
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function ToggleGroup({
  type,
  value,
  defaultValue,
  onValueChange,
  children,
  className,
}: ToggleGroupProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue || '');

  const currentValue = value !== undefined ? value : internalValue;

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      if (value === undefined) setInternalValue(newValue);
      onValueChange?.(newValue);
    },
    [value, onValueChange],
  );

  return (
    <ToggleGroupContext.Provider value={{ value: currentValue, onValueChange: handleValueChange, type }}>
      <div
        role="group"
        className={cn('inline-flex items-center justify-center gap-1 rounded-md', className)}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

// ============================================================
// ToggleGroupItem
// ============================================================

interface ToggleGroupItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  children: React.ReactNode;
}

export function ToggleGroupItem({ value, children, className, ...props }: ToggleGroupItemProps) {
  const { value: selectedValue, onValueChange } = useToggleGroup();
  const isPressed = selectedValue === value;

  return (
    <button
      type="button"
      data-state={isPressed ? 'on' : 'off'}
      aria-pressed={isPressed}
      onClick={() => onValueChange(value)}
      className={cn(
        'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export default {
  ToggleGroup,
  ToggleGroupItem,
};
