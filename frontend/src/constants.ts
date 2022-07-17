// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
import * as _ from 'lodash';
import { Color, Mesh } from 'three';

import {ModelParams, SupportedVehicle} from './initialization';

// These are abstract vehicle classes. For a complete list, see:
// http://sumo.dlr.de/wiki/Definition_of_Vehicles,_Vehicle_Types,_and_Routes

// Vehicle colors and types from OpenGameArt (OGA), licensed CC0.
// See http://opengameart.org/content/vehicles-assets-pt1
// There are also types for trucks and vans which we could incorporate.
const OGA_COLORS = ['blue', 'citrus', 'green', 'orange', 'red', 'silver', 'violet'];
const OGA_TYPES = ['normal', 'hatchback', 'mpv', 'station'];
// The OGA vehicles are scaled to [-1, 1]. This winds up being a bit small, so we scale up.
const OGA_SCALE = 2.2;

function ogaVehicle(type: string, color: string): ModelParams {
  return {
    objectUrl: `/vehicles/car-${type}-${color}.obj`,
    materialUrl: `/vehicles/car-${type}-${color}.mtl`,
    scale: OGA_SCALE,
  };
}

const CGT_SCALE = 1.1;
const CGT_COLORS = ['red', 'blue', 'green', 'orange', 'grey', 'yellow'];
const CGT_COLORS_RGB : { [id: string]: number[] } = {"red": [1, 0, 0], "blue": [0, 0, 1], "green": [0, 1, 0], "orange": [1, 0, 1], "grey": [0.1, 0.1, 0.1], "yellow": [0.1, 0.5, 0.5]};

function cgtVehicle(color: string): ModelParams {
  return {
    objectUrl: `/vehicles-new/clio-${color}.glb`,
    scale: CGT_SCALE,
    baseColor: new Color(...CGT_COLORS_RGB[color]),
    baseColorPart: "body",
  };
}

export const SUPPORTED_VEHICLE_CLASSES: {[sumoVehicleClass: string]: SupportedVehicle} = {
  passenger: {
    label: 'car',
    // models: _.flatMap(OGA_TYPES, type => _.map(OGA_COLORS, color => ogaVehicle(type, color))),
    models: _.map(CGT_COLORS, color => cgtVehicle(color)),
  },
  passenger2: {
    label: 'car',
    // models: _.flatMap(OGA_TYPES, type => _.map(OGA_COLORS, color => ogaVehicle(type, color))),
    models: [cgtVehicle('blue')]
  },
  bicycle: {
    label: 'bike',
    models: [
      {
        objectUrl: '/vehicles/bicycle.obj',
        materialUrl: '/vehicles/bicycle.png',
      },
    ],
  },
  rail: {
    label: 'train',
    models: [
      {
        objectUrl: '/vehicles/Streetcar.obj',
        materialUrl: '/vehicles/Streetcar.png',
      },
    ],
  },
  pedestrian: {
    label: 'person',
    models: [
      {
        objectUrl: '/vehicles/pedestrian.obj',
        materialUrl: '/vehicles/pedestrian.png',
      },
      {
        objectUrl: '/vehicles/pedestrian_male.obj',
        materialUrl: '/vehicles/pedestrian_male.png',
      },
    ],
  },
  bus: {
    label: 'bus',
    models: [
      {
        objectUrl: '/vehicles/bus.obj',
        materialUrl: '/vehicles/bus.png',
      },
    ],
  },
};

export const MODELS: {[name: string]: ModelParams} = {
  tree: {objectUrl: '/models/tree.glb', scale: 0.5},
  environment: {
    objectUrl: '/models/osm.glb',
    position: { x: 550, y: 0, z: 414 }
  },
  building: {objectUrl: '/models/flat.glb', scale: 1.0},
  trafficLight: {objectUrl: '/models/trafficLight.glb'},
  tlFixture: {objectUrl: '/models/tlFixture.glb'},
}
