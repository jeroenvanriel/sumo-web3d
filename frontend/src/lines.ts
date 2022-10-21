import * as three from 'three';
import * as _ from 'lodash';
import * as clipperLib from 'js-angusj-clipper/web';
import { IntPoint, ReadonlyPath, ReadonlyPaths, EndType } from 'js-angusj-clipper';
import { parseShape } from './sumo-utils';
import { Net } from './api';
import { Transform } from './coords';

// clipper uses integer numbers, so we multiply
const SCALE = 1000;

const LINE_OFFSET = 0.08;
const LINE_WIDTH = 0.08;

function toClipper(points: number[][]) : IntPoint[] {
  return _.map(points, (point) => ({
    x: Math.round(SCALE * point[0]),
    y: Math.round(SCALE * point[1]),
  }));
}

function fromClipper(points: ReadonlyPath) : number[][] {
  return _.map(points, (point) => [
    point.x / SCALE,
    point.y / SCALE,
  ]);
}

/**
 * Determine the lines between lanes and edges.
 * We use a polygon/line clipping library (clipperjs) to determine the "seams"
 * between lanes and edges to construct an extruded line geometry.
 */
export async function getLines(net: Net, transform: Transform) : Promise<three.Mesh[]> {
  const clipper = await clipperLib.loadNativeClipperLibInstanceAsync(
    clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
  );

  function union(polygons: ReadonlyPaths) : ReadonlyPaths {
    const inputs = _.map(polygons, (polygon) => ({ data: polygon, closed: true }));
    const res = clipper.clipToPaths({
      clipType: clipperLib.ClipType.Union,
      subjectInputs: inputs,
      subjectFillType: clipperLib.PolyFillType.Positive
    });
    if (!res) throw Error('failed to union polygons');
    return res;
  }

  function extrudePolyline(line: ReadonlyPath, delta=2) : ReadonlyPath {
   const res = clipper.offsetToPaths({
      delta: delta,
      offsetInputs: [{
        data: line,
        joinType: clipperLib.JoinType.Square,
        endType: clipperLib.EndType.OpenButt
      }],
    });
    if (! res) throw Error('failed to extrude polyline');
    return res[0];
  }

  function offsetPolygon(polygon: ReadonlyPath, delta=2) : ReadonlyPath {
    const res = clipper.offsetToPolyTree({
      delta: delta,
      offsetInputs: [{
        data: polygon,
        joinType: clipperLib.JoinType.Round,
        endType: clipperLib.EndType.ClosedPolygon,
      }],
    });
    const contour = res?.getFirst()?.contour;
    if (! contour) throw Error('failed to offset polygon');
    return contour;
  }

  function intersection(poly1: ReadonlyPath, poly2: ReadonlyPath) : ReadonlyPaths {
    const in1 = { data: poly1, closed: true };
    const in2 = { data: poly2, closed: true };
    const res = clipper.clipToPaths({
      clipType: clipperLib.ClipType.Intersection,
      subjectInputs: [in1],
      clipInputs: [in2],
      subjectFillType: clipperLib.PolyFillType.Positive
    });
    if (! res) throw Error('failed to intersect polygons');
    return res;
  }

  /** Merge close vertices such that a very thin rectangle becomes an actual line. */
  function cleanLine(line: ReadonlyPath) {
    const points : Record<string, IntPoint> = {};
    _.forEach(line, point => {
      points[`${Math.round(point.x / 10)},${Math.round(point.y / 10)}`] = point;
    });
    return Object.values(points);
  }

  // skip `internal` edges
  const edges = _.filter(net.edge, edge => edge.function != 'internal');

  const edge_lane_polys = _.map(edges, (edge, id) => {
    // force array
    var lanes = Array.isArray(edge.lane) ? edge.lane : [edge.lane];
    return {
      id: edge.id,
      lanes: _.map(lanes, (lane, id) => {
        const points = parseShape(lane.shape);
        return extrudePolyline(toClipper(points), 1.6005 * SCALE);
      })
    };
  });

  // find intersection of lanes, we assume that lanes are ordered
  let lane_seams = _.flatten(_.map(edge_lane_polys, edge => {
    let lines = [];
    for (let i = 0; i < edge.lanes.length - 1; ++i) {
      const line = intersection(edge.lanes[i], edge.lanes[i+1])[0];
      lines.push(cleanLine(line));
    }
    return lines;
  }));

  // find intersection of edges and merge lanes
  let edge_polys: ReadonlyPath[] = [];
  let edge_seams: ReadonlyPath[] = [];
  let done: string[] = [];
  _.forEach(edge_lane_polys, edge => {
    // check if we already processed this edge
    if (done.includes(edge.id)) return
    done.push(edge.id);

    // merge lanes to form a single edge
    const lanes = union(edge.lanes);
    if (lanes) edge_polys.push(lanes[0]);

    // see if there is an opposite edge
    const opposite_id = edge.id[0] == '-' ? edge.id.slice(1) : `-${edge.id}`;
    const opposite = _.find(edge_lane_polys, e => e.id == opposite_id);
    if (! opposite) return // no opposite lane found

    // merge lanes of opposite edge
    const opposite_lanes = union(opposite.lanes);
    if (opposite_lanes) edge_polys.push(opposite_lanes[0]);

    // determine the line between both edges
    if (lanes && opposite_lanes) {
        const line = intersection(lanes[0], opposite_lanes[0])[0];
        edge_seams.push(cleanLine(line));
    }
  });

  // skip `dead_end` and `internal` junctions
  const junctions = _.filter(net.junction, junction => ['traffic_light', 'priority'].includes(junction.type));
  const junction_polys = _.map(junctions, junction => {
    const points = parseShape(junction.shape);
    return toClipper(points);
  });

  const junctions_inflated = _.map(junction_polys, p => offsetPolygon(p, 20));
  const merged_road: ReadonlyPaths = union([...edge_polys, ...junctions_inflated]);

  const lines_side: ReadonlyPath[] = _.map(merged_road, p => offsetPolygon(p, -LINE_OFFSET * SCALE));
  const lines_between = [...edge_seams, ...lane_seams];

  /** Extrude a line, results in possibly multiple paths (contour and holes). */
  function extrudeLine(line: ReadonlyPath, endType: EndType) : ReadonlyPaths {
    const res = clipper.offsetToPaths({
        delta: LINE_WIDTH * SCALE,
        offsetInputs: [{
            data: line,
            joinType: clipperLib.JoinType.Square,
            endType: endType,
        }],
    });
    if (! res) throw Error('failed to extrude line');
    return res;
  }

  // extrude lines
  const line_polys: ReadonlyPaths[] = [
    ..._.map(lines_side, l => extrudeLine(l, clipperLib.EndType.ClosedLine)),
    ..._.map(lines_between, l => extrudeLine(l, clipperLib.EndType.OpenButt)),
  ]

  function polygonToMesh(polygon: ReadonlyPaths, material: three.Material) {
    let outer = [];
    let holes: three.Path[] = [];

    // check if this is a polygon with holes (then the polygons after the first define holes)
    if (polygon.length > 1) {
      // first one is the outer boundary
      outer = _.map(fromClipper(polygon[0]), (point) => new three.Vector2( point[0], point[1] ));

      // the rest of the polygons define the holes
      _.forEach(polygon.slice(1), p => {
        const points = _.map(fromClipper(p), (point) => new three.Vector2( point[0], point[1] ));
        const path = new three.Path(points);
        holes.push(path);
      });
    } else {
      outer = _.map(fromClipper(polygon[0]), (point) => new three.Vector2( point[0], point[1] ));
    }

    const shape = new three.Shape(outer);
    shape.holes = holes;
    
    const geometry = new three.ShapeGeometry( shape );
    material.side = three.DoubleSide;
    const mesh = new three.Mesh( geometry, material );
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.translateY(-transform.bottom);
    return mesh;
  }

  // TODO(Jeroen): we have the merged road anyway, so we could use it instead of using the old generation code
  // const roadMaterial = new three.MeshBasicMaterial({ color: 'black' });
  // _.map(merged_road, p => group.add(polygonToMesh([p], roadMaterial)));

  const meshes: three.Mesh[] = [];
  const lineMaterial = new three.MeshBasicMaterial({ color: new three.Color(0.7, 0.7, 0.7) });
  _.map(line_polys, p => {
      const mesh = polygonToMesh(p, lineMaterial);
      // up a little bit to prevent interferance with road
      mesh.translateZ(0.01);
      meshes.push(mesh);
  })

  return meshes;
}
