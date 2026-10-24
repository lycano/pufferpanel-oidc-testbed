import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  // the tests share alice, bobby and their links, so they run one after another
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:8088',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // milliseconds between browser actions, so a headed run can be followed (npm run test:headed sets 500)
    launchOptions: { slowMo: Number(process.env.SLOWMO || 0) }
  }
})
