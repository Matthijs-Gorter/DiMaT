import { defineConfig } from '@playwright/test';

const apiPort=3010;
export default defineConfig({
  testDir:'./e2e',
  fullyParallel:false,
  workers:1,
  reporter:'list',
  use:{baseURL:'http://127.0.0.1:5174',browserName:'chromium',launchOptions:{channel:'chrome'}},
  webServer:[
    {command:`PORT=${apiPort} HOST=127.0.0.1 DEBUG=1 DIMAT_DB=/tmp/dimat-playwright-${process.pid}.sqlite pnpm --filter @dimat/server dev`,url:`http://127.0.0.1:${apiPort}/health`,reuseExistingServer:false,timeout:30_000},
    {command:`VITE_API_PORT=${apiPort} pnpm --filter @dimat/web dev:e2e`,url:'http://127.0.0.1:5174',reuseExistingServer:false,timeout:30_000}
  ]
});
