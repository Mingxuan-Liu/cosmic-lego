import { createKeplerSystem, keplerStateAt, observeSystem, sampleOrbitPath } from './physics.js';
import { validateStructure, capabilities, tools, orbitDefaults } from './contract.js';
export { capabilities, tools };

function modelInput(scene, planetIds = null) {
  const star = scene.bodies.find(b => b.kind === 'star');
  return { star, planets: scene.bodies.filter(b => b.kind === 'planet' && (!planetIds || planetIds.includes(b.id))).map(body => ({ ...body, orbit: scene.orbits.find(o => o.bodyId === body.id) })) };
}

export function validateScene(scene) {
  const errors = validateStructure(scene), warnings = [];
  if (errors.length) return { valid: false, errors, warnings };
  const fail = (path,message,code='COUPLING') => errors.push({path,code,message});
  const stars = scene.bodies.filter(b=>b.kind==='star'), planets=scene.bodies.filter(b=>b.kind==='planet');
  if (stars.length !== 1) fail('$.bodies','This model requires exactly one fixed stellar host. Binary dynamics needs another model.');
  for (const [i,orbit] of scene.orbits.entries()) {
    if (!planets.some(p=>p.id===orbit.bodyId)) fail(`$.orbits[${i}].bodyId`,'An orbit must attach an existing planet.');
    if (!stars.some(s=>s.id===orbit.hostId)) fail(`$.orbits[${i}].hostId`,'An orbit must reference the stellar host.');
  }
  for (const planet of planets) if (scene.orbits.filter(o=>o.bodyId===planet.id).length!==1) fail(`$.bodies.${planet.id}`,'Every planet must have exactly one attached orbit.');
  for (const [i,m] of scene.measurements.entries()) {
    if (!stars.some(s=>s.id===m.starId)) fail(`$.measurements[${i}].starId`,'Measurement must reference the stellar source.');
    if (!scene.observers.some(o=>o.id===m.observerId)) fail(`$.measurements[${i}].observerId`,'Measurement must reference an existing observer.');
    if (Array.isArray(m.occulters) && m.occulters.some(id=>!planets.some(p=>p.id===id))) fail(`$.measurements[${i}].occulters`,'Explicit occulters must be existing planets.');
  }
  for (const [i,a] of scene.annotations.entries()) if (a.focusId!==null && !scene.bodies.some(b=>b.id===a.focusId)) fail(`$.annotations[${i}].focusId`,'An annotation may focus an existing body.');
  if (!errors.length) {
    try { createKeplerSystem(modelInput(scene)); }
    catch(error) { fail('$.orbits',error.message,'PHYSICS'); }
  }
  if (planets.length>1) warnings.push({code:'INDEPENDENT_KEPLER',message:'These planets share one star and one composite measurement, but mutual gravity and long-term stability are not modeled.'});
  return {valid:errors.length===0,errors,warnings};
}

function requireValid(scene) {
  const result=validateScene(scene);
  if (!result.valid) { const e=new Error(result.errors.map(v=>`${v.path}: ${v.message}`).join('\n')); e.code='INVALID_SCENE';e.validation=result;throw e; }
}

export function compileScene(scene) {
  requireValid(scene);
  const saved=structuredClone(scene), system=createKeplerSystem(modelInput(saved));
  const byId=new Map(saved.bodies.map(b=>[b.id,b]));
  return {scene:saved,system,byId,
    paths:saved.orbits.map(o=>({id:o.bodyId,orbitId:o.id,points:sampleOrbitPath(system,o.bodyId,241)})),
    measures:saved.measurements.map(m=>({...m,observer:saved.observers.find(o=>o.id===m.observerId),system:m.occulters==='orbiting'?system:createKeplerSystem(modelInput(saved,m.occulters))}))};
}

