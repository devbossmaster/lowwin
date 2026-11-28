import {test, expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';

test('sheet rises from the bottom and returns keyboard focus to its trigger', async ({page},info) => {
  page.setDefaultTimeout(30000);
  test.skip(process.env.REDESIGN_STAGE === 'before', 'New sheet regression');
  const client = new PrismaClient({datasourceUrl: process.env.TEST_DATABASE_URL});
  try {
    await page.emulateMedia({reducedMotion:'no-preference'});
    const id = randomInt(9000000000, 9500000000);
    await verifyFixtureContact(client, id);
    await page.route('https://telegram.org/**', route => route.fulfill({body: ''}));
    await page.addInitScript(({data}) => {
      window.Telegram = {WebApp: {initData: data, ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}}};
      document.addEventListener('click',event=>{
        if(!(event.target instanceof Element)||!event.target.closest('[data-home-hero] button'))return;
        const state=document.documentElement.dataset;
        state.sheetTestClicked=String(performance.now());
        delete state.sheetTestShown;
        delete state.sheetTestSettled;
      },true);
      const showModal=HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal=function(){
        showModal.call(this);
        document.documentElement.dataset.sheetTestShown=String(performance.now());
      };
      const animate=Element.prototype.animate;
      Element.prototype.animate=function(keyframes,options){
        const animation=animate.call(this,keyframes,options);
        if(this instanceof HTMLDialogElement){
          if(document.documentElement.dataset.sheetTestPause==='yes'){animation.pause();animation.currentTime=0;}
          else void animation.finished.then(()=>{document.documentElement.dataset.sheetTestSettled=String(performance.now())},()=>{});
        }
        return animation;
      };
    }, {data: signedLaunch({user: JSON.stringify({id, first_name: 'Focus fixture'})}, process.env.TELEGRAM_BOT_TOKEN)});
    await page.goto('/',{waitUntil:'domcontentloaded',timeout:90000});
    const trigger = page.locator('[data-home-hero]').getByRole('button', {name: 'How it works?', exact: true});
    await expect(trigger).toBeVisible();
    const dialog = page.getByRole('dialog', {name: 'How LowWin works'});
    const timing=[];
    for(const open of ['first','repeat']){
      await trigger.click();
      await expect(dialog).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-sheet-test-settled',/^\d/);
      timing.push(await page.evaluate(open=>{
        const state=document.documentElement.dataset,clicked=Number(state.sheetTestClicked);
        return {open,clickToShowMs:Math.round(Number(state.sheetTestShown)-clicked),clickToSettledMs:Math.round(Number(state.sheetTestSettled)-clicked)};
      },open));
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
    await info.attach('sheet-open-timings',{body:JSON.stringify(timing),contentType:'application/json'});
    await page.locator('html').evaluate(element=>{element.dataset.sheetTestPause='yes'});
    await trigger.focus();
    await trigger.click();
    await expect(dialog).toBeVisible();
    const motion=await dialog.evaluate(element=>{
      const [slide]=element.getAnimations();
      if(!slide?.effect)return null;
      const start=element.getBoundingClientRect().top,duration=Number(slide.effect.getComputedTiming().duration);
      slide.currentTime=duration/2;
      const midway=element.getBoundingClientRect().top;
      slide.finish();
      return {start,midway,end:element.getBoundingClientRect().top,bottom:window.innerHeight,duration,modal:element.matches(':modal')};
    });
    expect(motion).not.toBeNull();
    expect(motion!.modal).toBe(true);
    expect(motion!.start).toBeGreaterThanOrEqual(motion!.bottom-1);
    expect(motion!.midway).toBeLessThan(motion!.start);
    expect(motion!.midway).toBeGreaterThan(motion!.end);
    expect(motion!.duration).toBeLessThan(300);
    await dialog.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(trigger).toBeFocused({timeout: 5000});

    await page.emulateMedia({reducedMotion:'reduce'});
    await trigger.click();
    await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeFocused();
    expect(await dialog.evaluate(element=>element.getAnimations().length)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {await client.$disconnect();}
});
