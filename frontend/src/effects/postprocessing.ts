// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
import * as dat from 'dat.gui/build/dat.gui.js';
import * as three from 'three';

// import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass';
// import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';

import { SMAAEffect, BloomEffect, DepthOfFieldEffect, EffectComposer, EffectPass, RenderPass } from "postprocessing";
import {
	BlendFunction,
	DepthEffect,
	EdgeDetectionMode,
	KernelSize,
	SMAAImageLoader,
	SMAAPreset,
	TextureEffect,
	VignetteEffect
} from 'postprocessing';


// TODO(canderson): magic numbers
const FOG_COLOR = 0xaaaaaa;
export const FOG_RATE = 0.0005;

export const ENTIRE_SCENE = 0, BLOOM_SCENE = 1;
const DARK_MATERIAL = new three.MeshBasicMaterial( { color: "black" } );

export default class Effects {
  private camera: three.Camera;
  private scene: three.Scene;
  private renderer: three.WebGLRenderer;
  private gui: typeof dat.gui.GUI;

  private bloomLayer = new three.Layers();
  private materials: { [id: string]: three.Material } = {};

  private depthMaterial: three.MeshDepthMaterial;
  private depthRenderTarget: three.WebGLRenderTarget;
  private composer: EffectComposer;
  private bloomComposer: EffectComposer;

  private effectsEnabled: {
    ssao: boolean;
    smaa: boolean;
    fog: boolean;
  };
  private ssaoPass: SSAOPass;
  private ssaoParams: {
    cameraNear: number;
    cameraFar: number;
    radius: number;
    size: number;
    aoClamp: number;
    lumInfluence: number;
    onlyAO: boolean;
  };
  private smaaPass: SMAAPass;
  private fog: three.FogExp2;

  constructor(
    camera: three.Camera,
    scene: three.Scene,
    renderer: three.WebGLRenderer,
    gui: typeof dat.gui.GUI,
    width: number,
    height: number,
    centerX: number,
    centerZ: number,
  ) {
    this.camera = camera;
    this.scene = scene;
    this.renderer = renderer;
    this.gui = gui;

    this.bloomLayer.set( BLOOM_SCENE );

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = three.PCFSoftShadowMap;

    this.scene.fog = this.fog = new three.FogExp2(FOG_COLOR, FOG_RATE);

    this.depthMaterial = new three.MeshDepthMaterial();
    this.depthMaterial.depthPacking = three.RGBADepthPacking;
    this.depthMaterial.blending = three.NoBlending;
    this.depthRenderTarget = new three.WebGLRenderTarget(width, height, {
      minFilter: three.LinearFilter,
      magFilter: three.LinearFilter,
      format: three.RGBAFormat,
    });

    this.initPostprocessing(width, height);
    this.onResize(width, height);

    // this.renderBloom = this.renderBloom.bind(this);
    // this.darkenNonBloomed = this.darkenNonBloomed.bind(this);
    // this.restoreMaterial = this.restoreMaterial.bind(this);
  }

