// Run in the author's own process: node examples/composition-kernel.mjs
// This example only constructs data. It does not render or evaluate a model.
import { pathToFileURL } from 'node:url';
import { Project } from '../src/core/index.js';
import { fixtureValidators } from './fixtures/composition-types.js';

/** A composition root explicitly supplies trusted validators to the kernel. */
export function buildExample() {
  const project = new Project({
    id: 'labeled-points',
    title: 'Three labeled points and a relationship ring',
    validators: fixtureValidators,
  });
  const draft = project.begin();

  function labeledPoint(index, position) {
    const point = draft.component('fixture.point', {
      id: `point-${index}`,
      data: { position },
    });
    const label = draft.component('fixture.label', {
      id: `label-${index}`,
      data: { text: `Point ${index}` },
    });
    return { point, label };
  }

  const pairs = [[0, 0, 0], [2, 0, 0], [1, 2, 0]]
    .map((position, index) => labeledPoint(index, position));

  // A staged draft may be incomplete. Acceptance cannot bypass the validator.
  const incomplete = draft.validate();
  if (incomplete.valid || !incomplete.errors.some(error => error.code === 'FIXTURE_ANCHOR_REQUIRED')) {
    throw new Error('Expected the staged labels to need anchor relationships.');
  }

  for (const [index, { point, label }] of pairs.entries()) {
    const anchor = draft.connect('fixture.anchor', label, point, { id: `anchor-${index}` });
    // Declare the label's dependence on its anchor explicitly so cascading
    // removal can find it. This creates a valid label↔anchor reference cycle.
    label.set({ references: { anchor: anchor.id } });
    draft.connect('fixture.link', point, pairs[(index + 1) % pairs.length].point, {
      id: `link-${index}`,
    });
  }
  draft.accept();
  return project;
}

export default buildExample;

/** Demonstrate data commands and edit history separately from any animation. */
export function demonstrate() {
  const project = buildExample();
  const token = project.token;
  const operations = [{
    op: 'update',
    id: 'point-0',
    patch: { data: { position: [0, 0, 1] } },
  }];
  const preview = project.preview(operations, token);
  const acceptedPositionBeforeApply = project.get('point-0').value.data.position;
  project.apply(operations, token);
  const editedRevision = project.token.revision;
  project.undo(project.token);
  const positionAfterUndo = project.get('point-0').value.data.position;
  const undoRevision = project.token.revision;
  project.redo(project.token);

  return {
    projectId: project.token.projectId,
    nodes: project.snapshot().nodes.length,
    previewValid: preview.validation.valid,
    acceptedPositionBeforeApply,
    positionAfterUndo,
    positionAfterRedo: project.get('point-0').value.data.position,
    revisions: [editedRevision, undoRevision, project.token.revision],
    point0References: project.dependencies('point-0', {
      direction: 'incoming', edge: 'reference', transitive: true,
    }),
    computationalDependencies: project.dependencies('point-0', {
      edge: 'computation', transitive: true,
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(demonstrate(), null, 2));
}
