/**
 * 3D preview.
 *
 * Renders the parametric fabric (built from the 2D layout) plus the supplied
 * GLB frame. Textures are regenerated from the part layers whenever the design
 * changes, so the 3D view is a direct function of the 2D document.
 *
 * The supplied frame models are authored at a fixed unit size and with the
 * frame's top around y≈2.0. Rather than hard-coding per-model magic numbers we
 * measure each loaded model's bounding box and fit it to the product's canopy
 * (footprint + eave height) - so the same GLB serves any tent size.
 */
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, useGLTF } from '@react-three/drei';
import { OrbitController } from './OrbitController';
import { Suspense, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { CustomerConfiguration, Layout, PartConfig, ProductDefinition } from '@tent/core';
import { assetsSnapshot } from '../rendering/assets';
import { pixelSize, renderPart } from '../rendering/rasterizer';
import { buildTent } from './tentGeometry';

type CameraPreset = 'orbit' | 'front' | 'back' | 'left' | 'right' | 'top';

/** Assets shipped with the repo; anything else reuses the nearest one. */
const FRAME_FALLBACK: Record<string, string> = {
  'tent-10x10': 'tent-8x8.glb',
  'tent-10x20': 'tent-8x8.glb',
};

interface Props {
  product: ProductDefinition;
  config: CustomerConfiguration;
  layout: Layout;
  className?: string;
  cameraPreset?: CameraPreset;
  /** Called once the scene has painted (used by the PDF exporter). */
  onReady?: () => void;
}

/** Generate a texture for one part from its layers, at part-local coordinates. */
function textureForPart(part: PartConfig, layout: Layout, maxWidth: number): THREE.CanvasTexture | null {
  const box = layout.partBoxes[part.partId];
  const pieces = layout.pieces.filter((p) => p.partId === part.partId && p.piece === 'outer');
  if (!box || !pieces.length) return null;
  const canvas = document.createElement('canvas');
  // Re-origin the pieces to their own bounding box. The part box includes
  // padding/gaps, whereas the texture must map the print polygon edge to edge.
  const localPieces = pieces.map((p) => {
    const minX = Math.min(...p.points.map((pt) => pt.x));
    const minY = Math.min(...p.points.map((pt) => pt.y));
    return { ...p, points: p.points.map((pt) => ({ x: pt.x - minX, y: pt.y - minY })) };
  });
  const bounds = {
    width: Math.max(...pieces.flatMap((p) => p.points.map((pt) => pt.x))) - Math.min(...pieces.flatMap((p) => p.points.map((pt) => pt.x))),
    height: Math.max(...pieces.flatMap((p) => p.points.map((pt) => pt.y))) - Math.min(...pieces.flatMap((p) => p.points.map((pt) => pt.y))),
  };
  const size = pixelSize(bounds, { maxWidth });
  renderPart(canvas, part, localPieces, bounds, { width: size.width, height: size.height }, assetsSnapshot());
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function TentModel({ product, config, layout }: Omit<Props, 'className' | 'cameraPreset' | 'onReady'>) {
  const [tent, setTent] = useState<THREE.Group | null>(null);

  useEffect(() => {
    const textures = new Map<string, THREE.Texture>();
    for (const [partId, part] of Object.entries(config.parts)) {
      const tex = textureForPart(part, layout, 1024);
      if (tex) textures.set(partId, tex);
    }
    const group = buildTent({ product, textures, pieces: layout.pieces });
    setTent(group);
    return () => {
      textures.forEach((t) => t.dispose());
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
    };
  }, [config, layout, product]);

  if (!tent) return null;
  return <primitive object={tent} />;
}

/**
 * Fit the supplied frame model into the product's frame volume. We take the
 * model's own bounding box (in its authored units), scale it so its footprint
 * matches the canopy, and sit its base on the ground.
 */
function FrameModel({ url, product }: { url: string; product: ProductDefinition }) {
  const { scene } = useGLTF(url);

  /**
   * The supplied GLBs bundle the fabric *and* the frame. The fabric is replaced
   * by our parametric canopy (so the artwork always matches the 2D artboard),
   * which leaves only the metal truss and legs. Non-metal meshes are removed
   * rather than made transparent: transparent geometry still writes depth and
   * would blacken the canopy from inside.
   */
  const { object, transform } = useMemo(() => {
    const root = scene.clone(true);
    const toRemove: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const isMetal = mats.every((m: THREE.Material) => m.name.toLowerCase().includes('metal'));
      if (!isMetal) {
        toRemove.push(o);
        return;
      }
      o.material = new THREE.MeshStandardMaterial({ color: '#c3c7cb', metalness: 0.85, roughness: 0.34 });
      o.castShadow = true;
      o.receiveShadow = true;
    });
    toRemove.forEach((o) => o.parent?.remove(o));

    /**
     * Fit to the *legs*, not the whole model: the truss apex rises above the
     * eave, so fitting the overall box would over-scale the frame and push
     * the peak through the canopy.
     */
    const legBox = new THREE.Box3();
    const legSize = new THREE.Vector3();
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) legBox.expandByObject(o);
    });
    legBox.getSize(legSize);
    const footprint = Math.max(legSize.x, legSize.z) || 1;
    const targetFootprint = Math.min(product.canopy.width, product.canopy.depth) / 1000;
    const scale = (targetFootprint / footprint) * 0.995;

    const box = legBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    return {
      object: root,
      transform: {
        scale,
        position: [-center.x * scale, -box.min.y * scale, -center.z * scale] as [number, number, number],
      },
    };
  }, [scene, product]);

  return (
    <group scale={transform.scale} position={transform.position}>
      <primitive object={object} />
    </group>
  );
}

