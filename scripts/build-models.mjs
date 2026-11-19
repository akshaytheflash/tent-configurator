/**
 * Model build step.
 *
 * The source GLBs (shared/models/*.glb) are authored assets with 2048² textures
 * baked in - ~10 MB each, which is far too heavy to ship to a browser. This
 * script produces web-ready variants in apps/configurator/public/models:
 *
 *  - strips the metal base-colour/normal maps (we shade the frame procedurally)
 *  - keeps a downscaled 1024² fabric normal map for cloth detail
 *  - runs weld/quantize/prune to shrink geometry
 *
 * Run with `npm run models`. Outputs are committed so the app builds without it.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  quantize,
  resample,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'shared', 'models');
const OUT = join(here, '..', 'apps', 'configurator', 'public', 'models');

const FILES = ['tent-5x5.glb', 'tent-65x65.glb', 'tent-8x8.glb'];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

await mkdir(OUT, { recursive: true });

for (const file of FILES) {
  const buf = await readFile(join(SRC, file));
  const doc = await io.readBinary(new Uint8Array(buf));
  const root = doc.getRoot();

  // Metal is rendered by our own PBR material: drop its big maps.
  for (const material of root.listMaterials()) {
    if (material.getName() === 'Metal_mat') {
      const base = material.getBaseColorTexture();
      if (base) {
        // Reuse the PNG as a neutral tint source is unnecessary; clear it.
        material.setBaseColorTexture(null);
        material.setNormalTexture(null);
        material.setMetallicRoughnessTexture(null);
        material.setBaseColorFactor([0.78, 0.79, 0.8, 1]);
        material.setMetallicFactor(0.9);
        material.setRoughnessFactor(0.35);
      }
    }
  }

  // The inner fabric is a flat colour; its material is fine as-is.
  await doc.transform(
    weld(),
    dedup(),
    resample(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [1024, 1024],
      quality: 82,
    }),
    prune({ keepAttributes: false }),
    quantize(),
  );

  const out = await io.writeBinary(doc);
  await writeFile(join(OUT, file), out);
  console.log(`  ${file}  ${(buf.byteLength / 1e6).toFixed(1)} MB -> ${(out.byteLength / 1e6).toFixed(2)} MB`);
}
