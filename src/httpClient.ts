export interface JsonHttpClient {
  fetchJson<T>(url: string, init: RequestInit): Promise<T>;
}

export class FetchJsonHttpClient implements JsonHttpClient {
  private readonly timeoutMs: number;

  public constructor(timeoutSeconds: number) {
    this.timeoutMs = Math.max(1, timeoutSeconds) * 1000;
  }

  public async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request ${url} timed out after ${this.timeoutMs / 1000} seconds.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Request ${url} failed with ${response.status} ${response.statusText}: ${await response.text()}`);
    }

    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }
}
