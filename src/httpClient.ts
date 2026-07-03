export interface JsonHttpClient {
  fetchJson<T>(url: string, init: RequestInit): Promise<T>;
}

export class JsonHttpError extends Error {
  public constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
    public readonly responseMessage?: string,
  ) {
    super(`Request ${url} failed with ${status} ${statusText}: ${body}`);
  }
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
      const body = await response.text();
      throw new JsonHttpError(String(url), response.status, response.statusText, body, responseMessage(body));
    }

    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }
}

function responseMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; messages?: unknown };
    if (typeof parsed.message === 'string') {
      return parsed.message;
    }
    if (typeof parsed.messages === 'string') {
      return parsed.messages;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
