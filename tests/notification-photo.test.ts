import {afterAll,describe,expect,it,vi} from 'vitest';
import {InputFile} from 'grammy';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {notificationPhoto} from '../src/modules/notifications/service';

const dir=mkdtempSync(join(tmpdir(),'lowwin-notification-'));
const path=join(dir,'notification.png');
afterAll(()=>rmSync(dir,{recursive:true,force:true}));

describe('Telegram notification photo',()=>{
 it('keeps existing delivery when the optional image has not been added',async()=>{
  const tx={managedMedia:{findUnique:vi.fn()}} as never;
  expect(await notificationPhoto(tx,undefined,'https://lowwin.example',path)).toBeNull();
  expect(await notificationPhoto(tx,'media-1','https://lowwin.example',path)).toBe('https://lowwin.example/api/media/media-1');
 });
 it('attaches the provided PNG to notices and includes it on custom broadcasts',async()=>{
  writeFileSync(path,await sharp({create:{width:160,height:160,channels:4,background:'#0BDA51'}}).png().toBuffer());
  const bytes=await sharp({create:{width:500,height:400,channels:3,background:'#ffffff'}}).png().toBuffer();
  const findUnique=vi.fn(async()=>({bytes}));
  const tx={managedMedia:{findUnique}} as never;
  expect(await notificationPhoto(tx,undefined,'https://lowwin.example',path)).toBeInstanceOf(InputFile);
  const custom=await notificationPhoto(tx,'media-2','https://lowwin.example',path);
  expect(custom).toBeInstanceOf(InputFile);
  expect((custom as InputFile).filename).toBe('notification.png');
  expect(findUnique).toHaveBeenCalledTimes(1);
 });
});
