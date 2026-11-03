#!/usr/bin/env node
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { toScript } from '../src/sdk.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),flags=new Map();
for(let i=0;i<args.length;i++){if(args[i]==='--resume')flags.set('--resume',true);else if(['--port','--example'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'))flags.set(args[i],args[++i]);else throw new Error(`Unknown or incomplete option ${args[i]}.`);}
const port=Number(flags.get('--port')??4317);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port.');
const examples=[
  {id:'cosmic-clockwork',title:'Three planets · one shared shadow',description:'Independent orbits and one combined photometer, including overlapping silhouettes.'},
  {id:'tilted-orbits',title:'Tilt a planet · move the observer',description:'A structural revision adds another observer and measurement.'},
  {id:'eccentric-periapsis',title:'Eccentricity · what stays fixed?',description:'Compare changing e at fixed semimajor axis and at fixed periapsis.'},
  {id:'agent-a-overlap',title:'Agent A · overlapping shadows',description:'An independently authored three-planet world with six linked photometers.'},
  {id:'agent-b-eccentricity',title:'Agent B · four separate orbital clocks',description:'An independently authored world using creation, removal, eccentricity constraints and observer rewiring.'}
];
async function loadExample(id){if(!examples.some(e=>e.id===id))throw new Error('Unknown example.');const file=path.join(root,id.startsWith('agent-')?'experiments':'examples',`${id}.mjs`);const module=await import(pathToFileURL(file));const world=typeof module.default==='function'?module.default():module.default;return {scene:world.build(),source:readFileSync(file,'utf8')};}
const saved=path.join(root,'.local/world-v2.json');
const initial=flags.has('--resume')&&existsSync(saved)?{scene:JSON.parse(readFileSync(saved,'utf8'))}:await loadExample(flags.get('--example')??'cosmic-clockwork');
const server=createApp({root,initialScene:initial.scene,initialSource:initial.source??toScript(initial.scene),examples,loadExample,onScene:scene=>{mkdirSync(path.dirname(saved),{recursive:true});writeFileSync(saved,JSON.stringify(scene,null,2)+'\n');}});
server.listen(port,'127.0.0.1',()=>console.log(`Cosmic Lego v0.2: http://127.0.0.1:${server.address().port}\nAgent construction tools: GET /api/tools · POST /api/commands\nCtrl+C to stop.`));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  server.close(()=>process.exit(0));
  server.closeAllConnections();
});
