import {describe,expect,it,vi} from 'vitest';
import type {Prisma} from '@prisma/client';
import {broadcastButtonLabel,broadcastMiniAppPath} from '../src/lib/broadcast-link';
import {campaignContent} from '../src/modules/notifications/campaigns';
import {materializeAlert} from '../src/modules/notifications/service';

describe('Master Guide Admin Telegram broadcasts',()=>{
 it.each(['/','/auctions/all','/my-bids','/winners','/profile','/auctions/42'])('accepts a supported Mini App destination: %s',path=>{
  expect(broadcastMiniAppPath(path)).toBe(path);
 });
 it.each(['https://elsewhere.example','//elsewhere.example','/admin','/profile?redirect=https://elsewhere.example','/auctions/../admin','/auctions/0','/auctions/42\n'])('rejects an unsafe or unsupported destination: %s',path=>{
  expect(()=>broadcastMiniAppPath(path)).toThrow();
 });
 it('retains the message, validated image and custom button for Telegram',async()=>{
  const tx={} as Prisma.TransactionClient;
  expect(await campaignContent(tx,{kind:'BROADCAST',payload:{recipientUserId:'player',body:'Auction update',href:'/auctions/42',imageId:'validated-image',buttonLabel:'View item',telegramOnly:true}})).toMatchObject({userId:'player',body:'Auction update',href:'/auctions/42',imageId:'validated-image',buttonLabel:'View item'});
  expect(await campaignContent(tx,{kind:'BROADCAST',payload:{recipientUserId:'player',body:'Update',href:'//elsewhere.example'}})).toBeNull();
 });
 it('never materializes a broadcast in the Mini App inbox, including old jobs',async()=>{
  const upsert=vi.fn(),tx={notificationInbox:{upsert},auction:{findUnique:vi.fn()}} as unknown as Prisma.TransactionClient;
  for(const telegramOnly of [undefined,true])await materializeAlert(tx,{key:'broadcast:fixture',kind:'BROADCAST',payload:{recipientUserId:'player',body:'Update',href:'/',telegramOnly}});
  expect(upsert).not.toHaveBeenCalled();
  expect(tx.auction.findUnique).not.toHaveBeenCalled();
 });
 it('bounds the Telegram button label and supplies a readable default',()=>{
  expect(broadcastButtonLabel(undefined)).toBe('Open Lowwin');
  expect(broadcastButtonLabel('  Open item  ')).toBe('Open item');
  for(const value of ['', 'x'.repeat(41),'Open\nitem'])expect(()=>broadcastButtonLabel(value)).toThrow();
 });
});
