import { compileScene, evaluateScene, sampleMeasurements } from './scene.js';

const $ = (id) => document.getElementById(id);
const TAU = 2 * Math.PI;
const AU = 149597870700;
const palette = ['#91c9c0', '#ba9de3', '#e6a088', '#8cafe1', '#c4cd87', '#d5a5c9'];
let scene = null, compiled = null, sampled = null, state = null, revision = null;
let source = '', history = [], examples = [], tools = [];
let selectedId = null, followedId = null, measurementId = null;
let running = false, timeDays = 0, lastFrame = 0, lastDraw = 0;
let startDays = 0, endDays = 12, maxDistance = AU, plotMinimum = .97;
let camera = { azimuthDeg: -30, elevationDeg: 30, zoom: 1 };
let showOrbits = true, requestPending = false, pollBusy = false, dirtyView = true;
let screenBodies = [], drag = null, renderingError = '';
const stars = Array.from({ length: 115 }, (_, index) => {
  const random = (seed) => { const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return value - Math.floor(value); };
  return { x: random(index + 1), y: random(index + 173), size: .4 + random(index + 63)*.8, opacity: .08 + random(index + 89)*.3 };
});

function el(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function colorOf(body, index = 0) { return body?.color || (body?.kind === 'star' ? '#f2c063' : palette[Math.max(0,index) % palette.length]); }
function nameOf(body) { return body?.name || body?.label || body?.id || 'Object'; }
function numberLabel(value) { return Number(value.toPrecision(6)).toString(); }
function dot(color) { const item=el('span','object-dot');item.style.backgroundColor=color;return item; }
function showNotice(message) { $('notice').textContent=message; $('notice').hidden=!message; }
function connection(ok, text) { $('connection').textContent=text || (ok?'Local world connected':'Connection unavailable');$('connection').className=ok?'connection':'connection offline'; }
function validationMessage(data) { return (data.validation?.errors || data.errors || []).map((item)=>`${item.path || 'Scene'}: ${item.message}`).join('\n') || data.message || data.error || 'The scene could not be loaded.'; }
async function request(url, options) {
  const response=await fetch(url,options);
  const data=await response.json();
  if(!response.ok)throw new Error(validationMessage(data));
  return data;
}
function setOptions(select, items, selected) {
  select.replaceChildren();
  items.forEach((item)=>{const option=el('option','',item.name||item.title||item.id);option.value=item.id;select.append(option);});
  select.value=items.some((item)=>item.id===selected)?selected:items[0]?.id||'';
  return select.value;
}

function adopt(data, { reset = false } = {}) {
  const cameraChanged=JSON.stringify(scene?.presentation?.camera)!==JSON.stringify(data.scene.presentation?.camera);
  const nextCompiled=compileScene(data.scene);
  const nextSamples=sampleMeasurements(nextCompiled,{samples:721});
  const nextStart=nextSamples.startDays ?? data.scene.presentation.startDays;
  const nextEnd=nextSamples.endDays ?? nextStart+data.scene.presentation.durationDays;
  const nextTime=(!scene||reset)?(nextStart<=0&&nextEnd>=0?0:nextStart):Math.min(nextEnd,Math.max(nextStart,timeDays));
  const nextState=evaluateScene(nextCompiled,nextTime);
  scene=data.scene;compiled=nextCompiled;sampled=nextSamples;state=nextState;revision=data.revision;
  source=typeof data.source==='string'?data.source:(data.source?.code||data.source?.text||'');
  history=Array.isArray(data.history)?data.history:[];
  startDays=nextStart;endDays=nextEnd;timeDays=nextTime;
  maxDistance=0;
  for(const path of compiled.paths||[])for(const point of path.points||[])maxDistance=Math.max(maxDistance,Math.hypot(point.x,point.y,point.z||0));
  if(!maxDistance)maxDistance=Math.max(AU*.01,...state.planets.map((planet)=>Math.hypot(planet.worldMeters.x,planet.worldMeters.y,planet.worldMeters.z||0)));
  const fluxes=sampled.tracks.flatMap((track)=>track.points.map((point)=>point.flux));
  const minFlux=fluxes.reduce((lowest,value)=>Math.min(lowest,value),1);
  plotMinimum=1-Math.max(1-minFlux,.00015)*1.17;
  if(!scene.bodies.some((body)=>body.id===selectedId))selectedId=state.planets[0]?.id||state.star.id;
  if(followedId&&!scene.bodies.some((body)=>body.id===followedId))followedId=null;
  if(reset||cameraChanged||revision===1)resetCamera(false);
  measurementId=setOptions($('measurement-select'),scene.measurements,measurementId);
  $('measurement-select').disabled=!scene.measurements.length;
  if(!scene.measurements.length){const option=el('option','','No measurement connected');option.value='';$('measurement-select').append(option);}
  $('scene-title').textContent=scene.title;
  const count=state.planets.length;
  $('scene-description').textContent=`${count} planet${count===1?'':'s'} · ${scene.orbits.length} orbital relationship${scene.orbits.length===1?'':'s'} · ${scene.observers.length} observer${scene.observers.length===1?'':'s'}`;
  $('revision').textContent=`revision ${revision}`;
  $('time-start').textContent=`${startDays.toFixed(2)} d`;
  $('time-end').textContent=`${endDays.toFixed(2)} d`;
  buildHandles();buildCues();buildHistory();buildGraph();refreshSource();
  renderingError='';dirtyView=true;showNotice('');connection(true);render();
}

function buildHandles() {
  const host=$('object-handles');host.replaceChildren();
  scene.bodies.forEach((body,index)=>{
    const button=el('button',`object-chip${body.id===selectedId?' active':''}`);
    button.append(dot(colorOf(body,index)),document.createTextNode(nameOf(body)));
    button.dataset.id=body.id;button.title=`Select handle: ${body.id}`;
    button.setAttribute('aria-pressed',body.id===selectedId?'true':'false');
    button.addEventListener('click',()=>selectBody(body.id));host.append(button);
  });
  refreshSelection();
}
function selectBody(id) {
  selectedId=id;
  for(const button of $('object-handles').children){const active=button.dataset.id===id;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  refreshSelection();dirtyView=true;render();
}
function refreshSelection() {
  if(!scene)return;
  const body=scene.bodies.find((item)=>item.id===selectedId)||scene.bodies[0];
  const planet=state?.planets.find((item)=>item.id===body.id);
  const orbit=scene.orbits.find((item)=>item.bodyId===body.id);
  $('selected-handle').textContent=body.id;
  $('selected-name').textContent=nameOf(body);
  $('selected-dot').style.backgroundColor=colorOf(body,scene.bodies.indexOf(body));
  $('focus-object').textContent=followedId===body.id?'Release focus ↗':'Follow object ↗';
  $('selected-details').textContent=orbit?`${numberLabel(orbit.semiMajorAxisAU)} AU · e = ${numberLabel(orbit.eccentricity)} · i = ${numberLabel(orbit.inclinationDeg)}°${planet?.periodDays?` · P = ${planet.periodDays.toFixed(2)} d`:''}`:`${body.massSolar} M☉ · ${body.radiusSolar} R☉ · fixed central star`;
}
function buildCues() {
  $('cue-buttons').replaceChildren();
  for(const cue of scene.annotations||[]){const button=el('button','',`◇ ${cue.title}`);button.title=`Go to ${cue.timeDays} days`;button.addEventListener('click',()=>{timeDays=Math.min(endDays,Math.max(startDays,cue.timeDays));running=false;updatePlay();if(cue.focusId)selectBody(cue.focusId);dirtyView=true;render();});$('cue-buttons').append(button);}
}
function buildHistory() {
  const host=$('history');host.replaceChildren();
  if(history.length){for(const entry of history.slice(-4)){const row=el('p');const rev=entry.revision!==undefined?`r${entry.revision} · `:'';row.append(el('strong','',rev),document.createTextNode(entry.summary||entry.message||'Scene updated'));host.append(row);}}
  else {
    const rows=[`${scene.bodies.length} body handles created`,`${scene.orbits.length} Keplerian orbits attached`,`${scene.measurements.length} measurement${scene.measurements.length===1?'':'s'} connected to observers`];
    rows.forEach((text)=>host.append(el('p','',text)));
  }
}
function buildGraph() {
  const host=$('graph-tree');host.replaceChildren();
  const groups=[['Bodies',scene.bodies,(body)=>`${body.kind} · ${body.id}`],['Orbital relationships',scene.orbits,(orbit)=>`${orbit.hostId} → ${orbit.bodyId}\na = ${orbit.semiMajorAxisAU} AU; e = ${orbit.eccentricity}; i = ${orbit.inclinationDeg}°`],['Observers',scene.observers,(observer)=>`direction = [${observer.direction.join(', ')}]`],['Measurements',scene.measurements,(measurement)=>`${measurement.kind} · ${measurement.starId} → ${measurement.observerId}\nocculting bodies: ${Array.isArray(measurement.occulters)?measurement.occulters.join(', '):measurement.occulters}`]];
  for(const [title,items,describe] of groups){const group=el('div','graph-section');group.append(el('h3','',title));for(const item of items){const row=el('div','graph-node');row.append(el('strong','',nameOf(item)),el('span','',describe(item)));group.append(row);}host.append(group);}
  $('graph-json').textContent=JSON.stringify(scene,null,2);
}
function refreshSource() {
  $('source-kind').textContent=source?'Authored SDK program':'Scene graph · source unavailable';
  $('source-code').textContent=source||JSON.stringify(scene,null,2);
}

function canvasContext(canvas) {
  const width=canvas.clientWidth,height=canvas.clientHeight,ratio=Math.min(devicePixelRatio||1,2);
  const nextWidth=Math.max(1,Math.round(width*ratio)),nextHeight=Math.max(1,Math.round(height*ratio));
  if(canvas.width!==nextWidth||canvas.height!==nextHeight){canvas.width=nextWidth;canvas.height=nextHeight;}
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
  return {ctx,width,height};
}
function circle(ctx,x,y,radius,fill,stroke) { if(radius<=0)return;ctx.beginPath();ctx.arc(x,y,radius,0,TAU);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();} }
function bodyState(id) { return state.star.id===id?state.star:state.planets.find((planet)=>planet.id===id); }
function projector(width,height) {
  const az=camera.azimuthDeg*Math.PI/180,elv=camera.elevationDeg*Math.PI/180;
  const center=followedId?bodyState(followedId)?.worldMeters:null;
  const scale=Math.min(width*.41,height*.36)/maxDistance*camera.zoom;
  const cx=width*.52,cy=height*.48;
  const transform=(point)=>{
    const x=point.x-(center?.x||0),y=point.y-(center?.y||0),z=(point.z||0)-(center?.z||0);
    const lateral=x*Math.cos(az)-y*Math.sin(az),forward=x*Math.sin(az)+y*Math.cos(az);
    return {x:cx+lateral*scale,y:cy-(forward*Math.sin(elv)-z*Math.cos(elv))*scale,depth:forward*Math.cos(elv)+z*Math.sin(elv)};
  };
  return {transform,scale,cx,cy};
}
function drawWorld() {
  const {ctx,width,height}=canvasContext($('world'));
  for(const star of stars){ctx.globalAlpha=star.opacity;circle(ctx,star.x*width,star.y*height,star.size,'#b7a8d2');}ctx.globalAlpha=1;
  if(!state)return;
  const project=projector(width,height);
  // A subdued reference plane provides orientation without changing the model.
  const zero=project.transform({x:0,y:0,z:0});
  ctx.lineWidth=.6;ctx.strokeStyle='#4a365a22';
  for(const direction of [[1,0,0],[0,1,0]]){const a=project.transform({x:-maxDistance*direction[0]*1.18,y:-maxDistance*direction[1]*1.18,z:0});const b=project.transform({x:maxDistance*direction[0]*1.18,y:maxDistance*direction[1]*1.18,z:0});ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  if(showOrbits){
    for(const path of compiled.paths||[]){
      const orbit=scene.orbits.find((item)=>item.id===path.id||item.bodyId===path.id);
      const body=scene.bodies.find((item)=>item.id===(path.bodyId||orbit?.bodyId||path.id));
      const color=colorOf(body,scene.bodies.indexOf(body));
      const active=body?.id===selectedId;
      ctx.lineWidth=active?1.35:1;
      const points=path.points||[];
      for(let index=1;index<points.length;index++){
        const a=project.transform(points[index-1]),b=project.transform(points[index]);
        ctx.strokeStyle=color;ctx.globalAlpha=(a.depth>=0?.55:.24)*(active?1.2:1);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      }
      ctx.globalAlpha=1;
    }
  }
  const selectedMeasurement=scene.measurements.find((item)=>item.id===measurementId);
  const observer=scene.observers.find((item)=>item.id===selectedMeasurement?.observerId);
  if(observer){
    const length=Math.hypot(...observer.direction),distance=maxDistance*1.13;
    const tip=project.transform({x:observer.direction[0]/length*distance,y:observer.direction[1]/length*distance,z:observer.direction[2]/length*distance});
    const dx=tip.x-zero.x,dy=tip.y-zero.y,screenLength=Math.hypot(dx,dy);
    if(screenLength>35){
      ctx.save();ctx.strokeStyle='#b6a1c3';ctx.globalAlpha=.38;ctx.setLineDash([3,5]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(zero.x,zero.y);ctx.lineTo(tip.x,tip.y);ctx.stroke();ctx.setLineDash([]);
      const angle=Math.atan2(dy,dx);ctx.beginPath();ctx.moveTo(tip.x-7*Math.cos(angle-.45),tip.y-7*Math.sin(angle-.45));ctx.lineTo(tip.x,tip.y);ctx.lineTo(tip.x-7*Math.cos(angle+.45),tip.y-7*Math.sin(angle+.45));ctx.stroke();ctx.globalAlpha=.75;ctx.font='10px system-ui';ctx.fillStyle='#b6a1c3';ctx.textAlign=dx>0?'left':'right';ctx.fillText('toward observer',tip.x+(dx>0?10:-10),tip.y+3);ctx.restore();
    }
  }
  const bodies=[state.star,...state.planets].map((body,index)=>{
    const p=project.transform(body.worldMeters),isStar=body.id===state.star.id;
    const radius=isStar?Math.max(12,Math.min(28,body.radiusMeters*project.scale*(scene.presentation.bodyScale||8))):Math.max(4,Math.min(15,body.radiusMeters*project.scale*(scene.presentation.bodyScale||8)));
    return {body,index,...p,radius,isStar};
  }).sort((a,b)=>a.depth-b.depth);
  screenBodies=bodies;
  for(const item of bodies){
    const {body,x,y,radius,isStar}=item,color=body.color||colorOf(scene.bodies.find((entry)=>entry.id===body.id),item.index);
    if(isStar){
      const glow=ctx.createRadialGradient(x,y,radius*.3,x,y,radius*5);glow.addColorStop(0,'#f2c06355');glow.addColorStop(.25,'#f2c06316');glow.addColorStop(1,'#f2c06300');circle(ctx,x,y,radius*5,glow);
      const surface=ctx.createRadialGradient(x-radius*.25,y-radius*.3,0,x,y,radius);surface.addColorStop(0,'#fff3d4');surface.addColorStop(.7,color);surface.addColorStop(1,'#c99047');circle(ctx,x,y,radius,surface);
    }else{
      const surface=ctx.createRadialGradient(x-radius*.4,y-radius*.4,0,x,y,radius*1.2);surface.addColorStop(0,color);surface.addColorStop(.6,color);surface.addColorStop(1,'#30203e');circle(ctx,x,y,radius,surface);
    }
    if(body.id===selectedId){ctx.lineWidth=1;ctx.globalAlpha=.7;circle(ctx,x,y,radius+6,null,color);ctx.globalAlpha=1;}
    ctx.font='10px system-ui';ctx.textAlign='left';ctx.fillStyle=body.id===selectedId?'#eadbf1':'#a58caf';
    const labelX=x+radius+13,labelY=y-7;
    if(labelX<width-55&&y>110&&y<height-175){ctx.globalAlpha=.75;ctx.strokeStyle=color;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x+radius+3,y-1);ctx.lineTo(labelX-4,labelY-3);ctx.stroke();ctx.globalAlpha=1;ctx.fillText(nameOf(body),labelX,labelY);}
  }
}
function currentMeasurement() { return state?.measurements.find((item)=>item.id===measurementId)||state?.measurements[0]; }
function drawSky() {
  const {ctx,width,height}=canvasContext($('sky'));
  const measurement=currentMeasurement();if(!measurement){$('transit-state').textContent='Connect an observer';$('observer-name').textContent='—';$('flux-value').value='—';ctx.font='11px system-ui';ctx.fillStyle='#8f779f';ctx.textAlign='center';ctx.fillText('An observer turns a world into a measurement.',width/2,height/2);return;}
  const radius=Math.min(width*.31,height*.34),cx=width/2,cy=height/2;
  const starRadius=measurement.starRadiusMeters||state.star.radiusMeters,scale=radius/starRadius;
  ctx.strokeStyle='#3b2d492f';ctx.setLineDash([2,5]);ctx.beginPath();ctx.moveTo(cx,9);ctx.lineTo(cx,height-9);ctx.moveTo(10,cy);ctx.lineTo(width-10,cy);ctx.stroke();ctx.setLineDash([]);
  const planets=measurement.planets||[];
  const silhouette=(planet)=>{const x=cx+planet.skyMeters.x*scale,y=cy-planet.skyMeters.y*scale,r=planet.radiusMeters*scale;if(r>0&&Math.abs(x-cx)<width/2+r&&Math.abs(y-cy)<height/2+r){circle(ctx,x,y,r,'#181020',planet.color||palette[0]);if(planet.id===selectedId){ctx.globalAlpha=.5;circle(ctx,x,y,r+3,null,planet.color||palette[0]);ctx.globalAlpha=1;}}};
  planets.filter((planet)=>!planet.foreground).forEach(silhouette);
  circle(ctx,cx,cy,radius,'#f2c063');
  planets.filter((planet)=>planet.foreground).sort((a,b)=>a.lineOfSightMeters-b.lineOfSightMeters).forEach(silhouette);
  const occulting=measurement.occultingPlanetIds;
  $('transit-state').textContent=occulting.length?`${occulting.length} foreground transit${occulting.length===1?'':'s'}`:'No foreground transit';
  const observer=scene.observers.find((item)=>item.id===measurement.observerId);
  $('observer-name').textContent=nameOf(observer);
  $('flux-value').value=measurement.flux.toFixed(6);
  $('sky').setAttribute('aria-label',`${nameOf(observer)}: ${occulting.length} foreground transits. Normalized flux ${measurement.flux.toFixed(6)}. Physical radius ratios.`);
}
function drawSignal() {
  const {ctx,width,height}=canvasContext($('signal'));
  const measurement=currentMeasurement(),track=sampled?.tracks.find((item)=>item.id===measurement?.id);if(!track)return;
  const l=45,r=8,t=12,b=33,pw=width-l-r,ph=height-t-b;
  plotMinimum=Math.min(plotMinimum,1-Math.max(1-measurement.flux,.00015)*1.17);
  const maximum=1+(1-plotMinimum)*.08,minimum=plotMinimum;
  const decimals=Math.min(6,Math.max(3,Math.ceil(-Math.log10(1-minimum))+1));
  const x=(value)=>l+(value-startDays)/(endDays-startDays)*pw;
  const y=(value)=>t+(maximum-value)/(maximum-minimum)*ph;
  ctx.font='9px system-ui';ctx.strokeStyle='#35273e';ctx.fillStyle='#80698f';ctx.lineWidth=.6;
  for(let index=0;index<3;index++){const value=minimum+(1-minimum)*index/2,yy=y(value);ctx.beginPath();ctx.moveTo(l,yy);ctx.lineTo(width-r,yy);ctx.stroke();ctx.textAlign='right';ctx.fillText(value.toFixed(decimals),l-7,yy+3);}
  for(let index=0;index<4;index++){const value=startDays+(endDays-startDays)*index/3,xx=x(value);ctx.beginPath();ctx.moveTo(xx,t);ctx.lineTo(xx,height-b);ctx.stroke();ctx.textAlign='center';ctx.fillText(value.toFixed(1),xx,height-19);}
  ctx.textAlign='center';ctx.fillText('physical time / days',l+pw/2,height-3);
  ctx.save();ctx.beginPath();ctx.rect(l,t,pw,ph);ctx.clip();
  ctx.strokeStyle='#baa3d6';ctx.lineWidth=1.6;ctx.beginPath();
  track.points.forEach((point,index)=>{if(index===0)ctx.moveTo(x(point.timeDays),y(point.flux));else ctx.lineTo(x(point.timeDays),y(point.flux));});ctx.stroke();
  const cursorX=x(timeDays);ctx.strokeStyle='#f2c06355';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cursorX,t);ctx.lineTo(cursorX,height-b);ctx.stroke();circle(ctx,cursorX,y(measurement.flux),3,'#f2c063');
  ctx.restore();
}
function refreshLegend() {
  const host=$('planet-legend');host.replaceChildren();
  const measurement=currentMeasurement();if(!measurement)return;
  const definition=scene.measurements.find(item=>item.id===measurement.id);
  $('signal-title').textContent=definition?.occulters==='orbiting'?'One star. Shared shadows.':'Selected occultors · model comparison';
  $('sampling-note').textContent=sampled?.sampling?.warning||'Sampled model curve; current flux evaluated at the exact playhead time.';
  for(const planet of measurement.planets||[]){const item=el('span');item.append(dot(planet.color||palette[0]),document.createTextNode(nameOf(planet)));host.append(item);}
}
function render() {
  if(!compiled)return;
  try {
    state=evaluateScene(compiled,timeDays);
    drawWorld();drawSky();drawSignal();
    $('time-value').value=`${timeDays.toFixed(3)} days`;
    if(document.activeElement!==$('playhead'))$('playhead').value=(timeDays-startDays)/(endDays-startDays)*1000;
    const annotation=state.annotation;
    $('annotation').hidden=!annotation;
    if(annotation){$('annotation-title').textContent=annotation.title;$('annotation-text').textContent=annotation.text;}
    if(dirtyView){refreshSelection();refreshLegend();}
    dirtyView=false;
  }catch(error){if(error.message!==renderingError){showNotice(`The scene could not be drawn: ${error.message}`);renderingError=error.message;}running=false;updatePlay();}
}
function resetCamera(redraw=true) { camera={azimuthDeg:-30,elevationDeg:30,zoom:1,...scene?.presentation?.camera};followedId=null;dirtyView=true;if(redraw)render(); }
function updatePlay() { $('play').textContent=running?'Ⅱ':'▶';$('play').setAttribute('aria-label',running?'Pause animation':'Play animation'); }
function tick(now) {
  const delta=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;
  if(scene&&running&&!document.hidden){timeDays+=delta*(endDays-startDays)/(scene.presentation.playbackSeconds||40);if(timeDays>endDays)timeDays=startDays;}
  if(!document.hidden&&(running||dirtyView)&&now-lastDraw>25){render();lastDraw=now;}
  requestAnimationFrame(tick);
}

const world=$('world');
world.addEventListener('pointerdown',(event)=>{world.setPointerCapture(event.pointerId);drag={x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false};});
world.addEventListener('pointermove',(event)=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.moved ||= Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>4;camera.azimuthDeg+=dx*.35;camera.elevationDeg=Math.max(-85,Math.min(85,camera.elevationDeg+dy*.3));drag.x=event.clientX;drag.y=event.clientY;dirtyView=true;});
world.addEventListener('pointerup',(event)=>{if(drag&&!drag.moved){const rect=world.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;const selected=[...screenBodies].reverse().find((body)=>Math.hypot(body.x-x,body.y-y)<body.radius+12);if(selected)selectBody(selected.body.id);}drag=null;});
world.addEventListener('pointercancel',()=>{drag=null;});
world.addEventListener('wheel',(event)=>{event.preventDefault();camera.zoom=Math.max(.35,Math.min(6,camera.zoom*Math.exp(-event.deltaY*.001)));dirtyView=true;},{passive:false});
world.addEventListener('keydown',(event)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','0'].includes(event.key))return;event.preventDefault();if(event.key==='ArrowLeft')camera.azimuthDeg-=5;if(event.key==='ArrowRight')camera.azimuthDeg+=5;if(event.key==='ArrowUp')camera.elevationDeg=Math.min(85,camera.elevationDeg+5);if(event.key==='ArrowDown')camera.elevationDeg=Math.max(-85,camera.elevationDeg-5);if(event.key==='+')camera.zoom=Math.min(6,camera.zoom*1.1);if(event.key==='-')camera.zoom=Math.max(.35,camera.zoom/1.1);if(event.key==='0')resetCamera();dirtyView=true;});
$('focus-object').addEventListener('click',()=>{followedId=followedId===selectedId?null:selectedId;dirtyView=true;render();});
$('reset-camera').addEventListener('click',()=>resetCamera());
$('toggle-orbits').addEventListener('click',()=>{showOrbits=!showOrbits;$('toggle-orbits').classList.toggle('active',showOrbits);$('toggle-orbits').setAttribute('aria-pressed',String(showOrbits));dirtyView=true;render();});
$('measurement-select').addEventListener('change',()=>{measurementId=$('measurement-select').value;dirtyView=true;render();});
$('play').addEventListener('click',()=>{running=!running;updatePlay();});
$('restart').addEventListener('click',()=>{timeDays=startDays;dirtyView=true;render();});
$('playhead').addEventListener('input',()=>{running=false;updatePlay();timeDays=startDays+Number($('playhead').value)/1000*(endDays-startDays);dirtyView=true;render();});
$('example-select').addEventListener('change',async()=>{
  if(requestPending||!$('example-select').value)return;
  requestPending=true;running=false;updatePlay();$('example-select').disabled=true;
  try{const data=await request('/api/example',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:$('example-select').value})});adopt(data,{reset:true});}
  catch(error){showNotice(error.message);}
  finally{requestPending=false;$('example-select').disabled=false;$('example-select').value='';}
});

