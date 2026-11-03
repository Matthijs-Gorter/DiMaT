import { defineConfig } from '@playwright/test';

const apiPort=Number(process.env.E2E_API_PORT??3010);
const webPort=Number(process.env.E2E_WEB_PORT??5174);
export default defineConfig({
  testDir:'./e2e',
  fullyParallel:false,
  workers:1,
  reporter:'list',
  use:{baseURL:`http://127.0.0.1:${webPort}`,browserName:'chromium',launchOptions:{channel:'chrome'}},
  webServer:[
    {command:`PORT=${apiPort} HOST=127.0.0.1 DEBUG=1 DIMAT_DB=/tmp/dimat-playwright-${process.pid}.sqlite node --import tsx apps/server/src/index.ts`,url:`http://127.0.0.1:${apiPort}/health`,reuseExistingServer:false,timeout:30_000},
    {command:`VITE_API_PORT=${apiPort} pnpm --filter @dimat/web exec vite --host 127.0.0.1 --port ${webPort}`,url:`http://127.0.0.1:${webPort}`,reuseExistingServer:false,timeout:30_000}
  ]
});
