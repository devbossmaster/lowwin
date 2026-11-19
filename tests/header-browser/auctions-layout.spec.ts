import {expect,test} from '@playwright/test';

test('guests see Home from legacy catalogue routes',async({page})=>{
 for(const path of ['/auctions/all','/auctions?search=Watch&status=live&category=watches&sort=ending']){
  const response=await page.request.get(path,{maxRedirects:0});expect(response.status()).toBe(307);
  expect(new URL(response.headers().location,response.url()).pathname).toBe('/');
 }
 await page.goto('/?category=watches&sort=ending&q=Watch');
 await expect(page).toHaveURL(/\/\?category=watches&sort=ending&q=Watch$/);
 await expect(page.locator('#discover-auctions')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
