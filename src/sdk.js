import { blankScene } from './contract.js';
import { editDraft, validateScene, compileScene, evaluateScene, sampleMeasurements, applyOperations } from './scene.js';
export { validateScene, compileScene, evaluateScene, sampleMeasurements, applyOperations };

class Handle {
  constructor(world,id,kind){this.world=world;this.id=id;this.kind=kind;}
  set(patch){this.world._edit({op:`update_${this.kind}`,id:this.id,patch});return this;}
  remove({cascade=false}={}){this.world._edit({op:'remove',id:this.id,cascade});return this.world;}
}
class BodyHandle extends Handle {
  constructor(world,id){super(world,id,'body');}
  orbit(host,parameters={}) {
    this.world._sameWorld(host);
    const id=parameters.id??this.world._id(`${this.id}-orbit`);
    this.world._edit({op:'attach_orbit',orbit:{...parameters,id,bodyId:this.id,hostId:host.id}});
    return new OrbitHandle(this.world,id);
  }
}
class OrbitHandle extends Handle {
  constructor(world,id){super(world,id,'orbit');}
  eccentricity(value,{hold}={}){this.world._edit({op:'set_eccentricity',id:this.id,eccentricity:value,hold});return this;}
}

export class World {
  constructor({title='An agent-built world'}={}){this.scene=blankScene(title);}
  static from(scene){const w=new World();w.scene=structuredClone(scene);return w;}
  _id(prefix){let id=prefix,i=2;while(['bodies','orbits','observers','measurements','annotations'].some(k=>this.scene[k].some(x=>x.id===id)))id=`${prefix}-${i++}`;return id;}
  _edit(command){editDraft(this.scene,command);return this;}
  _sameWorld(handle){if(!(handle instanceof Handle)||handle.world!==this)throw new Error('Handles must belong to the same World.');}
  star(parameters={}){const id=parameters.id??this._id('star');this._edit({op:'add_body',body:{...parameters,id,kind:'star'}});return new BodyHandle(this,id);}
  planet(parameters={}){const id=parameters.id??this._id('planet');this._edit({op:'add_body',body:{...parameters,id,kind:'planet'}});return new BodyHandle(this,id);}
  observer(parameters={}){const id=parameters.id??this._id('observer');this._edit({op:'add_observer',observer:{...parameters,id}});return new Handle(this,id,'observer');}
  transits(star,observer,parameters={}){this._sameWorld(star);this._sameWorld(observer);const id=parameters.id??this._id('photometer');const occulters=Array.isArray(parameters.occulters)?parameters.occulters.map(h=>{if(typeof h==='string')return h;this._sameWorld(h);return h.id;}):parameters.occulters??'orbiting';this._edit({op:'observe_transits',measurement:{...parameters,id,starId:star.id,observerId:observer.id,occulters}});return new Handle(this,id,'measurement');}
  get(id){const entry=['bodies','orbits','observers','measurements'].map(k=>({k,v:this.scene[k].find(v=>v.id===id)})).find(x=>x.v);if(!entry)throw new Error(`Unknown handle ${id}.`);return entry.k==='bodies'?new BodyHandle(this,id):entry.k==='orbits'?new OrbitHandle(this,id):new Handle(this,id,entry.k==='observers'?'observer':'measurement');}
  present(patch){return this._edit({op:'set_presentation',patch});}
  title(title){return this._edit({op:'set_title',title});}
  annotate(parameters){if(parameters.focusId instanceof Handle)this._sameWorld(parameters.focusId);const id=parameters.id??this._id('cue');return this._edit({op:'annotate',annotation:{...parameters,id,focusId:parameters.focusId instanceof Handle?parameters.focusId.id:parameters.focusId??null}});}
  build(){const validation=validateScene(this.scene);if(!validation.valid){const error=new Error(validation.errors.map(v=>`${v.path}: ${v.message}`).join('\n'));error.validation=validation;throw error;}return structuredClone(this.scene);}
  at(timeDays){return evaluateScene(this.build(),timeDays);}
  sample(options){return sampleMeasurements(this.build(),options);}
}

export function toScript(scene){
  const lines=['import { World } from "../src/sdk.js";','',`const world = new World({ title: ${JSON.stringify(scene.title)} });`];
  const vars=new Map();let n=0;
  for(const body of scene.bodies){const name=`body${++n}`;vars.set(body.id,name);const {kind,...p}=body;lines.push(`const ${name} = world.${kind}(${JSON.stringify(p)});`);}
  for(const orbit of scene.orbits){const {bodyId,hostId,...p}=orbit;lines.push(`${vars.get(bodyId)}.orbit(${vars.get(hostId)}, ${JSON.stringify(p)});`);}
  for(const observer of scene.observers){const name=`observer${++n}`;vars.set(observer.id,name);lines.push(`const ${name} = world.observer(${JSON.stringify(observer)});`);}
  for(const m of scene.measurements){const {kind,starId,observerId,...p}=m;lines.push(`world.transits(${vars.get(starId)}, ${vars.get(observerId)}, ${JSON.stringify(p)});`);}
  lines.push(`world.present(${JSON.stringify(scene.presentation)});`);
  for(const cue of scene.annotations)lines.push(`world.annotate(${JSON.stringify(cue)});`);
  lines.push('','export default world;');return lines.join('\n')+'\n';
}

export async function publish(world,{url='http://127.0.0.1:4317',baseRevision,source}={}){
  const target=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.protocol!=='http:')throw new Error('Use a local HTTP loopback endpoint.');
  const scene=world instanceof World?world.build():world;
  const response=await fetch(new URL('/api/scene',target),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene,baseRevision,source}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok){const e=new Error(result.message??JSON.stringify(result));e.response=result;throw e;}return result;
}
