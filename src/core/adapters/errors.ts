/**
 * Adapter Error Model
 *
 * Tüm adapter hataları AdapterError tipinde fırlatılır.
 * UI/application layer bunları çevirir (kullanıcıya raw error gösterilmez).
 */

export type AdapterErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'SCHEMA_MISMATCH'
  | 'ADAPTER_UNAVAILABLE'
  | 'NOT_IMPLEMENTED'
  | 'UNKNOWN';

export interface AdapterErrorOptions {
  retryable?: boolean;
  details?: Record<string, unknown>;
  originalError?: unknown;
  retryAfterMs?: number;
}

export class AdapterError extends Error {
  public readonly code: AdapterErrorCode;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;
  public readonly originalError?: unknown;
  public readonly retryAfterMs?: number;

  constructor(code: AdapterErrorCode, message: string, options: AdapterErrorOptions = {}) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.retryable = options.retryable ?? defaultRetryable(code);
    this.details = options.details;
    this.originalError = options.originalError;
    this.retryAfterMs = options.retryAfterMs;
  }

  static notFound(resource: string, id?: string): AdapterError {
    return new AdapterError('NOT_FOUND', `${resource}${id ? ` "${id}"` : ''} bulunamadı.`);
  }

  static unauthorized(message = 'Yetkisiz erişim.'): AdapterError {
    return new AdapterError('UNAUTHORIZED', message);
  }

  static validation(message: string, details?: Record<string, unknown>): AdapterError {
    return new AdapterError('VALIDATION_ERROR', message, { details });
  }

  static conflict(message: string, details?: Record<string, unknown>): AdapterError {
    return new AdapterError('CONFLICT', message, { details });
  }

  static rateLimited(retryAfterMs: number): AdapterError {
    return new AdapterError('RATE_LIMITED', 'Rate limit aşıldı.', {
      retryable: true,
      retryAfterMs,
    });
  }

  static schemaMismatch(adapter: string, details?: Record<string, unknown>): AdapterError {
    return new AdapterError('SCHEMA_MISMATCH', `${adapter} adapter response sözleşmeye uymuyor.`, {
      details,
    });
  }

  static notImplemented(capability: string): AdapterError {
    return new AdapterError('NOT_IMPLEMENTED', `${capability} bu adapter'da desteklenmiyor.`);
  }
}

function defaultRetryable(code: AdapterErrorCode): boolean {
  switch (code) {
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return true;
    default:
      return false;
  }
}
