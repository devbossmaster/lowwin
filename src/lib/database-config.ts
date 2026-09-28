// Keep migration connections in DIRECT_URL. These defaults apply only to the
// application's Supabase pool; explicitly configured limits remain authoritative.
export function runtimeDatabaseUrl(raw:string|undefined):string|undefined {
  if(!raw)return undefined;
  let url:URL;
  try {url=new URL(raw)} catch {throw new Error('DATABASE_URL is invalid')}
  if(!url.hostname.endsWith('.pooler.supabase.com'))return raw;
  const defaults={connect_timeout:'15',pool_timeout:'20',connection_limit:'5'};
  for(const [name,value] of Object.entries(defaults)) {
    if(!url.searchParams.has(name))url.searchParams.set(name,value);
  }
  if(url.port==='6543')url.searchParams.set('pgbouncer','true');
  return url.toString();
}