export function evaluateScene(input,timeDays=0) {
  if (!Number.isFinite(timeDays)||Math.abs(timeDays)>1e6) throw new RangeError('timeDays must be finite and within ±1,000,000 days.');
  const c=input.system?input:compileScene(input), state=keplerStateAt(c.system,timeDays);
  const decorate=b=>({...b,...c.byId.get(b.id),orbit:c.scene.orbits.find(o=>o.bodyId===b.id)});
  const cues=c.scene.annotations.filter(a=>a.timeDays<=timeDays).sort((a,b)=>a.timeDays-b.timeDays);
  return {timeDays,star:decorate(state.star),planets:state.planets.map(decorate),observers:c.scene.observers,
    measurements:c.measures.map(m=>{const v=observeSystem(m.system,timeDays,m.observer);return {...v,id:m.id,name:m.name,observerId:m.observerId,planets:v.planets.map(decorate)};}),annotation:cues.at(-1)??null};
}

// Discover transit windows from orbital geometry, independently of the requested
// plotting cadence. This is a bounded demo sampler, not a certified event solver.
function transitWindows(system,observer,startDays,endDays) {
  const tau=2*Math.PI,windows=[];
  const basis=observeSystem(system,startDays,observer).observer;
  const dot=(axis,v)=>axis[0]*v.x+axis[1]*v.y+axis[2]*v.z;
  const bisect=(fn,left,right,increasing=true)=>{
    for(let i=0;i<55;i++){const mid=(left+right)/2;if((fn(mid)>0)===increasing)right=mid;else left=mid;}
    return (left+right)/2;
  };
  let unresolved=false;
  for(const planet of system.planets) {
    if(planet.radiusMeters===0)continue;
    const e=planet.orbit.eccentricity,beta=Math.sqrt(1-e*e);
    const ax=dot(basis.skyX,planet.basisX),ay=dot(basis.skyY,planet.basisX);
    const bx=beta*dot(basis.skyX,planet.basisY),by=beta*dot(basis.skyY,planet.basisY);
    const az=dot(basis.direction,planet.basisX),bz=beta*dot(basis.direction,planet.basisY);
    const threshold=((system.star.radiusMeters+planet.radiusMeters)/planet.semiMajorAxisMeters)**2;
    const separationSquared=E=>{const c=Math.cos(E)-e,s=Math.sin(E);return (ax*c+bx*s)**2+(ay*c+by*s)**2;};
    const derivative=E=>{const c=Math.cos(E),s=Math.sin(E);return (ax*(c-e)+bx*s)*(-ax*s+bx*c)+(ay*(c-e)+by*s)*(-ay*s+by*c);};
    const contact=E=>separationSquared(E)-threshold;
    const minima=[];
    // The projected ellipse has a smooth low-order trigonometric distance
    // function. Bracket its minima in anomaly, not sparsely sampled time.
    for(let i=0;i<256;i++) {
      const left=tau*i/256,right=tau*(i+1)/256,fl=derivative(left),fr=derivative(right);
      if(fl<=0&&fr>=0&&(fl<0||fr>0)) {
        const E=fl===0?left:bisect(derivative,left,right);
        if(!minima.some(prior=>Math.abs(Math.sin((prior-E)/2))<1e-10))minima.push(E);
      }
    }
    for(const E of minima) {
      if(contact(E)>=0||az*(Math.cos(E)-e)+bz*Math.sin(E)<=0)continue;
      let ingress=null,egress=null;
      // Find the nearest external contacts on either side of this minimum.
      for(const side of [-1,1]) {
        let inner=E;
        for(let step=1;step<=256;step++) {
          const outer=E+side*step*tau/256;
          if(contact(outer)>=0) {
            const root=side<0?bisect(contact,outer,inner,false):bisect(contact,inner,outer,true);
            if(side<0)ingress=root;else egress=root;
            break;
          }
          inner=outer;
        }
      }
      if(ingress===null||egress===null){unresolved=true;continue;}
      const mean=angle=>angle-e*Math.sin(angle),centerMean=mean(E);
      const base=planet.orbit.epochDays+(centerMean-planet.orbit.meanAnomalyDegAtEpoch*Math.PI/180)/tau*planet.periodDays;
      const leftOffset=(mean(ingress)-centerMean)/tau*planet.periodDays;
      const rightOffset=(mean(egress)-centerMean)/tau*planet.periodDays;
      const first=Math.ceil((startDays-rightOffset-base)/planet.periodDays);
      const last=Math.floor((endDays-leftOffset-base)/planet.periodDays);
      if(last>=first)windows.push({base,periodDays:planet.periodDays,leftOffset,rightOffset,first,count:last-first+1});
    }
  }
  return {windows,unresolved};
}

