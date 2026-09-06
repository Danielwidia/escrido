const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function workerLog(...args) {
  // const line = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
  // fs.appendFileSync(path.join(__dirname, 'temp-worker-log.txt'), line + '\n');
}

let connection = null;

function serializeError(err) {
  return {
    message: err && err.message ? err.message : String(err),
    code: err && err.code ? err.code : undefined,
    errno: err && err.errno ? err.errno : undefined,
    sqlState: err && err.sqlState ? err.sqlState : undefined
  };
}

async function initConnection(config, readySab) {
  try {
    const connectionConfig = Object.assign({}, config);
    connection = await mysql.createConnection(connectionConfig);
    
    if (readySab) {
      const ready = new Int32Array(readySab);
      Atomics.store(ready, 0, 1);
      Atomics.notify(ready, 0, 1);
    }
  } catch (err) {
    workerLog('[worker] initConnection error', err);
    if (readySab) {
      const ready = new Int32Array(readySab);
      Atomics.store(ready, 0, 2);
      Atomics.notify(ready, 0, 1);
    }
  }
}

if (workerData && workerData.config) {
  initConnection(workerData.config, workerData.readySab);
}

parentPort.on('message', async (msg) => {
  try {
    if (!msg || !msg.type) return;

    if (msg.type === 'dispose') {
      if (connection) await connection.end();
      process.exit(0);
      return;
    }

    if (!connection) {
      // Tunggu sebentar jika koneksi sedang inisialisasi
      let attempts = 0;
      while (!connection && attempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
      if (!connection) throw new Error('MySQL connection not initialized');
    }

    let result = null;
    let error = null;

    try {
      if (msg.type === 'query') {
        const [rows] = await connection.query(msg.sql, msg.values || []);
        result = rows;
      } else if (msg.type === 'call') {
        const fn = connection[msg.name];
        result = await fn.apply(connection, msg.args || []);
      }
    } catch (err) {
      error = serializeError(err);
    }

    if (msg.port) {
      msg.port.postMessage({ id: msg.id, result, error });
      msg.port.close();
    }
  } catch (err) {
    if (msg.port) {
      msg.port.postMessage({ id: msg.id, error: serializeError(err) });
      msg.port.close();
    }
  }
});
