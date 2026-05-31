import { defineConfig } from 'vite';

// Built output goes to the repo-root `voxel-city2/` folder so the EXISTING
// GitHub-Pages-from-branch deploy serves it at https://betmoar.github.io/voxel-city2/
// with zero infra change (the live /voxel-city/ game is untouched). Switching to a
// GitHub Actions Pages deploy is a deliberate later step (it changes the Pages source).
export default defineConfig({
  base: '/voxel-city2/',
  build: {
    outDir: '../voxel-city2',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 800, // three core is legitimately large; split the rest out
    rollupOptions: {
      output: {
        // split heavy vendor libs into separately-cacheable chunks (better repeat-load + caching;
        // only the app chunk changes on most edits)
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('rapier')) return 'rapier';
          if (id.includes('postprocessing') || id.includes('n8ao')) return 'postfx';
          if (id.includes('/three/')) return 'three';
          return 'vendor';
        },
      },
    },
  },
});