export function sampleMeasurements(input,{samples=721}={}) {
  if (!Number.isInteger(samples)||samples<3||samples>4097) throw new RangeError('samples must be an integer from 3 to 4097.');
  const c=input.system?input:compileScene(input),startDays=c.scene.presentation.startDays,endDays=startDays+c.scene.presentation.durationDays;
  const maxEventsPerTrack=160,maxPointsPerTrack=8192,details=[];
  const tracks=c.measures.map(m=>{
    const times=new Set(Array.from({length:samples},(_,i)=>startDays+(endDays-startDays)*i/(samples-1)));
    const {windows,unresolved}=transitWindows(m.system,m.observer,startDays,endDays);
    let remaining=maxEventsPerTrack,sampledEvents=0;
    const requestedEvents=windows.reduce((sum,w)=>sum+w.count,0);
    for(const [index,w] of windows.entries()) {
      // Reserve a fair share for other planets/conjunctions. If a long window
      // contains too many events, cover it evenly and report the omission.
      const allocated=Math.min(w.count,Math.floor(remaining/(windows.length-index)));
      remaining-=allocated;sampledEvents+=allocated;
      for(let j=0;j<allocated;j++) {
        const cycle=w.first+(allocated===1?Math.floor((w.count-1)/2):Math.round(j*(w.count-1)/(allocated-1)));
        const center=w.base+cycle*w.periodDays;
        const ingress=center+w.leftOffset,egress=center+w.rightOffset,duration=egress-ingress;
        const candidates=[center,ingress-duration*.05,egress+duration*.05];
        for(let k=0;k<=16;k++)candidates.push(ingress+duration*k/16);
        for(const t of candidates)if(t>=startDays&&t<=endDays&&times.size<maxPointsPerTrack)times.add(t);
      }
    }
    const limited=sampledEvents<requestedEvents||times.size>=maxPointsPerTrack;
    details.push({id:m.id,eventsInWindow:requestedEvents,sampledEvents,points:times.size,budgetLimited:limited,unresolvedGeometry:unresolved});
    return {id:m.id,name:m.name,points:[...times].sort((a,b)=>a-b).map(timeDays=>({timeDays,flux:observeSystem(m.system,timeDays,m.observer).flux}))};
  });
  const budgetLimited=details.some(d=>d.budgetLimited),unresolved=details.some(d=>d.unresolvedGeometry);
  const warning=budgetLimited
    ? 'Sampling budget reached: some transit events are omitted. Shorten the time window to inspect them.'
    : unresolved
      ? 'Some transit contacts could not be resolved. Shorten the time window and inspect the instantaneous measurement.'
      : 'Event-guided curve samples are approximate; very grazing or mutual-overlap details may require a shorter time window.';
  return {startDays,endDays,tracks,sampling:{method:'event-guided',baselineSamples:samples,maxEventsPerTrack,maxPointsPerTrack,budgetLimited,warning,tracks:details}};
}

const kinds={body:'bodies',orbit:'orbits',observer:'observers',measurement:'measurements',annotation:'annotations'};
function locate(scene,id) { for(const list of Object.values(kinds)) {const index=scene[list].findIndex(x=>x.id===id);if(index>=0)return {list,index,value:scene[list][index]};} throw new Error(`Unknown handle ${id}.`); }
function add(scene,list,value) { if(Object.values(kinds).some(k=>scene[k].some(v=>v.id===value.id)))throw new Error(`Handle ${value.id} already exists.`);scene[list].push(value); }
function patch(scene,list,id,value,forbidden=['id']) {const target=locate(scene,id);if(target.list!==list)throw new Error(`Handle ${id} is not in ${list}.`);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('patch must be an object.');if(forbidden.some(k=>Object.hasOwn(value,k)))throw new Error(`Cannot patch ${forbidden.join(', ')}; use the appropriate semantic operation.`);Object.assign(target.value,value);}

