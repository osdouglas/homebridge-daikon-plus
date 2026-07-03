import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DaikinThermostatAccessory } from '../dist/thermostatAccessory.js';

test('reports HomeKit communication failure while thermostat is offline', async () => {
  const { accessory, characteristic, client } = fixture({ online: false, schedule: true });

  new DaikinThermostatAccessory(platform(client, characteristic), accessory, 'zone-1');
  const thermostat = accessory.getService('Thermostat');
  const schedule = accessory.getServiceById('Switch', 'schedule');

  assert.equal(thermostat.characteristics.has(characteristic.StatusFault), false);
  assert.equal(schedule.characteristics.has(characteristic.StatusFault), false);
  await assert.rejects(
    thermostat.getCharacteristic(characteristic.CurrentTemperature).get(),
    error => error === -70402,
  );
  await assert.rejects(
    schedule.getCharacteristic(characteristic.On).get(),
    error => error === -70402,
  );
});

test('rejects offline thermostat mode writes before calling Daikin client', async () => {
  const { accessory, characteristic, client } = fixture({ online: false, schedule: false });

  new DaikinThermostatAccessory(platform(client, characteristic), accessory, 'zone-1');
  const targetMode = accessory.getService('Thermostat').getCharacteristic(characteristic.TargetHeatingCoolingState);

  await assert.rejects(
    targetMode.set(characteristic.TargetHeatingCoolingState.COOL),
    error => error === -70402,
  );
  assert.deepEqual(client.modeWrites, []);
});

test('rejects thermostat writes that discover Daikin went offline', async () => {
  const mode = fixture({ online: true, schedule: false, writeOffline: true });
  new DaikinThermostatAccessory(platform(mode.client, mode.characteristic), mode.accessory, 'zone-1');
  await assert.rejects(
    mode.accessory
      .getService('Thermostat')
      .getCharacteristic(mode.characteristic.TargetHeatingCoolingState)
      .set(mode.characteristic.TargetHeatingCoolingState.COOL),
    error => error === -70402,
  );
  assert.deepEqual(mode.client.modeWrites, [{ deviceId: 'zone-1', mode: 2 }]);

  const target = fixture({ online: true, schedule: false, writeOffline: true });
  new DaikinThermostatAccessory(platform(target.client, target.characteristic), target.accessory, 'zone-1');
  await assert.rejects(
    target.accessory
      .getService('Thermostat')
      .getCharacteristic(target.characteristic.TargetTemperature)
      .set(22),
    error => error === -70402,
  );
  assert.deepEqual(target.client.targetTemperatureWrites, [{ deviceId: 'zone-1', temperature: 22 }]);

  const schedule = fixture({ online: true, schedule: true, writeOffline: true });
  new DaikinThermostatAccessory(platform(schedule.client, schedule.characteristic), schedule.accessory, 'zone-1');
  await assert.rejects(
    schedule.accessory
      .getServiceById('Switch', 'schedule')
      .getCharacteristic(schedule.characteristic.On)
      .set(true),
    error => error === -70402,
  );
  assert.deepEqual(schedule.client.scheduleWrites, [{ deviceId: 'zone-1', scheduleEnabled: true }]);
});

