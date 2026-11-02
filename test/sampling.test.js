import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sdk.js';
import { sampleMeasurements, evaluateScene, applyOperations } from '../src/scene.js';

function makeScene({massSolar=.1,radiusSolar=.1,semiMajorAxisAU=5,eccentricity=0,direction=[0,0,1],inclinationDeg=90,argumentPeriapsisDeg=90,durationDays=1000,occulters='orbiting'}={}) {
  const world=new World();
  const star=world.star({id:'s',massSolar,radiusSolar});
  const planet=world.planet({id:'p',massJupiter:.05,radiusJupiter:.2});
  planet.orbit(star,{id:'orbit',semiMajorAxisAU,eccentricity,inclinationDeg,argumentPeriapsisDeg});
  const observer=world.observer({id:'o',direction});
  world.transits(star,observer,{id:'photometer',occulters});
  world.present({startDays:-.25,durationDays});
  return world.build();
}

test('event-guided sampling recovers a narrow transit missed by the uniform cadence',()=>{
  const scene=makeScene();
  const exact=evaluateScene(scene,0).measurements[0].flux;
  const sampled=sampleMeasurements(scene,{samples:721});
  assert.ok(exact<.96);
  assert.ok(Math.abs(Math.min(...sampled.tracks[0].points.map(p=>p.flux))-exact)<1e-12);
  assert.ok(sampled.tracks[0].points.length>721);
  assert.equal(sampled.sampling.budgetLimited,false);
  assert.equal(sampled.sampling.tracks[0].sampledEvents,1);
});

test('eccentric orbits and a non-default observer get physical-time event samples',()=>{
  const scene=makeScene({massSolar:1,semiMajorAxisAU:.5,eccentricity:.8,direction:[1,0,0],inclinationDeg:0,argumentPeriapsisDeg:0,durationDays:270});
  const initial=evaluateScene(scene,0),period=initial.planets[0].periodDays;
  const sampled=sampleMeasurements(scene,{samples:17});
  assert.equal(sampled.sampling.tracks[0].sampledEvents,3);
  for(const center of [0,period,2*period]) {
    const nearest=sampled.tracks[0].points.reduce((a,b)=>Math.abs(a.timeDays-center)<Math.abs(b.timeDays-center)?a:b);
    assert.ok(Math.abs(nearest.timeDays-center)<1e-9);
    assert.ok(nearest.flux<.96);
    assert.equal(nearest.flux,evaluateScene(scene,nearest.timeDays).measurements[0].flux);
  }
});

test('bounded event sampling reports omitted events instead of claiming a resolved curve',()=>{
  const scene=makeScene({massSolar:1,semiMajorAxisAU:.005});
  const sampled=sampleMeasurements(scene,{samples:17});
  assert.equal(sampled.sampling.budgetLimited,true);
  assert.match(sampled.sampling.warning,/omitted/);
  const detail=sampled.sampling.tracks[0];
  assert.ok(detail.eventsInWindow>1000);
  assert.ok(detail.sampledEvents<=160);
  assert.ok(sampled.tracks[0].points.length<=8192);
  assert.ok(sampled.tracks[0].points.every(p=>Number.isFinite(p.flux)&&p.flux>=0&&p.flux<=1));
  assert.ok(sampled.tracks[0].points.every((p,i,a)=>i===0||p.timeDays>a[i-1].timeDays));
});

test('explicit empty occulter selection retains a flat baseline with no event claims',()=>{
  const sampled=sampleMeasurements(makeScene({occulters:[]}),{samples:17});
  assert.equal(sampled.tracks[0].points.length,17);
  assert.equal(sampled.sampling.tracks[0].sampledEvents,0);
  assert.ok(sampled.tracks[0].points.every(p=>p.flux===1));
});

test('unknown semantic operation arguments fail before changing the scene',()=>{
  const scene=makeScene(),before=structuredClone(scene);
  assert.throws(()=>applyOperations(scene,[{op:'set_title',title:'Changed',titel:'typo'}]),/Unsupported argument.*titel/);
  assert.throws(()=>applyOperations(scene,[{op:'set_eccentricity',id:'orbit',eccentricity:.2,hold:'semimajorAxis',preserve:'periapsis'}]),/Unsupported argument.*preserve/);
  assert.deepEqual(scene,before);
});