export function editDraft(scene,command) {
  if (!command || typeof command!=='object' || !tools.some(t=>t.name===command.op)) throw new Error(`Unknown operation ${command?.op}. Discover the available tools first.`);
  const allowed={add_body:['body'],attach_orbit:['orbit'],add_observer:['observer'],observe_transits:['measurement'],update_body:['id','patch'],update_orbit:['id','patch'],set_eccentricity:['id','eccentricity','hold'],update_observer:['id','patch'],update_measurement:['id','patch'],remove:['id','cascade'],set_presentation:['patch'],annotate:['annotation'],set_title:['title']}[command.op];
  const unknown=Object.keys(command).filter(key=>key!=='op'&&!allowed.includes(key));
  if(unknown.length)throw new Error(`Unsupported argument${unknown.length===1?'':'s'} for ${command.op}: ${unknown.join(', ')}.`);
  const c=command;
  switch(c.op) {
    case 'add_body': {
      const b=c.body; if(!b||!['star','planet'].includes(b.kind))throw new Error('Specify a star or planet body.');
      add(scene,'bodies',b.kind==='star'?{name:b.id,massSolar:1,radiusSolar:1,color:'#f2c063',...b}:{name:b.id,massJupiter:0,radiusJupiter:1,color:'#a69af8',...b});break;
    }
    case 'attach_orbit': add(scene,'orbits',{...orbitDefaults,...c.orbit});break;
    case 'add_observer': add(scene,'observers',{name:c.observer?.id,direction:[0,0,1],...c.observer});break;
    case 'observe_transits': add(scene,'measurements',{kind:'transit',name:c.measurement?.id,occulters:'orbiting',...c.measurement});break;
    case 'update_body': patch(scene,'bodies',c.id,c.patch,['id','kind']);break;
    case 'update_orbit': patch(scene,'orbits',c.id,c.patch,['id','eccentricity']);break;
    case 'update_observer': patch(scene,'observers',c.id,c.patch);break;
    case 'update_measurement': patch(scene,'measurements',c.id,c.patch,['id','kind']);break;
    case 'set_eccentricity': {
      const target=locate(scene,c.id);if(target.list!=='orbits')throw new Error('set_eccentricity requires an orbit handle.');
      if(!['semimajorAxis','periapsis'].includes(c.hold))throw new Error('Specify hold: semimajorAxis or periapsis.');
      if(!Number.isFinite(c.eccentricity)||c.eccentricity<0||c.eccentricity>0.85)throw new Error('Supported eccentricity is 0 to 0.85.');
      if(c.hold==='periapsis')target.value.semiMajorAxisAU*= (1-target.value.eccentricity)/(1-c.eccentricity);
      target.value.eccentricity=c.eccentricity;break;
    }
    case 'set_presentation': {
      if(!c.patch||typeof c.patch!=='object')throw new Error('Expected presentation patch.');
      scene.presentation={...scene.presentation,...c.patch,camera:{...scene.presentation.camera,...c.patch.camera}};break;
    }
    case 'annotate':add(scene,'annotations',{focusId:null,...c.annotation});break;
    case 'set_title':scene.title=c.title;break;
    case 'remove': {
      if(c.cascade!==undefined&&typeof c.cascade!=='boolean')throw new Error('cascade must be a boolean.');
      locate(scene,c.id);const removed=new Set([c.id]);let changed=true;
      while(changed){changed=false;for(const list of Object.values(kinds))for(const x of scene[list]) {
        const refs=[x.bodyId,x.hostId,x.starId,x.observerId,x.focusId,...(Array.isArray(x.occulters)?x.occulters:[])];
        if(!removed.has(x.id)&&refs.some(v=>removed.has(v))){if(!c.cascade)throw new Error(`${c.id} is referenced by ${x.id}; use cascade:true explicitly.`);removed.add(x.id);changed=true;}
      }}
      for(const list of Object.values(kinds))scene[list]=scene[list].filter(v=>!removed.has(v.id));break;
    }
  }
  return scene;
}

export function applyOperations(scene,commands) {
  if(!Array.isArray(commands)||commands.length<1||commands.length>128)throw new Error('Provide 1–128 operations per atomic transaction.');
  const draft=structuredClone(scene);
  for(const command of commands)editDraft(draft,command);
  requireValid(draft);return draft;
}
