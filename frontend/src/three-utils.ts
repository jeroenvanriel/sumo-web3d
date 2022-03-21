// Copyright 2018 Sidewalk Labs | http://www.eclipse.org/legal/epl-v20.html
/**
 * Utility code for working with three.js.
 */
import * as three from 'three';
import * as _ from 'lodash';

const extrudePolyline = require('extrude-polyline');

import {Transform} from './coords';
import { sub, dot, rotateCW, findClosestPoint, polylineDistance } from './geometry';
import {Feature} from './utils';

import { BufferGeometry, Float32BufferAttribute } from 'three';

function shapeFromVertices(vertices: number[][]) {
  const shape = new three.Shape();
  shape.moveTo(vertices[0][0], vertices[0][1]);
  for (let i = 1; i < vertices.length; i++) {
    const [x, y] = vertices[i];
    shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

// Add UV mappings to geometries which lack them.
function addUVMappingToGeometry(geometry: three.Geometry) {
  // See https://stackoverflow.com/a/27317936/388951
  geometry.computeBoundingBox();
  const {min, max} = geometry.boundingBox;
  const offset = new three.Vector2(0 - min.x, 0 - min.y);
  const range = new three.Vector2(max.x - min.x, max.y - min.y);
  const faces = geometry.faces;

  geometry.faceVertexUvs[0] = [];

  for (let i = 0; i < faces.length; i++) {
    const v1 = geometry.vertices[faces[i].a];
    const v2 = geometry.vertices[faces[i].b];
    const v3 = geometry.vertices[faces[i].c];

    geometry.faceVertexUvs[0].push([
      new three.Vector2((v1.x + offset.x) / range.x, (v1.y + offset.y) / range.y),
      new three.Vector2((v2.x + offset.x) / range.x, (v2.y + offset.y) / range.y),
      new three.Vector2((v3.x + offset.x) / range.x, (v3.y + offset.y) / range.y),
    ]);
  }
  geometry.uvsNeedUpdate = true;
}

// For an extruded geometry, we do UV mapping differently for the top/bottom and the sides.
// For the top/bottom, mapping the x/y coordinates directly produces reasonable results.
// For the sides, "u" follows the perimeter of the polygon while "v" corresponds to the height.
function addUVMappingToExtrudedGeometry(
  geometry: three.ExtrudeGeometry,
  vertices: number[][],
  sideScale: number,
  topBottomScale: number,
) {
  geometry.computeBoundingBox();
  const {min} = geometry.boundingBox;
  const offset = new three.Vector3(0 - min.x, 0 - min.y, 0 - min.z);
  const faces = geometry.faces;

  geometry.faceVertexUvs[0] = [];
  for (const face of faces) {
    const v1 = geometry.vertices[face.a];
    const v2 = geometry.vertices[face.b];
    const v3 = geometry.vertices[face.c];

    // The faces can be distinguished by their normal vectors. For the sides, these point out.
    if (face.normal.z === 0) {
      // It's a side. u should follow the polyline around,
      // whereas v should go up with the z-coordinate.
      const d1 = polylineDistance(vertices, [v1.x, v1.y], true);
      const d2 = polylineDistance(vertices, [v2.x, v2.y], true);
      const d3 = polylineDistance(vertices, [v3.x, v3.y], true);
      geometry.faceVertexUvs[0].push([
        new three.Vector2(d1.dLine * sideScale, v1.z * sideScale),
        new three.Vector2(d2.dLine * sideScale, v2.z * sideScale),
        new three.Vector2(d3.dLine * sideScale, v3.z * sideScale),
      ]);
    } else {
      // It's either the top or bottom. Use the x/y coordinates.
      geometry.faceVertexUvs[0].push([
        new three.Vector2((v1.x + offset.x) * topBottomScale, (v1.y + offset.y) * topBottomScale),
        new three.Vector2((v2.x + offset.x) * topBottomScale, (v2.y + offset.y) * topBottomScale),
        new three.Vector2((v3.x + offset.x) * topBottomScale, (v3.y + offset.y) * topBottomScale),
      ]);
    }
  }
  geometry.uvsNeedUpdate = true;
}

// Add UV mappings to polyline geometries.
// The "u" dimension follows the path of the polyline,
// while the "v" dimension is perpendicular to it.
// The "v" values go from 0 to 1, while the "u" values go from zero to the length of the polyline.
// The idea is that the "u" direction will be repeated, whereas the "v" direction will not.
// The scaling of the "u" values can be adjusted with the uScaleFactor parameter.
function addUVMappingToGeometryWithPolyline(
  geometry: three.BufferGeometry,
  points: number[][],
  width: number,
  uScaleFactor: number,
  transform: Transform,
) {
  const indices = geometry.getIndex();
  if (indices === null) {
    // TODO(Jeroen): what to do in this case?
    console.error("no indexed faces")
    return
  }

  const positions = geometry.getAttribute('position');
  const uvs = new Array(positions.count * 2);

  for (let i = 0; i < indices.count; i++) {
    // vertex index
    const vi = indices.array[i];
    
    const vx = positions.array[3*vi + 0];
    const vz = positions.array[3*vi + 2];

    // TODO(danvk): it's a little gross that the transform is here.
    const d = polylineDistance(points, [vx, transform.bottom - vz]);

      // Scale dLine as requested. Rescale dPerp to go from 0 to 1.
    uvs[2*vi + 0] = (d.dLine * uScaleFactor);
    uvs[2*vi + 1] = (d.dPerp / width + 0.5);
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
}

/** Return a flat mesh from a polygon's vertices. The polygon will have y=0. */
export function flatMeshFromVertices(vertices: number[][], material: three.Material) {
  const shape = shapeFromVertices(vertices);
  const geometry = new three.ShapeGeometry(shape);
  addUVMappingToGeometry(geometry);

  const mesh = new three.Mesh(geometry, material);
  mesh.material.side = three.DoubleSide; // visible from above and below.
  mesh.geometry.rotateX(Math.PI / 2);
  return mesh;
}

export function flatRectMesh(
  {top, left, right, bottom}: {top: number; left: number; right: number; bottom: number},
  material: three.Material,
) {
  return flatMeshFromVertices(
    [[left, top], [right, top], [right, bottom], [left, bottom]],
    material,
  );
}

/** Creates a shape with y=0 and extrudes it up to y=height */
export function extrudedMeshFromVertices(
  vertices: number[][],
  height: number,
  topBottomUVScale: number,
  sideUVScale: number,
  materials: three.Material[],
) {
  const shape = shapeFromVertices(vertices);
  const geometry = new three.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  addUVMappingToExtrudedGeometry(geometry, vertices, topBottomUVScale, sideUVScale);
  const mesh = new three.Mesh(geometry, materials as any);
  mesh.rotation.set(Math.PI / 2, 0, 0);
  mesh.position.setY(height);
  return mesh;
}

export interface LineParams {
  width: number;
  uScaleFactor?: number;
}

/** Create an object from an array of 2D or 3D points in SUMO coordinates. */
export function lineString(
  points: number[][],
  transform: Transform,
  params: LineParams,
): three.BufferGeometry {
  const simplicialComplex = extrudePolyline({
    thickness: params.width,
    // TODO(danvk): figure out what good values for cap/join/miterLimit are.
    cap: 'butt',
    join: 'bevel',
    miterLimit: 10,
  }).build(points);

  // Translate from SUMO coordinates to three.js coordinates.
  simplicialComplex.positions = simplicialComplex.positions.map((position: number[]) => {
    const xyz = transform.xyToXyz(position);
    const closestPoint = findClosestPoint(xyz, points);
    return [xyz[0], closestPoint && closestPoint[2] ? closestPoint[2] : 0, xyz[2]];
  });

  const geometry: three.BufferGeometry = new BufferGeometry();

  // flatten positions array into BufferAttribute
  const vertices : number[] = _.flatten(simplicialComplex.positions);
  geometry.setAttribute('position', new three.Float32BufferAttribute(vertices, 3));

  // add faces(/cells)
  const indices = [];
  for (let i = 0; i < simplicialComplex.cells.length; i++) {
    var face = simplicialComplex.cells[i];
    // extract the x- and z-coordinates to determine the orientation
    // face[i] gives index of vertex
    // p[face[i]] gives x,y,z
    let p = simplicialComplex.positions;
    let a = [p[face[0]][0], p[face[0]][2]];
    let b = [p[face[1]][0], p[face[1]][2]];
    let c = [p[face[2]][0], p[face[2]][2]];

    // make sure that all faces have the same orientation
    // we perform an orientation test on vertices a, b, c
    // to determine CW or CCW
    if (dot(rotateCW(sub(b, a)), sub(c, b)) < 0) {
      indices.push(face[0], face[1], face[2]);
    } else {
      indices.push(face[2], face[1], face[0]);
    }
  }
  geometry.setIndex(indices);

  geometry.computeVertexNormals();

  addUVMappingToGeometryWithPolyline(
    geometry,
    points,
    params.width,
    params.uScaleFactor || 1,
    transform,
  );

  return geometry;
}

function polygonToShape(coordinates: number[][][]): three.Shape {
  const outer = shapeFromVertices(coordinates[0]);
  for (let i = 1; i < coordinates.length; i++) {
    const inner = shapeFromVertices(coordinates[i]);
    outer.holes.push(inner);
  }
  return outer;
}

/** Convert a GeoJSON feature toa  three.js Geometry */
export function featureToGeometry(feature: Feature): three.BufferGeometry {
  const geometry = feature.geometry;
  if (geometry.type === 'MultiPolygon') {
    const coordinates: number[][][][] = geometry.coordinates;
    const shapes = coordinates.map(polygonToShape);
    const geom = new three.ShapeGeometry(shapes);
    addUVMappingToGeometry(geom);
    return geom;
  } else if (geometry.type === 'Polygon') {
    const coordinates: number[][][] = geometry.coordinates;
    const shape = polygonToShape(coordinates);
    const geom = new three.ShapeGeometry(shape);
    addUVMappingToGeometry(geom);
    return geom;
  } else {
    throw new Error(`Geometry type ${geometry.type} not supported.`);
  }
}

const OBJ_LOADER = new three.OBJLoader();

/** Load an OBJ file, returning a Promise for it. Optionally adds a material. */
export function loadOBJFile(url: string, material?: three.Material): Promise<three.Object3D> {
  return new Promise<three.Object3D>((resolve, reject) => {
    OBJ_LOADER.load(
      url,
      obj => {
        if (material) {
          setMaterial(obj, material);
        }
        resolve(obj);
      },
      () => {},
      reject,
    );
  });
}

/** Set a material on all meshes in an object. */
export function setMaterial(obj: three.Object3D, material: three.Material) {
  obj.traverse(child => {
    if (child instanceof three.Mesh) {
      child.material = material;
    }
  });
}

/** Merge the mesh into the geometry, copying its userData onto the new faces. */
export function mergeMeshWithUserData(geometry: three.Geometry, mesh: three.Mesh) {
  const numFaces = geometry.faces.length;
  geometry.mergeMesh(mesh);
  for (let i = numFaces; i < geometry.faces.length; i++) {
    (geometry.faces[i] as any).userData = mesh.userData;
  }
  return geometry;
}
