import { defineConfig } from 'tsdown'

/**
 * Build the wizard service and the standalone preview-reader CLI as separate
 * single-entry bundles. The preview-reader is spawned (confined read-only by
 * the sandbox seam) so it ships as its own executable entry rather than a
 * shared chunk. Separate builds keep each entry self-contained.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/preview-reader.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])