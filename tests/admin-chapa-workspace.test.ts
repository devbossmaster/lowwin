import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma,type PrismaClient} from '@prisma/client';
const guard=vi.hoisted(()=>({role:'OWNER'}));
vi.mock('../src/modules/admin/boundary',async original=>({...await original<typeof import('../src/modules/admin/boundary')>(),requireAdmin:vi.fn(async()=>({id:'staff',role:guard.role,sessionId:'staff-session',now:new Date('2026-10-26T12:00:00Z')}))}));
vi.mock('../src/modules/auctions/maintenance',()=>({readAuctionMaintenance:vi.fn(async()=>({halted:false}))}));
import {financialSummary,gatewayStatus,workspaceRead} from '../src/modules/admin/workspace';

const now=new Date('2026-10-26T12:00:00Z');
function fixture(tables:string[]=[]){
 const queries:Prisma.Sql[]=[],readiness:string[]=[];
 const mock={$queryRaw:vi.fn(async(query:Prisma.Sql|TemplateStringsArray,...values:unknown[])=>{
  if(!('text' in query)){const table=String(values[0]).replace(/^public\."|"$/g,'');readiness.push(table);return [{ready:tables.includes(table)}];}
  queries.push(query);
  if(query.text.startsWith('WITH fees')||query.text.includes('WITH fees AS'))return [{grossFees:'0',discounts:'0',refunds:'0',netFees:'0',deposits:'0',available:'0',held:'0',count:0,todayEtb:'0'}];
  if(query.text.includes('COUNT(*)::int AS count FROM ('))return [{count:0}];
  return [];
 }),chapaCheckout:{findMany:vi.fn(async()=>[]),count:vi.fn(async()=>0)},outbox:{groupBy:vi.fn(async()=>[])}};
 return {db:mock as unknown as PrismaClient,mock,queries,readiness};
}
beforeEach(()=>{vi.clearAllMocks();guard.role='OWNER';vi.stubEnv('CHAPA_SCHEMA_READY','false')});
describe('Chapa admin workspace compatibility',()=>{
 it('keeps Chapa readiness disabled and unconfigured without real configuration',()=>{
  expect(gatewayStatus({PAYMENT_GATEWAY:'CHAPA'})).toMatchObject({selected:'Chapa',state:'Not configured',chapa:{implemented:true,configured:false,enabled:false,recoveryEnabled:false,mode:'test'}});
 });
 it('labels enabled test configuration honestly without claiming live verification',()=>{
  const raw={APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@127.0.0.1/chapa_test',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_SCHEMA_READY:'true',CHAPA_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(32),CHAPA_WEBHOOK_SECRET:'local-only-secret-with-over-thirty-two-characters'};
  expect(gatewayStatus(raw)).toMatchObject({state:'Test checkout enabled',chapa:{configured:true,enabled:true,mode:'test'}});
  expect(gatewayStatus({...raw,CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'true'})).toMatchObject({state:'Recovery only',chapa:{enabled:false,recoveryEnabled:true}});
  expect(JSON.stringify(gatewayStatus(raw))).not.toMatch(/CHAPA_TEST_|credentialFingerprint|local-only-secret/);
 });
 it('does not inspect schemas or query absent Chapa storage on ordinary navigation',async()=>{
  const {db,queries,readiness,mock}=fixture();const result=await workspaceRead(db,new Headers(),'transactions',new URLSearchParams());
  expect(result).toMatchObject({configured:false,items:[]});expect(readiness).toEqual([]);expect(queries).toEqual([]);expect(mock.chapaCheckout.findMany).not.toHaveBeenCalled();
 });
 it('lists bounded Chapa rows only after the reviewed schema gate',async()=>{
  vi.stubEnv('CHAPA_SCHEMA_READY','true');const {db,mock,readiness}=fixture(['ChapaCheckout','ArifPayCheckout']);await workspaceRead(db,new Headers(),'transactions',new URLSearchParams({page:'2',sort:'amount'}));
  expect(mock.chapaCheckout.findMany).toHaveBeenCalledWith(expect.objectContaining({take:25,skip:25,orderBy:[{amountCents:'desc'},{id:'asc'}]}));expect(readiness).toEqual([]);
  expect(JSON.stringify(mock.chapaCheckout.findMany.mock.calls)).not.toMatch(/checkoutUrl|credentialFingerprint|initialization|merchantReference|processorReference/);
 });
 it('does not select provider reference suffixes for Support',async()=>{
  vi.stubEnv('CHAPA_SCHEMA_READY','true');const {db,mock}=fixture(['ChapaCheckout']);guard.role='SUPPORT';await workspaceRead(db,new Headers(),'transactions',new URLSearchParams());
  expect(JSON.stringify(mock.chapaCheckout.findMany.mock.calls)).not.toContain('chapaReference');
 });
 it('keeps financial reports compatible with pre-Chapa production schemas',async()=>{
  const {db,queries,readiness}=fixture();await financialSummary(db,now);expect(readiness).toContain('ChapaCheckout');expect(queries).toHaveLength(1);expect(queries[0].text).not.toContain('"ChapaCheckout"');expect(queries[0].text).toContain('0::numeric');
 });
 it('counts only committed live Chapa TOP_UP receipts in wallet deposits',async()=>{
  const {db,queries}=fixture(['ChapaCheckout']);await financialSummary(db,now);const query=queries[0];for(const required of ['c.mode=\'live\'','c.purpose=\'TOP_UP\'','c.status=\'CREDITED\'','j.id=c."creditJournalId"',"j.kind='CHAPA_RECEIPT'","o.scope='CHAPA_RECEIPT'",'o."userId"=c."userId"','o.key=c.id',"o.result->>'mode'='live'","o.result->>'checkoutId'=c.id",'j."createdAt"<='])expect(query.text).toContain(required);expect(query.values).toContain(now);
 });
 it('removes settings readiness from ordinary workspace routes',async()=>{
  const {db,queries,readiness}=fixture(['ChapaCheckout']);await expect(workspaceRead(db,new Headers(),'system',new URLSearchParams())).rejects.toMatchObject({status:404});expect(queries).toEqual([]);expect(readiness).toEqual([]);
 });
});
