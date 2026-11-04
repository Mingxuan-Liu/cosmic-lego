// Local-only creation. The player itself does not need Playwright.
import { pathToFileURL } from 'node:url';
import { open } from 'node:fs/promises';
import { PORTABLE_LIMITS } from '../src/portable/format.js';
import { exportFrames, packagePlayer } from '../src/timeline/export.js';

const usage = 'Use export <project.json> <new-directory> --start S --end S --fps N --width W --height H, or package <project.json> <new-directory>.';
async function readInput(file) {
  const input = await open(file, 'r');
  try {
    const info = await input.stat();
    if (!info.isFile() || info.size > PORTABLE_LIMITS.maxBytes) throw new Error('Choose a regular project file of at most 16 MiB.');
    const data = Buffer.alloc(info.size + 1);
    let read = 0;
    while (read < data.length) {
      const { bytesRead } = await input.read(data, read, data.length - read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    if (read !== info.size) throw new Error('Project file changed during the read. Retry with the completed document.');
    return data.subarray(0, read);
  } finally { await input.close(); }
}

export async function runDelivery(args, composition) {
  const [command, file, directory, ...flags] = args;
  if (!['export', 'package'].includes(command) || !file || !directory) throw new Error(usage);
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (command === 'export') { process.on('SIGINT', stop); process.on('SIGTERM', stop); }
  try {
    const schedule = {};
    for (let i = 0; i < flags.length; i += 2) {
      const key = flags[i].slice(2);
      if (command !== 'export' || !flags[i].startsWith('--') || !['start', 'end', 'fps', 'width', 'height'].includes(key)
          || Object.hasOwn(schedule, key) || !flags[i + 1]?.trim()) throw new Error(usage);
      schedule[key] = Number(flags[i + 1]);
    }
    const manifest = await readInput(file);
    const result = command === 'package' ? await packagePlayer({ manifest, directory, composition }) :
      await exportFrames({ manifest, directory, composition, schedule, signal: controller.signal });
    console.log(JSON.stringify(result, null, 2));
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) try {
  await runDelivery(process.argv.slice(2));
} catch (error) {
  console.error(error.code ? error.code + ' · ' + error.message : error.message);
  process.exitCode = error.code === 'EXPORT_INTERRUPTED' ? 130 : 1;
}
