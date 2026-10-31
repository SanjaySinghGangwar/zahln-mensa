import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  berlinDate,
  berlinStartOfDay,
  dailyTotalsToCsv,
  describeError,
  fetchAllPayments,
  formatCents,
  isAbort,
  nextDate,
  paymentsToCsv,
  serverNow,
  t,
  type Mensa,
  type PaymentQuery,
  type PaymentStatus,
  type Totals,
} from '@zahln/core';
import { useCachedQuery } from '@zahln/core/react';
import { ErrorNotice, Modal, Notice, Spinner, StaleNotice, Tabs } from '../components/ui';
import { downloadText } from '../lib/download';
import { useUrlParam, useUrlTab } from '../lib/useUrlParam';
import { PaymentDetailView } from './PaymentDetailView';
import { PaymentsList } from './PaymentsList';

const TABS = ['totals', 'attention', 'payments'] as const;

export function Dashboard() {
  const [tab, setTab] = useUrlTab(TABS, 'totals');
  const [openPayment, setOpenPayment] = useUrlParam('payment');
  // Names for the filters; saved, and the filters still work without them.
  const mensas: Mensa[] = useCachedQuery('mensas', (signal) => api.mensas(signal)).data?.items ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('dash.title')}</h1>
          <div className="muted">{t('dash.subtitle')}</div>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'totals', label: t('dash.tab.totals') },
            { id: 'attention', label: t('dash.tab.attention') },
            { id: 'payments', label: t('dash.tab.payments') },
          ]}
        />
      </div>

      {tab === 'totals' && <DailyTotalsView />}
      {tab === 'attention' && (
        <section className="card" aria-label={t('dash.tab.attention')}>
          <p className="muted">{t('dash.attentionIntro')}</p>
          <PaymentsList query={{ needsAttention: true }} onOpen={setOpenPayment} emptyText={t('dash.noneAttention')} />
        </section>
      )}
      {tab === 'payments' && <PaymentsSearch mensas={mensas} onOpen={setOpenPayment} />}

      {openPayment && (
        <Modal title={t('detail.title')} onClose={() => setOpenPayment(null)}>
          <PaymentDetailView paymentId={openPayment} />
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DailyTotalsView() {
  const [date, setDate] = useState(() => berlinDate(serverNow()));
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Each day's totals are saved; "today" changes, so it is refreshed every time anyway.
  const totals = useCachedQuery(`totals:${date || 'today'}`, (signal) => api.dailyTotals(date || undefined, signal), reload);
  const { data, loading } = totals;
  const error = totals.stale ? null : totals.error;

  // Hide totals of a previously selected day while the new day loads.
  const shown = data && (!date || data.date === date) ? data : null;
  const allExpanded = !!shown && shown.mensas.every((m) => expanded[m.mensa.id]);

  return (
    <section className="card" aria-label={t('dash.tab.totals')}>
      <div className="list-toolbar">
        <label className="field inline">
          <span>{t('dash.day')}</span>
          <input type="date" value={date} max={berlinDate(serverNow())} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="row">
          {shown && (
            <button
              className="btn btn-sm"
              onClick={() => setExpanded(Object.fromEntries(shown.mensas.map((m) => [m.mensa.id, !allExpanded])))}
              aria-pressed={allExpanded}
            >
              {allExpanded ? '▾' : '▸'} {t('dash.till')}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => shown && downloadText(`zahln-tagessummen-${shown.date}.csv`, dailyTotalsToCsv(shown))} disabled={!shown}>
            ⤓ {t('dash.exportTotalsCsv')}
          </button>
          <button className="btn btn-sm" onClick={() => setReload((n) => n + 1)} disabled={loading}>
            {loading ? <Spinner small /> : <span aria-hidden="true">↻</span>} {t('common.refresh')}
          </button>
        </div>
      </div>

      {totals.stale && <StaleNotice savedAt={totals.savedAt} onRetry={() => setReload((n) => n + 1)} />}
      {error !== null && <ErrorNotice error={error} onRetry={() => setReload((n) => n + 1)} />}
      {!shown && loading && (
        <div className="center pad">
          <Spinner />
        </div>
      )}

      {shown && (
        <>
          <div className="kpis">
            <Kpi label={t('dash.gross')} value={formatCents(shown.grossCents)} sub={t('dash.confirmedCount', { count: shown.paymentCount })} />
            <Kpi label={t('dash.refunded')} value={formatCents(shown.refundedCents)} sub={t('dash.completedThisDay')} />
            <Kpi label={t('dash.net')} value={formatCents(shown.netCents)} strong />
            <Kpi
              label={t('dash.pending')}
              value={formatCents(shown.pendingCents)}
              sub={t('dash.pendingCount', { count: shown.pendingCount })}
              warn={shown.pendingCount > 0}
            />
          </div>
          {shown.pendingCount > 0 && <Notice tone="warn">{t('dash.pendingNote')}</Notice>}

          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">
                {t('dash.tab.totals')} {shown.date}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('dash.mensaTill')}</th>
                  <th scope="col" className="num">
                    {t('dash.paymentsCount')}
                  </th>
                  <th scope="col" className="num">
                    {t('dash.gross')}
                  </th>
                  <th scope="col" className="num">
                    {t('dash.refunded')}
                  </th>
                  <th scope="col" className="num">
                    {t('dash.net')}
                  </th>
                  <th scope="col" className="num">
                    {t('dash.pending')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.mensas.map((m) => {
                  const open = !!expanded[m.mensa.id];
                  return (
                    <Fragment key={m.mensa.id}>
                      <tr className="row-group">
                        <th scope="row">
                          <button
                            className="link-btn row-toggle"
                            aria-expanded={open}
                            aria-label={t(open ? 'dash.collapse' : 'dash.expand', { mensa: m.mensa.name })}
                            onClick={() => setExpanded((x) => ({ ...x, [m.mensa.id]: !x[m.mensa.id] }))}
                          >
                            <span className="caret" aria-hidden="true">
                              {open ? '▾' : '▸'}
                            </span>{' '}
                            <strong>{m.mensa.name}</strong>
                          </button>
                        </th>
                        <TotalsCells t={m} />
                      </tr>
                      {open &&
                        m.tills.map((tl) => (
                          <tr key={tl.till.id} className="row-sub">
                            <th scope="row">{tl.till.name}</th>
                            <TotalsCells t={tl} />
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{t('dash.allMensas')}</th>
                  <TotalsCells t={shown} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function TotalsCells({ t: x }: { t: Totals }) {
  return (
    <>
      <td className="num">{x.paymentCount}</td>
      <td className="num">{formatCents(x.grossCents)}</td>
      <td className="num">{x.refundedCents ? `−${formatCents(x.refundedCents)}` : '–'}</td>
      <td className="num">
        <strong>{formatCents(x.netCents)}</strong>
      </td>
      <td className="num">{x.pendingCount ? `${x.pendingCount} · ${formatCents(x.pendingCents)}` : '–'}</td>
    </>
  );
}

function Kpi({ label, value, sub, strong, warn }: { label: string; value: string; sub?: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className={`kpi${strong ? ' kpi-strong' : ''}${warn ? ' kpi-warn' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Filters {
  mensaId: string;
  tillId: string;
  status: '' | PaymentStatus;
  from: string;
  to: string;
  needsAttention: boolean;
  q: string;
}

const EMPTY: Filters = { mensaId: '', tillId: '', status: '', from: '', to: '', needsAttention: false, q: '' };

export function toQuery(f: Filters): PaymentQuery {
  return {
    mensaId: f.mensaId || undefined,
    tillId: f.tillId || undefined,
    status: f.status || undefined,
    needsAttention: f.needsAttention ? true : undefined,
    q: f.q.trim() || undefined,
    from: f.from ? berlinStartOfDay(f.from) : undefined,
    to: f.to ? berlinStartOfDay(nextDate(f.to)) : undefined,
  };
}

function PaymentsSearch({ mensas, onOpen }: { mensas: Mensa[]; onOpen: (id: string) => void }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);

  const tills = useMemo(() => {
    if (filters.mensaId) return mensas.find((m) => m.id === filters.mensaId)?.tills ?? [];
    return mensas.flatMap((m) => m.tills);
  }, [mensas, filters.mensaId]);

  // The ID search applies as you type (debounced); the rest on change.
  useEffect(() => {
    const timer = window.setTimeout(() => setApplied(filters), filters.q !== applied.q ? 350 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const query = useMemo(() => toQuery(applied), [applied]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <section className="card" aria-label={t('dash.tab.payments')}>
      <div className="filters">
        <label className="field">
          <span>{t('dash.search')}</span>
          <input type="search" value={filters.q} onChange={(e) => set('q', e.target.value)} placeholder={t('dash.searchPlaceholder')} maxLength={100} />
        </label>
        <label className="field">
          <span>{t('dash.mensa')}</span>
          <select value={filters.mensaId} onChange={(e) => setFilters((f) => ({ ...f, mensaId: e.target.value, tillId: '' }))}>
            <option value="">{t('dash.all')}</option>
            {mensas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('dash.till')}</span>
          <select value={filters.tillId} onChange={(e) => set('tillId', e.target.value)}>
            <option value="">{t('dash.all')}</option>
            {tills.map((tl) => (
              <option key={tl.id} value={tl.id}>
                {tl.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('dash.status')}</span>
          <select value={filters.status} onChange={(e) => set('status', e.target.value as Filters['status'])}>
            <option value="">{t('dash.all')}</option>
            <option value="pending">{t('status.pending')}</option>
            <option value="confirmed">{t('status.confirmed')}</option>
            <option value="declined">{t('status.declined')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('dash.from')}</span>
          <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('dash.to')}</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.needsAttention} onChange={(e) => set('needsAttention', e.target.checked)} />
          {t('dash.attentionOnly')}
        </label>
        <button className="btn btn-sm" onClick={() => setFilters(EMPTY)}>
          {t('dash.reset')}
        </button>
      </div>
      <CsvExport query={query} />
      <PaymentsList query={query} onOpen={onOpen} />
    </section>
  );
}

/** Exports every payment matching the filter, page by page, as a CSV the finance team opens in Excel. */
export function CsvExport({ query }: { query: PaymentQuery }) {
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  // A finished export belongs to the old filter.
  useEffect(() => setResult(null), [query]);

  async function run() {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setCount(0);
    setResult(null);
    try {
      const { items, capped } = await fetchAllPayments(query, { signal: controller.signal, onProgress: setCount });
      const stamp = berlinDate(serverNow());
      downloadText(`zahln-zahlungen-${stamp}.csv`, paymentsToCsv(items));
      setResult(
        capped
          ? { tone: 'warn', text: t('dash.exportCapped', { count: items.length }) }
          : { tone: 'ok', text: t('dash.exportDone', { count: items.length }) },
      );
    } catch (e) {
      if (!isAbort(e)) setResult({ tone: 'bad', text: t('dash.exportFailed', { error: describeError(e) }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-bar">
      {busy ? (
        <>
          <span role="status">
            <Spinner small /> {t('dash.exporting', { count })}
          </span>
          <button className="btn btn-sm" onClick={() => abortRef.current?.abort()}>
            {t('common.cancel')}
          </button>
        </>
      ) : (
        <button className="btn btn-sm" onClick={run}>
          ⤓ {t('dash.exportCsv')}
        </button>
      )}
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
    </div>
  );
}
