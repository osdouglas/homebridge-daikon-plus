import { hrtime } from 'node:process';

import type { Logging } from 'homebridge';

import { normalizeMode, parseThermostatPayload } from './daikinOpenApiMapper.js';
import { DaikinOpenApiGateway, type DaikinWriteEndpoint, type DaikinWriteUpdate } from './daikinOpenApiGateway.js';
import { DaikinPayloadDiagnostics } from './daikinPayloadDiagnostics.js';
import { FetchJsonHttpClient, JsonHttpError, type JsonHttpClient } from './httpClient.js';
import { applySetpointPolicy } from './setpointPolicy.js';
import { EquipmentStatus, FanCirculateMode, FanCirculateSpeed, ModeLimit, ThermostatMode } from './types.js';
import type {
  DaikinFanUpdate,
  DaikinDevice,
  DaikinPlatformConfig,
  DaikinScheduleUpdate,
  DaikinThermostatData,
  DaikinThermostatUpdate,
} from './types.js';

type DataChanged = () => void;

const WRITE_DELAY_MS = 15_000;
const UNKNOWN_TEMPERATURE = -270;
const DEVICE_OFFLINE_MESSAGE = 'DeviceOfflineException';

export class DaikinOpenApiClient {
  private devices = new Map<string, DaikinDevice>();
  private offlineDeviceIds = new Set<string>();
  private listeners = new Map<string, Set<DataChanged>>();
  private refreshTimer?: NodeJS.Timeout;
  private initialized = false;
  private readonly pollIntervalMs: number;
  private noPollBeforeMs = 0;
  private readonly gateway: DaikinOpenApiGateway;
  private readonly diagnostics: DaikinPayloadDiagnostics;

