// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
/**
 * Materials used in three.js scenes.
 */
import * as three from 'three';

const textureLoader = new three.TextureLoader();

const loadRepeatedTexture = (url: string) =>
  textureLoader.load(url, texture => {
    texture.wrapS = texture.wrapT = three.RepeatWrapping;
  });

const railroadTie = loadRepeatedTexture('/textures/rail64.png');
const sidewalkTexture = loadRepeatedTexture('/textures/sidewalk256.jpg');
const asphaltTexture = loadRepeatedTexture('/textures/asphalt256.jpg');
const asphaltTexture2 = loadRepeatedTexture('/textures/asphalt.png');
asphaltTexture2.encoding = three.sRGBEncoding;
const crossingTexture = loadRepeatedTexture('/textures/zebra.jpg');
// const grassTexture = loadRepeatedTexture('/grass/GrassGreenTexture0001.jpg')
const grassTexture = loadRepeatedTexture('/textures/grass/grass.jpg')
grassTexture.repeat.set(0.1,0.1);
grassTexture.encoding = three.sRGBEncoding;

export const LAND = new three.MeshPhysicalMaterial({
  map: grassTexture,
  side: three.DoubleSide, // one side is visible from above, the other casts shadows.
  // color: 0x88ff88,
  metalness: 0.1,
  roughness: 1.0,
  clearcoat: 0.1,
  clearcoatRoughness: 1.0,
  reflectivity: 0.05,
  // We use polygonOffset to counter z-fighting with roadways.
  polygonOffset: true,
  polygonOffsetFactor: +2,
  polygonOffsetUnits: 1,
});
export const WATER = new three.MeshPhysicalMaterial({
  side: three.DoubleSide,
  color: 0xaaaaaa,
  metalness: 0,
  roughness: 0.8,
  clearcoat: 0.7,
  clearcoatRoughness: 0.5,
  reflectivity: 0.9,
});
export const BUILDING_TOP = new three.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0.8,
  clearcoat: 0.6,
  clearcoatRoughness: 1.0,
  reflectivity: 0.2,
});
export const BUILDING_SIDE = new three.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0.8,
  clearcoat: 0.6,
  clearcoatRoughness: 1.0,
  reflectivity: 0.2,
});

export const BUILDING = [BUILDING_TOP, BUILDING_SIDE];

// export const ROAD = new three.MeshPhysicalMaterial({
//   map: asphaltTexture,
//   side: three.DoubleSide, // one side is visible from above, the other casts shadows.
//   metalness: 0,
//   roughness: 0.8,
//   clearcoat: 0.6,
//   clearcoatRoughness: 1.0,
//   reflectivity: 0.2,
// });
export const BUS_STOP = new three.MeshPhysicalMaterial({
  side: three.DoubleSide,
  color: 0xdddd00,
});
export const CYCLEWAY = new three.MeshPhysicalMaterial({
  color: 0xaa0000,
  side: three.DoubleSide,
});
export const CROSSING = new three.MeshPhysicalMaterial({
  map: crossingTexture,
  side: three.DoubleSide, // one side is visible from above, the other casts shadows.
  metalness: 0,
  roughness: 0.8,
  clearcoat: 0.6,
  clearcoatRoughness: 1.0,
  reflectivity: 0.2,
  polygonOffset: true, // this resolves z-fighting between crosswalks and junctions.
  polygonOffsetFactor: -3,
  polygonOffsetUnits: 1,
});
export const RAILWAY = new three.MeshPhysicalMaterial({
  map: railroadTie,
  transparent: true,
  side: three.DoubleSide,
});
export const WALKWAY = new three.MeshPhysicalMaterial({
  map: sidewalkTexture,
  side: three.DoubleSide,
});
export const HIGHLIGHT = new three.MeshPhysicalMaterial({
  color: 0xff0000,
  depthTest: true,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: 1.1,
  transparent: true,
  opacity: 0.9,
  side: three.DoubleSide,
});
// export const JUNCTION = new three.MeshPhysicalMaterial({
//   color: 0x272727,
//   reflectivity: 0.2,
//   polygonOffset: true, // this resolves z-fighting between the junctions and street.
//   polygonOffsetFactor: -2,
//   polygonOffsetUnits: 1,
// });

export const TRAFFIC_LIGHTS: {[color: string]: three.MeshLambertMaterial} = {
  g: new three.MeshLambertMaterial({
    color: 0x00ff00,
    side: three.DoubleSide,
  }),
  y: new three.MeshLambertMaterial({
    color: 0xffff00,
    side: three.DoubleSide,
  }),
  r: new three.MeshLambertMaterial({
    color: 0xff0000,
    side: three.DoubleSide,
  }),
  x: new three.MeshLambertMaterial({
    color: 0x000000,
    side: three.DoubleSide,
  }),
};


