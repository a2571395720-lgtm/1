const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e', timeout: 90000, expect: { timeout: 10000 }, workers: 1,
  reporter: [['list']], outputDir: '../artifacts/desktop-qa/results',
});
