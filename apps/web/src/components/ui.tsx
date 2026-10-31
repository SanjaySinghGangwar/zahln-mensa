import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { describeError, formatTime, t, type Lang, type MessageKey } from '@zahln/core';
import { useLanguage } from '@zahln/core/react';
import { chooseLanguage } from '../lib/lang';

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? 'spinner spinner-sm' : 'spinner'} aria-hidden="true" />;
}

const STATUS_TONE: Record<string, string> = {
  open: 'info',
  paying: 'warn',
  paid: 'ok',
  expired: 'muted',
  pending: 'warn',
  confirmed: 'ok',
  declined: 'bad',
  completed: 'ok',
  failed: 'bad',
};

export function StatusBadge({ status }: { status: string }) {
  const key = `status.${status}` as MessageKey;
  return <span className={`badge badge-${STATUS_TONE[status] ?? 'muted'}`}>{STATUS_TONE[status] ? t(key) : status}</span>;
}

export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <div>{children}</div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Notice
      tone="bad"
      action={
        onRetry && (
          <button className="btn btn-sm" onClick={onRetry}>
            {t('common.retry')}
          </button>
        )
      }
    >
      {describeError(error)}
    </Notice>
  );
}

/** Accessible dialog: focus moves in, Escape closes, focus returns to where it was. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; badge?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          className={value === tab.id ? 'tab tab-active' : 'tab'}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge ? <span className="tab-badge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Shown when the server failed and the screen is using the last saved data. */
export function StaleNotice({ savedAt, onRetry }: { savedAt: number | null; onRetry?: () => void }) {
  return (
    <Notice
      tone="warn"
      action={
        onRetry && (
          <button className="btn btn-sm" onClick={onRetry}>
            {t('common.retry')}
          </button>
        )
      }
    >
      {t('common.stale', { time: savedAt ? formatTime(savedAt) : '–' })}
    </Notice>
  );
}

/** A banner while the device has no network connection. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      {t('common.offline')}
    </div>
  );
}

export function LanguageSwitch({ dark }: { dark?: boolean }) {
  const lang = useLanguage();
  const options: Lang[] = ['de', 'en'];
  return (
    <div className={dark ? 'lang-switch lang-switch-dark' : 'lang-switch'} role="group" aria-label={t('lang.switch')}>
      {options.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} className={lang === l ? 'lang-on' : ''} onClick={() => chooseLanguage(l)}>
          <span aria-hidden="true">{l.toUpperCase()}</span>
          <span className="sr-only">{t(`lang.${l}`)}</span>
        </button>
      ))}
    </div>
  );
}
