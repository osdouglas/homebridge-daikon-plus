import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DaikinOutdoorUnitAccessory } from '../dist/outdoorUnitAccessory.js';

test('reports HomeKit communication failure while outdoor unit is offline', async () => {
  const { accessory, characteristic, client } = fixture({ online: false });

  new DaikinOutdoorUnitAccessory(platform(client, characteristic), accessory, 'zone-1');
  const temperature = accessory.getService('TemperatureSensor');
  const humidity = accessory.getService('HumiditySensor');

  assert.equal(await temperature.getCharacteristic(characteristic.StatusFault).get(), characteristic.StatusFault.GENERAL_FAULT);
  assert.equal(await humidity.getCharacteristic(characteristic.StatusFault).get(), characteristic.StatusFault.GENERAL_FAULT);
  await assert.rejects(
    temperature.getCharacteristic(characteristic.CurrentTemperature).get(),
    error => error === -70402,
  );
});

function fixture({ online }) {
  const characteristic = fakeCharacteristic();
  const client = {
    online,
    addListener() {},
    getOutdoorHumidity() {
      return 50;
    },
    getOutdoorTemperature() {
      return 20;
    },
    isDeviceOnline() {
      return this.online;
    },
    requestRefreshNow() {},
  };

  return {
    accessory: new FakePlatformAccessory('Downstairs Outdoor Unit', 'uuid:zone-1:outdoor-unit'),
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
  constructor(displayName, uuid) {
    this.displayName = displayName;
    this.UUID = uuid;
    this.context = {
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

  addService(serviceType) {
    const service = new FakeService(serviceType);
    this.services.push(service);
    return service;
  }
}

class FakeService {
  constructor(serviceType) {
    this.serviceType = serviceType;
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

  async get() {
    return this.getHandler();
  }
}

function fakeServiceTypes() {
  return {
    AccessoryInformation: 'AccessoryInformation',
    HumiditySensor: 'HumiditySensor',
    TemperatureSensor: 'TemperatureSensor',
  };
}

function fakeCharacteristic() {
  return {
    CurrentRelativeHumidity: 'CurrentRelativeHumidity',
    CurrentTemperature: 'CurrentTemperature',
    FirmwareRevision: 'FirmwareRevision',
    Manufacturer: 'Manufacturer',
    Model: 'Model',
    Name: 'Name',
    SerialNumber: 'SerialNumber',
    StatusFault: { GENERAL_FAULT: 1, NO_FAULT: 0 },
  };
}
