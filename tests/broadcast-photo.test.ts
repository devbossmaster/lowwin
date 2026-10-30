import {describe,expect,it,vi} from 'vitest';
import {InputFile} from 'grammy';
import {sendBroadcastPhoto} from '../src/modules/notifications/broadcast-photo';

const result=(fileId='largest-file')=>({message_id:42,photo:[{file_id:'small-file'},{file_id:fileId}]});
const options=(caption:string)=>({caption,reply_markup:{inline_keyboard:[[{text:'Open Lowwin',web_app:{url:'https://lowwin.test/'}}]]}});

describe('broadcast photo transport reuse',()=>{
 it('uploads once and reuses the largest Telegram photo while keeping each caption and button',async()=>{
  const sendPhoto=vi.fn().mockResolvedValue(result()),api={sendPhoto} as never,photo=new InputFile(Buffer.alloc(16000),'broadcast.png');
  await sendBroadcastPhoto(api,'chat-one',photo,options('First player'),'immutable-image');
  await sendBroadcastPhoto(api,'chat-two',photo,options('Second player'),'immutable-image');
  expect(sendPhoto.mock.calls).toEqual([['chat-one',photo,options('First player')],['chat-two','largest-file',options('Second player')]]);
 });
 it('never reuses a file ID across bots or changed image content',async()=>{
  const first=vi.fn().mockResolvedValue(result('bot-one-file')),second=vi.fn().mockResolvedValue(result('bot-two-file'));
  const a={sendPhoto:first} as never,b={sendPhoto:second} as never,photo=new InputFile(Buffer.from('fixture'));
  await sendBroadcastPhoto(a,'chat',photo,options('One'),'image-v1');
  await sendBroadcastPhoto(b,'chat',photo,options('Two'),'image-v1');
  await sendBroadcastPhoto(a,'chat',photo,options('Changed'),'image-v2');
  expect(first.mock.calls[1][1]).toBe(photo);expect(second.mock.calls[0][1]).toBe(photo);
 });
 it('refreshes a rejected cached file once and stores the new successful file ID',async()=>{
  const sendPhoto=vi.fn().mockResolvedValueOnce(result('old-file')).mockRejectedValueOnce({error_code:400}).mockResolvedValue(result('new-file'));
  const api={sendPhoto} as never,photo=new InputFile(Buffer.from('fixture'));
  await sendBroadcastPhoto(api,'chat',photo,options('First'),'image');
  await sendBroadcastPhoto(api,'chat',photo,options('Second'),'image');
  await sendBroadcastPhoto(api,'chat',photo,options('Third'),'image');
  expect(sendPhoto.mock.calls.map(call=>call[1])).toEqual([photo,'old-file',photo,'new-file']);
 });
 it.each([429,403,undefined])('preserves dispatcher backoff and terminal handling for %s without an immediate retry',async code=>{
  const error=code?{error_code:code,parameters:{retry_after:9}}:new Error('Network unavailable');
  const sendPhoto=vi.fn().mockResolvedValueOnce(result()).mockRejectedValue(error),api={sendPhoto} as never,photo=new InputFile(Buffer.from('fixture'));
  await sendBroadcastPhoto(api,'chat',photo,options('First'),'image');
  await expect(sendBroadcastPhoto(api,'chat',photo,options('Second'),'image')).rejects.toBe(error);
  expect(sendPhoto).toHaveBeenCalledTimes(2);
 });
 it('bounds cached images and reuploads an evicted image',async()=>{
  const sendPhoto=vi.fn().mockResolvedValue(result()),api={sendPhoto} as never,photo=new InputFile(Buffer.from('fixture'));
  for(let i=0;i<33;i++)await sendBroadcastPhoto(api,'chat',photo,options('Fixture'),`image-${i}`);
  await sendBroadcastPhoto(api,'chat',photo,options('Old image'),'image-0');
  expect(sendPhoto.mock.calls.at(-1)![1]).toBe(photo);
 });
});
