// Run in the author's process: node examples/extension-registry.mjs
// This produces checked scientific and declarative asset/view data, not pixels.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { registryExtensions } from './fixtures/registry-extensions.js';

export function buildExample() {
  const registry = new ExtensionRegistry({
    capabilities: ['dataflow.sync', 'assets.data', 'views.data'],
  });
  for (const extension of registryExtensions) registry.register(extension);
  const binding = registry.bind();
  const project = new Project({
    id: 'registered-fixtures', title: 'Declared models, operators, assets, and views',
    validators: binding.validators,
  });
  const draft = project.begin();
  const author = binding.author(draft);
  const point = author.instantiate('fixture.moving-point', {
    id: 'moving', parameters: { r0: [1, -2, 3], v: [2, -1, 0.5] },
  });
  const length = author.constant(value({
    kind: 'scalar', data: -3, unit: 'm', meaning: 'length',
  }), { id: 'length' });
  author.instantiate('fixture.scale-length', {
    id: 'scaled-length', parameters: { factor: 2.5 }, inputs: { source: length },
  });
  const geometry = author.instantiate('fixture.point-geometry', {
    id: 'marker', parameters: { size: 0.25 },
  });
  author.instantiate('fixture.point-view', {
    id: 'point-view', parameters: { targetId: point.id, markerScale: 3 },
    inputs: { position: { node: point, port: 'position' } }, assets: { geometry },
  });
  draft.accept();
  return { registry, binding, project };
}

export default buildExample;

function checked(result, label) {
  assert.equal(result.valid, true, `${label}: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

export function demonstrate() {
  const { registry, binding, project } = buildExample();
  const declaredReview = registry.discover().extensions.map(extension => extension.review.declaredStatus);
  const contracts = registryExtensions.map(extension => registry.runContractTests(extension.manifest.id));
  assert.equal(contracts.reduce((sum, report) => sum + report.cases.length, 0), 8);
  for (const report of contracts) {
    assert.equal(report.passed, true, `${report.extensionId}: ${JSON.stringify(report.cases)}`);
    assert.ok(report.cases.every(referenceCase => referenceCase.passed));
    assert.equal(report.scientificCertification, false);
  }
  const time = { value: 2, unit: 's' };
  const position = checked(binding.evaluate(project, 'moving', { port: 'position', time }), 'position');
  const scaled = checked(binding.evaluate(project, 'scaled-length', { time }), 'scaled length');
  const geometry = checked(binding.produce(project, 'marker', { time }), 'geometry');
  const view = checked(binding.produce(project, 'point-view', { time }), 'view');
  assert.deepEqual(position.value.data, [5, -4, 4]);
  assert.equal(scaled.value.data, -7.5);
  assert.equal(scaled.value.unit.symbol, 'm');
  assert.equal(geometry.artifact.kind, 'geometry');
  assert.deepEqual(geometry.artifact.data, { positions: [[0, 0, 0]], size: 0.25 });
  assert.deepEqual(view.artifact.data.position, position.value.data);
  assert.equal(view.artifact.data.markerScale, 3);
  assert.deepEqual(view.artifact.data.geometry, geometry.artifact.data);

  const draft = project.begin();
  const authoredView = draft.get('point-view');
  authoredView.set({ data: {
    ...authoredView.value.data,
    parameters: { ...authoredView.value.data.parameters, markerScale: 7 },
  } });
  draft.accept();
  const afterEdit = checked(binding.produce(project, 'point-view', { time }), 'edited view');
  const afterPosition = checked(binding.evaluate(project, 'moving', { port: 'position', time }), 'unchanged position');
  assert.equal(afterEdit.artifact.data.markerScale, 7);
  assert.deepEqual(afterPosition.value, position.value);

  const discovery = registry.discover();
  assert.equal(discovery.extensions.length, 4);
  assert.ok(discovery.extensions.every(extension => !extension.review.independentlyVerified));
  assert.deepEqual(discovery.extensions.map(extension => extension.review.declaredStatus), declaredReview);
  return {
    extensions: discovery.extensions.map(extension => ({
      id: extension.manifest.id, kind: extension.manifest.kind,
      review: extension.review,
    })),
    contracts,
    identity: project.token,
    position: position.value.data,
    scaledLength: { data: scaled.value.data, unit: scaled.value.unit.symbol },
    geometry: geometry.artifact,
    view: afterEdit.artifact,
    requirements: binding.requirements(project.snapshot()),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(demonstrate(), null, 2));
}
