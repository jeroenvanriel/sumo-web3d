// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
import * as _ from 'lodash';
import * as three from 'three';

import { ModelParams, SupportedVehicle } from './initialization';

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
    baseColor: new three.Color(...CGT_COLORS_RGB[color]),
    baseColorPart: "body",
  };
}

export const SUPPORTED_VEHICLE_TYPES: {[sumoVehicleType: string]: SupportedVehicle} = {
  car: {
    label: 'car',
    models: _.map(CGT_COLORS, color => cgtVehicle(color)),
  },
  ambulance: {
    label: 'ambulance',
    models: [{ 
      objectUrl: '/ambulance.glb',
      scale: 0.17,
    }],
  }
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