export const getGradientMaterial = function(length: number) {
  const vertexShader = `
    varying vec2 vUv;

    void main() {
      vUv = uv;

      vec4 localPosition = vec4( position, 1.);
      vec4 worldPosition = modelMatrix * localPosition;

      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`

  const fragmentShader = `
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform float length;
    uniform float gradientScale;
    uniform float gradients[30];
    uniform int nGradients;

    uniform sampler2D roadTexture;
    varying vec2 vUv;

    void main() {
      float i = (length - vUv.x) / length;
      float step = float(nGradients - 1);
      int il = int(floor(i * step));
      int ir = int(ceil(i * step));
      float gl = gradients[il];
      float gr = gradients[ir];
      float g = mix(gl, gr, mod(i * step, 1.0));

      vec4 overlayColor = vec4( mix( bottomColor, topColor, g * gradientScale), 1.0 );
      gl_FragColor = mix( overlayColor, texture2D(roadTexture, vUv), 0.5);
    }`

  const material = new three.ShaderMaterial({
    uniforms: {
      roadTexture: { value: asphaltTexture },
      bottomColor: { value: new three.Color(0, 0, 0) }, // low density
      topColor: { value: new three.Color(0, 1, 0) }, // high density
      length: { value: length }, // total lenght to draw (number of cars * lenght of car)
      gradientScale: { value: 1.0 }, // may be updated according to actual distribution
      gradients: { value: new Array(30) }, // provide the actual distribution here
      nGradients: { value: 30 }, // the actual number of gradient values provided
    },
    vertexShader,
    fragmentShader,
  });

  material.side = three.BackSide;
  return material;
}

const perlinNoise = `
  vec3 mod289(vec3 x)
  {
      return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 mod289(vec4 x)
  {
      return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 permute(vec4 x)
  {
      return mod289(((x*34.0)+1.0)*x);
  }

  vec4 taylorInvSqrt(vec4 r)
  {
      return 1.79284291400159 - 0.85373472095314 * r;
  }

  vec3 fade(vec3 t) {
      return t*t*t*(t*(t*6.0-15.0)+10.0);
  }

  // Classic Perlin noise
  float cnoise(vec3 P)
  {
      vec3 Pi0 = floor(P); // Integer part for indexing
      vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1
      Pi0 = mod289(Pi0);
      Pi1 = mod289(Pi1);
      vec3 Pf0 = fract(P); // Fractional part for interpolation
      vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
      vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
      vec4 iy = vec4(Pi0.yy, Pi1.yy);
      vec4 iz0 = Pi0.zzzz;
      vec4 iz1 = Pi1.zzzz;

      vec4 ixy = permute(permute(ix) + iy);
      vec4 ixy0 = permute(ixy + iz0);
      vec4 ixy1 = permute(ixy + iz1);

      vec4 gx0 = ixy0 * (1.0 / 7.0);
      vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
      gx0 = fract(gx0);
      vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
      vec4 sz0 = step(gz0, vec4(0.0));
      gx0 -= sz0 * (step(0.0, gx0) - 0.5);
      gy0 -= sz0 * (step(0.0, gy0) - 0.5);

      vec4 gx1 = ixy1 * (1.0 / 7.0);
      vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
      gx1 = fract(gx1);
      vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
      vec4 sz1 = step(gz1, vec4(0.0));
      gx1 -= sz1 * (step(0.0, gx1) - 0.5);
      gy1 -= sz1 * (step(0.0, gy1) - 0.5);

      vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
      vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
      vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
      vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
      vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
      vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
      vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
      vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

      vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
      g000 *= norm0.x;
      g010 *= norm0.y;
      g100 *= norm0.z;
      g110 *= norm0.w;
      vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
      g001 *= norm1.x;
      g011 *= norm1.y;
      g101 *= norm1.z;
      g111 *= norm1.w;

      float n000 = dot(g000, Pf0);
      float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
      float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
      float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
      float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
      float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
      float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
      float n111 = dot(g111, Pf1);

      vec3 fade_xyz = fade(Pf0);
      vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
      vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
      float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x); 
      return 2.2 * n_xyz;
  }
`