  public constructor(
    private readonly config: DaikinPlatformConfig,
    private readonly log: Logging,
    http: JsonHttpClient = new FetchJsonHttpClient(config.requestTimeoutSeconds),
  ) {
    this.pollIntervalMs = Math.max(180, config.pollIntervalSeconds) * 1000;
    this.gateway = new DaikinOpenApiGateway(config, log, http);
    this.diagnostics = new DaikinPayloadDiagnostics(log, config.developerMode);
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public getDeviceList(): DaikinDevice[] {
    return [...this.devices.values()];
  }

  public getDevice(deviceId: string): DaikinDevice | undefined {
    return this.devices.get(deviceId);
  }

  public isDeviceOnline(deviceId: string): boolean {
    return !this.offlineDeviceIds.has(deviceId);
  }

  public addListener(deviceId: string, listener: DataChanged): void {
    let deviceListeners = this.listeners.get(deviceId);
    if (!deviceListeners) {
      deviceListeners = new Set();
      this.listeners.set(deviceId, deviceListeners);
    }
    deviceListeners.add(listener);

    if (this.devices.get(deviceId)?.data) {
      listener();
    }
  }

  public async initialize(): Promise<void> {
    await this.gateway.authenticate();
    await this.discoverDevices();
    await this.refreshAllDevices();
    this.initialized = this.devices.size > 0;
    this.scheduleRefresh(this.pollIntervalMs);
  }

  public requestRefreshNow(): void {
    const delayMs = Math.max(0, this.noPollBeforeMs - this.monotonicMs());
    this.scheduleRefresh(delayMs);
  }

  public getCurrentStatus(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.equipmentStatus ?? EquipmentStatus.IDLE;
  }

  public getMode(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.mode ?? ThermostatMode.OFF;
  }

  public getCurrentTemperature(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.tempIndoor ?? UNKNOWN_TEMPERATURE;
  }

  public getTargetTemperature(deviceId: string): number {
    const data = this.devices.get(deviceId)?.data;
    if (!data) {
      return UNKNOWN_TEMPERATURE;
    }
    return data.mode === ThermostatMode.COOL ? data.coolSetpoint : data.heatSetpoint;
  }

  public getHeatingThreshold(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.heatSetpoint ?? UNKNOWN_TEMPERATURE;
  }

  public getCoolingThreshold(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.coolSetpoint ?? UNKNOWN_TEMPERATURE;
  }

  public getSetpointMinimum(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.setpointMinimum ?? 10;
  }

  public getSetpointMaximum(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.setpointMaximum ?? 35;
  }

  public getSetpointDelta(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.setpointDelta ?? 1.5;
  }

  public getCurrentHumidity(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.humIndoor ?? 0;
  }

  public hasOutdoorData(deviceId: string): boolean {
    const data = this.devices.get(deviceId)?.data;
    return typeof data?.tempOutdoor === 'number' || typeof data?.humOutdoor === 'number';
  }

  public getOutdoorTemperature(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.tempOutdoor ?? UNKNOWN_TEMPERATURE;
  }

  public getOutdoorHumidity(deviceId: string): number {
    return this.devices.get(deviceId)?.data?.humOutdoor ?? 0;
  }

  public hasScheduleData(deviceId: string): boolean {
    return typeof this.devices.get(deviceId)?.data?.scheduleEnabled === 'boolean';
  }

  public getScheduleEnabled(deviceId: string): boolean {
    return this.devices.get(deviceId)?.data?.scheduleEnabled ?? false;
  }

  public hasFanCirculationData(deviceId: string): boolean {
    return typeof this.devices.get(deviceId)?.data?.fanCirculate === 'number';
  }

  public getFanCirculate(deviceId: string): FanCirculateMode {
    return this.devices.get(deviceId)?.data?.fanCirculate ?? FanCirculateMode.OFF;
  }

  public getFanCirculateSpeed(deviceId: string): FanCirculateSpeed {
    return this.devices.get(deviceId)?.data?.fanCirculateSpeed ?? FanCirculateSpeed.MEDIUM;
  }

  public getSupportedModes(deviceId: string): ThermostatMode[] {
    const data = this.devices.get(deviceId)?.data;
    switch (data?.modeLimit) {
      case ModeLimit.NONE:
      case ModeLimit.ALL:
      case undefined:
        return [ThermostatMode.OFF, ThermostatMode.HEAT, ThermostatMode.COOL, ThermostatMode.AUTO];
      case ModeLimit.HEAT_ONLY:
        return [ThermostatMode.OFF, ThermostatMode.HEAT];
      case ModeLimit.COOL_ONLY:
        return [ThermostatMode.OFF, ThermostatMode.COOL];
      default:
        return this.fallbackSupportedModes(data);
    }
  }

  public async setMode(deviceId: string, mode: number): Promise<boolean> {
    const data = this.devices.get(deviceId)?.data;
    if (!data) {
      this.log.error('Cannot set mode for %s because no device data is loaded.', deviceId);
      return false;
    }

    const requestedMode = this.normalizeMode(mode);

    if (!this.canWriteMode(deviceId, requestedMode)) {
      this.log.warn('Skipping unsupported Daikin mode %d for %s.', requestedMode, deviceId);
      return false;
    }

    if (requestedMode === data.mode) {
      return true;
    }

    return this.putMsp(deviceId, applySetpointPolicy(data, {
      mode: requestedMode,
      heatSetpoint: data.heatSetpoint,
      coolSetpoint: data.coolSetpoint,
    }));
  }

  public async setTargetTemperature(deviceId: string, temperature: number): Promise<boolean> {
    const data = this.devices.get(deviceId)?.data;
    if (!data) {
      this.log.error('Cannot set target temperature for %s because no device data is loaded.', deviceId);
      return false;
    }

    if (data.mode === ThermostatMode.OFF) {
      this.log.debug('Ignoring target temperature write while %s is off.', deviceId);
      return true;
    }

    const update =
      data.mode === ThermostatMode.COOL
        ? { mode: data.mode, heatSetpoint: data.heatSetpoint, coolSetpoint: temperature }
        : { mode: data.mode, heatSetpoint: temperature, coolSetpoint: data.coolSetpoint };

    return this.putMsp(deviceId, applySetpointPolicy(data, update));
  }

  public async setThresholds(deviceId: string, heatSetpoint?: number, coolSetpoint?: number): Promise<boolean> {
    const data = this.devices.get(deviceId)?.data;
    if (!data) {
      this.log.error('Cannot set thresholds for %s because no device data is loaded.', deviceId);
      return false;
    }

    return this.putMsp(deviceId, applySetpointPolicy(data, {
      mode: data.mode,
      heatSetpoint: heatSetpoint ?? data.heatSetpoint,
      coolSetpoint: coolSetpoint ?? data.coolSetpoint,
    }));
  }

  public async setScheduleEnabled(deviceId: string, scheduleEnabled: boolean): Promise<boolean> {
    if (!this.hasScheduleData(deviceId)) {
      this.log.warn(
        'Skipping Daikin schedule write for %s because scheduleEnabled is not present in current device data.',
        deviceId,
      );
      return false;
    }

    return this.putSchedule(deviceId, { scheduleEnabled });
  }

  public async setFanCirculation(
    deviceId: string,
    update: DaikinFanUpdate,
  ): Promise<boolean> {
    if (!this.hasFanCirculationData(deviceId)) {
      this.log.warn(
        'Skipping Daikin fan write for %s because fan circulation is not present in current device data.',
        deviceId,
      );
      return false;
    }

    return this.putFan(deviceId, {
      fanCirculate: update.fanCirculate,
      fanCirculateSpeed: update.fanCirculateSpeed ?? this.getFanCirculateSpeed(deviceId),
    });
  }

  private async discoverDevices(): Promise<void> {
    const locations = await this.gateway.listDevices();
    const allowedIds = new Set(this.config.deviceIds);
    const nextDevices = new Map<string, DaikinDevice>();

    for (const location of locations) {
      for (const device of location.devices ?? []) {
        if (allowedIds.size > 0 && !allowedIds.has(device.id)) {
          continue;
        }

        nextDevices.set(device.id, {
          ...this.devices.get(device.id),
          ...device,
          locationName: location.locationName,
        });
      }
    }

    this.devices = nextDevices;
    this.log.info('Discovered %d Daikin Open API device(s).', this.devices.size);
  }

  private async refreshAllDevices(): Promise<void> {
    for (const device of this.devices.values()) {
      try {
        const payload = await this.gateway.getDevicePayload(device.id);
        this.diagnostics.logRawPayload(device.id, payload);
        const parsedPayload = parseThermostatPayload(payload);
        this.diagnostics.logValidation(device.id, parsedPayload);
        this.updateDeviceData(device.id, parsedPayload.data);
        this.setDeviceOnline(device.id);
        this.notify(device.id);
      } catch (error) {
        if (this.setDeviceOfflineFromError(device.id, error)) {
          this.notify(device.id);
        }
        this.logError(`Unable to refresh ${device.name} (${device.id}).`, error);
      }
    }
  }

  private async putMsp(deviceId: string, update: DaikinThermostatUpdate): Promise<boolean> {
    if (!this.canWriteMode(deviceId, update.mode)) {
      this.log.warn('Skipping unsupported Daikin mode %d for %s.', update.mode, deviceId);
      return false;
    }

    return this.putDeviceUpdate(deviceId, 'msp', update, 'Daikin write payload', 'Daikin device write');
  }

  private async putSchedule(deviceId: string, update: DaikinScheduleUpdate): Promise<boolean> {
    return this.putDeviceUpdate(deviceId, 'schedule', update, 'Daikin schedule payload', 'Daikin schedule write');
  }

  private async putFan(deviceId: string, update: DaikinFanUpdate): Promise<boolean> {
    return this.putDeviceUpdate(deviceId, 'fan', update, 'Daikin fan payload', 'Daikin fan write');
  }

  private async putDeviceUpdate(
    deviceId: string,
    endpoint: DaikinWriteEndpoint,
    update: DaikinWriteUpdate,
    payloadLabel: string,
    writeLabel: string,
  ): Promise<boolean> {
    if (this.config.readonly) {
      this.log.warn('Read-only mode is enabled. Skipping %s for %s.', writeLabel, deviceId);
      return false;
    }

    try {
      if (this.config.developerMode) {
        this.log.info('%s for %s: %s', payloadLabel, deviceId, JSON.stringify(update));
      }
      await this.gateway.putDeviceUpdate(deviceId, endpoint, update);

      this.updateDeviceData(deviceId, this.localUpdateForEndpoint(endpoint, update));
      this.setDeviceOnline(deviceId);
      this.notify(deviceId);
      this.noPollBeforeMs = this.monotonicMs() + WRITE_DELAY_MS;
      this.scheduleRefresh(WRITE_DELAY_MS);
      return true;
    } catch (error) {
      if (this.setDeviceOfflineFromError(deviceId, error)) {
        this.notify(deviceId);
      }
      this.logError(`Unable to complete ${writeLabel} for ${deviceId}.`, error);
      return false;
    }
  }

  private updateDeviceData(
    deviceId: string,
    update: DaikinFanUpdate | DaikinScheduleUpdate | DaikinThermostatUpdate | Partial<DaikinThermostatData>,
  ): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      this.log.error('Received update for unknown device %s.', deviceId);
      return;
    }

