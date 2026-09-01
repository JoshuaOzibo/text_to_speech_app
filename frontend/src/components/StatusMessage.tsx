import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export type StatusTone = 'info' | 'success' | 'warning' | 'error';

interface Props {
  tone: StatusTone;
  message: string;
}

const TONES = {
  info: {
    icon: Info,
    className: 'border-line bg-surface text-muted',
    iconClass: 'text-faint',
  },
  success: {
    icon: CheckCircle2,
    className: 'border-success-bright/40 bg-success-bright/8 text-ink',
    iconClass: 'text-success',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-warning-bright bg-warning-bright/10 text-ink',
    iconClass: 'text-warning',
  },
  error: {
    icon: XCircle,
    className: 'border-danger/40 bg-danger/6 text-ink',
    iconClass: 'text-danger',
  },
} as const;

export function StatusMessage({ tone, message }: Props) {
  const { icon: Icon, className, iconClass } = TONES[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-btn border px-3 py-2.5 text-[12px] leading-relaxed ${className}`}
    >
      <Icon size={14} className={`mt-px shrink-0 ${iconClass}`} />
      <span className="min-w-0">{message}</span>
    </div>
  );
}