  private initPostprocessing(width: number, height: number) {
    const effectsFolder = this.gui.addFolder('Effects');
    const ssaoFolder = this.gui.addFolder('SSAO');
    const bloomFolder = this.gui.addFolder('Bloom');

    // Render pass
    const renderPass = new RenderPass(this.scene, this.camera);

    // Screen Space Ambient Occlusion approximates true ambient occlusion, which is the fact
    // that ambient light does not travel to interiors.
    this.ssaoPass = new SSAOPass( this.scene, this.camera, width, height );

    ssaoFolder.add( this.ssaoPass, 'kernelSize' ).min( 0 ).max( 32 );
    ssaoFolder.add( this.ssaoPass, 'kernelRadius' ).min( 0 ).max( 32 );
    ssaoFolder.add( this.ssaoPass, 'minDistance' ).min( 0.001 ).max( 0.02 );
    ssaoFolder.add( this.ssaoPass, 'maxDistance' ).min( 0.01 ).max( 1.3 );

    // Subpixel Morphological Antialiasing is an efficient technique to provide antialiasing.
    this.smaaPass = new SMAAPass(width, height);

    // this.composer = new EffectComposer( this.renderer );
    // this.composer.addPass(renderPass);
    // this.composer.addPass(this.smaaPass);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const depthOfFieldEffect = new DepthOfFieldEffect(this.camera, {
			focusDistance: 0.0,
			focalLength: 0.018,
			bokehScale: 2.0,
			height: 480
		});

		const depthEffect = new DepthEffect({
			blendFunction: BlendFunction.SKIP
		});

		const vignetteEffect = new VignetteEffect({
			eskil: false,
			offset: 0.35,
			darkness: 0.5
		});

		const effectPass = new EffectPass(
			this.camera,
      new BloomEffect(),
			// depthOfFieldEffect,
			// vignetteEffect,
			depthEffect,
      new SMAAEffect()
		);
    this.composer.addPass(effectPass);


    // // Bloom 
    // const bloomPass = new UnrealBloomPass(new three.Vector2( window.innerWidth, window.innerHeight ), 1.5, 0.4, 0.85);
    // bloomFolder.add( bloomPass, 'threshold' ).min( 0 ).max( 1 );
    // bloomFolder.add( bloomPass, 'strength' ).min( 0 ).max( 3 );
    // bloomFolder.add( bloomPass, 'radius' ).min( 0 ).max( 1 );

    // this.bloomComposer = new EffectComposer(this.renderer);
    // this.bloomComposer.renderToScreen = false;
    // this.bloomComposer.addPass(renderPass);
    // this.bloomComposer.addPass(bloomPass);
    // this.composer.addPass(this.ssaoPass);
    // this.composer.addPass(this.smaaPass);

    // const finalPass = new ShaderPass(
		// 		new three.ShaderMaterial( {
		// 			uniforms: {
		// 				baseTexture: { value: null },
		// 				bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
		// 			},
		// 			vertexShader: `
    //         varying vec2 vUv;

    //         void main() {

    //           vUv = uv;

    //           gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

    //         }
    //       `,
		// 			fragmentShader: `
    //         uniform sampler2D baseTexture;
    //         uniform sampler2D bloomTexture;

    //         varying vec2 vUv;

    //         void main() {

    //           gl_FragColor = ( texture2D( baseTexture, vUv ) + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );

    //         }
    //       `,
		// 			defines: {}
		// 		} ), "baseTexture"
		// 	);
		// 	finalPass.needsSwap = true;

		// 	this.composer = new EffectComposer( this.renderer );
		// 	this.composer.addPass( renderPass );
		// 	this.composer.addPass( finalPass );

    this.effectsEnabled = {
      ssao: true,
      smaa: true,
      fog: true,
    };
    effectsFolder.add(this.effectsEnabled, 'smaa').onChange((v: boolean) => {
      this.smaaPass.enabled = v;
    });
    effectsFolder.add(this.effectsEnabled, 'ssao').onChange((v: boolean) => {
      this.ssaoPass.enabled = v;
    });
    effectsFolder.add(this.effectsEnabled, 'fog').onChange((v: boolean) => {
      if (v) {
        this.scene.fog = this.fog;
      } else {
        this.scene.fog = null as any;
      }
    });
  }

  // renderBloom( mask: boolean ) {

	// 			if ( mask === true ) {

	// 				this.scene.traverse( this.darkenNonBloomed );
  //         const background = this.scene.background;
  //         this.scene.background = new three.Color('black');
	// 				this.bloomComposer.render();
	// 				this.scene.traverse( this.restoreMaterial );
  //         this.scene.background = background;

	// 			} else {

	// 				this.camera.layers.set( ENTIRE_SCENE );
	// 				this.bloomComposer.render();
	// 				this.camera.layers.set( BLOOM_SCENE );

	// 			}

	// 		}

  // darkenNonBloomed( obj: any) {

  //   if ( obj.isMesh && this.bloomLayer.test( obj.layers ) === true ) {

  //     this.materials[ obj.uuid ] = obj.material;
  //     obj.material = DARK_MATERIAL;

  //   }

  // }

  // restoreMaterial( obj: any) {

  //   if ( this.materials[ obj.uuid ] ) {

  //     obj.material = this.materials[ obj.uuid ];
  //     delete this.materials[ obj.uuid ];

  //   }

  // }

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
