import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {listChapaCheckouts} from '../src/modules/payments/chapa';
import {acceptedBidView,myBidsFilter} from '../src/components/my-bids-copy';

const previous=process.env.CHAPA_SCHEMA_READY;
beforeEach(()=>{process.env.CHAPA_SCHEMA_READY='true'});
afterEach(()=>{if(previous===undefined)delete process.env.CHAPA_SCHEMA_READY;else process.env.CHAPA_SCHEMA_READY=previous});
const database=()=>{const findMany=vi.fn().mockResolvedValue([]);return {findMany,db:{chapaCheckout:{findMany}} as unknown as PrismaClient}};

describe('owned My Bids payment filters',()=>{
 it('filters failed attempts before pagination and retains ownership and no accepted bid',async()=>{
  const {db,findMany}=database();await listChapaCheckouts(db,'verified-player','BID',2,true,'failed');
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:{userId:'verified-player',purpose:'BID',bidId:null,creditJournalId:null,status:{in:['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED']}},skip:20,take:21,orderBy:[{createdAt:'desc'},{id:'desc'}]}));
 });
 it('keeps pending, review and customer-session expiry separate from provider failure',async()=>{
  const {db,findMany}=database();await listChapaCheckouts(db,'verified-player','BID',1,true,'pending');
  const where=findMany.mock.calls[0][0].where;
  expect(where).toMatchObject({userId:'verified-player',purpose:'BID',bidId:null,creditJournalId:null,status:{notIn:['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED']}});
  expect(where.status.notIn).not.toContain('NEEDS_REVIEW');expect(where).not.toHaveProperty('createdAt');expect(where).not.toHaveProperty('expiresAt');
 });
 it('keeps all unaccepted payments visible without counting them as accepted records',async()=>{
  const {db,findMany}=database();expect(await listChapaCheckouts(db,'verified-player','BID',1,true)).toEqual({items:[],page:1,nextPage:null});
  expect(findMany.mock.calls[0][0].where).toEqual({userId:'verified-player',purpose:'BID',bidId:null});
 });
 it('rejects narrower status filters on broad or top-up history',async()=>{
  const {db,findMany}=database();
  await expect(listChapaCheckouts(db,'verified-player','TOP_UP',1,false,'failed')).rejects.toMatchObject({code:'INVALID_INPUT',status:422});
  await expect(listChapaCheckouts(db,'verified-player','BID',1,false,'pending')).rejects.toMatchObject({code:'INVALID_INPUT',status:422});
  expect(findMany).not.toHaveBeenCalled();
 });
 it('does not touch unconfigured payment storage',async()=>{
  const {db,findMany}=database();process.env.CHAPA_SCHEMA_READY='false';expect(await listChapaCheckouts(db,'verified-player','BID',1,true,'failed')).toEqual({items:[],page:1,nextPage:null});expect(findMany).not.toHaveBeenCalled();
 });
});

describe('My Bids navigation state',()=>{
 it.each(['all','active','successful','pending','failed'] as const)('retains the explicit %s filter',filter=>expect(myBidsFilter(filter)).toBe(filter));
 it('preserves legacy active/history links while keeping accepted reads scoped',()=>{
  expect(myBidsFilter(null,'live')).toBe('active');expect(myBidsFilter(null,'history')).toBe('successful');expect(myBidsFilter('invalid','live')).toBe('active');
  expect(acceptedBidView('active',null)).toBe('live');expect(acceptedBidView('successful','history')).toBe('history');expect(acceptedBidView('successful',null)).toBe('all');
 });
});
