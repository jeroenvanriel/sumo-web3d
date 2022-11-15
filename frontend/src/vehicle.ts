// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
import * as stringHash from 'string-hash';
import * as three from 'three';
import * as _ from 'lodash';

import { Signals, VehicleInfo } from './api';
import { Model } from './initialization';
import { Transform } from './coords';
import { Color } from 'three';
import { ConfigManager, hexToRgb } from './config';

// Turn/brake lights are temporarily disabled while we investigate performance issues around them.
const SHOW_LIGHTS = false;

const LIGHT_OFFSET_X = 0.8;
const LIGHT_OFFSET_Y = 0.644;
const LIGHT_OFFSET_Z_FRONT = -0.1;
const LIGHT_OFFSET_Z_BACK = -4.0;

const BRAKE_LIGHT_COLOR = 0xff0000;
const SIGNAL_LIGHT_COLOR = 0x0000ff;

export default class Vehicle {
  // TODO (Ananta): the frontend shouldn't need to retain a copy of all vehicle info.
  // Make it as lightweight as possible
  public mesh: three.Group | three.Object3D | three.Mesh;
  public id: string;
  public vehicleInfo: VehicleInfo;

  private static configManager : ConfigManager;

  private offsetY: number = 0.0;

  private baseColor: three.Color;
  private baseColorMaterial: { color: three.Color };

  private customColor: boolean = false;

  static setConfigManager(configManager: ConfigManager) { this.configManager = configManager; }

  static fromInfo(
    vTypeObjects: {[vType: string]: Model[]},
    vehicleId: string,
    info: VehicleInfo,
  ): Vehicle | null {
    const models = vTypeObjects[info.type];
    if (!models) {
      console.warn(`Unsupported vehicle type: ${info.type}`);
      return null;
    }
    const randomModelIndex = stringHash(vehicleId) % models.length;
    const model = models[randomModelIndex];
    return new Vehicle(model, vehicleId, info);
  }

  private constructor(model: Model, vehicleId: string, info: VehicleInfo) {
    const mesh = model.object.clone();
    this.mesh = mesh;
    this.id = vehicleId;
    this.vehicleInfo = info;
    if (model.offsetY) 
      this.offsetY = model.offsetY

    mesh.name = vehicleId; // TODO(Jeroen): check if this prop is still necessary
    mesh.userData = {
      type: info.type,
      vClass: info.vClass,
    };

    if (info.vClass === 'passenger' && SHOW_LIGHTS) {
      this.setupLights(mesh.userData, mesh);
    }
    
    if (model.baseColorPart) { // model may specify the part (baseColorPart) that changes color
      // TODO(Jeroen): possibly allow multiple parts
      this.mesh.traverse(obj => { // locate that part
        if (obj instanceof three.Mesh && _.has(obj.material, 'color') && obj.name == model.baseColorPart) {
          // each vehicle gets it's own material instance for the part that changes color
          obj.material = obj.material.clone();
          // keep a reference to this material for dynamically changing the color
          this.baseColorMaterial = obj.material;
        }
      })
      if (info.color) { // use color in vehicle info
        this.baseColor = this.baseColorMaterial.color = new three.Color(...info.color);
      } else if (model.baseColor) { // ...or see if model provides a base color
        this.baseColor = this.baseColorMaterial.color = new three.Color(...hexToRgb(model.baseColor));
      } else { // ...or use color already on the object
        this.baseColor = this.baseColorMaterial.color;
      }
    }

    this.update.bind(this);
    this.updateColor.bind(this);
    this.changeColor.bind(this);
    this.resetColor.bind(this);

    return this;
  }

  update(t: Transform) {
    // In SUMO, the position of a vehicle is the front/center.
    // But the rotation is around its center/center.
    // Our models are built with (0, 0) at the center/center, so we rotate and then offset.
    const v = this.vehicleInfo;
    const obj = this.mesh;
    const [x, y, z] = t.sumoXyzToXyz([v.x, v.y, v.z]);
    const angle = three.MathUtils.degToRad(180 - v.angle);
    const offset = v.length / 2 + this.offsetY;
    obj.position.set(x - offset * Math.sin(angle), y, z - offset * Math.cos(angle));
    obj.rotation.set(0, angle, 0);
    if (v.type === 'SUMO_DEFAULT_TYPE' || v.type === 'passenger') {
      this.setSignals(v.signals); // update turn & brake signals.
    }
    obj.visible = !v.vehicle; // Don't render objects which are contained in vehicles.

    this.updateColor();
  }

  updateColor() {
    if (this.baseColorMaterial) { // else ignore
      if (Vehicle.configManager.get('vehicle', 'colorSpeed') && !this.customColor) {
        const colorLow = new three.Color(...Vehicle.configManager.get('vehicle', 'colorSpeedLow'));
        const colorHigh = new three.Color(...Vehicle.configManager.get('vehicle', 'colorSpeedHigh'));
        const max = Vehicle.configManager.get('vehicle', 'colorSpeedMax');
        // change color according to current speed
        const col = new Color().lerpColors(colorLow, colorHigh, this.vehicleInfo.speed / max);
        this.baseColorMaterial.color = col;
      } else if (this.vehicleInfo.color && !this.customColor) { // use the provided color
        this.baseColorMaterial.color = new three.Color(...this.vehicleInfo.color);
      }
    }
  }

  changeColor(color: three.Color) {
    if (this.baseColorMaterial) { // else ignore
      this.customColor = true;
      this.baseColorMaterial.color = color;
    }
  }

  resetColor() {
    this.customColor = false;
    this.baseColorMaterial.color = this.baseColor;
    this.updateColor();
  }

  addLight(mesh: three.Object3D, x: number, y: number, z: number, lightColor: number) {
    const sphereGeom = new three.SphereGeometry(0.12, 24, 24);
    const material = new three.MeshBasicMaterial({color: lightColor, transparent: false});
    const light = new three.Mesh(sphereGeom, material);
    light.position.set(x, y, z);
    mesh.add(light);
    return light;
  }

  setupLights(userData: any, mesh: three.Object3D) {
    userData.leftFrontLight = this.addLight(
      mesh,
      -LIGHT_OFFSET_X,
      LIGHT_OFFSET_Y,
      LIGHT_OFFSET_Z_FRONT,
      SIGNAL_LIGHT_COLOR,
    );
    userData.leftBackLight = this.addLight(
      mesh,
      LIGHT_OFFSET_X,
      LIGHT_OFFSET_Y,
      LIGHT_OFFSET_Z_BACK,
      BRAKE_LIGHT_COLOR,
    );
    userData.rightFrontLight = this.addLight(
      mesh,
      LIGHT_OFFSET_X,
      LIGHT_OFFSET_Y,
      LIGHT_OFFSET_Z_FRONT,
      SIGNAL_LIGHT_COLOR,
    );
    userData.rightBackLight = this.addLight(
      mesh,
      -LIGHT_OFFSET_X,
      LIGHT_OFFSET_Y,
      LIGHT_OFFSET_Z_BACK,
      BRAKE_LIGHT_COLOR,
    );
  }

  setSignals(signals: number) {
    if (!SHOW_LIGHTS) return;
    const isBraking = signals & Signals.BRAKE;
    const {userData} = this.mesh;
    userData.leftBackLight.visible = isBraking > 0;
    userData.rightBackLight.visible = isBraking > 0;
    userData.leftFrontLight.visible = (signals & Signals.LEFT) > 0;
    userData.rightFrontLight.visible = (signals & Signals.RIGHT) > 0;
  }
}
