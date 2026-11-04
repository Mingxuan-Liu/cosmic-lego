// Data-only CLI for the same gateway used by the browser and author SDK.
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHttpGatewayClient } from '../src/gateway/sdk.js';

const usage = `Cosmic Lego command gateway
Usage:
  node scripts/gateway.mjs discover [--url http://127.0.0.1:4326]
  node scripts/gateway.mjs inspect [component-id] [--url ...]
  node scripts/gateway.mjs request request.json [--url ...]
  node scripts/gateway.mjs request - [--url ...]  # Read JSON from stdin

Requests are gateway envelopes. Mutations require the expected project token
and an idempotencyKey. Discover schemas first; inspect returns the current token.
This CLI reads JSON data only. Author JavaScript recipes run in your own process.
`;
const cliError = message => Object.assign(new Error(message), { code: 'CLI_ARGUMENT' });
const decode = bytes => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw cliError('Expected valid UTF-8 JSON request data.'); }
};
export async function runCLI(argv, { input = process.stdin, output = process.stdout, errors = process.stderr, client: suppliedClient } = {}) {
  try {
    if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
      if (argv.length > 1) throw cliError('Help does not accept extra arguments.');
      output.write(usage); return 0;
    }
    const positional = []; let url;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--url') { if (url || !argv[i + 1] || argv[i + 1].startsWith('--')) throw cliError('Specify --url once with a loopback URL.'); url = argv[++i]; }
      else if (argv[i].startsWith('--')) throw cliError(`Unsupported option ${argv[i]}.`);
      else positional.push(argv[i]);
    }
    const [command, argument, ...extra] = positional;
    if (extra.length || !['discover', 'inspect', 'request'].includes(command) || command === 'discover' && argument !== undefined || command === 'request' && argument === undefined) throw cliError('Use discover, inspect [id], or request <JSON file|->.');
    const client = suppliedClient ?? createHttpGatewayClient(url ? { url } : {});
    let outcome;
    if (command === 'discover') outcome = await client.discover();
    else if (command === 'inspect') outcome = await client.inspect(argument);
    else {
      let text = '';
      if (argument === '-') {
        const chunks = []; let size = 0;
        for await (const chunk of input) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length; if (size > 65536) throw cliError('Request exceeds 64 KiB.');
          chunks.push(bytes);
        }
        text = decode(Buffer.concat(chunks, size));
      } else {
        const file = await open(argument, 'r');
        try {
          const buffer = Buffer.alloc(65537); let size = 0;
          while (size < buffer.length) { const { bytesRead } = await file.read(buffer, size, buffer.length - size, size); if (!bytesRead) break; size += bytesRead; }
          if (size > 65536) throw cliError('Request exceeds 64 KiB.'); text = decode(buffer.subarray(0, size));
        } finally { await file.close(); }
      }
      let data; try { data = JSON.parse(text); } catch { throw cliError('Expected JSON request data, not executable source.'); }
      outcome = await client.request(data);
    }
    output.write(JSON.stringify(outcome, null, 2) + '\n'); return outcome.ok ? 0 : 1;
  } catch (error) {
    errors.write(JSON.stringify({ ok: false, error: { code: error.code ?? 'TRANSPORT_ERROR', message: error.message } }) + '\n'); return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runCLI(process.argv.slice(2));
