import {defineConfig,devices} from '@playwright/test'

export default defineConfig({
  testDir:'./tests',
  testMatch:'sales-hub-mobile-preview.spec.mjs',
  timeout:45000,
  expect:{timeout:10000},
  fullyParallel:false,
  retries:1,
  reporter:[['list'],['html',{outputFolder:'playwright-report',open:'never'}]],
  use:{
    baseURL:'http://127.0.0.1:4173',
    trace:'retain-on-failure',
    screenshot:'only-on-failure'
  },
  webServer:{
    command:'python3 -m http.server 4173 --bind 127.0.0.1',
    url:'http://127.0.0.1:4173/tests/sales-hub-mobile-preview.html',
    reuseExistingServer:true,
    timeout:30000
  },
  projects:[
    {name:'iPhone-15',use:{...devices['iPhone 15']}},
    {name:'iPad-Pro-11-portrait',use:{...devices['iPad Pro 11']}},
    {name:'iPad-Pro-11-landscape',use:{...devices['iPad Pro 11 landscape']}}
  ],
  outputDir:'test-results'
})
