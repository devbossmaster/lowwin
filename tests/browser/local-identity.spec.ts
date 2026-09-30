import { test, expect } from '@playwright/test';
import { LOCAL_ACCESS_KEY } from '../helpers';
test.beforeAll(async({request})=>{
  // Compile the dev auth route before timing an interactive sign-in, never authenticate.
  expect((await request.post('/api/auth/lowin/dev-identity',{headers:{origin:'http://localhost:3107'},data:{}})).status()).toBe(401);
});
test('localhost action requires the operator key, which is never embedded in the page',async({page},testInfo)=>{
  await page.goto('/profile');
  await expect(page.getByRole('button',{name:'Use local test identity'})).toBeVisible();
  expect(await page.content()).not.toContain(LOCAL_ACCESS_KEY);
  await page.getByLabel('Local operator key').fill('incorrect-operator-key-with-enough-length');
  await page.getByRole('button',{name:'Use local test identity'}).click();
  await expect(page.getByText('Local test sign-in was denied.',{exact:false})).toBeVisible();
  await expect(page.locator('.page-loading-backdrop')).toHaveCount(0);await page.screenshot({caret:'initial',path:`docs/screenshots/hardening-local-${testInfo.project.name}.png`,fullPage:true});
  if (process.env.TEST_DATABASE_URL) {
    await page.getByLabel('Local operator key').fill(LOCAL_ACCESS_KEY);
    await page.getByRole('button',{name:'Use local test identity'}).click();
    await expect(page.locator('.profile-heading h2')).toHaveText('Local test player');
  }
});
test('public tunnel configuration hides identity and rejects fully rewritten local requests',async({page,request},testInfo)=>{
  await page.goto('http://localhost:3108/profile');
  await expect(page.getByText('Opening your Lowwin…')).toBeHidden();
  await expect(page.getByRole('button',{name:'Use local test identity'})).toHaveCount(0);
  await expect(page.getByLabel('Local operator key')).toHaveCount(0);
  expect(await page.content()).not.toContain(LOCAL_ACCESS_KEY);
  const response=await request.post('http://localhost:3108/api/auth/lowin/dev-identity',{headers:{origin:'http://localhost:3108','x-forwarded-host':'localhost:3108','x-forwarded-for':'127.0.0.1'},data:{accessKey:LOCAL_ACCESS_KEY}});
  expect(response.status()).toBe(503);expect(response.headers()['set-cookie']).toBeUndefined();
  await expect(page.locator('.page-loading-backdrop')).toHaveCount(0);await page.screenshot({caret:'initial',path:`docs/screenshots/hardening-tunnel-${testInfo.project.name}.png`});
});
