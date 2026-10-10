import {describe,expect,it} from 'vitest';
import {Prisma} from '@prisma/client';
import {databaseErrorSummary} from '../src/lib/database-error';

describe('safe database diagnostics',()=>{
  it('reports Prisma initialization errorCode instead of unknown',()=>{
    const error=new Prisma.PrismaClientInitializationError('private connection details','6.19.3','P1001');
    expect(databaseErrorSummary(error)).toMatchObject({code:'P1001',kind:'PrismaClientInitializationError'});
    expect(JSON.stringify(databaseErrorSummary(error))).not.toContain('private connection details');
  });
  it('recognizes PostgreSQL failures wrapped by an unknown Prisma request',()=>{
    const error=new Prisma.PrismaClientUnknownRequestError('ConnectorError { code: "42P05", message: "private SQL and credentials" }',{clientVersion:'6.19.3'});
    expect(databaseErrorSummary(error)).toMatchObject({code:'UNKNOWN',kind:'PrismaClientUnknownRequestError',sqlState:'42P05'});
    expect(JSON.stringify(databaseErrorSummary(error))).not.toContain('private SQL');
  });
  it('reports permission errors without leaking query metadata',()=>{
    const error=new Prisma.PrismaClientKnownRequestError('private SQL',{code:'P2010',clientVersion:'6.19.3',meta:{code:'42501',message:'private details'}});
    expect(databaseErrorSummary(error)).toMatchObject({code:'P2010',sqlState:'42501'});
    expect(JSON.stringify(databaseErrorSummary(error))).not.toContain('private');
  });
  it.each([null,undefined,'private-token',{name:'private-token',code:'postgresql://user:password@host/app',errorCode:'private-token',meta:{code:'private-token'}},new Error('private-token')])('never returns arbitrary error data: %j',error=>{
    const summary=databaseErrorSummary(error);
    expect(summary).toMatchObject({code:'UNKNOWN',kind:'Error'});
    expect(JSON.stringify(summary)).not.toMatch(/private-token|postgresql|password/);
  });
});
