import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  server: {
    port: 4000
  },
  plugins: [svelte({
    compilerOptions: {
      customElement: true
    }
  })],
  build: {
    copyPublicDir: true,
    lib: {
      entry: {
        'pie-chart': 'src/lib/pie-chart.js',
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
        entryFileNames: '[name].es.js',
        chunkFileNames: 'custom-element-helper.js',
        format: 'es'
      },
      preserveEntrySignatures: "strict",
    },
  },
  resolve: {
    alias: {
      $components: path.resolve('src/lib'),
      $lib: path.resolve('src/lib'),
    },
  },
});
