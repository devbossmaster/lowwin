// Never log database exception messages, SQL, connection strings or metadata.
// Prisma initialization errors use errorCode; query errors normally use code.
export function databaseErrorSummary(error: unknown) {
  const failure = error && typeof error === 'object'
    ? error as {code?:unknown;errorCode?:unknown;name?:unknown;message?:unknown;meta?:{code?:unknown}}
    : {};
  const code = [failure.code, failure.errorCode].find(value => typeof value === 'string' && /^P\d{4}$/.test(value)) as string | undefined;
  const kinds = ['PrismaClientInitializationError','PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientValidationError','PrismaClientRustPanicError'];
  const kind = typeof failure.name === 'string' && kinds.includes(failure.name) ? failure.name : 'Error';
  const states:Record<string,string> = {
    '42P05':'Prepared-statement conflict; check pooler compatibility.',
    '26000':'Prepared statement missing; check pooler compatibility.',
    '42P01':'Database table missing; check the target schema and deployed migrations.',
    '42703':'Database column missing; check the target schema and deployed migrations.',
    '42501':'Database permission denied; check the restricted runtime role grants.',
    '28P01':'Database authentication failed; check the runtime credentials.',
    '53300':'Database connection limit reached; inspect pool usage.',
    '57P03':'Database is temporarily unavailable.',
  };
  // Unknown Prisma request errors sometimes embed PostgreSQL's code in text.
  // Extract only a recognized SQLSTATE, never the surrounding message.
  const embedded = typeof failure.message === 'string'
    ? failure.message.match(/\bcode:\s*"([A-Z0-9]{5})"/)?.[1] : undefined;
  const sqlState = [failure.meta?.code,embedded].find(value => typeof value === 'string' && Object.hasOwn(states,value)) as string | undefined;
  // Supabase pooler initialization can omit a Prisma code. Return a fixed
  // reason only; the server message can contain the private tenant reference.
  const initializationMessage=kind==='PrismaClientInitializationError'&&typeof failure.message==='string'?failure.message:undefined;
  const reason=initializationMessage&&/\bFATAL:[\s\S]{0,256}\bAddress\s+not\s+in\s+tenant\s+allow_list\b/i.test(initializationMessage)
    ? 'NETWORK_ADDRESS_NOT_ALLOWED' as const
    : initializationMessage&&/\bFATAL:[\s\S]{0,256}\bTenant\b[\s\S]{0,256}\bnot found\b/i.test(initializationMessage)
      ? 'POOLER_TENANT_NOT_FOUND' as const : undefined;
  const hints:Record<string,string> = {
    P1000:'Database authentication failed; check the runtime credentials.',
    P1001:'Database unreachable; check the endpoint and network.',
    P1002:'Database connection timed out.',
    P1010:'Database access denied; check the restricted runtime role grants.',
    P1011:'Database TLS connection failed; check SSL configuration.',
    P1013:'Database connection string is invalid.',
    P1017:'Database connection closed unexpectedly.',
    P2021:states['42P01'],P2022:states['42703'],
    P2024:'Database connection pool timed out; inspect pool usage.',
    P2028:'Database transaction failed; run the inbox database check.',
  };
  return {code:code??'UNKNOWN',kind,...(sqlState?{sqlState}:{}),...(reason?{reason}:{}),
    hint:reason==='NETWORK_ADDRESS_NOT_ALLOWED'?'Database network restrictions rejected this address; review the project allow list for the current application egress address.':
      reason==='POOLER_TENANT_NOT_FOUND'?'Database pooler tenant was not found; check the configured project reference and project status.':
      (sqlState?states[sqlState]:undefined)??(code?hints[code]:undefined)??'Run npm run db:check -- --bot-inbox in this container.'};
}
