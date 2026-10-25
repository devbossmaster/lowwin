import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CONTACT_APPROVAL_TIMEOUT_MS,watchContactApproval} from '../src/lib/contact-approval';

beforeEach(()=>{vi.useFakeTimers()});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()});

describe('finite Telegram contact approval watchdog',()=>{
  it.each([true,false])('accepts a %s result once and clears the timeout',shared=>{
    const onResult=vi.fn(),onTimeout=vi.fn(),approval=watchContactApproval(onResult,onTimeout);
    vi.advanceTimersByTime(CONTACT_APPROVAL_TIMEOUT_MS-1);
    approval.respond(shared);
    expect(onResult).toHaveBeenCalledExactlyOnceWith(shared);
    expect(onTimeout).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
    approval.respond(!shared);approval.respond(shared);
    vi.advanceTimersByTime(CONTACT_APPROVAL_TIMEOUT_MS*2);
    expect(onResult).toHaveBeenCalledExactlyOnceWith(shared);expect(onTimeout).not.toHaveBeenCalled();
  });

  it('expires after 30 seconds and ignores every late or duplicate response',()=>{
    const onResult=vi.fn(),onTimeout=vi.fn(),approval=watchContactApproval(onResult,onTimeout);
    expect(CONTACT_APPROVAL_TIMEOUT_MS).toBe(30000);
    vi.advanceTimersByTime(CONTACT_APPROVAL_TIMEOUT_MS-1);
    expect(onResult).not.toHaveBeenCalled();expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
    approval.respond(true);approval.respond(false);approval.cancel();
    vi.advanceTimersByTime(CONTACT_APPROVAL_TIMEOUT_MS*2);
    expect(onResult).not.toHaveBeenCalled();expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending watchdog and ignores callbacks received after cleanup',()=>{
    const onResult=vi.fn(),onTimeout=vi.fn(),approval=watchContactApproval(onResult,onTimeout);
    vi.advanceTimersByTime(1000);approval.cancel();approval.cancel();
    expect(vi.getTimerCount()).toBe(0);
    approval.respond(true);approval.respond(false);
    vi.advanceTimersByTime(CONTACT_APPROVAL_TIMEOUT_MS*2);
    expect(onResult).not.toHaveBeenCalled();expect(onTimeout).not.toHaveBeenCalled();
  });

  it('keeps a replacement request active when a canceled request receives a stale callback',()=>{
    const oldResult=vi.fn(),oldTimeout=vi.fn(),currentResult=vi.fn(),currentTimeout=vi.fn();
    const oldApproval=watchContactApproval(oldResult,oldTimeout);
    vi.advanceTimersByTime(10000);oldApproval.cancel();
    const currentApproval=watchContactApproval(currentResult,currentTimeout);
    oldApproval.respond(true);
    expect(oldResult).not.toHaveBeenCalled();expect(oldTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(20000);
    expect(currentResult).not.toHaveBeenCalled();expect(currentTimeout).not.toHaveBeenCalled();
    currentApproval.respond(true);oldApproval.respond(false);
    vi.advanceTimersByTime(CONTACT_APPROVAL_TIMEOUT_MS*2);
    expect(currentResult).toHaveBeenCalledExactlyOnceWith(true);expect(currentTimeout).not.toHaveBeenCalled();
    expect(oldResult).not.toHaveBeenCalled();expect(oldTimeout).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
});
