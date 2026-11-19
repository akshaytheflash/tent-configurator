/**
 * 3D canopy geometry.
 *
 * The fabric is generated from the *same* layout polygons the 2D editor shows.
 * Each roof face is a triangle lifted into 3D, and its UVs are the normalised
 * position of its vertices inside the 2D piece. The consequence is structural:
 * moving a logo in 2D moves the exact same texels on the 3D roof, because there
 * is only one coordinate system.
 *
 * The supplied GLB models provide the aluminium frame (legs + truss) and are
 * scaled/positioned to match the parametric fabric.
 */
import * as THREE from 'three';
import type { ProductDefinition } from '@tent/core';

export interface FabricInput {
  product: ProductDefinition;
  /** Rendered textures keyed by part id. */
  textures: Map<string, THREE.Texture>;
  /** Print piece geometry from the layout (canvas space). */
  pieces: Array<{ partId: string; piece: string; points: Array<{ x: number; y: number }> }>;
}

export type Side = 'front' | 'back' | 'left' | 'right';

/** World-space corners of the eave rectangle (y up, metres). */
export function eaveCorners(product: ProductDefinition) {
  const hw = product.canopy.width / 2000;
  const hd = product.canopy.depth / 2000;
  const y = product.canopy.legHeight / 1000;
  return {
    frontLeft: new THREE.Vector3(-hw, y, hd),
    frontRight: new THREE.Vector3(hw, y, hd),
    backLeft: new THREE.Vector3(-hw, y, -hd),
    backRight: new THREE.Vector3(hw, y, -hd),
    peak: new THREE.Vector3(0, product.canopy.peakHeight / 1000, 0),
  };
}

/**
 * Build the whole tent as a group: fabric + valance + walls + frame.
 * Everything is in metres, matching the GLB models' world scale.
 */
export function buildTent(input: FabricInput): THREE.Group {
  const { product, textures } = input;
  const group = new THREE.Group();
  group.name = 'tent';

  const { frontLeft, frontRight, backLeft, backRight, peak } = eaveCorners(product);
  const valance = (product.canopy.valanceHeight ?? 250) / 1000;

  const roofTex = textures.get('roof');
  if (roofTex) {
    const roofMat = new THREE.MeshStandardMaterial({
      map: roofTex,
      roughness: 0.82,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    // Front/back faces read the peak piece; left/right read the same piece,
    // mirrored, exactly as the fabric is sewn.
    // Face order and widths must match buildLayout()'s roof sawtooth.
    const w = product.canopy.width;
    const d = product.canopy.depth;
    const total = (w + d) * 2;
    const faces: Array<[THREE.Vector3, THREE.Vector3, number, boolean]> = [
      [frontLeft, frontRight, w / total, true],
      [frontRight, backRight, d / total, false],
      [backRight, backLeft, w / total, true],
      [backLeft, frontLeft, d / total, false],
    ];
    let uCursor = 0;
    for (const [a, b, span, apexAtTop] of faces) {
      const geom = roofFaceGeometry(a, b, peak, uCursor, uCursor + span, apexAtTop);
      uCursor += span;
      const mesh = new THREE.Mesh(geom, roofMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Valance strips hang from each eave edge. Each strip reads its own
    // part's texture (one strip per side), so a valance banner printed on the
    // front is not repeated on the back.
    for (const side of ['front', 'back', 'left', 'right'] as Side[]) {
      const valTex = textures.get(`valance-${side}`) ?? roofTex;
      const [a, b] = wallEdge(side, { product });
      const geom = valanceBandGeometry(a, b, valance);
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ map: valTex, roughness: 0.82, side: THREE.DoubleSide }),
      );
      mesh.castShadow = true;
      group.add(mesh);
    }
  }

  // Side walls and half walls.
  for (const side of ['front', 'back', 'left', 'right'] as Side[]) {
    const partId = `wall-${side}`;
    const tex = textures.get(partId);
    if (!tex) continue;
    const [a, b] = wallEdge(side, { product });
    const geom = wallGeometry(a, b, product.canopy.legHeight / 1000);
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }),
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const side of ['front', 'back'] as Side[]) {
    const partId = `halfwall-${side}`;
    const tex = textures.get(partId);
    if (!tex) continue;
    const [a, b] = wallEdge(side, { product });
    const geom = wallGeometry(a, b, (product.canopy.legHeight / 1000) * 0.45);
    group.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide })));
  }

  return group;
}

/**
 * One roof face.
 *
 * The roof texture is the 2D sawtooth strip (front, right, back, left). Face i
 * occupies the horizontal band [u_i, u_i+1] of that strip, with its eave edge
 * on v=0.5 (the shared eave line in the artboard) and its apex at v=0 or v=1
 * depending on whether the face was drawn apex-up or apex-down.
 *
 * Mapping straight from the artboard geometry means a logo placed on the front
 * triangle in 2D appears on the front roof face in 3D, at the same scale.
 */
function roofFaceGeometry(
  a: THREE.Vector3,
  b: THREE.Vector3,
  peak: THREE.Vector3,
  uStart: number,
  uEnd: number,
  apexAtTop: boolean,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const vertices = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, peak.x, peak.y, peak.z]);
  // Canvas Y grows downward; texture V grows upward, so the eave line (mid)
  // maps to v=0.5 and apex-up faces (smaller canvas Y) map to v=1.
  const apexV = apexAtTop ? 1 : 0;
  const uvs = new Float32Array([uStart, 0.5, uEnd, 0.5, (uStart + uEnd) / 2, apexV]);
  g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2]);
  // Face the roof outward regardless of vertex order: the face normal must
  // point up, otherwise half the roof renders unlit (black).
  const n = new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(b, a),
    new THREE.Vector3().subVectors(peak, a),
  );
  if (n.y < 0) g.setIndex([0, 2, 1]);
  g.computeVertexNormals();
  return g;
}

function valanceBandGeometry(a: THREE.Vector3, b: THREE.Vector3, height: number) {
  const g = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    a.x, a.y, a.z,
    b.x, b.y, b.z,
    b.x, b.y - height, b.z,
    a.x, a.y - height, a.z,
  ]);
  // The valance part's texture *is* the strip, so it maps 1:1.
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

export function wallEdge(side: Side, { product }: { product: ProductDefinition }): [THREE.Vector3, THREE.Vector3] {
  const { frontLeft, frontRight, backLeft, backRight } = eaveCorners(product);
  switch (side) {
    case 'front': return [frontLeft, frontRight];
    case 'back': return [backRight, backLeft];
    case 'left': return [backLeft, frontLeft];
    case 'right': return [frontRight, backRight];
  }
}

function wallGeometry(a: THREE.Vector3, b: THREE.Vector3, height: number) {
  const g = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    a.x, a.y, a.z,
    b.x, b.y, b.z,
    b.x, a.y - height, b.z,
    a.x, a.y - height, a.z,
  ]);
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}
