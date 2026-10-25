import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import {resolve} from 'node:path';
import next from 'next';

const target = new URL(process.env.DATABASE_URL ?? '');
if (process.env.APP_ENV !== 'local' || !['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw Error('Disposable loopback browser server required');
process.env.NODE_ENV = 'production';
const directory = resolve(process.env.REDESIGN_SOURCE_DIR ?? '.');
const app = next({dev: false, dir: directory, hostname: 'localhost', port: 3137});
await app.prepare();
const server = createServer({key: readFileSync(process.env.REDESIGN_TLS_KEY), cert: readFileSync(process.env.REDESIGN_TLS_CERT)}, app.getRequestHandler());
server.listen(3137, '127.0.0.1', () => console.log('Local HTTPS redesign browser server ready'));
const close = () => server.close(() => process.exit(0));
process.on('SIGTERM', close);
process.on('SIGINT', close);
