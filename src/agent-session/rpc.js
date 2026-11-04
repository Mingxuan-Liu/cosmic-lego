import { KernelError } from '../core/index.js';
import { copyData } from '../core/data.js';

// Native app-server uses JSON objects separated by LF, not Content-Length frames.
// Raw stderr and unknown notifications never become public transcript messages.
export function createJsonLineRpc(child, { onNotification, onRequest, onClose, maxFrameBytes = 16777216, maxPending = 64, timeoutMs = 30000 } = {}) {
  let nextId = 0, ended = false, buffered = Buffer.alloc(0);
  const pending = new Map();
  const failure = (code, message) => new KernelError(code, message);
  const finish = error => {
    if (ended) return; ended = true;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear(); buffered = Buffer.alloc(0); onClose?.(error);
  };
  function write(message) {
    if (ended) throw failure('AGENT_DISCONNECTED', 'The native agent connection is closed.');
    const frame = Buffer.from(`${JSON.stringify(copyData(message))}\n`);
    if (frame.length > maxFrameBytes) throw failure('AGENT_PROTOCOL_BUDGET', 'Native agent message exceeds the frame limit.');
    if ((child.stdin.writableLength ?? 0) + frame.length > maxFrameBytes) {
      const error = failure('AGENT_PROTOCOL_BUDGET', 'Native agent input queue exceeds its byte limit.');
      finish(error); child.kill('SIGTERM'); throw error;
    }
    child.stdin.write(frame);
  }
  child.stdout.on('data', chunk => {
    if (ended) return;
    try {
      buffered = Buffer.concat([buffered, chunk]);
      let newline;
      while ((newline = buffered.indexOf(10)) >= 0) {
        if (newline > maxFrameBytes) throw failure('AGENT_PROTOCOL_BUDGET', 'Native agent frame exceeds its byte limit.');
        const line = buffered.subarray(0, newline); buffered = buffered.subarray(newline + 1);
        if (!line.length) continue;
        const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw failure('AGENT_PROTOCOL', 'Expected a native protocol object.');
        if (typeof message.method === 'string') {
          if (Object.hasOwn(message, 'id')) {
            Promise.resolve(onRequest?.(message)).catch(() => {
              try { write({ id: message.id, error: { code: -32603, message: 'Host request handler failed.' } }); } catch { /* disconnected */ }
            });
          } else onNotification?.(message);
        } else if (Object.hasOwn(message, 'id')) {
          const entry = pending.get(message.id); if (!entry) continue;
          pending.delete(message.id); clearTimeout(entry.timer);
          if (message.error) entry.reject(failure('AGENT_RPC', String(message.error.message ?? 'Native agent request failed.').slice(0, 2000)));
          else if (Object.hasOwn(message, 'result')) entry.resolve(message.result);
          else entry.reject(failure('AGENT_PROTOCOL', 'Native response omitted its result.'));
        }
      }
      if (buffered.length > maxFrameBytes) throw failure('AGENT_PROTOCOL_BUDGET', 'Native agent frame exceeds its byte limit.');
    } catch (error) {
      finish(error instanceof KernelError ? error : failure('AGENT_PROTOCOL', 'Invalid native agent JSON/UTF-8 frame.'));
      child.kill('SIGTERM');
    }
  });
  child.stderr?.on('data', () => {});
  child.on('error', () => finish(failure('AGENT_EXECUTABLE', 'Could not start the configured local agent executable.')));
  child.on('exit', () => finish(failure('AGENT_DISCONNECTED', 'The local agent process exited.')));
  child.stdin.on('error', () => finish(failure('AGENT_DISCONNECTED', 'The local agent input stream closed.')));
  return Object.freeze({
    request(method, params, options = {}) {
      if (ended) return Promise.reject(failure('AGENT_DISCONNECTED', 'The native agent connection is closed.'));
      if (pending.size >= maxPending) return Promise.reject(failure('AGENT_PROTOCOL_BUDGET', 'Too many pending native agent requests.'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(failure('AGENT_TIMEOUT', `Native ${method} request timed out.`)); }, options.timeoutMs ?? timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { write({ id, method, params }); } catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
    notify: (method, params = {}) => write({ method, params }),
    respond: (id, result) => write({ id, result }),
    reject: (id, message = 'Unsupported host request.') => write({ id, error: { code: -32601, message } }),
    close() { finish(failure('AGENT_DISCONNECTED', 'Native connection closed by the host.')); },
  });
}
