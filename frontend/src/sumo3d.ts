// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
import * as dat from 'dat.gui/build/dat.gui.js';
import * as _ from 'lodash';
import * as Stats from 'stats.js';
import * as three from 'three';

import {LaneMap, LightInfo, SimulationState, VehicleInfo} from './api';
import FollowVehicleControls from './controls/follow-controls';
import PanAndRotateControls from './controls/pan-and-rotate-controls';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';
import {XZPlaneMatrix4} from './controls/utils';
import {getTransforms, LatLng, Transform} from './coords';
import Postprocessing, {FOG_RATE, BLOOM_SCENE} from './effects/postprocessing';
import {addSkybox, addLights} from './effects/sky';
import {InitResources, Model} from './initialization';
import {HIGHLIGHT} from './materials';
import {makeStaticObjects, MeshAndPosition, OsmIdToMesh} from './network';
import {pointCameraAtScene} from './scene-finder';
import TrafficLights from './traffic-lights';
import {forceArray} from './utils';
import Vehicle from './vehicle';
import Config from './config';

const {hostname} = window.location;
export const SUMO_ENDPOINT = `http://${hostname}:5000`;

export interface SumoState {
  time: number;
  payloadSize: number;
  vehicleCounts: {[type: string]: number};
  simulateSecs: number;
  snapshotSecs: number;
}

export interface NameAndUserData extends UserData {
  name: string;
}

export interface UserData {
  type: string;
  vClass?: string;
  osmId?: {
    id: number;
    type: 'node' | 'way' | 'relation';
  };
}

export interface SumoParams {
  onClick: (
    latLng: LatLng | null,
    sumoXY: [number, number] | null,
    objects: NameAndUserData[],
  ) => any;
  onUnfollow: () => any;
  onRemove: (id: string) => any;
  onUnhighlight: () => any;
}

interface HighlightedMesh {
  originalMesh: three.Object3D;
  highlightedMesh: three.Object3D;
}

/**
 * Visualize a Sumo simulation using three.js.
 *
 * This class expects the DOM to be ready and for all its resources to be loaded.
 */
export default class Sumo3D {
  parentElement: HTMLElement;

  public osmIdToMeshes: OsmIdToMesh;
  private laneMaterials: { [laneId: string]: three.ShaderMaterial };
  private lanemap: LaneMap | null;
  private transform: Transform;
  private vehicles: {[vehicleId: string]: Vehicle};
  private camera: three.PerspectiveCamera;
  private scene: three.Scene;
  private renderer: three.WebGLRenderer;
  private controls: PanAndRotateControls | FollowVehicleControls | OrbitControls;
  public simulationState: SimulationState;
  private vTypeModels: {[vehicleType: string]: Model[]};
  private trafficLights: TrafficLights;
  private highlightedMeshes: HighlightedMesh[];
  private highlightedRoute: HighlightedMesh[];
  private highlightedVehicles: Vehicle[];
  private gui: typeof dat.gui.GUI;
  private postprocessing: Postprocessing;
  private stats: Stats;
  private simTimePanel: Stats.Panel;
  private maxSimTimeMs: number;
  private groundPlane: three.Object3D;
  private cancelNextClick = false;