    device.data = {
      ...(device.data ?? {}),
      ...update,
    } as DaikinThermostatData;
  }

  private localUpdateForEndpoint(
    endpoint: DaikinWriteEndpoint,
    update: DaikinWriteUpdate,
  ): DaikinWriteUpdate | Partial<DaikinThermostatData> {
    if (endpoint === 'msp') {
      return {
        ...update,
        scheduleEnabled: false,
      };
    }
    return update;
  }

  private setDeviceOnline(deviceId: string): boolean {
    return this.offlineDeviceIds.delete(deviceId);
  }

  private setDeviceOfflineFromError(deviceId: string, error: unknown): boolean {
    if (!(error instanceof JsonHttpError && error.responseMessage === DEVICE_OFFLINE_MESSAGE)) {
      return false;
    }

    const wasOnline = this.isDeviceOnline(deviceId);
    this.offlineDeviceIds.add(deviceId);
    return wasOnline;
  }

  private scheduleRefresh(delayMs: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      void this.refreshAllDevices()
        .catch(error => this.logError('Scheduled Daikin refresh failed.', error))
        .finally(() => this.scheduleRefresh(this.pollIntervalMs));
    }, delayMs);
    this.refreshTimer.unref?.();
  }

  private notify(deviceId: string): void {
    for (const listener of this.listeners.get(deviceId) ?? []) {
      listener();
    }
  }

  private monotonicMs(): number {
    return Number(hrtime.bigint() / BigInt(1_000_000));
  }

  private normalizeMode(value: unknown): ThermostatMode {
    return normalizeMode(value);
  }

  private canWriteMode(deviceId: string, mode: ThermostatMode): boolean {
    return mode === this.devices.get(deviceId)?.data?.mode || this.getSupportedModes(deviceId).includes(mode);
  }

  private fallbackSupportedModes(data: DaikinThermostatData | undefined): ThermostatMode[] {
    if (!data) {
      return [ThermostatMode.OFF];
    }

    const fallbackMode = data.mode === ThermostatMode.EMERGENCY_HEAT ? ThermostatMode.OFF : data.mode;
    return [...new Set([ThermostatMode.OFF, fallbackMode])];
  }

  private logError(message: string, error: unknown): void {
    this.log.error(message);
    this.log.error(error instanceof Error ? error.message : String(error));
  }
}
