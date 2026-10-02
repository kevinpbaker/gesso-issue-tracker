import { defineConfig } from 'vitest/config';

/** Everything runs in node: the model with no framework, the views through `gesso-testing`. */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    environment: 'node'
  }
});
