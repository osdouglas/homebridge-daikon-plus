import type { Logging } from 'homebridge';

import { FetchJsonHttpClient, type JsonHttpClient } from './httpClient.js';
import type {
  DaikinFanUpdate,
  DaikinLocation,
  DaikinPlatformConfig,
  DaikinScheduleUpdate,
  DaikinThermostatUpdate,
} from './types.js';

interface DaikinTokenResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
}

export type DaikinWriteEndpoint = 'msp' | 'schedule' | 'fan';
export type DaikinWriteUpdate = DaikinFanUpdate | DaikinScheduleUpdate | DaikinThermostatUpdate;

const DAIKIN_ONE_BASE_URI = 'https://integrator-api.daikinskyport.com';
const TOKEN_URL = `${DAIKIN_ONE_BASE_URI}/v1/token`;
const DEVICES_URL = `${DAIKIN_ONE_BASE_URI}/v1/devices`;

export class DaikinOpenApiGateway {
  private token?: DaikinTokenResponse;
  private tokenExpiresAtMs = 0;

  public constructor(
    private readonly config: DaikinPlatformConfig,
    private readonly log: Logging,
    private readonly http: JsonHttpClient = new FetchJsonHttpClient(config.requestTimeoutSeconds),
  ) {}

  public async authenticate(): Promise<void> {
    this.debug('Authenticating with Daikin One Open API.');
    const response = await this.fetchJson<DaikinTokenResponse>(TOKEN_URL, {
      method: 'POST',
      headers: this.baseHeaders(),
      body: JSON.stringify({
        email: this.config.integratorEmail,
        integratorToken: this.config.integratorToken,
      }),
    });

    this.token = response;
    this.tokenExpiresAtMs = Date.now() + response.accessTokenExpiresIn * 1000 - 60_000;
  }

  public async listDevices(): Promise<DaikinLocation[]> {
    return this.authorizedGet<DaikinLocation[]>(DEVICES_URL);
  }

  public async getDevicePayload(deviceId: string): Promise<Record<string, unknown>> {
    return this.authorizedGet<Record<string, unknown>>(`${DEVICES_URL}/${deviceId}`);
  }

  public async putDeviceUpdate(
    deviceId: string,
    endpoint: DaikinWriteEndpoint,
    update: DaikinWriteUpdate,
  ): Promise<void> {
    await this.ensureToken();
    await this.fetchJson<unknown>(`${DEVICES_URL}/${deviceId}/${endpoint}`, {
      method: 'PUT',
      headers: this.authorizedHeaders(),
      body: JSON.stringify(update),
    });
  }

  private async authorizedGet<T>(url: string): Promise<T> {
    await this.ensureToken();
    return this.fetchJson<T>(url, {
      headers: this.authorizedHeaders(),
    });
  }

  private async ensureToken(): Promise<void> {
    if (!this.token || Date.now() >= this.tokenExpiresAtMs) {
      await this.authenticate();
    }
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    return this.http.fetchJson<T>(url, init);
  }

  private baseHeaders(): Record<string, string> {
    return {
      'x-api-key': this.config.apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private authorizedHeaders(): Record<string, string> {
    if (!this.token) {
      throw new Error('No Daikin Open API token is available.');
    }

    return {
      ...this.baseHeaders(),
      Authorization: `Bearer ${this.token.accessToken}`,
    };
  }

  private debug(message: string, ...parameters: unknown[]): void {
    if (this.config.developerMode) {
      this.log.info(message, ...parameters);
    }
  }
}
