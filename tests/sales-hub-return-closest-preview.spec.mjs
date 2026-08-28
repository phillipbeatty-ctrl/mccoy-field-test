import {test,expect} from '@playwright/test'

async function openHarness(page){
  await page.goto('/tests/sales-hub-return-closest-preview.html')
  await expect(page.locator('#leadOrServiceAddress')).toBeVisible()
}

test('empty address fills from the nearest organization lead and manual text is preserved',async({page})=>{
  await openHarness(page)
  const input=page.locator('#leadOrServiceAddress')
  await expect(input).toHaveValue('100 Closest Avenue',{timeout:5000})
  await expect(page.locator('#closestDoorAddress')).toContainText('Closest McCoy lead')
  let calls=await page.evaluate(()=>window.__calls.filter(call=>call.kind==='rpc'))
  expect(calls.some(call=>call.name==='get_closest_mccoy_lead')).toBeTruthy()
  expect(calls[0].args).toEqual({p_lat:45.5,p_lng:-122.6})

  await input.fill('900 Manual Street')
  await page.evaluate(()=>{
    window.__nearest={id:'lead-b',address:'200 New Closest Road',latitude:45.5001,longitude:-122.6001,distance_meters:8}
    window.dispatchEvent(new CustomEvent('mccoy-location-updated'))
  })
  await page.waitForTimeout(400)
  await expect(input).toHaveValue('900 Manual Street')

  await input.fill('')
  await expect(input).toHaveValue('200 New Closest Road',{timeout:5000})
})

test('a real page exit followed by focus marks the capture returned and reopens Provider Outcome',async({page})=>{
  await openHarness(page)
  await page.evaluate(()=>{
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('focus'))
  })
  await expect.poll(()=>page.evaluate(()=>window.__providerReturned)).toBe(true)
  await expect(page.locator('#saleModal')).toHaveClass(/show/)
  const calls=await page.evaluate(()=>window.__calls.filter(call=>call.kind==='function'))
  expect(calls.filter(call=>call.name==='provider-sale-capture'&&call.body.action==='mark_returned')).toHaveLength(1)
})
