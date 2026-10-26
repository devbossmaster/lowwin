import {test, expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';

test('sheet returns keyboard focus to its trigger', async ({page}) => {
  page.setDefaultTimeout(30000);
  test.skip(process.env.REDESIGN_STAGE === 'before', 'New sheet regression');
  const client = new PrismaClient({datasourceUrl: process.env.TEST_DATABASE_URL});
  try {
    const id = randomInt(9000000000, 9500000000);
    await verifyFixtureContact(client, id);
    await page.route('https://telegram.org/**', route => route.fulfill({body: ''}));
    await page.addInitScript(({data}) => {window.Telegram = {WebApp: {initData: data, ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}}};}, {data: signedLaunch({user: JSON.stringify({id, first_name: 'Focus fixture'})}, process.env.TELEGRAM_BOT_TOKEN)});
    await page.goto('/');
    const trigger = page.getByRole('button', {name: 'Learn more'}).first();
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await trigger.click();
    const dialog = page.getByRole('dialog', {name: 'A little different wins'});
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(trigger).toBeFocused({timeout: 5000});
  } finally {await client.$disconnect();}
});
