// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
/** This module loads all the resources which are needed to initialize the microsim UI. */

import * as _ from 'lodash';
import * as three from 'three';

import {AdditionalResponse, Network, LaneMap, ScenarioName, SimulationState, SumoSettings} from './api';
import {loadOBJFile} from './three-utils';
import {promiseObject, FeatureCollection} from './utils';

import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader';
import {MTLLoader} from 'three/examples/jsm/loaders/MTLLoader';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader';

import { SUPPORTED_VEHICLE_TYPES, MODELS } from './constants';
import { Color, Mesh, MeshPhongMaterial, Object3D } from 'three';

export interface ModelParams {
  objectUrl: string;
  materialUrl?: string;
  scale?: number;
  position?: { x: number, y: number, z: number };
  offsetY?: number,
  baseColor?: Color,
  baseColorPart?: string,
}

export interface Model extends ModelParams {
  object: three.Object3D | three.Mesh | three.Group,
}

export interface SupportedVehicle {
  label: string; // colloquial name, for display use only
  models: ModelParams[];
}

export interface InitResources {
  availableScenarios: ScenarioName[];
  settings: SumoSettings | null;
  network: Network;
  vehicles: {[vehicleType: string]: Model[]};
  models: {[name: string]: Model};
  additional: AdditionalResponse | null;
  lanemap: LaneMap | null,
  arrows: {
    left: three.Object3D;
    right: three.Object3D;
    uturn: three.Object3D;
    straight: three.Object3D;
  };
  water: FeatureCollection;
  simulationState: SimulationState;
  webSocket: WebSocket;
  reactRootEl: HTMLElement;
  sumoRootEl: HTMLElement;
  isProjection: boolean;
}

const {hostname} = window.location;
const WEB_SOCKETS_ENDPOINT = `ws://${hostname}:8080/ws`;

const textureLoader = new three.TextureLoader();
const mtlLoader = new MTLLoader();

function getOrThrow(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Unable to get element #${id}.`);
  }
  return el;
}

function loadMaterial(url: string): three.MeshBasicMaterial {
  return new three.MeshBasicMaterial({
    map: textureLoader.load(url),
  });
}

async function loadObjMtl(objFile: string, mtlFile: string): Promise<three.Object3D> {
  return new Promise<three.Object3D>((resolve, reject) => {
    mtlLoader.load(
      mtlFile,
      materialLoader => {
        materialLoader.preload();
        _.forEach(materialLoader.materials, (material) => {
          material.side = three.DoubleSide;
          (material as MeshPhongMaterial).shininess = 50;
        });
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materialLoader);
        objLoader.load(
          objFile,
          obj => {
            resolve(obj);
          },
          () => {},
          reject,
        );
      },
      () => {},
      reject,
    );
  });
}

async function loadGlb(file: string): Promise<three.Object3D> {
  return new Promise<three.Object3D>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(file, function(gltf) {
      resolve(gltf.scene);
    }, undefined, function(error) {
      console.error(error);
      reject();
    });
  });
}

async function loadObject3D(params: ModelParams): Promise<Model> {
  const { objectUrl, materialUrl, scale } = params;
  let object = new Object3D();

  if (objectUrl.endsWith('.obj')) {
    if (materialUrl) {
      if (materialUrl.endsWith('.mtl')) {
        object = await loadObjMtl(objectUrl, materialUrl);
      } else {
        object = await loadOBJFile(objectUrl, loadMaterial(materialUrl));
      }
    } else {
      object = await loadOBJFile(objectUrl);
    }
  } else if (objectUrl.endsWith('.glb')) {
    object = await loadGlb(objectUrl);
  } else {
    console.error("Cannot determine 3D object file type.")
  }

  if (scale && object) {
    object.scale.multiplyScalar(scale);
  }

  return { object: object, ...params };
}

/** Set the `castShadow` property to true on all relevant children. */
async function enableVehicleShadows(model: Promise<Model>) {
  const object = (await model).object;
  if (object != null)
    _.forEach(object.children[0].children, child => child.castShadow = true);
  return model;
}

function loadVehicles(): {[vehicleType: string]: Promise<Model[]>} {
  // map each vehicle type to an array of all possible models
  return _.mapValues(SUPPORTED_VEHICLE_TYPES, (v, k) =>
    Promise.all(
      _.map(v.models, model => enableVehicleShadows(loadObject3D(model)))
    )
  );
}

function loadModels(): {[name: string]: Promise<Model>} {
  return _.mapValues(MODELS, (v, k) => loadObject3D(v));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (response.status !== 200) {
    console.log('non-200', url);
    throw new Error(`Unable to load ${url}, response: ${response}`);
  }
  const val = (await response.json()) as T;
  console.log(`Loaded ${url}`);
  return val;
}

async function fetchJsonAllowFail<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (response.status === 404) {
    console.log(`Request for ${url} 404'd.`);
    return null;
  }
  const val = (await response.json()) as T;
  console.log(`Loaded ${url}`);
  return val;
}

export default async function init(): Promise<InitResources> {
  const loadStartMs = window.performance.now();
  const simulationState = await fetchJson<SimulationState>('/state');
  const network = await fetchJson<Network>('network');
  const isProjection =
    network.net.location.projParameter.length > 0 && network.net.location.projParameter !== '!';

  const domPromise = new Promise((resolve, reject) => {
    if (document.readyState !== 'loading') {
      resolve(true);
    } else {
      window.addEventListener('DOMContentLoaded', resolve);
    }
  });

  const webSocket = new WebSocket(WEB_SOCKETS_ENDPOINT);
  const webSocketPromise = new Promise((resolve, reject) => {
    webSocket.onopen = () => resolve(webSocket);
    webSocket.onerror = reject;
  });

  try {
    const {dom, ...resources} = await promiseObject({
      additional: fetchJsonAllowFail<AdditionalResponse>('additional'),
      availableScenarios: fetchJson<ScenarioName[]>('/scenarios'),
      vehicles: promiseObject(loadVehicles()),
      models: promiseObject(loadModels()),
      water: fetchJson<FeatureCollection>('water'),
      settings: fetchJsonAllowFail<SumoSettings>('settings'),
      lanemap: fetchJsonAllowFail<LaneMap>('lanemap'),
      arrows: promiseObject({
        left: loadOBJFile('/arrows/LeftArrow.obj'),
        right: loadOBJFile('/arrows/RightArrow.obj'),
        uturn: loadOBJFile('/arrows/UTurnArrow.obj'),
        straight: loadOBJFile('/arrows/StraightArrow.obj'),
      }),
      dom: domPromise,
      webSocket: webSocketPromise,
    });

    getOrThrow('loading').remove();

    const loadEndMs = window.performance.now();
    console.log('Loaded static resources in ', loadEndMs - loadStartMs, ' ms.');

    return {
      ...resources,
      simulationState,
      network,
      webSocket,
      isProjection,
      reactRootEl: getOrThrow('sidebar'),
      sumoRootEl: getOrThrow('canvas-wrapper'),
    };
  } catch (e) {
    webSocket.close();
    throw e;
  }
}
