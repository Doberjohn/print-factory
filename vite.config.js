import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // The TensorFlow.js chunk is big by nature, but it only loads when a low-res
    // image needs enhancing and is never part of the initial page load.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // A recognizable file name, so the network tab shows whether it loaded.
          groups: [{ name: "tfjs", test: /node_modules[\\/]@tensorflow[\\/]/ }],
        },
      },
    },
  },
});
