import { EquipmentStatus, ThermostatMode, type DaikinThermostatData } from './types.js';

export function normalizeThermostatData(payload: Record<string, unknown>): DaikinThermostatData {
  return {
    equipmentStatus: numberFrom(payload.equipmentStatus, EquipmentStatus.IDLE) as EquipmentStatus,
    mode: normalizeMode(payload.mode),
    modeLimit: optionalNumber(payload.modeLimit),
    modeEmHeatAvailable: optionalBooleanOrNumber(payload.modeEmHeatAvailable),
    fan: optionalNumber(payload.fan),
    fanCirculate: optionalNumber(payload.fanCirculate),
    fanCirculateSpeed: optionalNumber(payload.fanCirculateSpeed),
    heatSetpoint: numberFrom(payload.heatSetpoint, 20),
    coolSetpoint: numberFrom(payload.coolSetpoint, 24),
    setpointDelta: optionalNumber(payload.setpointDelta),
    setpointMinimum: optionalNumber(payload.setpointMinimum),
    setpointMaximum: optionalNumber(payload.setpointMaximum),
    tempIndoor: numberFrom(payload.tempIndoor, -270),
    humIndoor: optionalNumber(payload.humIndoor),
    tempOutdoor: optionalNumber(payload.tempOutdoor),
    humOutdoor: optionalNumber(payload.humOutdoor),
    scheduleEnabled: optionalBoolean(payload.scheduleEnabled),
    geofencingEnabled: optionalBoolean(payload.geofencingEnabled),
  };
}

export function normalizeMode(value: unknown): ThermostatMode {
  const mode = numberFrom(value, ThermostatMode.OFF);
  switch (mode) {
    case ThermostatMode.HEAT:
    case ThermostatMode.COOL:
    case ThermostatMode.AUTO:
    case ThermostatMode.EMERGENCY_HEAT:
      return mode;
    default:
      return ThermostatMode.OFF;
  }
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return undefined;
}

function optionalBooleanOrNumber(value: unknown): number | boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return optionalNumber(value);
}

function optionalNumber(value: unknown): number | undefined {
  const numberValue = numberFrom(value, Number.NaN);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function numberFrom(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}
