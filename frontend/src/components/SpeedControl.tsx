interface Props {
  value: number;
  disabled: boolean;
  onChange: (speed: number) => void;
}

const MIN = 0.5;
const MAX = 2;

export function SpeedControl({ value, disabled, onChange }: Props) {
  const percent = ((value - MIN) / (MAX - MIN)) * 100;

  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <label
          htmlFor="speed"
          className="text-[10px] font-medium tracking-[0.12em] text-faint uppercase"
        >
          Speed
        </label>
        <span className="text-[14px] font-medium text-ink tabular-nums">
          {value.toFixed(1)}×
        </span>
      </div>

      <input
        id="speed"
        type="range"
        min={MIN}
        max={MAX}
        step={0.1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{
          background: `linear-gradient(to right, var(--color-accent) ${percent}%, var(--color-line-strong) ${percent}%)`,
          backgroundSize: '100% 4px',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          borderRadius: '999px',
        }}
      />

      <div className="mt-1 flex justify-between text-[11px] text-faint tabular-nums">
        <span>0.5×</span>
        <span>2.0×</span>
      </div>
    </div>
  );
}