function CameraRig({ preset }: { preset: CameraPreset }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    if (preset === 'orbit') return;
    const aspect = size.width / Math.max(1, size.height);
    const zoomOut = Math.max(1, 1.35 / aspect);
    const positions: Record<CameraPreset, [number, number, number]> = {
      orbit: [5.2, 3.4, 5.2],
      front: [0, 3.0, 7],
      back: [0, 3.0, -7],
      left: [-7, 3.0, 0],
      right: [7, 3.0, 0],
      top: [0.01, 9.5, 0.01],
    };
    const p = positions[preset];
    camera.position.set(p[0] * zoomOut, p[1], p[2] * zoomOut);
    camera.lookAt(0, 2.2, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, preset, size, invalidate]);
  return null;
}

export function TentView({ product, config, layout, className, cameraPreset = 'orbit', onReady }: Props) {
  /**
   * The three supplied GLBs share one truss/leg design; only their proportions
   * differ. Any product without its own asset borrows the closest one and the
   * fit logic scales it to this product's footprint, so 10x10 and 10x20 still
   * show a frame. When a dedicated model is supplied, it is preferred.
   */
  const frameModel = FRAME_FALLBACK[product.id] ?? product.model;
  const modelUrl = `/models/${frameModel}`;

  return (
    <Canvas
      className={className}
      shadows
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }}
      camera={{ position: [5.2, 3.4, 5.2], fov: 38 }}
      onCreated={({ gl, scene }) => {
        // Debug hook: used by the geometry tests / inspector in development.
        if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __scene: scene });
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        requestAnimationFrame(() => onReady?.());
      }}
    >
      <color attach="background" args={['#f1f2f3']} />
      <CameraRig preset={cameraPreset} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[6, 9, 5]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-5, 4, -6]} intensity={0.4} />
      <Suspense fallback={null}>
        <TentModel product={product} config={config} layout={layout} />
        <FrameModel url={modelUrl} product={product} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#e7e8ea" roughness={1} />
        </mesh>
        <ContactShadows position={[0, 0.004, 0]} opacity={0.3} scale={16} blur={2.4} far={6} />
        <Environment preset="city" environmentIntensity={0.35} />
      </Suspense>
      <OrbitController enabled={cameraPreset === 'orbit'} />
    </Canvas>
  );
}
