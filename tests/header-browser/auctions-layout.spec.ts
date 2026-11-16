import {expect,test} from '@playwright/test';

test('removed catalogue route returns not found and legacy browse opens Home',async({page})=>{
 const response=await page.goto('/auctions/all');expect(response?.status()).toBe(404);
 await page.goto('/auctions?search=Watch&status=live&category=watches&sort=ending');
 await expect(page).toHaveURL(/\/\?category=watches&sort=ending&q=Watch$/);
 await expect(page.locator('#discover-auctions')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
