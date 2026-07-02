import type { Logging } from 'homebridge';

import type { ThermostatPayloadValidation } from './daikinOpenApiMapper.js';

export class DaikinPayloadDiagnostics {
  private readonly lastPayloadWarningKeys = new Map<string, string>();
  private readonly lastDeveloperNoteKeys = new Map<string, string>();

  public constructor(
    private readonly log: Logging,
    private readonly developerMode: boolean,
  ) {}

  public logRawPayload(deviceId: string, payload: Record<string, unknown>): void {
    if (this.developerMode) {
      this.log.info('Raw Daikin payload for %s: %s', deviceId, JSON.stringify(payload));
    }
  }

  public logValidation(deviceId: string, validation: ThermostatPayloadValidation): void {
    this.logChangedPayloadWarnings(deviceId, validation.warnings);

    if (this.developerMode) {
      this.logChangedDeveloperNotes(deviceId, validation.developerNotes);
    }
  }

  private logChangedPayloadWarnings(deviceId: string, warnings: string[]): void {
    const warningKey = warnings.join('; ');
    if (this.lastPayloadWarningKeys.get(deviceId) === warningKey) {
      return;
    }

    this.lastPayloadWarningKeys.set(deviceId, warningKey);
    if (warnings.length > 0) {
      this.log.warn('Daikin payload validation warning for %s: %s.', deviceId, warningKey);
    }
  }

  private logChangedDeveloperNotes(deviceId: string, developerNotes: string[]): void {
    const noteKey = developerNotes.join('; ');
    if (this.lastDeveloperNoteKeys.get(deviceId) === noteKey) {
      return;
    }

    this.lastDeveloperNoteKeys.set(deviceId, noteKey);
    if (developerNotes.length > 0) {
      this.log.info('Daikin payload developer note for %s: %s.', deviceId, noteKey);
    }
  }
}
