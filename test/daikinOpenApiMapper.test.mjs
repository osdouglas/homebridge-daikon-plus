import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeThermostatData } from '../dist/daikinOpenApiMapper.js';
import { applySetpointPolicy } from '../dist/setpointPolicy.js';

test('normalizes numeric Open API strings into thermostat data', () => {
  const data = normalizeThermostatData({
    equipmentStatus: '3',
    mode: '1',
    heatSetpoint: '19.5',
    coolSetpoint: '24',
    tempIndoor: '20.25',
    humIndoor: '48',
    scheduleEnabled: '1',
  });

  assert.equal(data.equipmentStatus, 3);
  assert.equal(data.mode, 1);
  assert.equal(data.heatSetpoint, 19.5);
  assert.equal(data.coolSetpoint, 24);
  assert.equal(data.tempIndoor, 20.25);
  assert.equal(data.humIndoor, 48);
  assert.equal(data.scheduleEnabled, true);
});

test('falls back to safe mode and placeholder values for invalid payload fields', () => {
  const data = normalizeThermostatData({
    equipmentStatus: Number.NaN,
    mode: 255,
    heatSetpoint: 'not-a-number',
    coolSetpoint: null,
    tempIndoor: undefined,
  });

  assert.equal(data.equipmentStatus, 5);
  assert.equal(data.mode, 0);
  assert.equal(data.heatSetpoint, 20);
  assert.equal(data.coolSetpoint, 24);
  assert.equal(data.tempIndoor, -270);
});

test('keeps auto heat and cool setpoints separated by the Daikin delta', () => {
  const data = normalizeThermostatData({
    equipmentStatus: 5,
    mode: 3,
    heatSetpoint: 20,
    coolSetpoint: 22,
    setpointDelta: 2,
    setpointMinimum: 10,
    setpointMaximum: 35,
    tempIndoor: 21,
  });

  assert.deepEqual(
    applySetpointPolicy(data, {
      mode: 3,
      heatSetpoint: 20,
      coolSetpoint: 20.5,
    }),
    {
      mode: 3,
      heatSetpoint: 18.5,
      coolSetpoint: 20.5,
    },
  );
});
