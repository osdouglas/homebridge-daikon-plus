import { HAPStatus, type CharacteristicValue, type PlatformAccessory, type Service } from 'homebridge';

import type { DaikinOpenApiPlatform } from './platform.js';
import type { AccessoryContext } from './types.js';

export class DaikinOutdoorUnitAccessory {
  private readonly humidityService: Service;
  private readonly temperatureService: Service;

  public constructor(
    private readonly platform: DaikinOpenApiPlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    private readonly deviceId: string,
  ) {
    const device = accessory.context.device;

    accessory
      .getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(platform.Characteristic.Manufacturer, 'Daikin')
      .setCharacteristic(platform.Characteristic.Model, device.model ?? 'Daikin Outdoor Unit')
      .setCharacteristic(platform.Characteristic.SerialNumber, `${device.id}:outdoor-unit`)
      .setCharacteristic(platform.Characteristic.FirmwareRevision, device.firmwareVersion ?? 'unknown');

    this.temperatureService =
      accessory.getService(platform.Service.TemperatureSensor) ?? accessory.addService(platform.Service.TemperatureSensor);
    this.temperatureService.setCharacteristic(platform.Characteristic.Name, `${accessory.displayName} Temperature`);
    this.temperatureService.getCharacteristic(platform.Characteristic.StatusFault).onGet(() => this.getStatusFault());
    this.temperatureService.getCharacteristic(platform.Characteristic.CurrentTemperature).onGet(() => {
      this.platform.client.requestRefreshNow();
      this.assertOnline();
      return this.getOutdoorTemperature();
    });

    this.humidityService =
      accessory.getService(platform.Service.HumiditySensor) ?? accessory.addService(platform.Service.HumiditySensor);
    this.humidityService.setCharacteristic(platform.Characteristic.Name, `${accessory.displayName} Humidity`);
    this.humidityService.getCharacteristic(platform.Characteristic.StatusFault).onGet(() => this.getStatusFault());
    this.humidityService.getCharacteristic(platform.Characteristic.CurrentRelativeHumidity).onGet(() => {
      this.platform.client.requestRefreshNow();
      this.assertOnline();
      return this.getOutdoorHumidity();
    });

    this.updateFaultStatus();
    this.platform.client.addListener(this.deviceId, this.updateValues.bind(this));
  }

  private updateValues(): void {
    const characteristic = this.platform.Characteristic;

    this.updateFaultStatus();
    this.temperatureService.updateCharacteristic(characteristic.CurrentTemperature, this.getOutdoorTemperature());
    this.humidityService.updateCharacteristic(characteristic.CurrentRelativeHumidity, this.getOutdoorHumidity());
  }

  private getOutdoorTemperature(): CharacteristicValue {
    return this.clamp(this.platform.client.getOutdoorTemperature(this.deviceId), -270, 100);
  }

  private getOutdoorHumidity(): CharacteristicValue {
    return this.clamp(this.platform.client.getOutdoorHumidity(this.deviceId), 0, 100);
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(max, Math.max(min, value));
  }

  private updateFaultStatus(): void {
    const statusFault = this.getStatusFault();
    this.temperatureService.updateCharacteristic(this.platform.Characteristic.StatusFault, statusFault);
    this.humidityService.updateCharacteristic(this.platform.Characteristic.StatusFault, statusFault);
  }

  private getStatusFault(): CharacteristicValue {
    return this.platform.client.isDeviceOnline(this.deviceId)
      ? this.platform.Characteristic.StatusFault.NO_FAULT
      : this.platform.Characteristic.StatusFault.GENERAL_FAULT;
  }

  private assertOnline(): void {
    if (!this.platform.client.isDeviceOnline(this.deviceId)) {
      throw HAPStatus.SERVICE_COMMUNICATION_FAILURE;
    }
  }
}