export const ROAD = function() {
  const vertexShader = [
    three.ShaderChunk.common,
    three.ShaderChunk.shadowmap_pars_vertex,
    `
    varying vec2 vUv;
    varying vec2 vPos;
    varying vec4 vWorldPos;
    varying vec3 vViewPosition;

    void main() {`,
    three.ShaderChunk.beginnormal_vertex,
    three.ShaderChunk.defaultnormal_vertex,
    `
    vUv = uv;
    vPos = position.xz;

    vec4 localPosition = vec4(position, 1.);
    `,
    three.ShaderChunk["begin_vertex"],
    three.ShaderChunk["worldpos_vertex"],
    `
    vWorldPos = worldPosition;

    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    vViewPosition = - mvPosition.xyz; // vector from vertex to camera

    gl_Position = projectionMatrix * modelViewMatrix * localPosition;
    `,
    three.ShaderChunk.shadowmap_vertex,
    `}`].join('\n');

  const fragmentShader = [
    perlinNoise,
    three.ShaderChunk.common,
    three.ShaderChunk.packing,
    three.ShaderChunk.lights_pars_begin,
    three.ShaderChunk.shadowmap_pars_fragment,
    three.ShaderChunk.shadowmask_pars_fragment,
    `
    uniform sampler2D roadTexture;
    varying vec2 vUv;
    varying vec2 vPos;
    varying vec4 vWorldPos;
    varying vec3 vViewPosition;

    void main() {
      vec4 white = vec4(1.0, 1.0, 1.0, 1.0);
      vec4 black = vec4(0.0, 0.0, 0.0, 1.0);

      // main asphalt texture darkened with black
      gl_FragColor = mix( texture2D(roadTexture, vPos / 10.0), black, 0.2);

      // global noise
      // float scale = 0.04;
      // float factor = 0.001 * cnoise(vec3(vPos.x * scale, vPos.y * scale, 0.0));
      // gl_FragColor = mix( gl_FragColor, white, factor );

      // local lane noise
      // factor = 0.15 * cnoise(vec3(vUv.y, vUv.y, vPos.x / 100.0 + vPos.y / 100.0));
      // float mask = 1.0 - (16.0 * (0.5 - vUv.x) * (0.5 - vUv.x) * (0.5 - vUv.x) * (0.5 - vUv.x));
      // gl_FragColor = mix( gl_FragColor, white, factor * mask );

      // striping
      // if (abs(vUv.y) < 0.1) {
      //   gl_FragColor = mix( gl_FragColor, white, 0.7);
      // }

      // if (abs(vUv.y) > 0.95 || abs(vUv.y) < 0.05) {
      if (abs(vUv.y) > 0.96) {
        // make sure to use an odd number
        if (mod(vUv.x * 31.0, 2.0) > 1.0) {
          gl_FragColor = mix( gl_FragColor, white, 0.7);
        }
      }

      // shadows
      gl_FragColor = mix( gl_FragColor, black, 1.0 - getShadowMask());
    }`].join('\n');

  const textures = { roadTexture: { value: null } };
  const uniforms = three.UniformsUtils.merge([
    textures,
    three.UniformsLib.common,
    three.UniformsLib.lights,
  ]);

  uniforms.roadTexture.value = asphaltTexture2;

  const material = new three.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    lights: true
  });

  material.side = three.BackSide;
  return material;
}()

export const JUNCTION = function() {
  const vertexShader = [
    three.ShaderChunk.common,
    three.ShaderChunk.shadowmap_pars_vertex,
    `
    varying vec2 vUv;
    varying vec2 vPos;

    void main() {`,
    three.ShaderChunk.beginnormal_vertex,
    three.ShaderChunk.defaultnormal_vertex,
    `
    vUv = uv;
    vPos = position.xz;

    vec4 localPosition = vec4(position, 1.);
    `,
    three.ShaderChunk.begin_vertex,
    three.ShaderChunk.worldpos_vertex,
    `
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    `,
    three.ShaderChunk.shadowmap_vertex,
    `}`].join('\n');

  const fragmentShader = [
    perlinNoise,
    three.ShaderChunk.common,
    three.ShaderChunk.packing,
    three.ShaderChunk.lights_pars_begin,
    three.ShaderChunk.shadowmap_pars_fragment,
    three.ShaderChunk.shadowmask_pars_fragment,
    `
    uniform sampler2D roadTexture;
    varying vec2 vUv;
    varying vec2 vPos;

    void main() {
      vec4 white = vec4(1.0, 1.0, 1.0, 1.0);
      vec4 black = vec4(0.0, 0.0, 0.0, 1.0);

      // main asphalt texture darkened with black
      gl_FragColor = mix( texture2D(roadTexture, vPos / 10.0), black, 0.2);

      // global noise
      // float scale = 0.04;
      // float factor = 0.05 * cnoise(vec3(vPos.x * scale, vPos.y * scale, 0.0));
      // gl_FragColor = mix( gl_FragColor, white, factor );

      // shadow
      gl_FragColor = mix( gl_FragColor, black, 1.0 - getShadowMask());
    }`].join('\n');

  const textures = { roadTexture: { value: null } };
  const uniforms = three.UniformsUtils.merge([
    textures,
    three.UniformsLib.common,
    three.UniformsLib.lights,
  ]);

  uniforms.roadTexture.value = asphaltTexture2;

  const material = new three.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    lights: true
  });

  material.side = three.BackSide;
  return material;
}()
