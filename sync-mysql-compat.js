const path = require('path');
const { Worker, receiveMessageOnPort, MessageChannel } = require('worker_threads');

class SyncMySQL {
  constructor(config) {
    this._requestId = 1;
    this._readySab = new Int32Array(new SharedArrayBuffer(4));
    this._ready = false;
    this._readyError = null;

    this._worker = new Worker(path.join(__dirname, 'sync-mysql-worker.js'), {
      workerData: {
        config,
        readySab: this._readySab.buffer
      }
    });

    this._worker.on('error', err => {
      this._readyError = err;
    });
  }

  _waitReady() {
    if (this._ready) return;
    
    let state = Atomics.load(this._readySab, 0);
    while (state === 0) {
      Atomics.wait(this._readySab, 0, 0, 100);
      state = Atomics.load(this._readySab, 0);
    }

    if (state === 2) {
      throw new Error('MySQL worker initialization failed');
    }
    this._ready = true;
  }

  _syncRequest(payload) {
    this._waitReady();

    const id = this._requestId++;
    const { port1, port2 } = new MessageChannel();
    
    this._worker.postMessage(Object.assign({ id, port: port2 }, payload), [port2]);

    let response = null;
    while (true) {
      const msg = receiveMessageOnPort(port1);
      if (msg) {
        response = msg.message;
        break;
      }
      // Busy wait or small sleep? Since it's local, it should be very fast.
      // We don't want to block the port from receiving messages.
    }

    port1.close();

    if (response.error) {
      const err = new Error(response.error.message || response.error || 'Unknown MySQL error');
      err.code = response.error.code;
      throw err;
    }
    return response.result;
  }

  query(sql, values = []) {
    return this._syncRequest({ type: 'query', sql, values });
  }

  call(name, args = []) {
    return this._syncRequest({ type: 'call', name, args });
  }

  dispose() {
    this._worker.postMessage({ type: 'dispose' });
  }

  end() {
    return this.dispose();
  }
}

module.exports = SyncMySQL;