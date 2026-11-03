import { Project } from '../core/index.js';
import { copyData, isRecord } from '../core/data.js';
import { value, descriptorOf, checkPort } from '../dataflow/index.js';
import { SCIENTIFIC, diagnostic, issue, keys, requireThat } from './contracts.js';

export function prepareCases(input, maxCases) {
  const cases = copyData(input ?? []);
  requireThat(Array.isArray(cases) && cases.length <= maxCases, 'CONTRACT_CASES', `Supply at most ${maxCases} data-only reference cases.`);
  const ids = new Set();
  return cases.map(item => {
    keys(item, ['id', 'description', 'parameters', 'inputs', 'assets', 'request', 'expected', 'expectedError', 'tolerance'], 'reference case');
    requireThat(typeof item.id === 'string' && item.id.trim() && !ids.has(item.id) && typeof item.description === 'string' && item.description.trim(), 'CONTRACT_CASES', 'Cases need unique IDs and meaningful descriptions.');
    ids.add(item.id);
    requireThat((item.expected !== undefined) !== (item.expectedError !== undefined), 'CONTRACT_CASES', 'Supply expected results or one expected error code.');
    if (item.expectedError !== undefined) requireThat(typeof item.expectedError === 'string' && item.expectedError.trim(), 'CONTRACT_CASES', 'Expected error must be a nonempty code.');
    if (item.expected !== undefined) {
      keys(item.expected, ['outputs', 'artifact'], 'case expectation');
      requireThat((item.expected.outputs !== undefined) !== (item.expected.artifact !== undefined), 'CONTRACT_CASES', 'Expect scientific outputs or artifact data.');
      if (item.expected.outputs !== undefined) {
        requireThat(isRecord(item.expected.outputs) && Object.keys(item.expected.outputs).length > 0, 'CONTRACT_CASES', 'Expected outputs must be a nonempty map.');
        item.expected.outputs = Object.fromEntries(Object.entries(item.expected.outputs).map(([port, result]) => [port, value(result)]));
      }
    }
    const tolerance = item.tolerance ?? { absolute: 0, relative: 0 };
    keys(tolerance, ['absolute', 'relative'], 'tolerance');
    requireThat(['absolute', 'relative'].every(key => Number.isFinite(tolerance[key]) && tolerance[key] >= 0), 'CONTRACT_CASES', 'Tolerances must be finite and nonnegative.');
    const parameters = item.parameters ?? {}, inputs = item.inputs ?? {}, assets = item.assets ?? {};
    requireThat(isRecord(parameters) && isRecord(inputs) && isRecord(assets), 'CONTRACT_CASES', 'Case parameters, inputs and assets must be objects.');
    for (const asset of Object.values(assets)) {
      keys(asset, ['extension', 'parameters'], 'case asset');
      requireThat(typeof asset.extension === 'string' && asset.extension && (asset.parameters === undefined || isRecord(asset.parameters)), 'CONTRACT_CASES', 'A case asset names an installed extension and optional parameters.');
    }
    return { ...item, parameters, inputs: Object.fromEntries(Object.entries(inputs).map(([slot, input]) => [slot, value(input)])), assets, tolerance };
  });
}

function compare(actual, expected, tolerance, path, errors) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance.absolute + tolerance.relative * Math.abs(expected)) {
      errors.push(diagnostic('REFERENCE_MISMATCH', `Expected ${expected}; received ${actual}.`, path));
    }
  } else if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) errors.push(diagnostic('REFERENCE_MISMATCH', 'Array shape differs from the reference case.', path));
    else expected.forEach((entry, i) => compare(actual[i], entry, tolerance, `${path}[${i}]`, errors));
  } else if (isRecord(expected)) {
    if (!isRecord(actual) || JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort())) errors.push(diagnostic('REFERENCE_MISMATCH', 'Object fields differ from the reference case.', path));
    else for (const key of Object.keys(expected)) compare(actual[key], expected[key], tolerance, `${path}.${key}`, errors);
  } else if (actual !== expected) errors.push(diagnostic('REFERENCE_MISMATCH', `Expected ${String(expected)}; received ${String(actual)}.`, path));
}

