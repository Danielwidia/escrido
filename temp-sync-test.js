const SyncMySQL = require('./sync-mysql-compat');

console.log('starting test');
const db = new SyncMySQL({ host: '127.0.0.1', port: 3306, user: 'root', password: '', charset: 'utf8mb4' });

console.log('worker created', { threadId: db._worker.threadId });
db._worker.on('message', m => console.log('WORKER_MSG', JSON.stringify(m)));
db._worker.on('error', e => console.log('WORKER_ERROR', e && e.stack ? e.stack : e));
db._worker.on('exit', c => console.log('WORKER_EXIT', c));

try {
  console.log('about to query');
  const result = db.query('SELECT 1 AS ok');
  console.log('query result', JSON.stringify(result));
} catch (err) {
  console.error('CATCH', err && err.stack ? err.stack : err);
}

console.log('ending');
db.end();
