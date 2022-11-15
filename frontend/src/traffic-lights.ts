// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
/**
 * Code to generate traffic light objects from a SUMO network.
 *
 * These are static in the sense that they don't move, but dynamic in the sense that they do change.
 */
import * as _ from 'lodash';
import * as three from 'three';

import {Network, TlLogic} from './api';
import {Transform} from './coords';
import {InitResources, Model} from './initialization';
import {TRAFFIC_LIGHTS} from './materials';
import {parseShape} from './sumo-utils';
import {setMaterial} from './three-utils';
import {forceArray} from './utils';
import { ConfigManager } from './config';

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
  private configManager: ConfigManager;
  private lightObjects: {[lightId: string]: three.Object3D[]} = {};
  private lightCycles: {[programId: string]: {[lightId: string]: TlLogic}} = {};
  private currentPrograms: {[lightId: string]: string} = {};
  private arrows: InitResources['arrows'];
  private trafficLight: Model;

  private tlsGroup: three.Group;
  private tlsOffsetPrev = 0;
  private tubesGroup: three.Group;
  private arrowsGroup: three.Group;

  private group: three.Group; /* all trafficlights */

  constructor(init: InitResources, configManager: ConfigManager) { 
    this.configManager = configManager;
    this.arrows = init.arrows;
    this.trafficLight = init.models.trafficLight;

    this.updateOffset = this.updateOffset.bind(this)
    this.loadNetwork = this.loadNetwork.bind(this)

    configManager.listen(this.updateOffset, 'environment', 'trafficLightOffset')
    configManager.listen((v: boolean) => this.group.visible = v, 'environment', 'trafficLight')
  }

  loadNetwork(network: Network, t: Transform): three.Group {
    const { net } = network;
    this.tlsGroup = new three.Group();
    this.tubesGroup = new three.Group();
    this.arrowsGroup = new three.Group();

    const tlConnections = _.filter(net.connection, c => _.has(c, 'tl'));
    const lightCounts: {[laneId: string]: number} = {};

    const edgeIdToEdge = _.keyBy(net.edge, 'id');

    _.forEach(_.groupBy(tlConnections, 'from'), connections => {
      if (connections.length == 0) return;
      const edgeId = connections[0].from
      const edge = edgeIdToEdge[edgeId];

      const tlLocations: three.Vector3[] = [];
      const poleHeight = 7;

      let yRotation = 0;

      _.forEach(connections, connection => {
        const lightId = connection.tl;
        const { dir } = connection;
        const lanes = forceArray(edge.lane);
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
        yRotation = Math.atan2(z - pz, px - x);

        const pos = new three.Vector3(x, -2.1 + y + lightCounts[laneId] * 0.85, z);
        light.position.copy(pos);
        light.rotation.set(0, yRotation, 0);
        this.arrowsGroup.add(light);
        if (!this.lightObjects[lightId]) {
          this.lightObjects[lightId] = [];
        }
        this.lightObjects[lightId][Number(connection.linkIndex)] = light;

        // only add a fixture when the first arrow is added
        if (lightCounts[laneId] == 1) {
          const fixture = this.trafficLight.object.clone();
          fixture.position.set(x, y, z);
          fixture.rotation.set(0, yRotation, 0);
          this.tlsGroup.add(fixture);

          const fixturePoint = new three.Vector3().copy(pos);
          fixturePoint.setComponent(1, poleHeight);
          tlLocations.push(fixturePoint);
        }
      });

      function createTube(path: three.Curve<three.Vector3>) {
        const geometry = new three.TubeGeometry( path, 30, 0.15, 8, false );
        const material = new three.MeshBasicMaterial( { color: 0x111111 } );
        return new three.Mesh( geometry, material );
      }

      // determine position of vertical pole
      const offsetZ = new three.Vector3(0, 0, -3);
      const offsetX = new three.Vector3(-0.3, 0, 0);
      offsetZ.applyAxisAngle(new three.Vector3(0, 1, 0), yRotation);
      offsetX.applyAxisAngle(new three.Vector3(0, 1, 0), yRotation);

      const origin = new three.Vector3();
      origin.copy(tlLocations[0]);
      origin.add(offsetZ); // move to the side
      origin.add(offsetX); // move back a little
      origin.setComponent(1, 0); // set to ground

      // draw vertical part
      let previous = new three.Vector3(0, poleHeight, 0).add(origin);
      const vertical = new three.LineCurve3(origin, previous);
      this.tubesGroup.add(createTube(vertical));

      // draw horizontal parts
      const path = new three.CurvePath<three.Vector3>();
      _.forEach(tlLocations, location => {
        location.add(offsetX);
        path.add(new three.LineCurve3(previous, location));
        previous = location;
      });
      
      this.tubesGroup.add(createTube(path));
    });

    // set initial offset
    this.updateOffset();

    this.group = new three.Group().add(this.tlsGroup).add(this.tubesGroup).add(this.arrowsGroup);
    return this.group;
  }

  private updateOffset() {
    const tlsOffset = this.configManager.get('environment', 'trafficLightOffset');
    this.tlsGroup.position.y += tlsOffset - this.tlsOffsetPrev;
    this.arrowsGroup.position.y += tlsOffset - this.tlsOffsetPrev;
    this.tlsOffsetPrev = tlsOffset;
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
