import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relativní cesty: web funguje na GitHub Pages i v podsložce /MONOPOLIS/.
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
