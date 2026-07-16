import * as React from 'react';

export interface SliderProps {
  value?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
}

export const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ value, onValueChange, min = 0, max = 100, step = 1 }, ref) => {
    const fillRef = React.useRef<HTMLDivElement>(null);
    const thumbRef = React.useRef<HTMLDivElement>(null);

    const currentValue = value?.[0] ?? min;
    const percentage = ((currentValue - min) / (max - min)) * 100;

    React.useEffect(() => {
      if (fillRef.current) fillRef.current.style.width = percentage + '%';
      if (thumbRef.current) thumbRef.current.style.left = percentage + '%';
    }, [percentage]);

    const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange?.([Number(e.target.value)]);
    };

    return (
      <div className="relative flex w-full items-center h-6" ref={ref}>
        <div className="relative w-full h-1.5">
          <div className="absolute inset-0 rounded-full bg-secondary" />
          <div ref={fillRef} className="absolute left-0 top-0 h-full rounded-full bg-primary" style={{ width: percentage + '%' }} />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentValue}
          onChange={handleInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20 m-0"
          style={{ WebkitAppearance: 'none', appearance: 'none', background: 'transparent' }}
        />
        <div ref={thumbRef} className="absolute top-1/2 size-4 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary border-2 border-background shadow-md z-10 pointer-events-none" style={{ left: percentage + '%' }} />
      </div>
    );
  },
);
Slider.displayName = 'Slider';

export default Slider;
