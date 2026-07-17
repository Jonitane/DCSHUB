import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked = false, disabled, onClick, onCheckedChange, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={checked ? 'checked' : 'unchecked'}
        disabled={disabled}
        {...props}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented) onCheckedChange?.(!checked)
        }}
        className={cn(
          'peer inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-input',
          className,
        )}
      >
        <span
          className={cn(
            'pointer-events-none block h-3 w-3 rounded-full bg-background shadow ring-0 transition-transform',
            checked ? 'translate-x-[14px]' : 'translate-x-0',
          )}
        />
        {props.children}
      </button>
    );
  },
);
Switch.displayName = 'Switch';

export default Switch;
