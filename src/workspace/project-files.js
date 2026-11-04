// Portable file controls. The host validates each document and owns every write.
const maxFileBytes = 16 * 1024 * 1024;
const validName = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const sameToken = (a, b) => a && b && a.projectId === b.projectId && a.generation === b.generation && a.revision === b.revision;

export async function readProjectFile(file) {
  if (!file || file.size > maxFileBytes) throw new Error('Choose a JSON project of at most 16 MiB.');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    return JSON.parse(text);
  } catch { throw new Error('The file must contain a UTF-8 JSON project.'); }
}

export function setProjectTime(input, seconds, range) {
  if (!Number.isFinite(seconds)) throw new Error('Saved physical time must be finite.');
  input.min = String(Math.min(0, Math.floor(seconds)));
  input.max = String(seconds > 8 ? Math.ceil(seconds + 8) : 8);
  input.step = Number.isInteger(seconds * 4) ? '0.25' : 'any';
  if (range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min) {
    input.min = String(Math.min(seconds, range.min));
    input.max = String(Math.max(seconds, range.max));
    input.step = 'any';
    if (input.dataset) input.dataset.advance = String((range.max - range.min) / 120);
  } else if (input.dataset) delete input.dataset.advance;
  input.value = String(seconds);
}

export function createProjectFiles({ getIdentity, getTime, enqueue, onLoad, fetch: fetcher = fetch, document: page = document }) {
  const byId = id => page.getElementById(id);
  const nameInput = byId('project-name'), list = byId('project-list'), feedback = byId('project-feedback');
  const localPrivacy = byId('project-save-transcript'), filePrivacy = byId('project-share-transcript');
  let status, entries = [], busy = false, listEpoch = 0;

  async function request(route, data) {
    const response = await fetcher(`/api/projects/${route}`, data === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const envelope = await response.json();
    if (!response.ok || !envelope.ok) throw Object.assign(new Error(envelope.error?.message ?? 'Project request failed.'), envelope.error);
    return envelope.result;
  }
  function message(text, error = false) { feedback.textContent = text; feedback.dataset.error = String(error); }
  function render() {
    const selected = entries.find(item => item.name === list.value);
    byId('project-open').disabled = busy || !selected;
    for (const id of ['project-save', 'project-download', 'project-import', 'project-list-refresh']) byId(id).disabled = busy;
    if (!status) return;
    byId('project-current').textContent = status.name ?? 'Unnamed project';
    const time = status.playback?.time?.value;
    const changedTime = Number.isFinite(time) && getTime().value !== time;
    byId('project-dirty').textContent = status.dirty ? 'Unsaved changes' : changedTime ? 'Playhead differs from local save' : 'Current construction saved';
    byId('project-dirty-dot').hidden = !status.dirty && !changedTime;
    const source = { matches: 'Matches the construction', diverged: 'Construction has changed since the recipe ran', unavailable: 'Original recipe unavailable' };
    byId('project-source').textContent = `${source[status.sourceStatus] ?? 'Unavailable'}${status.sourcePath ? ` · ${status.sourcePath}` : ''}`;
    byId('project-replay').textContent = Number.isFinite(time)
      ? `${time} s · replay from initial conditions (${status.playback.mode ?? 'auto'})${changedTime ? ` · displayed ${getTime().value} s` : ''}`
      : 'Time unavailable';
    byId('project-privacy').textContent = status.includeTranscript ? 'Public transcript included in the project' : 'Public transcript excluded from the project';
  }
  function observe(next, { reset = false } = {}) {
    if (!next || !sameToken(next.identity, getIdentity())) return;
    status = next;
    if (reset) {
      localPrivacy.checked = false; filePrivacy.checked = false; nameInput.value = next.name ?? '';
      list.value = next.name ?? ''; message('');
    }
    render();
  }
  async function refreshList() {
    const epoch = ++listEpoch, result = await request('list');
    if (epoch !== listEpoch) return;
    entries = result;
    const selected = list.value || status?.name || '';
    list.replaceChildren(new Option('Choose a local save…', ''));
    for (const entry of entries) list.append(new Option(entry.name, entry.name));
    list.value = entries.some(entry => entry.name === selected) ? selected : '';
    render();
  }
  async function refreshStatus() { const next = await request('state'); observe(next); return next; }
  async function run(label, work) {
    if (busy) return;
    busy = true; message(label); render();
    try { await enqueue(work); }
    catch (error) { message(`${error.code ? `${error.code} · ` : ''}${error.message}`, true); }
    finally { busy = false; render(); }
  }
  byId('project-save-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = nameInput.value.trim(), includeTranscript = localPrivacy.checked;
    if (!validName.test(name)) { message('Use 1–64 lowercase letters, numbers, hyphens or underscores, beginning with a letter or number.', true); return; }
    const expectedVersion = status?.name === name ? status.version : entries.find(entry => entry.name === name && list.value === name)?.version ?? null;
    run('Saving project…', async () => {
      const saved = await request('save', { expected: getIdentity(), name, expectedVersion, time: getTime(), includeTranscript });
      observe(saved); await refreshList(); list.value = name;
      message(`Saved ${name}${includeTranscript ? ' with public conversation.' : '.'}`);
    });
  });
  list.addEventListener('change', () => { if (list.value) nameInput.value = list.value; render(); });
  byId('project-list-refresh').addEventListener('click', () => run('Refreshing…', async () => { await refreshList(); message('List refreshed.'); }));
  byId('project-open').addEventListener('click', () => {
    const entry = entries.find(item => item.name === list.value); if (!entry) return;
    run('Opening project…', async () => { await onLoad(await request('open', { expected: getIdentity(), name: entry.name, expectedVersion: entry.version })); message(`Opened ${entry.name}.`); });
  });
  byId('project-import').addEventListener('click', () => byId('project-file').click());
  byId('project-file').addEventListener('change', event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    run('Importing project…', async () => {
      const expected = getIdentity(), document = await readProjectFile(file);
      await onLoad(await request('import', { expected, document })); message(`Imported ${file.name}.`);
    });
  });
  byId('project-download').addEventListener('click', () => {
    const includeTranscript = filePrivacy.checked;
    run('Preparing download…', async () => {
      const document = await request('export', { expected: getIdentity(), time: getTime(), includeTranscript });
      const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2), '\n'], { type: 'application/json' }));
      const link = page.createElement('a'); link.href = url; link.download = `${status?.name ?? 'cosmic-lego-project'}.json`;
      page.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      message(includeTranscript ? 'Downloaded project with public conversation.' : 'Downloaded project. Conversation excluded.');
    });
  });
  return {
    observe, render, refreshStatus,
    async openMenu() { message(''); try { await Promise.all([refreshStatus(), refreshList()]); } catch (error) { message(error.message, true); } },
  };
}
