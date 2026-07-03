import { HAPStatus, type CharacteristicValue, type PlatformAccessory, type Service } from 'homebridge';

import type { DaikinOpenApiPlatform } from './platform.js';
import { EquipmentStatus, FanCirculateMode, FanCirculateSpeed, type AccessoryContext } from './types.js';

export class DaikinCirculationFanAccessory {
  private readonly service: Service;

  public constructor(
    private readonly platform: DaikinOpenApiPlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    private readonly deviceId: string,
  ) {
    const device = accessory.context.device;

    accessory
      .getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(platform.Characteristic.Manufacturer, 'Daikin')
      .setCharacteristic(platform.Characteristic.Model, device.model ?? 'Daikin Circulation Fan')
      .setCharacteristic(platform.Characteristic.SerialNumber, `${device.id}:circulation-fan`)
      .setCharacteristic(platform.Characteristic.FirmwareRevision, device.firmwareVersion ?? 'unknown');

    this.service = accessory.getService(platform.Service.Fanv2) ?? accessory.addService(platform.Service.Fanv2);
    this.service.setCharacteristic(platform.Characteristic.Name, accessory.displayName);
    this.service.getCharacteristic(platform.Characteristic.StatusFault).onGet(() => this.getStatusFault());

    this.service
      .getCharacteristic(platform.Characteristic.Active)
      .onGet(() => {
        this.platform.client.requestRefreshNow();
        this.assertOnline();
        return this.getActive();
      })
      .onSet(this.setActive.bind(this));

    this.service.getCharacteristic(platform.Characteristic.CurrentFanState).onGet(() => {
      this.platform.client.requestRefreshNow();
      this.assertOnline();
      return this.getCurrentFanState();
    });

    this.service
      .getCharacteristic(platform.Characteristic.TargetFanState)
      .onGet(() => {
        this.platform.client.requestRefreshNow();
        this.assertOnline();
        return this.getTargetFanState();
      })
      .onSet(this.setTargetFanState.bind(this));

    this.service
      .getCharacteristic(platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => {
        this.platform.client.requestRefreshNow();
        this.assertOnline();
        return this.getRotationSpeed();
      })
      .onSet(this.setRotationSpeed.bind(this));

    this.updateFaultStatus();
    this.platform.client.addListener(this.deviceId, this.updateValues.bind(this));
  }

  private updateValues(): void {
    const characteristic = this.platform.Characteristic;

    this.updateFaultStatus();
    this.service.updateCharacteristic(characteristic.Active, this.getActive());
    this.service.updateCharacteristic(characteristic.CurrentFanState, this.getCurrentFanState());
    this.service.updateCharacteristic(characteristic.TargetFanState, this.getTargetFanState());
    this.service.updateCharacteristic(characteristic.RotationSpeed, this.getRotationSpeed());
  }

  private getActive(): CharacteristicValue {
    return this.isCirculationEnabled()
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    this.assertOnline();
    const active = Number(value) === this.platform.Characteristic.Active.ACTIVE;
    await this.writeOrThrow(this.platform.client.setFanCirculation(this.deviceId, {
      fanCirculate: active ? this.activeCirculationMode({ preferManual: true }) : FanCirculateMode.OFF,
      fanCirculateSpeed: this.currentSpeed(),
    }));
  }

  private getCurrentFanState(): CharacteristicValue {
    if (!this.isCirculationEnabled()) {
      return this.platform.Characteristic.CurrentFanState.INACTIVE;
    }

    return this.platform.client.getCurrentStatus(this.deviceId) === EquipmentStatus.FAN
      ? this.platform.Characteristic.CurrentFanState.BLOWING_AIR
      : this.platform.Characteristic.CurrentFanState.IDLE;
  }

  private getTargetFanState(): CharacteristicValue {
    return this.platform.client.getFanCirculate(this.deviceId) === FanCirculateMode.SCHEDULE
      ? this.platform.Characteristic.TargetFanState.AUTO
      : this.platform.Characteristic.TargetFanState.MANUAL;
  }

  private async setTargetFanState(value: CharacteristicValue): Promise<void> {
    this.assertOnline();
    const fanCirculate =
      Number(value) === this.platform.Characteristic.TargetFanState.AUTO
        ? FanCirculateMode.SCHEDULE
        : this.activeCirculationMode({ preferManual: true });
    await this.writeOrThrow(this.platform.client.setFanCirculation(this.deviceId, {
      fanCirculate,
      fanCirculateSpeed: this.currentSpeed(),
    }));
  }

  private getRotationSpeed(): CharacteristicValue {
    if (!this.isCirculationEnabled()) {
      return 0;
    }
    return this.speedToRotationSpeed(this.platform.client.getFanCirculateSpeed(this.deviceId));
  }

  private async setRotationSpeed(value: CharacteristicValue): Promise<void> {
    this.assertOnline();
    const rotationSpeed = Number(value);
    if (rotationSpeed <= 0) {
      await this.writeOrThrow(this.platform.client.setFanCirculation(this.deviceId, {
        fanCirculate: FanCirculateMode.OFF,
        fanCirculateSpeed: this.currentSpeed(),
      }));
      return;
    }

    await this.writeOrThrow(this.platform.client.setFanCirculation(this.deviceId, {
      fanCirculate: this.activeCirculationMode({ preferManual: true }),
      fanCirculateSpeed: this.rotationSpeedToSpeed(rotationSpeed),
    }));
  }

  private activeCirculationMode(options: { preferManual?: boolean } = {}): FanCirculateMode {
    const current = this.platform.client.getFanCirculate(this.deviceId);
    if (current === FanCirculateMode.ON || current === FanCirculateMode.SCHEDULE) {
      return options.preferManual ? FanCirculateMode.ON : current;
    }
    return options.preferManual ? FanCirculateMode.ON : FanCirculateMode.SCHEDULE;
  }

  private currentSpeed(): FanCirculateSpeed | undefined {
    return this.platform.client.getFanCirculateSpeed(this.deviceId);
  }

  private isCirculationEnabled(): boolean {
    const fanCirculate = this.platform.client.getFanCirculate(this.deviceId);
    return fanCirculate === FanCirculateMode.ON || fanCirculate === FanCirculateMode.SCHEDULE;
  }

  private rotationSpeedToSpeed(rotationSpeed: number): FanCirculateSpeed {
    if (rotationSpeed <= 33) {
      return FanCirculateSpeed.LOW;
    }
    if (rotationSpeed <= 66) {
      return FanCirculateSpeed.MEDIUM;
    }
    return FanCirculateSpeed.HIGH;
  }

  private speedToRotationSpeed(speed: FanCirculateSpeed | undefined): number {
    switch (speed) {
      case FanCirculateSpeed.LOW:
        return 33;
      case FanCirculateSpeed.MEDIUM:
        return 66;
      case FanCirculateSpeed.HIGH:
        return 100;
      default:
        return 0;
    }
  }

  private updateFaultStatus(): void {
    this.service.updateCharacteristic(this.platform.Characteristic.StatusFault, this.getStatusFault());
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

  private async writeOrThrow(write: Promise<boolean>): Promise<void> {
    const didWrite = await write;
    if (!didWrite && !this.platform.client.isDeviceOnline(this.deviceId)) {
      throw HAPStatus.SERVICE_COMMUNICATION_FAILURE;
    }
  }
}
