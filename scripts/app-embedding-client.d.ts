export type EmbeddingMessageType =
  | "embedding:ready"
  | "embedding:hello"
  | "embedding:command"
  | "embedding:response"
  | "embedding:subscribe"
  | "embedding:unsubscribe"
  | "embedding:event";

export interface PBEScoreKeeperAPIOptions {
  targetOrigin?: string;
  timeoutMs?: number;
  readyTimeoutMs?: number;
  retries?: number;
  autoReady?: boolean;
  window?: Window;
}

export interface EmbeddingResponseError {
  code: string;
  message: string;
  [key: string]: unknown;
}

export interface EmbeddingEventEnvelope<T = unknown> {
  type: "embedding:event";
  event: string;
  data: T;
  apiVersion?: number;
}

export type EmbeddingEventHandler<T = unknown> = (
  data: T,
  envelope: EmbeddingEventEnvelope<T>
) => void;

export class PBEScoreKeeperAPIError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message?: string, details?: unknown);
}

export class PBEScoreKeeperAPI {
  constructor(frame: HTMLIFrameElement | string, options?: PBEScoreKeeperAPIOptions);

  isReady: boolean;
  readyPayload: unknown;

  ready(): Promise<unknown>;
  command<T = unknown>(commandName: string, payload?: unknown, options?: { timeoutMs?: number; retries?: number }): Promise<T>;
  sendCommand<T = unknown>(commandName: string, payload?: unknown, options?: { timeoutMs?: number; retries?: number }): Promise<T>;
  batch<T = unknown>(commands: Array<{ command: string; payload?: unknown }>, options?: { atomic?: boolean; haltOnError?: boolean; dryRun?: boolean; maxBatchCommands?: number; timeoutMs?: number; retries?: number }): Promise<T>;
  subscribe(events: string | string[], options?: { timeoutMs?: number; retries?: number }): Promise<unknown>;
  unsubscribe(events?: string | string[], options?: { timeoutMs?: number; retries?: number }): Promise<unknown>;
  on<T = unknown>(eventName: string, handler: EmbeddingEventHandler<T>): () => void;
  once<T = unknown>(eventName: string, handler: EmbeddingEventHandler<T>): () => void;
  off<T = unknown>(eventName: string, handler?: EmbeddingEventHandler<T>): boolean;
  destroy(): void;

  session: Record<string, (payload?: unknown, options?: unknown) => Promise<unknown>>;
  question: Record<string, (payload?: unknown, options?: unknown) => Promise<unknown>>;
  score: Record<string, (payload?: unknown, options?: unknown) => Promise<unknown>>;
  block: Record<string, (payload?: unknown, options?: unknown) => Promise<unknown>>;
  timer: Record<string, (payload?: unknown, options?: unknown) => Promise<unknown>>;
  state: Record<string, (payload?: unknown, options?: unknown) => Promise<unknown>>;
  ui: Record<string, (payload?: unknown, options?: unknown) => Promise<unknown>>;
}