  constructor(parentElement: HTMLElement, init: InitResources, private params: SumoParams) {
    const startMs = window.performance.now();

    this.parentElement = parentElement;
    const width = parentElement.clientWidth;
    const height = parentElement.clientHeight;

    this.simulationState = init.simulationState;
    this.transform = getTransforms(init.network);
    this.vTypeModels = init.vehicles;
    this.vehicles = {};
    this.highlightedRoute = [];
    this.highlightedMeshes = [];
    this.highlightedVehicles = [];

    this.renderer = new three.WebGLRenderer();
    (this.renderer as any).setPixelRatio(window.devicePixelRatio);
    // disable the ability to right click in order to allow rotating with the right button
    this.renderer.domElement.oncontextmenu = (e: PointerEvent) => false;
    this.renderer.domElement.tabIndex = 1;
    this.renderer.setSize(width, height);

    this.scene = new three.Scene();

    this.camera = new three.PerspectiveCamera(75, width / height, 1, 20000);
    let [centerX, centerZ] = this.transform.xyToXz(this.transform.center());
    let initZoom = 200;
    if (init.settings && init.settings.viewsettings.viewport) {
      const {x, y, zoom} = init.settings.viewsettings.viewport;
      console.log('Focusing on ', x, y);
      [centerX, centerZ] = this.transform.xyToXz([Number(x), Number(y)]);
      if (zoom) initZoom = Number(zoom);
    }
    const maxInitY = 0.5 / FOG_RATE; // beyond this, you can't see anything.
    // Distance at which whole scene is visible, see https://stackoverflow.com/a/31777283/388951.
    const initY = Math.min(
      this.transform.width() * 100 / initZoom / (2 * Math.tan(this.camera.fov * Math.PI / 360)),
      maxInitY,
    );
    this.camera.position.set(centerX, initY, centerZ);

    this.gui = new dat.gui.GUI();

    addSkybox(this.scene, centerX, centerZ);
    addLights(this.scene, centerX, centerZ);

    const config = new Config();
    this.updateVehicleColors = this.updateVehicleColors.bind(this);
    config.listen(this.updateVehicleColors, 'vehicle')
    this.trafficLights = new TrafficLights(init, config);

    Vehicle.setConfig(config);

    this.lanemap = init.lanemap;

    let staticGroup: three.Group;
    [staticGroup, this.laneMaterials, this.osmIdToMeshes] = makeStaticObjects(
      init.network,
      init.additional,
      init.water,
      init.models,
      this.transform,
      (this.lanemap !== null)
    );

    this.scene.add(staticGroup);

    pointCameraAtScene(this.camera, this.scene);

    this.scene.add(this.trafficLights.loadNetwork(init.network, this.transform));
    this.trafficLights.addLogic(forceArray(init.network.net.tlLogic));
    if (init.additional && init.additional.tlLogic) {
      this.trafficLights.addLogic(forceArray(init.additional.tlLogic));
    }
    this.groundPlane = this.scene.getObjectByName('Land') as three.Object3D<Event>;

    // this.groundPlane.layers.toggle( BLOOM_SCENE );

    this.animate = this.animate.bind(this);
    this.moveCameraTo = this.moveCameraTo.bind(this);
    this.moveCameraToRandomVehicleOfType = this.moveCameraToRandomVehicleOfType.bind(this);

    const sceneFolder = this.gui.addFolder('Scene');
    const sceneOptions = {
      showGroundPlane: true,
    };
    sceneFolder.add(sceneOptions, 'showGroundPlane').onChange((v: boolean) => {
      this.groundPlane.visible = v;
    });

    parentElement.appendChild(this.renderer.domElement);

    // this.controls = new PanAndRotateControls(
    //   this.camera,
    //   this.renderer.domElement,
    //   this.groundPlane,
    // );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.screenSpacePanning = false;
    this.controls.update();

    this.postprocessing = new Postprocessing(
      this.camera,
      this.scene,
      this.renderer,
      this.gui,
      width,
      height,
      centerX,
      centerZ,
    );

    this.stats = new Stats();
    this.simTimePanel = this.stats.addPanel(new Stats.Panel('simMs', '#fff', '#777'));
    this.maxSimTimeMs = 0;
    this.stats.showPanel(0); // 0 = show stats on FPS
    parentElement.appendChild(this.stats.dom);
    this.stats.dom.style.position = 'absolute'; // top left of container, not the page.
    this.animate();

    this.renderer.domElement.addEventListener('click', this.onClick.bind(this));
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));

    window.addEventListener('resize', this.onResize.bind(this));

    const endMs = window.performance.now();
    console.log('Initialized three.js scene in ', endMs - startMs, ' ms.');
  }

  updateVehicleColors() {
    _.forEach(this.vehicles, (vehicle, key) => {
      vehicle.updateColor();
    });
  }

  purgeVehicles() {
    // cleanup scene
    for (const vehId in this.vehicles) {
      this.scene.remove(this.vehicles[vehId].mesh);
    }
    this.vehicles = {};
  }

  createVehicleObject(vehicleId: string, info: VehicleInfo) {
    const vehicle = Vehicle.fromInfo(this.vTypeModels, vehicleId, info);
    if (vehicle) {
      this.vehicles[vehicleId] = vehicle;
      vehicle.update(this.transform);
      this.scene.add(vehicle.mesh);
    }
  }

  updateVehicleObject(vehicleId: string, update: VehicleInfo) {
    const vehicle = this.vehicles[vehicleId];
    if (vehicle) {
      _.extend(vehicle.vehicleInfo, update);
      vehicle.update(this.transform);
    }
  }

  removeVehicleObject(vehicleId: string) {
    let highlightedIndex = null;
    this.highlightedVehicles.forEach(({id}, index) => {
      if (vehicleId === id) {
        this.params.onUnhighlight();
        highlightedIndex = index;
      }
    });

    if (highlightedIndex) {
      this.highlightedVehicles.splice(highlightedIndex, 1);
    }

    const vehicle = this.vehicles[vehicleId];
    if (vehicle) {
      this.scene.remove(vehicle.mesh);
      if (
        this.controls instanceof FollowVehicleControls &&
        vehicleId === this.controls.object.name
      ) {
        this.params.onUnfollow();
      }
      this.params.onRemove(vehicleId);
      delete this.vehicles[vehicleId];
    }
  }

  updateLightObject(lightId: string, update: LightInfo) {
    const {programID, phase} = update;
    if (programID !== undefined) {
      this.trafficLights.setLightProgram(lightId, programID);
    }
    if (phase !== undefined) {
      this.trafficLights.setPhase(lightId, phase);
    }
  }

  updateStats(stats: SumoState) {
    const simTimeMs = stats.simulateSecs * 1000;
    this.maxSimTimeMs = Math.max(simTimeMs, this.maxSimTimeMs);
    this.simTimePanel.update(simTimeMs, 100);
  }

  animate() {
    this.controls.update();
    this.postprocessing.render();
    this.stats.update();

    requestAnimationFrame(this.animate);
  }

  onSelectFollowPOV(vehicleId: string) {
    const vehicle = this.vehicles[vehicleId];
    if (vehicle) {
      const object = vehicle.mesh;
      this.controls.dispose();
      this.controls = new FollowVehicleControls(object, this.camera, document.body);
      this.controls.update();
    }
  }

  unfollowPOV() {
    if (this.controls instanceof FollowVehicleControls) {
      // Place camera over vehicle's arrival location
      const translation = new three.Vector3(0, 100, 0);
      this.camera.position.copy(translation.applyMatrix4(this.controls.object.matrix));
      this.controls.dispose();
      this.controls = new PanAndRotateControls(
        this.camera,
        this.renderer.domElement,
        this.groundPlane,
      );
      // Have the camera look out over the horizon
      this.camera.setRotationFromMatrix(XZPlaneMatrix4);
    }
  }

  onShowRouteObject(edgeIds: string[]) {
    this.highlightedRoute = _.flatten(edgeIds.map(id => this.highlightByOsmId(id, false)));
    return;
  }

  /** Point the camera down at some SUMO coordinates. */
  moveCameraTo(sumoX: number, sumoY: number, sumoZ: number | null) {
    if (!(this.controls instanceof FollowVehicleControls)) {
      if (sumoZ) {
        const [x, y, z] = this.transform.sumoXyzToXyz([sumoX, sumoY, sumoZ]);
        this.camera.position.set(x, y, z);
      } else {
        // if y is not provided, we just use the previous value
        const y = this.camera.position.y;
        const [x, z] = this.transform.xyToXz([sumoX, sumoY])
        this.camera.position.set(x, y, z);
      }
    }
  }

  moveCameraControlCenter(sumoX: number, sumoY: number, sumoZ: number) {
    // move the camera controls center of rotation to this point
    console.log('center');
  
    if (this.controls instanceof OrbitControls) {
      const [x, y, z] = this.transform.sumoXyzToXyz([sumoX, sumoY, sumoZ]);
      this.controls.target = new three.Vector3(x, y, z);
      this.controls.update();
    }
  }

  moveCameraToRandomVehicleOfType(vehicleType: string) {
    const vehicles = _.filter(this.vehicles, v => v.vehicleInfo.type === vehicleType);
    const randomVehicle = _.sample<Vehicle>(vehicles);
    if (randomVehicle) {
      const {x, y, z} = randomVehicle.mesh.position;
      // the offsets put the camera slightly behind the vehicle and above the road
      this.camera.position.set(x, y + 2, z + 10);
    } else {
      console.warn('cannot find a random', vehicleType);
    }
  }

  moveCameraToRandomLight() {
    const randomLight = this.trafficLights.getRandomLight();
    if (randomLight) {
      const {x, y, z} = randomLight.position;
      // the offset puts the camera slightly behind the light
      this.camera.position.set(x, y, z + 10);
    } else {
      console.warn('cannot find a random traffic light');
    }
  }

  moveCameraToLatitudeAndLongitude(lat: number, lng: number) {
    const simulationCoords = this.transform.latLngToXZ({lat, lng});
    if (simulationCoords) {
      const [x, z] = simulationCoords;
      this.camera.position.set(x, this.camera.position.y, z);
      this.camera.lookAt(new three.Vector3(x, 0, z));
    }
  }

  checkParentsAndFaceForUserData(intersect: three.Intersection): any {
    // first check the face for userData. This comes from a merged geometry.
    const faceData = (intersect.face as any).userData;
    if (faceData) {
      return faceData;
    }
    // Otherwise look for userData on this object or its parents.
    return this.checkParentsForUserData(intersect.object);
  }

  checkParentsForUserData(obj: three.Object3D): any {
    if (!obj.parent) {
      return null;
    } else if (obj.userData['type']) {
      return {name: obj.name, ...obj.userData};
    } else {
      return this.checkParentsForUserData(obj.parent);
    }
  }

  highlightMesh(mesh: three.Mesh) {
    const newMesh = mesh.clone();
    newMesh.material = HIGHLIGHT;
    return newMesh;
  }

  highlightObject(obj: three.Object3D) {
    if (obj instanceof three.Mesh) {
      return this.highlightMesh(obj as three.Mesh);
    }
    const {highlightObject} = this;
    const highlightObjectFn = highlightObject.bind(this);
    const newObject = obj.clone();
    newObject.children = newObject.children.map(child => {
      if (child instanceof three.Mesh) {
        child = highlightObjectFn(child);
      }
      return child;
    });
    return newObject;
  }

  highlightByOsmId(osmId: string, changeCamera: boolean) {
    if (this.osmIdToMeshes[osmId]) {
      const selected: MeshAndPosition[] = this.osmIdToMeshes[osmId];
      const {scene, highlightMesh} = this;
      this.highlightedMeshes = this.highlightedMeshes.concat(
        selected.map(({mesh, position}) => {
          const originalMesh = mesh;
          const highlightedMesh = highlightMesh(mesh);
          originalMesh.visible = false;
          scene.add(highlightedMesh);
          return {highlightedMesh, originalMesh};
        }),
      );
      const positionUpdate = selected[0].position;
      if (changeCamera && positionUpdate !== null) {
        this.camera.position.copy(positionUpdate);
        this.camera.position.add(new three.Vector3(0, 50, 0));
        this.camera.lookAt(positionUpdate);
        this.camera.updateProjectionMatrix();
      }
    }
    return this.highlightedMeshes;
  }

  highlightByVehicleId(sumoId: string, changeCamera: boolean) {
    if (!this.vehicles[sumoId])
      return false; // not found

    this.highlightedVehicles.push(this.vehicles[sumoId]);

    // TODO(Jeroen): parameterize highlight color
    // set red highlight
    this.vehicles[sumoId].changeColor(new three.Color(1, 0, 0.5));

    // focus on vehicle
    const {position} = this.vehicles[sumoId].mesh;
    if (changeCamera && position !== null) {
      this.camera.position.copy(position);
      this.camera.position.add(new three.Vector3(0, 50, 0));
      this.camera.lookAt(position);
      this.camera.updateProjectionMatrix();
    }
    
    return true; // found
  }

  unhighlightRoute() {
    this.highlightedRoute.forEach(({highlightedMesh, originalMesh}) => {
      this.scene.remove(highlightedMesh);
      originalMesh.visible = true;
    });
  }

  unselectMeshes() {
    this.highlightedVehicles.forEach(vehicle => vehicle.resetColor() );
    this.highlightedVehicles = [];

    this.highlightedMeshes.forEach(({highlightedMesh, originalMesh}) => {
      this.scene.remove(highlightedMesh);
      originalMesh.visible = true;
    });
    this.highlightedMeshes = [];
  }

  updateLaneMaterials(lane_distributions: number[][]) {
    // TODO: use difference for lanes

    _.forEach(this.laneMaterials, (material, laneId) => {
      if (!this.lanemap) { throw new Error('lanemap must be provided when using lane gradients'); return; }
      const laneNumber = this.lanemap[laneId];
      if (!laneNumber) return;

      material.uniforms['gradients'].value = lane_distributions[laneNumber];
      material.uniforms['nGradients'].value = lane_distributions[laneNumber].length;
      material.uniforms['gradientScale'].value = 1 / Math.max(...lane_distributions[laneNumber]);
    });
  }

  onMouseDown(evnet: MouseEvent) {
    // Drags shouldn't lead to clicks.
    const {domElement} = this.renderer;
    this.cancelNextClick = false;
    const onMouseMove = () => {
      this.cancelNextClick = true;
    };
    const onMouseUp = () => {
      domElement.removeEventListener('mousemove', onMouseMove);
      domElement.removeEventListener('mouseup', onMouseUp);
    };
    domElement.addEventListener('mousemove', onMouseMove);
    domElement.addEventListener('mouseup', onMouseUp);
  }

  onClick(event: MouseEvent) {
    if (this.cancelNextClick) {
      // This was probably a drag, not a click.
      this.cancelNextClick = false;
      return;
    }

    const mouse = new three.Vector2();
    const el: HTMLElement = event.target as any;

    // Normalize coordinates to [-1, +1].
    mouse.x = event.offsetX / el.offsetWidth * 2 - 1;
    mouse.y = -(event.offsetY / el.offsetHeight) * 2 + 1;

    const raycaster = new three.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const intersections = raycaster.intersectObjects(this.scene.children, true);
    const groundObj = intersections.find(obj => obj.object.name === 'Land');
    const objects = intersections
      .map(intersect => this.checkParentsAndFaceForUserData(intersect))
      .filter(userData => !!userData);

    if (groundObj && event.ctrlKey) {
      const {x, z} = groundObj.point;
      const sumoPoint = this.transform.xzToSumoXy([x, z]);
      const latLng = this.transform.toLatLng([x, z]);
      this.params.onClick(latLng, sumoPoint, objects);
    } else {
      this.params.onClick(null, null, objects);
    }
  }

  getVehicleInfo(vehicleId: string): VehicleInfo {
    return this.vehicles[vehicleId].vehicleInfo;
  }

  onResize() {
    const width = this.parentElement.clientWidth;
    const height = this.parentElement.clientHeight;

    // resize WebGL canvas in response to window resizes
    this.renderer.setSize(width, height);

    this.postprocessing.onResize(width, height);

    // also readjust camera so images aren't stretched or squished
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
