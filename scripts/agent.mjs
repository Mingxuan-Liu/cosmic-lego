#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { tools,capabilities,validateScene } from '../src/scene.js';
import { publish } from '../src/sdk.js';
const [command,...args]=process.argv.slice(2), flags=new Map();let file;
const print=value=>console.log(JSON.stringify(value,null,2));
try{
  const allowed={tools:[],inspect:['--url'],run:['--url','--base-revision','--dry-run'],transact:['--url','--base-revision'],evaluate:['--url','--time-days'],sample:['--url','--samples'],validate:[],help:[]};
  if(!Object.hasOwn(allowed,command))throw new Error('Commands: tools, inspect, run recipe.mjs [--dry-run], transact operations.json, evaluate --time-days N, sample --samples N, validate world.json.');
  for(let i=0;i<args.length;i++){const arg=args[i];if(arg.startsWith('--')){if(!allowed[command].includes(arg)||flags.has(arg))throw new Error(`Unknown or duplicate option ${arg}.`);if(arg==='--dry-run'){flags.set(arg,true);continue;}const value=args[++i];if(value===undefined||value.startsWith('--'))throw new Error(`Missing value for ${arg}.`);flags.set(arg,value);}else if(['run','transact','validate'].includes(command)&&!file)file=arg;else throw new Error(`Unexpected argument ${arg}.`);}
  if(['run','transact','validate'].includes(command)&&!file)throw new Error('A local file is required.');
  const url=new URL(flags.get('--url')??'http://127.0.0.1:4317');if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol!=='http:')throw new Error('Use a local HTTP loopback endpoint.');
  let baseRevision;if(flags.has('--base-revision')){baseRevision=Number(flags.get('--base-revision'));if(!Number.isInteger(baseRevision)||baseRevision<1)throw new Error('Revision must be a positive integer.');}
  const jsonFile=()=>JSON.parse(readFileSync(file==='-'?0:file,'utf8'));
  const call=async(route,input)=>{const response=await fetch(new URL(route,url),input===undefined?{signal:AbortSignal.timeout(10000)}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});const result=await response.json();print(result);if(!response.ok)process.exitCode=1;};
  if(command==='tools')print({tools,capabilities});
  if(command==='inspect')await call('/api/scene');
  if(command==='validate'){const result=validateScene(jsonFile());print(result);if(!result.valid)process.exitCode=1;}
  if(command==='run'){
    const recipe=path.resolve(file),module=await import(pathToFileURL(recipe));const world=typeof module.default==='function'?await module.default():module.default;
    if(!world||typeof world.build!=='function')throw new Error('Recipe must export a World or a function returning one.');
    const scene=world.build();if(flags.has('--dry-run'))print({valid:true,scene});else print(await publish(scene,{url:url.href,baseRevision,source:readFileSync(recipe,'utf8')}));
  }
  if(command==='transact')await call('/api/commands',{commands:jsonFile(),baseRevision});
  if(command==='evaluate'){const timeDays=Number(flags.get('--time-days')??0);if(!Number.isFinite(timeDays))throw new Error('Invalid time.');await call('/api/evaluate',{timeDays});}
  if(command==='sample'){const samples=Number(flags.get('--samples')??721);if(!Number.isInteger(samples)||samples<3||samples>4097)throw new Error('samples must be 3–4097.');await call('/api/sample',{samples});}
  if(command==='help')print({workflow:['tools','run examples/cosmic-clockwork.mjs --dry-run','run examples/cosmic-clockwork.mjs','inspect','transact operations.json --base-revision N','evaluate --time-days 0']});
}catch(error){print({error:'AGENT_ERROR',message:error.message,...(error.validation?{validation:error.validation}:{})});process.exitCode=1;}
