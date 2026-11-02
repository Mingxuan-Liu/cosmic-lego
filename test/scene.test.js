import test from 'node:test';
import assert from 'node:assert/strict';
import { World, applyOperations, validateScene, toScript } from '../src/sdk.js';
import clockwork from '../examples/cosmic-clockwork.mjs';
import tilted from '../examples/tilted-orbits.mjs';
import eccentric from '../examples/eccentric-periapsis.mjs';

function starter() {
  const world = new World();
  const star = world.star({id:'star'});
  const observer = world.observer({id:'observer'});
  world.transits(star,observer,{id:'flux'});
  return {world,star,observer};
}

test('a photometer is a live relationship that includes planets added later',()=>{
  const {world,star}=starter();
  assert.equal(world.at(0).measurements[0].flux,1);
  for(let index=0;index<3;index++)world.planet({id:`p${index}`,radiusJupiter:.5+index*.2}).orbit(star,{semiMajorAxisAU:.04+index*.03,eccentricity:index*.1,inclinationDeg:90-index*8});
  const state=world.at(0);
  assert.equal(state.planets.length,3);
  assert.equal(state.measurements[0].planets.length,3);
  assert.ok(state.measurements[0].flux<1);
  assert.deepEqual(world.build().orbits.map(o=>o.hostId),['star','star','star']);
  assert.deepEqual(world.build().orbits.map(o=>o.eccentricity),[0,.1,.2]);
});

test('eccentricity edits require a constraint and derive period consistently',()=>{
  const {world,star}=starter();
  const orbit=world.planet({id:'planet'}).orbit(star,{id:'orbit',semiMajorAxisAU:.08});
  const period=world.at(0).planets[0].periodDays;
  assert.throws(()=>orbit.eccentricity(.5),/hold/);
  assert.throws(()=>orbit.set({eccentricity:.5}),/semantic/);
  orbit.eccentricity(.5,{hold:'semimajorAxis'});
  assert.equal(world.at(0).planets[0].periodDays,period);
  orbit.eccentricity(.75,{hold:'periapsis'});
  assert.equal(world.build().orbits[0].semiMajorAxisAU,.16);
  assert.ok(Math.abs(world.at(0).planets[0].periodDays/period-2**1.5)<1e-12);
});

test('structural transactions are atomic and reject unattached or unsupported components',()=>{
  const scene=clockwork().build(), before=structuredClone(scene);
  assert.throws(()=>applyOperations(scene,[{op:'add_body',body:{id:'stray',kind:'planet'}}]),/exactly one/);
  assert.throws(()=>applyOperations(scene,[{op:'update_body',id:'ember',patch:{radiusJupiter:1.2}},{op:'update_orbit',id:'absent',patch:{semiMajorAxisAU:.1}}]),/Unknown/);
  assert.throws(()=>applyOperations(scene,[{op:'update_body',id:'sun',patch:{luminosity:10}}]),/Unsupported/);
  assert.deepEqual(scene,before);
  const next=applyOperations(scene,[{op:'add_body',body:{id:'new',kind:'planet'}},{op:'attach_orbit',orbit:{id:'new-orbit',bodyId:'new',hostId:'sun',semiMajorAxisAU:.2}}]);
  assert.equal(next.bodies.length,scene.bodies.length+1);
  assert.equal(World.from(next).at(0).measurements[0].planets.length,4);
});

test('removal and rewiring preserve references and unaffected physical state',()=>{
  const world=clockwork(), before=world.at(.3).planets.find(p=>p.id==='ember');
  assert.throws(()=>world.get('iris').remove(),/cascade/);
  assert.throws(()=>applyOperations(world.build(),[{op:'remove',id:'iris',cascade:'false'}]),/boolean/);
  world.get('iris').remove({cascade:true});
  assert.equal(world.at(.3).measurements[0].planets.length,2);
  assert.deepEqual(world.at(.3).planets.find(p=>p.id==='ember'),before);
  const other=world.observer({id:'other',direction:[1,0,0]});
  world.get(world.build().measurements[0].id).set({observerId:other.id,occulters:['ember']});
  const measurement=world.at(.3).measurements[0];
  assert.equal(measurement.observerId,'other');
  assert.deepEqual(measurement.planets.map(p=>p.id),['ember']);
});

test('camera, exaggerated markers and playback speed cannot change observables',()=>{
  const world=clockwork(), before=world.at(.017);
  world.present({bodyScale:30,playbackSeconds:600,camera:{azimuthDeg:170,elevationDeg:-80,zoom:7}});
  assert.deepEqual(world.at(.017),before);
});

test('coupling checks reject wrong hosts, duplicate orbits, stellar collisions and excessive total mass',()=>{
  const baseline=clockwork().build();
  for(const modify of [
    s=>{s.orbits[0].hostId='iris';},
    s=>{s.orbits.push({...s.orbits[0],id:'extra-orbit'});},
    s=>{s.orbits[0].semiMajorAxisAU=.002;},
    s=>{s.bodies.filter(b=>b.kind==='planet').forEach(b=>b.massJupiter=10);},
    s=>{s.measurements[0].observerId='missing';},
    s=>{s.orbits[0].id=s.bodies[0].id;},
  ]){const scene=structuredClone(baseline);modify(scene);assert.equal(validateScene(scene).valid,false);}
});

test('foreign World handles are rejected at relationships and annotations',()=>{
  const first=starter(),second=starter();
  assert.throws(()=>first.world.planet({id:'a'}).orbit(second.star),/same World/);
  assert.throws(()=>first.world.transits(first.star,second.observer),/same World/);
  assert.throws(()=>first.world.annotate({timeDays:0,title:'Focus',text:'Foreign handle',focusId:second.star}),/same World/);
});

test('all teaching recipes validate and reconstructed SDK source preserves their worlds',async()=>{
  for(const recipe of [clockwork,tilted,eccentric]){
    const scene=recipe().build();assert.equal(validateScene(scene).valid,true);
    const script=toScript(scene).replace('../src/sdk.js',new URL('../src/sdk.js',import.meta.url).href);
    const rebuilt=await import('data:text/javascript;base64,'+Buffer.from(script).toString('base64'));
    assert.deepEqual(rebuilt.default.build(),scene);
  }
});
