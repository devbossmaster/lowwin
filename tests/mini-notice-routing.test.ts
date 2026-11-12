import {describe,expect,it,vi} from 'vitest';
import {createMiniNoticeRouting} from '../src/components/mini-notice';

function fixture(){
  let next=0;
  const show=vi.fn((_message:string,_kind:string,options:{id?:string;toasterId?:string;onDismiss?:()=>void;onAutoClose?:()=>void})=>options.id??++next),dismiss=vi.fn(),changed=vi.fn();
  return {show,dismiss,changed,routing:createMiniNoticeRouting({show,dismiss},changed)};
}

describe('native sheet notice routing',()=>{
  it('keeps root notices on the original global target and routes an existing callback after showModal',()=>{
    const f=fixture(),notify=f.routing.notify;
    notify('Global notice','info',{id:'saved',duration:3000});
    expect(f.show).toHaveBeenLastCalledWith('Global notice','info',expect.objectContaining({id:'saved',duration:3000}));
    expect(f.show.mock.calls[0][2].toasterId).toBeUndefined();
    const close=f.routing.activate('bid-sheet');
    notify('Choose a payment method','error',{id:'validation'});
    expect(f.show).toHaveBeenLastCalledWith('Choose a payment method','error',expect.objectContaining({id:'bid-sheet:validation',toasterId:'bid-sheet'}));
    expect(f.show).toHaveBeenCalledTimes(2);
    close();
    expect(f.dismiss).toHaveBeenCalledExactlyOnceWith('bid-sheet:validation');
    notify('Root again');
    expect(f.show.mock.calls[2][2].toasterId).toBeUndefined();
  });

  it('targets only the most recently opened sheet and restores the previous target on close',()=>{
    const f=fixture(),closeBid=f.routing.activate('bid'),closeTopup=f.routing.activate('topup');
    f.routing.notify('Invalid phone','error',{id:'phone'});
    expect(f.show.mock.calls[0][2].toasterId).toBe('topup');
    closeTopup();
    f.routing.notify('Check bids','error',{id:'phone'});
    expect(f.show.mock.calls[1][2]).toMatchObject({toasterId:'bid',id:'bid:phone'});
    expect(f.dismiss).toHaveBeenCalledExactlyOnceWith('topup:phone');
    closeBid();expect(f.changed).toHaveBeenLastCalledWith(null);
  });

  it('cleans up only owned active notices and tolerates out-of-order/repeated dialog cleanup',()=>{
    const f=fixture(),closeBid=f.routing.activate('bid');
    f.routing.notify('First','error',{id:'first'});
    f.routing.notify('Already dismissed','error',{id:'dismissed'});
    f.show.mock.calls[1][2].onDismiss?.();
    const closeTopup=f.routing.activate('topup');
    f.routing.notify('Last','error',{id:'last'});
    closeBid();closeBid();
    expect(f.dismiss.mock.calls).toEqual([['bid:first']]);
    expect(f.changed).toHaveBeenLastCalledWith('topup');
    closeTopup();expect(f.dismiss.mock.calls).toEqual([['bid:first'],['topup:last']]);
    expect(f.changed).toHaveBeenLastCalledWith(null);
  });

  it('does not retain an automatically closed toast until the sheet is dismissed',()=>{
    const f=fixture(),close=f.routing.activate('bid');
    f.routing.notify('One short error','error');
    f.show.mock.calls[0][2].onAutoClose?.();close();
    expect(f.dismiss).not.toHaveBeenCalled();
  });
});
