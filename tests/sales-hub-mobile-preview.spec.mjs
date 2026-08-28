import {test,expect} from '@playwright/test'

async function waitForLayout(page){
  await page.goto('/tests/sales-hub-mobile-preview.html')
  await expect(page.locator('#salesHubTopGrid')).toBeVisible()
  await expect(page.locator('#stageSalePhotoBtn')).toHaveText('PHOTO')
}

async function startValidatedCapture(page){
  await page.evaluate(()=>{
    window.__captureEnabled=true
    window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-started',{detail:{capture:window.__capture}}))
    window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-ready',{detail:{capture:window.__capture,validated:true}}))
  })
}

test('approved layout and action row fit the target device',async({page},testInfo)=>{
  await waitForLayout(page)
  const project=testInfo.project.name
  const field=await page.locator('.sales-hub-field-session').boundingBox()
  const door=await page.locator('.sales-hub-door-workflow').boundingBox()
  const middle=await page.locator('#salesHubMiddleStack').boundingBox()
  const live=await page.locator('.sales-hub-live-stats').boundingBox()
  const pay=await page.locator('#payProgressCard').boundingBox()
  expect(field&&door&&middle&&live&&pay).toBeTruthy()

  if(project.includes('landscape')){
    expect(field.x).toBeLessThan(middle.x)
    expect(middle.x).toBeLessThan(door.x)
    expect(live.y).toBeLessThan(pay.y)
    expect(Math.abs(live.width-pay.width)).toBeLessThanOrEqual(2)
  }else{
    expect(field.y).toBeLessThan(door.y)
    expect(door.y).toBeLessThan(middle.y)
    expect(live.y).toBeLessThan(pay.y)
  }

  const labels=await page.locator('.spotio-disposition-actions button').allTextContents()
  expect(labels).toEqual(['SAVE','SALE','PHOTO'])
  const widths=await page.locator('.spotio-disposition-actions button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width))
  expect(Math.max(...widths)-Math.min(...widths)).toBeLessThanOrEqual(2)
  await page.screenshot({path:`test-results/${project}-sales-hub.png`,fullPage:true})
})

test('PHOTO blocks before SALE even when an older local capture exists, then stages after current validation',async({page})=>{
  await waitForLayout(page)
  await page.evaluate(()=>localStorage.setItem('mccoy_active_provider_sale_capture_v1',JSON.stringify({
    id:'77777777-7777-4777-8777-777777777777',
    client_request_id:'88888888-8888-4888-8888-888888888888',
    provider:'Quantum',
    status:'details_required'
  })))
  let chooserOpened=false
  page.once('filechooser',()=>{chooserOpened=true})
  await page.locator('#stageSalePhotoBtn').click()
  await page.waitForTimeout(350)
  expect(chooserOpened).toBe(false)
  await expect(page.locator('#salePhotoStageStatus')).toContainText('Press SALE first')

  await startValidatedCapture(page)
  const chooserPromise=page.waitForEvent('filechooser')
  await page.locator('#stageSalePhotoBtn').click()
  const chooser=await chooserPromise
  const input=page.locator('#salePhotoStageInput')
  await expect(input).toHaveAttribute('accept','image/*')
  await chooser.setFiles({name:'quantum-order.png',mimeType:'image/png',buffer:Buffer.from('89504e470d0a1a0a','hex')})
  await expect(page.locator('#stageSalePhotoBtn')).toHaveText('PHOTO (1)')
  await expect(page.locator('#salePhotoStageStatus')).toContainText('staged')
  const actions=await page.evaluate(()=>window.__calls.filter(call=>call.name==='provider-sale-photo-stage').map(call=>call.body.action))
  expect(actions).toContain('create_upload')
  expect(actions).toContain('commit_upload')
})

test('completed sale finalizes staged photo and abandoned sale discards it',async({page})=>{
  await waitForLayout(page)
  await page.evaluate(()=>{
    window.__stagedRows=[{id:'33333333-3333-4333-8333-333333333333',status:'staged',provider_capture_id:window.__capture.id}]
  })
  await startValidatedCapture(page)
  await expect(page.locator('#stageSalePhotoBtn')).toHaveText('PHOTO (1)')
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mccoy-sale-saved',{detail:{saleId:'55555555-5555-4555-8555-555555555555',providerCaptureId:window.__capture.id}})))
  await expect(page.locator('#salePhotoStageStatus')).toContainText('attached')
  let actions=await page.evaluate(()=>window.__calls.map(call=>`${call.name}:${call.body.action}`))
  expect(actions).toContain('provider-sale-photo-stage:finalize')
  expect(actions).toContain('sale-order-photo:process')

  await page.evaluate(()=>{
    window.__stagedRows=[{id:'66666666-6666-4666-8666-666666666666',status:'staged',provider_capture_id:window.__capture.id}]
    window.__captureEnabled=false
    window.__captureEnabled=true
    window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-started',{detail:{capture:window.__capture}}))
    window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-ready',{detail:{capture:window.__capture,validated:true}}))
  })
  await expect(page.locator('#stageSalePhotoBtn')).toHaveText('PHOTO (1)')
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mccoy-provider-sale-abandoned',{detail:{providerCaptureId:window.__capture.id}})))
  await expect(page.locator('#salePhotoStageStatus')).toContainText('deleted')
  actions=await page.evaluate(()=>window.__calls.map(call=>`${call.name}:${call.body.action}`))
  expect(actions).toContain('provider-sale-photo-stage:discard')
})
