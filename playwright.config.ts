import { defineConfig,devices } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/e2e',
  fullyParallel:true,
  forbidOnly:!!process.env.CI,
  retries:process.env.CI?1:0,
  ...(process.env.CI?{workers:2}:{}),
  timeout:60000,
  expect:{timeout:10000},
  reporter:'list',
  outputDir:'test-results',
  use:{baseURL:'http://127.0.0.1:4174',trace:'retain-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer:{
    command:'npm run build && npm exec vite -- preview --host 127.0.0.1 --port 4174 --strictPort',
    url:'http://127.0.0.1:4174',
    reuseExistingServer:!process.env.CI,
    timeout:120000,
  },
});
