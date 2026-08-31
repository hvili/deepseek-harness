import { defineConfig } from 'tsdown'

/** Build Main as ESM plus the synchronous bootstrap and sandbox preload as CommonJS. */
export default defineConfig([
  { entry: ['src/main.ts'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', dts: false, clean: false, deps: { neverBundle: ['electron'] } },
  { entry: { bootstrap: 'src/bootstrap.ts', preload: 'src/preload.ts' }, outDir: 'lib', format: ['cjs'], platform: 'node', target: 'es2024', dts: false, clean: false, deps: { neverBundle: ['electron'] }, outputOptions: { entryFileNames: '[name].cjs' } },
])
