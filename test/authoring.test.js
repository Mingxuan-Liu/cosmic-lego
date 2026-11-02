import test from 'node:test';
import assert from 'node:assert/strict';
import { auditOverlapLesson } from '../experiments/agent-a-overlap.mjs';
import { audit } from '../experiments/agent-b-eccentricity.mjs';

test('independently authored overlap lesson demonstrates double-counting and structural removal',()=>{
  const report=auditOverlapLesson();
  assert.ok(Math.abs(report.overcountPpm-2865.2629273592247)<1e-5);
  assert.ok(report.combinedDeficit<report.naiveDeficit);
  assert.deepEqual(report.afterRemoval.planets,['amber','violet']);
  assert.equal(report.afterRemoval.amberPositionUnchanged,true);
  assert.deepEqual(report.sampledTiltedFluxRange,[1,1]);
});

test('independently authored eccentricity lesson retains constraints across construction edits',()=>{
  assert.equal(audit.after.axis.periodRatio,1);
  assert.ok(Math.abs(audit.after.periapsis.periodRatio-2*Math.sqrt(2))<1e-12);
  assert.ok(Math.abs(audit.after.periapsis.periapsisAU-audit.before.periapsisAU)<1e-14);
  assert.equal(audit.structural.dynamicCountWithProbe,5);
  assert.equal(audit.structural.dynamicCountAfterRemoval,4);
  assert.deepEqual(audit.structural.observerIds,['earthward','oblique']);
});