function compareValue(actual, expected, tolerance, errors, port) {
  const normalized = value(expected);
  errors.push(...checkPort(actual, descriptorOf(normalized)));
  compare(actual.data, normalized.data, tolerance, `${port}.data`, errors);
  for (const warning of normalized.metadata.warnings) if (!actual.metadata.warnings.some(found =>
    found.code === warning.code && found.path === warning.path && found.message === warning.message)) errors.push(diagnostic('REFERENCE_METADATA', `Missing expected warning ${warning.code}.`, port));
  for (const approximation of normalized.metadata.approximation) if (!actual.metadata.approximation.includes(approximation)) errors.push(diagnostic('REFERENCE_METADATA', `Missing approximation ${approximation}.`, port));
}

export function runCases(record, binding) {
  const outcomes = record.referenceCases.map(reference => {
    const errors = [], observedErrors = [];
    try {
      // A report label is not a project/node identifier. Keep setup independent
      // of label length/punctuation so an unrelated ID error cannot pass a case.
      const project = new Project({ validators: binding.validators });
      const draft = project.begin(), author = binding.author(draft);
      const inputs = Object.fromEntries(Object.entries(reference.inputs).map(([slot, input], index) => [slot, author.constant(input, { id: `input-${index}` })]));
      const assets = Object.fromEntries(Object.entries(reference.assets).map(([slot, asset], index) => [slot, author.instantiate(asset.extension, { id: `asset-${index}`, parameters: asset.parameters ?? {} })]));
      author.instantiate(record.manifest.id, { id: 'subject', parameters: reference.parameters, inputs, assets });
      draft.accept();
      if (SCIENTIFIC.has(record.manifest.kind)) {
        const ports = reference.expected?.outputs ? Object.keys(reference.expected.outputs) : Object.keys(record.manifest.ports.outputs);
        for (const port of ports) {
          const result = binding.evaluate(project, 'subject', { ...reference.request, port });
          if (!result.valid) observedErrors.push(...result.diagnostics.filter(item => item.severity !== 'warning'));
          else if (reference.expected?.outputs?.[port]) compareValue(result.value, reference.expected.outputs[port], reference.tolerance, errors, port);
        }
        if (reference.expected && !reference.expected.outputs) errors.push(diagnostic('CONTRACT_CASES', 'A scientific case must expect outputs.'));
      } else {
        const result = binding.produce(project, 'subject', reference.request ?? {});
        if (!result.valid) observedErrors.push(...result.diagnostics.filter(item => item.severity !== 'warning'));
        else if (reference.expected?.artifact !== undefined) compare(result.artifact.data, reference.expected.artifact, reference.tolerance, '$.artifact', errors);
        else if (reference.expected) errors.push(diagnostic('CONTRACT_CASES', 'An artifact case must expect artifact data.'));
      }
    } catch (error) { observedErrors.push(...(error?.validation?.errors ?? [issue(error)])); }
    if (reference.expectedError) {
      if (!observedErrors.some(error => error.code === reference.expectedError)) errors.push(diagnostic('EXPECTED_ERROR', `Expected ${reference.expectedError}; observed ${observedErrors.map(error => error.code).join(', ') || 'success'}.`));
    } else errors.push(...observedErrors);
    return { id: reference.id, description: reference.description, passed: !errors.length, diagnostics: errors, observedErrors, tolerance: copyData(reference.tolerance) };
  });
  const failed = outcomes.filter(outcome => !outcome.passed).length;
  return { extensionId: record.manifest.id, implementation: copyData(record.manifest.implementation),
    passed: outcomes.length > 0 && failed === 0, total: outcomes.length, failed, cases: outcomes, scientificCertification: false };
}