function fixture({ online, schedule, writeOffline = false }) {
  const characteristic = fakeCharacteristic();
  const client = {
    online,
    modeWrites: [],
    scheduleWrites: [],
    targetTemperatureWrites: [],
    thresholdWrites: [],
    writeOffline,
    addListener() {},
    getCoolingThreshold() {
      return 24;
    },
    getCurrentHumidity() {
      return 42;
    },
    getCurrentStatus() {
      return 5;
    },
    getCurrentTemperature() {
      return 21;
    },
    getHeatingThreshold() {
      return 20;
    },
    getMode() {
      return 1;
    },
    getScheduleEnabled() {
      return false;
    },
    getSetpointDelta() {
      return 2;
    },
    getSetpointMaximum() {
      return 35;
    },
    getSetpointMinimum() {
      return 10;
    },
    getSupportedModes() {
      return [0, 1, 2, 3];
    },
    getTargetTemperature() {
      return 20;
    },
    isDeviceOnline() {
      return this.online;
    },
    requestRefreshNow() {},
    async setMode(deviceId, mode) {
      this.modeWrites.push({ deviceId, mode });
      return this.completeWrite();
    },
    async setScheduleEnabled(deviceId, scheduleEnabled) {
      this.scheduleWrites.push({ deviceId, scheduleEnabled });
      return this.completeWrite();
    },
    async setTargetTemperature(deviceId, temperature) {
      this.targetTemperatureWrites.push({ deviceId, temperature });
      return this.completeWrite();
    },
    async setThresholds(deviceId, heatSetpoint, coolSetpoint) {
      this.thresholdWrites.push({ deviceId, heatSetpoint, coolSetpoint });
      return this.completeWrite();
    },
    completeWrite() {
      if (this.writeOffline) {
        this.online = false;
        return false;
      }
      return true;
    },
  };

  return {
    accessory: new FakePlatformAccessory('Downstairs Thermostat', 'uuid:zone-1:thermostat', schedule),
    characteristic,
    client,
  };
}

function platform(client, characteristic = fakeCharacteristic()) {
  return {
    Characteristic: characteristic,
    Service: fakeServiceTypes(),
    client,
  };
}

class FakePlatformAccessory {
  constructor(displayName, uuid, schedule) {
    this.displayName = displayName;
    this.UUID = uuid;
    this.context = {
      capabilities: { schedule },
      device: {
        id: 'zone-1',
        name: 'Downstairs',
      },
    };
    this.services = [new FakeService('AccessoryInformation')];
  }

  getService(serviceType) {
    return this.services.find(service => service.serviceType === serviceType);
  }

  getServiceById(serviceType, subtype) {
    return this.services.find(service => service.serviceType === serviceType && service.subtype === subtype);
  }

  addService(serviceType, displayName, subtype) {
    const service = new FakeService(serviceType, subtype);
    service.displayName = displayName;
    this.services.push(service);
    return service;
  }
}

class FakeService {
  constructor(serviceType, subtype) {
    this.serviceType = serviceType;
    this.subtype = subtype;
    this.characteristics = new Map();
  }

  getCharacteristic(characteristic) {
    if (!this.characteristics.has(characteristic)) {
      this.characteristics.set(characteristic, new FakeCharacteristicValue());
    }
    return this.characteristics.get(characteristic);
  }

  setCharacteristic() {
    return this;
  }

  updateCharacteristic() {
    return this;
  }
}

class FakeCharacteristicValue {
  onGet(handler) {
    this.getHandler = handler;
    return this;
  }

  onSet(handler) {
    this.setHandler = handler;
    return this;
  }

  setProps(props) {
    this.props = props;
    return this;
  }

  updateValue() {
    return this;
  }

  async get() {
    return this.getHandler();
  }

  async set(value) {
    await this.setHandler(value);
  }
}

function fakeServiceTypes() {
  return {
    AccessoryInformation: 'AccessoryInformation',
    Switch: 'Switch',
    Thermostat: 'Thermostat',
  };
}

function fakeCharacteristic() {
  return {
    CoolingThresholdTemperature: 'CoolingThresholdTemperature',
    CurrentHeatingCoolingState: { COOL: 2, HEAT: 1, OFF: 0 },
    CurrentRelativeHumidity: 'CurrentRelativeHumidity',
    CurrentTemperature: 'CurrentTemperature',
    FirmwareRevision: 'FirmwareRevision',
    HeatingThresholdTemperature: 'HeatingThresholdTemperature',
    Manufacturer: 'Manufacturer',
    Model: 'Model',
    Name: 'Name',
    On: 'On',
    SerialNumber: 'SerialNumber',
    StatusFault: { GENERAL_FAULT: 1, NO_FAULT: 0 },
    TargetHeatingCoolingState: { AUTO: 3, COOL: 2, HEAT: 1, OFF: 0 },
    TargetTemperature: 'TargetTemperature',
    TemperatureDisplayUnits: { CELSIUS: 0 },
  };
}
