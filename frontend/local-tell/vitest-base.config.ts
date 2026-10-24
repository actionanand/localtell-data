import { defineConfig } from 'vitest/config';

// Merged by @angular/build:unit-test. Few workers keep slow file systems (e.g. WSL1 on /mnt/c) from timing out.
export default defineConfig({
  test: {
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
