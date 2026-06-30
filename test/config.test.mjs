import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePlatformConfig } from '../dist/config.js';

test('reports missing required configuration without throwing', () => {
  const result = parsePlatformConfig({
    platform: 'DaikinOneOpenAPI',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['apiKey', 'integratorEmail', 'integratorToken']);
});

test('parses Homebridge config with defaults and filtered device IDs', () => {
  const result = parsePlatformConfig({
    platform: 'DaikinOneOpenAPI',
    apiKey: 'api-key',
    integratorEmail: 'owner@example.com',
    integratorToken: 'token',
    pollIntervalSeconds: 60,
    requestTimeoutSeconds: 0,
    includeDeviceName: false,
    deviceIds: ['zone-1', 42, 'zone-2'],
    readonly: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.config, {
    name: 'Daikin One',
    apiKey: 'api-key',
    integratorEmail: 'owner@example.com',
    integratorToken: 'token',
    pollIntervalSeconds: 180,
    requestTimeoutSeconds: 1,
    includeDeviceName: false,
    deviceIds: ['zone-1', 'zone-2'],
    readonly: true,
    debug: false,
    logRaw: false,
  });
});
