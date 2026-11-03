// Trusted, opt-in software fixtures. These are not astronomical models.
// The composition root imports these validators; the core never imports them.

const diagnostic = (node, field, code, message) => ({
  path: `nodes[${JSON.stringify(node.id)}]${field ? `.${field}` : ''}`,
  code,
  message,
});

function requireKind(node, kind) {
  return node.kind === kind ? [] : [diagnostic(
    node, 'kind', 'FIXTURE_KIND', `${node.type} must be a ${kind}.`,
  )];
}

function point(node) {
  const errors = requireKind(node, 'component');
  const position = node.data.position;
  if (!Array.isArray(position) || position.length !== 3
      || !position.every(value => typeof value === 'number' && Number.isFinite(value))) {
    errors.push(diagnostic(node, 'data.position', 'FIXTURE_POSITION',
      'A fixture point needs three finite position coordinates.'));
  }
  return errors;
}

function label(node, { project }) {
  const errors = requireKind(node, 'component');
  if (typeof node.data.text !== 'string' || !node.data.text.trim()) {
    errors.push(diagnostic(node, 'data.text', 'FIXTURE_TEXT',
      'A fixture label needs nonempty text.'));
  }
  const anchors = project.nodes.filter(candidate => candidate.kind === 'relationship'
    && candidate.type === 'fixture.anchor' && candidate.references.source === node.id);
  if (anchors.length !== 1) {
    errors.push(diagnostic(node, '', 'FIXTURE_ANCHOR_REQUIRED',
      'A fixture label needs exactly one fixture.anchor relationship to a point.'));
  }
  return errors;
}

function endpoints(node, { get }, sourceType, targetType) {
  const errors = requireKind(node, 'relationship');
  for (const [slot, type] of [['source', sourceType], ['target', targetType]]) {
    const target = get(node.references[slot]);
    if (!target || target.kind !== 'component' || target.type !== type) {
      errors.push(diagnostic(node, `references.${slot}`, 'FIXTURE_ENDPOINT',
        `${node.type} ${slot} must reference a ${type} component.`));
    }
  }
  return errors;
}

/** Pass this explicitly to new Project({ validators: fixtureValidators }). */
export const fixtureValidators = {
  structure: [project => project.nodes.length > 128 ? [{
    path: 'nodes',
    code: 'FIXTURE_SIZE',
    message: 'This small fixture permits at most 128 nodes.',
  }] : []],
  types: {
    'fixture.point': point,
    'fixture.label': label,
    'fixture.anchor': (node, context) => endpoints(
      node, context, 'fixture.label', 'fixture.point',
    ),
    'fixture.link': (node, context) => endpoints(
      node, context, 'fixture.point', 'fixture.point',
    ),
  },
};
