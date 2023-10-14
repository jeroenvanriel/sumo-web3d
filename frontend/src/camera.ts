import * as three from 'three';
import { MapControls, OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import { ConfigManager } from './config';

export interface CameraSetpoint {
    position: three.Vector3,
    target: three.Vector3,
}

export class CameraManager {
    private camera: three.PerspectiveCamera;

    private controls_move: OrbitControls;
    private controls_zoom: TrackballControls;

    private configManager: ConfigManager;

    constructor(camera: three.PerspectiveCamera, configManager: ConfigManager, domElement : HTMLCanvasElement) {
        this.camera = camera;

        this.configManager = configManager;
        const folder = this.configManager.gui.addFolder('camera');
        folder.add(this, 'saveInitialSetpoint').name('set initial camera position')

        this.controls_move = new MapControls(this.camera, domElement);
        this.controls_move.enableDamping = true;
        this.controls_move.dampingFactor = 0.05;
        this.controls_move.screenSpacePanning = false;
        this.controls_move.enableZoom = false;
        this.controls_move.rotateSpeed = 0.5;
        this.controls_move.maxPolarAngle = 0.495 * Math.PI;
        
        this.controls_zoom = new TrackballControls(this.camera, domElement);
        this.controls_zoom.noRotate = true;
        this.controls_zoom.noPan = true;
        this.controls_zoom.noZoom = false;
        this.controls_zoom.zoomSpeed = 0.4;
        this.controls_zoom.dynamicDampingFactor = 0.05; // set dampening factor
        this.controls_zoom.minDistance = 10;
        this.controls_zoom.maxDistance = 1000;
    }

    loadFromFile() {
        if (this.configManager.config.initialCameraSetpoint) {
            const { position, target } = this.configManager.config.initialCameraSetpoint;
            this.camera.position.copy(position);
            this.controls_move.target.copy(target);
            return true;
        }
        return false;
    }

    saveInitialSetpoint() {
        this.configManager.config.initialCameraSetpoint = {
            position: this.camera.position,
            target: this.controls_move.target,
        };
        this.configManager.saveToFile();
    }

    update(following: three.Object3D | null) {
        // update camera position when following
        // and synchronize movement and zooming controllers
        let target = new three.Vector3();
        if (following) {
            following.getWorldPosition(target);
            this.controls_move.enablePan = false;
            this.controls_move.target.copy(target);
            this.controls_move.update();
        } else {
            this.controls_move.enablePan = true;
            this.controls_move.update();
            target = this.controls_move.target;
        }
        this.controls_zoom.target.set(target.x, target.y, target.z);
        this.controls_zoom.update();

        // const updatedTarget = target.add(new three.Vector3(0.1, 0, 0))
        // this.controls_move.target.copy(updatedTarget);
        this.controls_move.update()
    }

    focus(position: three.Vector3) {
      this.controls_move.target = position;
      this.controls_move.update();
    }

    // TODO: implement a sort of animation from a list of waypoints
    // add(setpoint: CameraSetpoint) {
    //     this.setpoints.push(setpoint)
    // }
}
