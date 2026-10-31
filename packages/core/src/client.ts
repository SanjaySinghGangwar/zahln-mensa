import type { Problem } from './types';
import { coreConfig } from './config';


// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Every failure the client surfaces is an ApiError.
 *
 * `unknownOutcome` is the important flag: the request may have been handled
 * and saved on the server even though we got no usable answer (timeout,
 * 502 connection_dropped, 504 timeout, network error). Callers must check the
 * real state (or retry with the same Idempotency-Key) instead of assuming the
 * change did not happen.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly unknownOutcome: boolean;
  readonly problem: Problem;

  constructor(problem: Problem, unknownOutcome: boolean) {
    super(problem.detail || problem.title || problem.code);
    this.name = 'ApiError';
    this.problem = problem;
    this.status = problem.status;
    this.code = problem.code;
    this.retryable = problem.retryable;
    this.unknownOutcome = unknownOutcome;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** React Native has no DOMException, so aborts are recognised by name. */
export function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

export function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

// ---------------------------------------------------------------------------
// Server clock. The device clock may be wrong; the `Date` header is the truth.
// ---------------------------------------------------------------------------

let clockOffsetMs = 0;

export function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

function noteServerDate(res: Response) {
  const header = res.headers.get('Date');
  if (!header) return;
  const t = Date.parse(header);
  if (!Number.isNaN(t)) clockOffsetMs = t - Date.now();
}

// ---------------------------------------------------------------------------
// Auth hooks (installed by AuthProvider)
// ---------------------------------------------------------------------------

export interface AuthHooks {
  getToken: () => string | null;
  /** Logs in again with remembered credentials. Resolves to a new token or null. */
  relogin: () => Promise<string | null>;
  onSessionLost: () => void;
}

let authHooks: AuthHooks | null = null;

export function setAuthHooks(hooks: AuthHooks | null) {
  authHooks = hooks;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Required for POSTs that change money or orders. Reused for every retry. */
  idempotencyKey?: string;
  query?: Record<string, QueryValue>;
  /** Set false for endpoints that need no token (login, config). */
  auth?: boolean;
  /** Extra attempts after the first one, for retryable failures. */
  retries?: number;
  signal?: AbortSignal;
}

export interface ApiResponse<T> {
  data: T;
  /** True when the server replayed an earlier result for this Idempotency-Key. */
  replayed: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const method = opts.method ?? 'GET';
  const maxAttempts = 1 + (opts.retries ?? (method === 'GET' ? 2 : 4));
  let reauthenticated = false;
  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt), opts.signal);
    try {
      return await sendOnce<T>(path, method, opts);
    } catch (e) {
      if (!isApiError(e)) throw e; // aborts and programming errors

      // Session ended: log in again once and repeat the same request.
      // A 401 means the server rejected us before doing anything, so this is
      // safe even for POSTs, and the Idempotency-Key stays the same.
      if (e.status === 401 && opts.auth !== false && authHooks) {
        if (reauthenticated) {
          authHooks.onSessionLost();
          throw e;
        }
        reauthenticated = true;
        const token = await authHooks.relogin();
        if (!token) {
          authHooks.onSessionLost();
          throw e;
        }
        attempt--; // re-login does not use up a retry
        continue;
      }

      lastError = e;
      if (!e.retryable) throw e;
      // A POST that changes state is only retried with an Idempotency-Key,
      // because without one a lost response could turn into a double effect.
      if (method === 'POST' && !opts.idempotencyKey && opts.auth !== false) throw e;
    }
  }
  // The loop runs at least once and only ends here after recording an error.
  throw lastError as ApiError;
}

async function sendOnce<T>(path: string, method: 'GET' | 'POST', opts: RequestOptions): Promise<ApiResponse<T>> {
  const url = buildUrl(path, opts.query);
  const headers: Record<string, string> = {
    Accept: 'application/json, application/problem+json',
    'X-Candidate-Id': coreConfig.candidateId,
    'X-App-Version': coreConfig.appVersion,
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.auth !== false) {
    const token = authHooks?.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, retryPolicy.requestTimeoutMs);
  const onCallerAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onCallerAbort);

  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      if (opts.signal?.aborted && !timedOut) throw abortError();
      throw networkError(timedOut ? 'client_timeout' : 'network_error');
    }

    noteServerDate(res);

    if (res.ok) {
      let data: T;
      try {
        const text = await res.text();
        data = (text ? JSON.parse(text) : undefined) as T;
      } catch {
        // Status said success but the body never fully arrived.
        if (opts.signal?.aborted && !timedOut) throw abortError();
        throw networkError('connection_dropped');
      }
      return { data, replayed: res.headers.get('Idempotent-Replayed') === 'true' };
    }

    let problem: Problem | null = null;
    try {
      const parsed = (await res.json()) as Partial<Problem>;
      if (parsed && typeof parsed.code === 'string') {
        problem = {
          code: parsed.code,
          title: parsed.title ?? res.statusText,
          status: parsed.status ?? res.status,
          retryable: typeof parsed.retryable === 'boolean' ? parsed.retryable : res.status >= 500,
          detail: parsed.detail ?? null,
        };
      }
    } catch {
      /* not a problem+json body (e.g. a proxy error page) */
    }

    const isProblem = problem !== null;
    const finalProblem: Problem = problem ?? {
      code: `http_${res.status}`,
      title: res.statusText || 'Request failed',
      status: res.status,
      retryable: res.status >= 500,
      detail: null,
    };
    // 502/504 (and gateway errors without a problem body) mean the outcome is unknown.
    const unknownOutcome = res.status === 502 || res.status === 504 || (!isProblem && res.status >= 500);
    throw new ApiError(finalProblem, unknownOutcome);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }
}

function networkError(code: string): ApiError {
  return new ApiError(
    {
      code,
      title: code === 'client_timeout' ? 'The server took too long to answer' : 'Could not reach the server',
      status: 0,
      retryable: true,
      detail: null,
    },
    true,
  );
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const base = coreConfig.apiBase.replace(/\/$/, '');
  const params = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return base + path + (params.length ? `?${params.join('&')}` : '');
}

/** Exported so tests can make retries and timeouts instant. */
export const retryPolicy = { baseDelayMs: 400, maxDelayMs: 4000, requestTimeoutMs: 15_000 };

function backoffMs(attempt: number): number {
  const base = Math.min(retryPolicy.baseDelayMs * 2 ** (attempt - 1), retryPolicy.maxDelayMs);
  return base / 2 + Math.random() * (base / 2); // jitter
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
