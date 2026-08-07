export class HttpClient {
  private readonly _fetch: typeof fetch;

  constructor(_fetch?: typeof fetch) {
    this._fetch = _fetch ?? ((url, init) => fetch(url, init));
  }

  get(url: string, init?: RequestInit): Promise<Response> {
    return this._fetch(url, { ...init, method: "GET" });
  }

  post(url: string, init?: RequestInit): Promise<Response> {
    return this._fetch(url, { ...init, method: "POST" });
  }

  patch(url: string, init?: RequestInit): Promise<Response> {
    return this._fetch(url, { ...init, method: "PATCH" });
  }
}
