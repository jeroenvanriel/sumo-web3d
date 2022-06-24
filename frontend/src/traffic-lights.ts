// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
/**
 * Code to generate traffic light objects from a SUMO network.
 *
 * These are static in the sense that they don't move, but dynamic in the sense that they do change.
 */
import * as _ from 'lodash';
import * as three from 'three';
import * as dat from 'dat.gui/build/dat.gui.js';

import {Network, TlLogic} from './api';
import {Transform} from './coords';
import {InitResources} from './initialization';
import {TRAFFIC_LIGHTS} from './materials';
import {parseShape} from './sumo-utils';
import {setMaterial} from './three-utils';
import {forceArray} from './utils';

enum Directions {
  LEFT = 'l',
  RIGHT = 'r',
  STRAIGHT = 's',
  UTURN = 't',
  // TODO(danvk): figure out what these mean.
  PARTIAL_LEFT = 'L',
  PARTIAL_RIGHT = 'R',
}

export default class TrafficLights {
  private gui: typeof dat.gui.GUI;
  private lightObjects: {[lightId: string]: three.Object3D[]} = {};
  private lightCycles: {[programId: string]: {[lightId: string]: TlLogic}} = {};
  private currentPrograms: {[lightId: string]: string} = {};
  private arrows: InitResources['arrows'];
  private trafficLight: three.Object3D;

  private tlsGroup: three.Group;
  private tlsOffset = {offset: 6, prev: 0};
  private arrowsGroup: three.Group;
  private arrowsOffset = {offset: 3.5, prev: 0};

  constructor(init: InitResources, gui: typeof dat.gui.GUI) { 
    this.gui = gui;
    this.arrows = init.arrows;
    this.trafficLight = init.models.trafficLight;

    this.updateOffset = this.updateOffset.bind(this)
    this.loadNetwork = this.loadNetwork.bind(this)

    const folder = this.gui.addFolder('Traffic Lights');
    folder.add(this.tlsOffset, 'offset', 0, 10).onChange(this.updateOffset);
    folder.add(this.arrowsOffset, 'offset', 0, 10).onChange(this.updateOffset);
  }

  loadNetwork(network: Network, t: Transform): three.Group {
    const {net} = network;
    this.tlsGroup = new three.Group();
    this.arrowsGroup = new three.Group();

    const tlConnections = _.filter(net.connection, c => _.has(c, 'tl'));
    const lightCounts: {[laneId: string]: number} = {};

    const edgeIdToEdge = _.keyBy(net.edge, 'id');

    _.forEach(tlConnections, connection => {
      const lightId = connection.tl;
      const {dir} = connection;
      const lanes = forceArray(edgeIdToEdge[connection.from].lane);
      const lane = lanes[Number(connection.fromLane)];
      const laneId = lane.id;

      // keep a count of all lights in a lane, so we can offset their height
      lightCounts[laneId] = (lightCounts[laneId] || 0) + 1;

      const light = this.getObjectForDirection(dir).clone();
      const name = `Light ${lightId} ${laneId} ${dir}`;
      light.traverse(obj => {
        obj.name = name;
        // Add a type so lights will be included in datastore.clickedObjects
        obj.userData = {
          type: 'light',
        };
      });

      const shape = parseShape(lane.shape);
      const [x, y = 0, z] = t.sumoXyzToXyz(shape[shape.length - 1]);
      const [px, , pz] = t.sumoXyzToXyz(shape[shape.length - 2]);
      // use the lane's last 2 points to determine the angle of the light
      const yRotation = Math.atan2(z - pz, px - x);

      light.position.set(x, y + lightCounts[laneId], z);
      light.rotation.set(0, yRotation, 0);
      this.arrowsGroup.add(light);
      if (!this.lightObjects[lightId]) {
        this.lightObjects[lightId] = [];
      }
      this.lightObjects[lightId][Number(connection.linkIndex)] = light;

      // only add a fixture when the first arrow is added
      if (lightCounts[laneId] == 1) {
        const fixture = this.trafficLight.clone();
        fixture.position.set(x, y, z);
        fixture.rotation.set(0, yRotation, 0);
        this.tlsGroup.add(fixture);
      }
    });

    // set initial offset
    this.updateOffset();

    const group = new three.Group().add(this.tlsGroup).add(this.arrowsGroup);
    return group;
  }

  private updateOffset() {
    this.tlsGroup.position.y += this.tlsOffset.offset - this.tlsOffset.prev;
    this.tlsOffset.prev = this.tlsOffset.offset;

    this.arrowsGroup.position.y += this.arrowsOffset.offset - this.arrowsOffset.prev;
    this.arrowsOffset.prev = this.arrowsOffset.offset;
  }

  /** Add traffic light programs to the simulation. */
  addLogic(tlLogics: TlLogic[]) {
    _.forEach(_.groupBy(tlLogics, 'programID'), (programLogics, programId) => {
      this.lightCycles[programId] = _.keyBy(programLogics, 'id');
    });
  }

  getRandomLight() {
    const randomConnection = _.sample(this.lightObjects);
    return randomConnection ? randomConnection[0] : null;
  }

  setLightProgram(lightId: string, programId: string) {
    this.currentPrograms[lightId] = programId;
  }

  /** Change a light object to reflect its new phase. */
  setPhase(lightId: string, phaseIndex: number) {
    const programId = this.currentPrograms[lightId];
    const lightCycle = this.lightCycles[programId][lightId];
    if (!lightCycle) {
      console.warn('Cannot set phase for light', lightId);
      return;
    }

    const lightState = lightCycle.phase[phaseIndex].state; // this is a string like 'rgyR'
    const lights = this.lightObjects[lightId];
    lights.forEach((light, i) => {
      const material = TRAFFIC_LIGHTS[lightState.charAt(i).toLowerCase()] || TRAFFIC_LIGHTS.x;
      setMaterial(light, material);
    });
  }

  private getObjectForDirection(dir: string): three.Object3D {
    if (dir === Directions.LEFT || dir === Directions.PARTIAL_LEFT) {
      return this.arrows.left;
    } else if (dir === Directions.RIGHT || dir === Directions.PARTIAL_RIGHT) {
      return this.arrows.right;
    } else if (dir === Directions.STRAIGHT) {
      return this.arrows.straight;
    } else if (dir === Directions.UTURN) {
      return this.arrows.uturn;
    } else {
      throw new Error(`Unknown turn direction: ${dir}.`);
    }
  }
}
