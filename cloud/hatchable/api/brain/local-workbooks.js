import {storage} from 'hatchable';
import {Buffer} from 'node:buffer';
import {randomUUID, createHash} from 'node:crypto';

export const access='admin';
export const methods=['GET','POST'];
const OWNER='michaeljwilliams0123';
const PREFIX='owner-workbooks/';
const KEY=/^owner-workbooks\/[0-9a-f-]{36}\.xlsx$/;
const MAX=2*1024*1024;
const CT='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fail=(res,status,error)=>res.status(status).json({ok:false,error});

function safeXlsx(bytes){
 if(!bytes||bytes.length<100||bytes.length>MAX||
  bytes[0]!==0x50||bytes[1]!==0x4b||
  bytes[2]!==0x03||bytes[3]!==0x04)return false;
 // ZIP directory file names are not compressed; deny macro, external and
 // embedded payloads, plus require a standard Office Open XML workbook.
 const names=Buffer.from(bytes).toString('latin1');
 return names.includes('[Content_Types].xml')&&
  names.includes('xl/workbook.xml')&&
  names.includes('xl/worksheets/')&&
  !/vbaProject\.bin|externalLinks\/|embeddings\/|xl\/connections\.xml|\.rels\/\.\./i.test(names);
}
function nameOf(raw){
 if(typeof raw!=='string')return null;
 const name=raw.split(/[\\/]/).pop().trim();
 if(!/^[\w .()\-]{1,100}\.xlsx$/i.test(name))return null;
 return name;
}
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vary','Cookie');
 if(req.member?.handle!==OWNER)return fail(res,403,'primary-owner-required');
 try{
  if(req.method==='GET'){
   const key=req.query?.key;
   if(key!==undefined){
    if(typeof key!=='string'||!KEY.test(key))return fail(res,400,'invalid-key');
    const head=await storage.head(key);
    if(!head||head.size>MAX||head.content_type!==CT)return fail(res,404,'workbook-not-found');
    const url=await storage.url(key,{ttl:30});
    return res.json({ok:true,url,expiresInSeconds:30});
   }
   const cursor=typeof req.query?.cursor==='string'?req.query.cursor:null;
   const listing=await storage.list(PREFIX,{cursor,limit:25,include_metadata:true});
   const files=(listing.items||[]).filter(x=>KEY.test(x.key)).map(x=>({
    key:x.key,
    name:(()=>{try{return decodeURIComponent(x.metadata?.filename||'workbook.xlsx');}
      catch{return 'workbook.xlsx';}})(),
    bytes:x.size,
    createdAt:x.last_modified,
    sha256:x.metadata?.sha256||null
   }));
   return res.json({ok:true,schema:'ultron.local-workbook.v1',files,
    nextCursor:listing.next_cursor||null});
  }
  if(req.method!=='POST')return fail(res,405,'method-not-allowed');
  const upload=(req.files||[]).find(f=>f.field==='file');
  const payload=upload?{name:upload.filename,bytes:upload.buffer}:req.body;
  const filename=nameOf(payload?.name);
  if(!filename)return fail(res,400,'invalid-workbook-name');
  let bytes=payload.bytes;
  if(!upload){
   if(typeof payload.base64!=='string'||payload.base64.length>MAX*1.4||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.base64))return fail(res,400,'invalid-upload');
   bytes=Buffer.from(payload.base64,'base64');
   if(bytes.toString('base64')!==payload.base64)return fail(res,400,'invalid-upload');
  }
  if(!safeXlsx(bytes))return fail(res,415,'invalid-or-unsupported-xlsx');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const key=PREFIX+randomUUID()+'.xlsx';
  await storage.put(key,bytes,CT,{metadata:{
   filename:encodeURIComponent(filename),sha256,source:'owner-browser-import'
  }});
  return res.status(201).json({ok:true,schema:'ultron.local-workbook.v1',
   file:{key,name:filename,bytes:bytes.length,sha256}});
 }catch{
  return fail(res,503,'workbook-storage-unavailable');
 }
}