function drawer(open) { $('source-drawer').hidden=!open;$('source-drawer').setAttribute('aria-hidden',String(!open));$('drawer-backdrop').hidden=!open;if(open)$('close-source').focus();else $('open-source').focus(); }
$('open-source').addEventListener('click',()=>drawer(true));$('close-source').addEventListener('click',()=>drawer(false));$('drawer-backdrop').addEventListener('click',()=>drawer(false));
window.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&!$('source-drawer').hidden)drawer(false);});
for(const name of ['source','graph','agent'])$('tab-'+name).addEventListener('click',()=>{for(const target of ['source','graph','agent']){$('tab-'+target).setAttribute('aria-selected',String(name===target));$('panel-'+target).hidden=name!==target;}});
$('copy-source').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('source-code').textContent);$('drawer-status').textContent='Source copied.';}catch{$('drawer-status').textContent='Select the source text and copy it with your keyboard.';}});
$('download-scene').addEventListener('click',()=>{if(!scene)return;const url=URL.createObjectURL(new Blob([JSON.stringify(scene,null,2)+'\n'],{type:'application/json'}));const link=el('a');link.href=url;link.download='astrocompose-world.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
async function loadCatalog() {
  try{const result=await request('/api/examples');examples=Array.isArray(result)?result:result.examples||[];setOptions($('example-select'),[{id:'',title:'Explore authored worlds…'},...examples],'');}
  catch{$('example-select').replaceChildren(el('option','','Current authored world'));}
}
async function loadTools() {
  $('agent-command').textContent='node scripts/agent.mjs tools\nnode scripts/agent.mjs inspect\nnode scripts/agent.mjs run examples/cosmic-clockwork.mjs';
  try{const result=await request('/api/tools');tools=Array.isArray(result)?result:result.tools||[];const host=$('agent-tools');host.replaceChildren();for(const tool of tools){const row=el('div','tool-entry');row.append(el('strong','',tool.name||tool.id),el('p','',tool.description||''));host.append(row);}if(!tools.length)host.textContent='See the repository agent interface for the supported construction operations.';}
  catch{$('agent-tools').textContent='Tool discovery is unavailable. See docs/agent-interface.md in the repository.';}
}
async function poll() {
  if(requestPending||pollBusy||document.hidden)return;pollBusy=true;const priorRevision=revision;
  try{const data=await request('/api/scene');if(requestPending||revision!==priorRevision)return;if(data.revision!==revision)adopt(data);else connection(true);}
  catch(error){connection(false);if(!scene)showNotice(`Waiting for a valid composed world: ${error.message}`);}
  finally{pollBusy=false;}
}
window.addEventListener('resize',()=>{dirtyView=true;});
document.addEventListener('visibilitychange',()=>{lastFrame=0;if(!document.hidden){dirtyView=true;void poll();}});
void loadCatalog();void loadTools();void poll();setInterval(poll,1000);requestAnimationFrame(tick);
