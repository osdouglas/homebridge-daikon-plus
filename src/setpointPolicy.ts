import { ThermostatMode, type DaikinThermostatData, type DaikinThermostatUpdate } from './types.js';

export function applySetpointPolicy(data: DaikinThermostatData, update: DaikinThermostatUpdate): DaikinThermostatUpdate {
  const minimum = data.setpointMinimum ?? 10;
  const maximum = data.setpointMaximum ?? 35;
  const delta = data.setpointDelta ?? 1.5;

  let heatSetpoint = clamp(update.heatSetpoint, minimum, maximum);
  let coolSetpoint = clamp(update.coolSetpoint, minimum, maximum);

  if (update.mode === ThermostatMode.AUTO && coolSetpoint - heatSetpoint < delta) {
    if (update.coolSetpoint !== data.coolSetpoint) {
      heatSetpoint = clamp(coolSetpoint - delta, minimum, maximum);
      coolSetpoint = clamp(Math.max(coolSetpoint, heatSetpoint + delta), minimum, maximum);
    } else {
      coolSetpoint = clamp(heatSetpoint + delta, minimum, maximum);
      heatSetpoint = clamp(Math.min(heatSetpoint, coolSetpoint - delta), minimum, maximum);
    }
  }

  return {
    mode: update.mode,
    heatSetpoint,
    coolSetpoint,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
