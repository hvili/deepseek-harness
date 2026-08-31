import { defineConfig } from 'tsdown'

/** Build Main as ESM and the sandbox preload as the CommonJS format Electron requires. */
export default defineConfig([
  { entry: ['src/main.ts'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', dts: false, clean: false, deps: { neverBundle: ['electron'] } },
  { entry: { preload: 'src/preload.ts' }, outDir: 'lib', format: ['cjs'], platform: 'node', target: 'es2024', dts: false, clean: false, deps: { neverBundle: ['electron'] }, outputOptions: { entryFileNames: 'preload.cjs' } },
])
