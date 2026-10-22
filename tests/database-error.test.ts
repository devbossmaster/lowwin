import {describe,expect,it} from 'vitest';
import {Prisma} from '@prisma/client';
import {databaseErrorSummary} from '../src/lib/database-error';

describe('safe database diagnostics',()=>{
  it('reports Prisma initialization errorCode instead of unknown',()=>{
    const error=new Prisma.PrismaClientInitializationError('private connection details','6.19.3','P1001');
    expect(databaseErrorSummary(error)).toMatchObject({code:'P1001',kind:'PrismaClientInitializationError'});
    expect(JSON.stringify(databaseErrorSummary(error))).not.toContain('private connection details');
  });
  it.each([
    'FATAL: Tenant private-project-reference not found',
    'FATAL: Tenant or user not found',
    'FATAL: Backend connection failed: Tenant private-project-reference not found',
    'FATAL: Backend connection failed\nTenant private-project-reference not found',
  ])('recognizes a pooler tenant failure without returning its message',message=>{
    const summary=databaseErrorSummary(new Prisma.PrismaClientInitializationError(message,'6.19.3'));
    expect(summary).toMatchObject({code:'UNKNOWN',kind:'PrismaClientInitializationError',reason:'POOLER_TENANT_NOT_FOUND'});
    expect(summary.hint).toContain('project reference and project status');
    expect(JSON.stringify(summary)).not.toContain(message);expect(JSON.stringify(summary)).not.toContain('private-project-reference');
  });
  it.each([
    new Error('FATAL: Tenant private-project-reference not found'),
    new Prisma.PrismaClientInitializationError('Tenant private-project-reference not found in private notes','6.19.3'),
    new Prisma.PrismaClientInitializationError(`FATAL: ${'x'.repeat(257)} Tenant private-project-reference not found`,'6.19.3'),
  ])('does not infer a pooler reason from an unrelated error',error=>{
    const summary=databaseErrorSummary(error);
    expect(summary).not.toHaveProperty('reason');expect(summary.code).toBe('UNKNOWN');
    expect(JSON.stringify(summary)).not.toContain('private');
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
