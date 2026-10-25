/** A refusal from the API client engine. The code picks the HTTP status; the CLI always exits 2 on one. */
export type HttpErrorCode = 'invalid' | 'not_found' | 'unknown_vars' | 'secret_adhoc' | 'secrets_file' | 'conflict' | 'too_large';

export class HttpClientError extends Error {
  constructor(
    readonly code: HttpErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const statusFor = (c: HttpErrorCode): number => (c === 'not_found' ? 404 : c === 'conflict' ? 409 : c === 'too_large' ? 413 : c === 'secrets_file' ? 500 : 400);
