import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange?.(e.target.checked);
    };

    return (
      <div className="relative inline-flex items-center justify-center">
        {/* 实际的 checkbox input - 透明，放在最上层 */}
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
          className="peer size-4 shrink-0 opacity-0 absolute cursor-pointer z-10 disabled:cursor-not-allowed"
          {...props}
        />
        {/* 自定义的 checkbox 外观 */}
        <div
          className={cn(
            'size-4 shrink-0 rounded-sm border transition-all duration-200 flex items-center justify-center',
            checked
              ? 'bg-primary border-primary'
              : 'bg-background border-input hover:border-primary/50',
            disabled && 'opacity-50 cursor-not-allowed',
            className,
          )}
        >
          {checked && (
            <svg
              className="size-3.5 text-primary-foreground pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      </div>
    );
  },
);
Checkbox.displayName = 'Checkbox';

export default Checkbox;
