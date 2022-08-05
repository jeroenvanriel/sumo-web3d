// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
import * as three from 'three';

import {
  SelectiveBloomEffect,
  DepthOfFieldEffect,
  VignetteEffect,
  SMAAEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
} from 'postprocessing';

// TODO(canderson): magic numbers
const FOG_COLOR = 0xaaaaaa;
export const FOG_RATE = 0.0005;

export default class Effects {
  private camera: three.Camera;
  private scene: three.Scene;
  private renderer: three.WebGLRenderer;
  public composer: EffectComposer;

  public bloomEffect: SelectiveBloomEffect;

  private fog: three.FogExp2;

  constructor(
    camera: three.Camera,
    scene: three.Scene,
    renderer: three.WebGLRenderer,
    width: number,
    height: number,
  ) {
    this.camera = camera;
    this.scene = scene;
    this.renderer = renderer;

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = three.PCFSoftShadowMap;

    this.scene.fog = this.fog = new three.FogExp2(FOG_COLOR, FOG_RATE);

    this.initPostprocessing(width, height);
    this.onResize(width, height);
  }

  private initPostprocessing(width: number, height: number) {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomEffect = new SelectiveBloomEffect(this.scene, this.camera);
    this.bloomEffect.inverted = true;

    const depthOfFieldEffect = new DepthOfFieldEffect(this.camera, {
			focalLength: 0.018,
			bokehScale: 2.0,
      width, height
		});

		const vignetteEffect = new VignetteEffect({
			eskil: false,
			offset: 0.35,
			darkness: 0.2
		});

    this.composer.addPass(new EffectPass(
			this.camera,
			depthOfFieldEffect,
			vignetteEffect,
      new SMAAEffect(),
      this.bloomEffect,
		));
  }

  render() {
    this.composer.render();
  }

  onResize(width: number, height: number) {
    const pixelRatio = window.devicePixelRatio;
    const newWidth = Math.floor(width * pixelRatio) || width;
    const newHeight = Math.floor(height * pixelRatio) || height;
    this.composer.setSize(newWidth, newHeight);
  }
}
