export class HttpClient {
  private readonly _fetch: typeof fetch;
  private readonly _timeoutMs: number;

  constructor(_fetch?: typeof fetch, timeoutMs = 30_000) {
    this._fetch = _fetch ?? ((url, init) => fetch(url, init));
    this._timeoutMs = timeoutMs;
  }

  get(url: string, init?: RequestInit): Promise<Response> {
    return this._fetch(url, {
      ...init,
      method: "GET",
      signal: init?.signal ?? AbortSignal.timeout(this._timeoutMs),
    });
  }

  post(url: string, init?: RequestInit): Promise<Response> {
    return this._fetch(url, {
      ...init,
      method: "POST",
      signal: init?.signal ?? AbortSignal.timeout(this._timeoutMs),
    });
  }

  patch(url: string, init?: RequestInit): Promise<Response> {
    return this._fetch(url, {
      ...init,
      method: "PATCH",
      signal: init?.signal ?? AbortSignal.timeout(this._timeoutMs),
    });
  }
}
