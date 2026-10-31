/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_CANDIDATE_ID?: string;
}

declare const __APP_VERSION__: string;
