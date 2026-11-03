import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { capabilities, tools, validateScene, applyOperations, evaluateScene, sampleMeasurements } from './scene.js';
import { toScript } from './sdk.js';

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png'};
function json(res,status,value){res.writeHead(status,{'Content-Type':mime['.json'],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>256*1024){const e=new Error('Body exceeds 256 KiB.');e.status=413;throw e;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{const e=new Error('Expected JSON transport data.');e.status=400;throw e;}}

export function createApp({root,initialScene,initialSource='',examples=[],loadExample,onScene=()=>{}}){
  if(!validateScene(initialScene).valid)throw new Error('Invalid initial scene.');
  let scene=structuredClone(initialScene),source=initialSource||toScript(scene),revision=1;
  const history=[{revision,summary:'Loaded authored world'}];
  const snapshot=()=>({revision,scene,source,history});
  function commit(next,nextSource,summary){const validation=validateScene(next);if(!validation.valid){const e=new Error('The constructed world violates its model contract.');e.status=422;e.validation=validation;throw e;}onScene(next);scene=structuredClone(next);source=nextSource||toScript(scene);revision++;history.push({revision,summary});if(history.length>20)history.shift();}
  return http.createServer(async(req,res)=>{try{
    const host=req.headers.host??'';
    if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))return json(res,403,{error:'LOCAL_ONLY'});
    if(req.headers.origin&&req.headers.origin!==`http://${host}`)return json(res,403,{error:'CROSS_ORIGIN'});
    const route=new URL(req.url,`http://${host}`).pathname;
    if(req.method==='GET'){
      if(route==='/api/scene')return json(res,200,snapshot());
      if(route==='/api/tools')return json(res,200,{tools,capabilities});
      if(route==='/api/capabilities')return json(res,200,capabilities);
      if(route==='/api/examples')return json(res,200,examples);
    }
    if(req.method==='POST'&&['/api/scene','/api/commands','/api/example','/api/validate','/api/evaluate','/api/sample'].includes(route)){
      if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'CONTENT_TYPE'});
      const input=await body(req);if(!input||typeof input!=='object'||Array.isArray(input))return json(res,400,{error:'INVALID_REQUEST'});
      if(input.baseRevision!==undefined&&input.baseRevision!==revision)return json(res,409,{error:'REVISION_CONFLICT',revision,message:'Re-read the world before applying this edit.'});
      if(route==='/api/validate')return json(res,200,validateScene(input.scene));
      if(route==='/api/evaluate')return json(res,200,evaluateScene(input.scene??scene,input.timeDays??0));
      if(route==='/api/sample')return json(res,200,sampleMeasurements(input.scene??scene,{samples:input.samples??721}));
      if(route==='/api/commands'){
        const next=applyOperations(scene,input.commands);commit(next,null,input.commands.map(c=>c.op+(c.id?`(${c.id})`:c.body?.id?`(${c.body.id})`:'')).join(' → '));
      }else if(route==='/api/example'){
        if(!examples.some(e=>e.id===input.id))return json(res,404,{error:'UNKNOWN_EXAMPLE'});
        const expectedRevision=revision;
        const next=await loadExample(input.id);
        if(revision!==expectedRevision)return json(res,409,{error:'REVISION_CONFLICT',revision,message:'The world changed while this recipe loaded. Try again.'});
        commit(next.scene,next.source,`Recipe: ${input.id}`);
      }else{
        if(input.source!==undefined&&(typeof input.source!=='string'||input.source.length>100000))return json(res,400,{error:'INVALID_SOURCE'});
        commit(input.scene,input.source,'Agent published a constructed world');
      }
      return json(res,200,snapshot());
    }
    if(route.startsWith('/api/'))return json(res,404,{error:'NOT_FOUND'});
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'METHOD_NOT_ALLOWED'});
    const relative=decodeURIComponent(route==='/'?'/index.html':route).slice(1);
    if(!/^(index\.html|styles\.css|src\/[A-Za-z0-9_-]+\.js|examples\/[A-Za-z0-9_-]+\.mjs|assets\/branding\/cosmic-lego-mark\.png)$/.test(relative))return json(res,404,{error:'NOT_FOUND'});
    const data=await readFile(path.join(root,relative));res.writeHead(200,{'Content-Type':mime[path.extname(relative)]??'text/plain','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
  }catch(error){json(res,error.status??(error.validation?422:400),{error:error.code??(error.validation?'INVALID_SCENE':'REQUEST_ERROR'),message:error.message,...(error.validation?{validation:error.validation}:{})});}});
}
