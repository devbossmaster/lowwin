import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {InputFile} from 'grammy';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {notificationPhoto} from '../src/modules/notifications/service';

const dir=mkdtempSync(join(tmpdir(),'lowwin-notification-'));
const path=join(dir,'notification.png');
const missingPath=join(dir,'missing-badge.png');
beforeAll(async()=>writeFileSync(path,await sharp({create:{width:160,height:160,channels:4,background:'#0BDA51'}}).png().toBuffer()));
afterAll(()=>rmSync(dir,{recursive:true,force:true}));

describe('Telegram notification photo',()=>{
 it('keeps existing delivery when the optional image has not been added',async()=>{
  const tx={managedMedia:{findUnique:vi.fn()}} as never;
  expect(await notificationPhoto(tx,undefined,missingPath)).toBeNull();
 });
 it('uploads an authorized cover directly even without the optional badge',async()=>{
  const bytes=await sharp({create:{width:500,height:400,channels:3,background:'#ffffff'}}).png().toBuffer();
  const tx={managedMedia:{findUnique:vi.fn(async()=>({bytes}))}} as never;
  expect(await notificationPhoto(tx,'media-1',missingPath)).toBeInstanceOf(InputFile);
 });
 it('attaches the provided PNG to notices and includes it on custom broadcasts',async()=>{
  const bytes=await sharp({create:{width:500,height:400,channels:3,background:'#ffffff'}}).png().toBuffer();
  const findUnique=vi.fn(async()=>({bytes}));
  const tx={managedMedia:{findUnique}} as never;
  expect(await notificationPhoto(tx,undefined,path)).toBeInstanceOf(InputFile);
  const custom=await notificationPhoto(tx,'media-2',path);
  expect(custom).toBeInstanceOf(InputFile);
  expect((custom as InputFile).filename).toBe('notification.png');
  expect(findUnique).toHaveBeenCalledTimes(1);
 });
 it.each([[540,900],[900,55],[900,12],[12,900],[40,40]])('keeps %s × %s covers within Telegram photo dimensions',async(width,height)=>{
  const bytes=await sharp({create:{width,height,channels:3,background:'#111111'}}).png().toBuffer();
  const tx={managedMedia:{findUnique:vi.fn(async()=>({bytes}))}} as never;
  const custom=await notificationPhoto(tx,`media-${width}-${height}`,path);
  expect(custom).toBeInstanceOf(InputFile);
  const raw=await custom!.toRaw();
  if(!(raw instanceof Uint8Array))throw Error('Expected an uploaded image buffer.');
  const frame=await sharp(raw).metadata();
  expect({width:frame.width,height:frame.height}).toEqual({width:Math.max(width,Math.ceil(height/20)),height:Math.max(height,Math.ceil(width/20))});
 });
});
