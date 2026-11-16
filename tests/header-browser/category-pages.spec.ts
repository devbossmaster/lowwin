import {expect,test} from '@playwright/test';

test('category links use the existing Home catalogue and supported filters',async({page})=>{
 await page.goto('/categories/watches?status=live&sort=ending');
 await expect(page).toHaveURL(/\/\?category=watches&sort=ending$/);
 const categories=page.getByRole('navigation',{name:'Auction categories'});
 await expect(categories.locator('[aria-current="page"]')).toContainText('Watches');
 await expect(page.locator('#discover-auctions')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
