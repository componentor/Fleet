/**
 * Error thrown when the Fleet API returns a non-2xx response.
 */
export class FleetApiError extends Error {
  /** HTTP status code */
  readonly status: number;
  /** Error code from the API response body, if present */
  readonly code: string | undefined;
  /** Raw response body */
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown, code?: string) {
    super(message);
    this.name = 'FleetApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
