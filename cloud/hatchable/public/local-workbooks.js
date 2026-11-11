'use strict';
const $=id=>document.getElementById(id);
const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAX=2*1024*1024;
const addrPattern=/^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
let current=null, sheets=[], selected=null, entries=null, edits=0, currentName='';
const $status=$('status'),$result=$('result');
function status(message){$status.textContent=message;}
function escapeStatus(e){return e instanceof Error?e.message:'Workbook operation unavailable';}
function validAddr(a){
 const m=addrPattern.exec(a);
 if(!m||Number(m[2])>1048576)return false;
 const col=[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
 return col>0&&col<=16384;
}
function coordinates(addr){
 const m=addrPattern.exec(addr);
 return {col:[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),row:Number(m[2])};
}
function parseXml(bytes){
 const xml=new DOMParser().parseFromString(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'application/xml');
 if(xml.getElementsByTagName('parsererror').length)throw Error('Invalid workbook XML');
 return xml;
}
function first(node,tag){return node.getElementsByTagNameNS('*',tag)[0]||null;}
function textOf(node,tag){return first(node,tag)?.textContent??'';}
function zipPreflight(data){
 if(data.length<100||data.length>MAX||data[0]!==80||data[1]!==75)throw Error('Expected a standard .xlsx file (max 2 MB)');
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 let eocd=-1;
 for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--){
  if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
 }
 if(eocd<0)throw Error('Invalid ZIP directory');
 const count=view.getUint16(eocd+10,true);
 const size=view.getUint32(eocd+12,true),start=view.getUint32(eocd+16,true);
 if(count<3||count>500||start+size>eocd)throw Error('Unsupported workbook archive');
 let offset=start,total=0;
 for(let i=0;i<count;i++){
  if(offset+46>data.length||view.getUint32(offset,true)!==0x02014b50)throw Error('Corrupt workbook directory');
  const uncompressed=view.getUint32(offset+24,true);
  const compressed=view.getUint32(offset+20,true);
  const method=view.getUint16(offset+10,true);
  const filenameSize=view.getUint16(offset+28,true);
  const extra=view.getUint16(offset+30,true);
  const comment=view.getUint16(offset+32,true);
  const end=offset+46+filenameSize+extra+comment;
  if(end>data.length||![0,8].includes(method)||compressed>MAX)throw Error('Unsupported ZIP contents');
  const name=new TextDecoder().decode(data.subarray(offset+46,offset+46+filenameSize));
  if(name.includes('..')||name.startsWith('/')||/[\\]/.test(name)||
   /vbaProject\.bin|externalLinks\/|embeddings\/|xl\/connections\.xml/i.test(name))
   throw Error('External, macro, or embedded workbook content is not supported');
  total+=uncompressed;
  if(total>6*1024*1024)throw Error('Expanded workbook is too large for safe preview');
  offset=end;
 }
 if(offset!==start+size)throw Error('Unexpected ZIP directory length');
}
function sheetPath(target){
 const clean=target.replace(/^\/+/,'').replace(/^xl\//,'');
 if(!/^worksheets\/[a-zA-Z0-9_.-]+\.xml$/.test(clean))throw Error('Unsupported worksheet reference');
 return 'xl/'+clean;
}
function sharedStrings(files){
 const bytes=files['xl/sharedStrings.xml'];
 if(!bytes)return [];
 const doc=parseXml(bytes);
 return [...doc.getElementsByTagNameNS('*','si')].map(si=>
  [...si.getElementsByTagNameNS('*','t')].map(t=>t.textContent||'').join(''));
}
function collectCells(doc,strings){
 const map=new Map();
 for(const c of doc.getElementsByTagNameNS('*','c')){
  const key=(c.getAttribute('r')||'').toUpperCase();
  if(!validAddr(key)||map.has(key))continue;
  const type=c.getAttribute('t');
  const raw=textOf(c,'v'),formula=textOf(c,'f');
  let value;
  if(type==='s')value=strings[Number(raw)]??'';
  else if(type==='inlineStr')value=[...c.getElementsByTagNameNS('*','t')].map(t=>t.textContent||'').join('');
  else if(type==='b')value=raw==='1'?'TRUE':'FALSE';
  else value=raw;
  map.set(key,{value,formula:formula?('='+formula):null});
 }
 return map;
}
async function openData(bytes,name){
 if(!window.fflate?.unzipSync)throw Error('Local ZIP parser unavailable');
 zipPreflight(bytes);
 const zip=window.fflate.unzipSync(bytes);
 if(!zip['[Content_Types].xml']||!zip['xl/workbook.xml']||!zip['xl/_rels/workbook.xml.rels'])
  throw Error('Missing required Excel workbook files');
 const workbook=parseXml(zip['xl/workbook.xml']);
 const rels=parseXml(zip['xl/_rels/workbook.xml.rels']);
 const relations=new Map([...rels.getElementsByTagNameNS('*','Relationship')]
  .map(n=>[n.getAttribute('Id'),n.getAttribute('Target')]));
 const strings=sharedStrings(zip);
 const items=[];
 for(const node of workbook.getElementsByTagNameNS('*','sheet')){
  const id=node.getAttributeNS(REL,'id')||node.getAttribute('r:id');
  const target=relations.get(id);
  if(!target)continue;
  const path=sheetPath(target);
  if(!zip[path])continue;
  const doc=parseXml(zip[path]);
  items.push({name:node.getAttribute('name')||('Sheet '+(items.length+1)),
   path,doc,cells:collectCells(doc,strings)});
 }
 if(!items.length)throw Error('Workbook contains no supported worksheets');
 entries=zip;
 sheets=items;
 current=bytes;
 currentName=name;
 edits=0;
 $('edits').textContent='0 edits';
 $('sheet').replaceChildren(...sheets.map((s,i)=>{
  const o=document.createElement('option');o.value=String(i);o.textContent=s.name;return o;
 }));
 $('sheet').disabled=false;
 $('lookup').disabled=false;$('cell-value').disabled=false;
 $('stage').disabled=false;$('upload').disabled=false;$('export').disabled=false;
 selectSheet(0);
 status('Loaded '+name+' locally: '+sheets.length+' worksheet(s), '+bytes.length+' bytes. Nothing uploaded yet.');
}
function selectSheet(index){
 selected=sheets[index]||null;
 if(!selected)return;
 $('sheet').value=String(index);
 showCell();
 preview();
}
function showCell(){
 if(!selected)return;
 const addr=$('cell-ref').value.trim().toUpperCase();
 if(!validAddr(addr)){$result.textContent='Enter a valid Excel cell address (such as A1).';return;}
 const found=selected.cells.get(addr);
 $result.textContent=selected.name+'!'+addr+'\n'+(found?
  'Value: '+String(found.value)+'\n'+(found.formula?'Formula: '+found.formula:''):'Empty cell');
 $('cell-value').value=found?.formula||String(found?.value??'');
}
function colName(n){
 let text='';
 while(n){n--;text=String.fromCharCode(65+n%26)+text;n=Math.floor(n/26);}
 return text;
}
function preview(){
 const table=$('preview');table.replaceChildren();
 if(!selected)return;
 const addresses=[...selected.cells.keys()].map(coordinates);
 const rows=Math.min(25,Math.max(5,...addresses.map(p=>p.row)));
 const cols=Math.min(12,Math.max(4,...addresses.map(p=>p.col)));
 const thead=document.createElement('thead'),head=document.createElement('tr');
 const corner=document.createElement('th');corner.textContent='#';head.append(corner);
 for(let c=1;c<=cols;c++){const th=document.createElement('th');th.textContent=colName(c);head.append(th);}
 thead.append(head);table.append(thead);
 const tbody=document.createElement('tbody');
 for(let r=1;r<=rows;r++){
  const tr=document.createElement('tr'),label=document.createElement('th');
  label.textContent=String(r);tr.append(label);
  for(let c=1;c<=cols;c++){
   const address=colName(c)+r,cell=selected.cells.get(address),td=document.createElement('td');
   td.textContent=cell?.formula||String(cell?.value??'');
   td.title=address;tr.append(td);
  }
  tbody.append(tr);
 }
 table.append(tbody);
}
function putCell(sheet,address,value){
 const {row:rowNum,col:colNum}=coordinates(address);
 const doc=sheet.doc;
 const parent=first(doc,'sheetData');
 if(!parent)throw Error('Worksheet data section is unavailable');
 let row=[...parent.getElementsByTagNameNS('*','row')]
  .find(n=>Number(n.getAttribute('r'))===rowNum);
 if(!row){
  row=doc.createElementNS(NS,'row');row.setAttribute('r',String(rowNum));
  const following=[...parent.children].find(n=>
   n.localName==='row'&&Number(n.getAttribute('r'))>rowNum);
  parent.insertBefore(row,following||null);
 }
 let c=[...row.children].find(n=>n.localName==='c'&&n.getAttribute('r')===address);
 if(!c){
  c=doc.createElementNS(NS,'c');c.setAttribute('r',address);
  const after=[...row.children].find(n=>n.localName==='c'&&
   validAddr(n.getAttribute('r'))&&coordinates(n.getAttribute('r')).col>colNum);
  row.insertBefore(c,after||null);
 }
 for(const child of [...c.children])if(['f','v','is'].includes(child.localName))c.removeChild(child);
 if(value.startsWith('=')){
  const formula=value.slice(1);
  if(!/^[a-zA-Z0-9_.$()+*/,:!^&<>= \-]{1,160}$/.test(formula))
   throw Error('Formula contains unsupported characters');
  c.removeAttribute('t');
  const f=doc.createElementNS(NS,'f');f.textContent=formula;c.append(f);
  sheet.cells.set(address,{value:'',formula:value});
 }else if(/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value)&&Number.isFinite(Number(value))){
  c.removeAttribute('t');
  const v=doc.createElementNS(NS,'v');v.textContent=String(Number(value));c.append(v);
  sheet.cells.set(address,{value:String(Number(value)),formula:null});
 }else{
  c.setAttribute('t','inlineStr');
  const is=doc.createElementNS(NS,'is'),t=doc.createElementNS(NS,'t');
  t.textContent=value;
  if(/^\s|\s$/.test(value))t.setAttribute('xml:space','preserve');
  is.append(t);c.append(is);
  sheet.cells.set(address,{value,formula:null});
 }
}
function editedBytes(){
 if(!entries)throw Error('No workbook has been opened');
 if(!edits)return current;
 for(const sheet of sheets){
  entries[sheet.path]=new TextEncoder().encode(new XMLSerializer().serializeToString(sheet.doc));
 }
 const workbook=parseXml(entries['xl/workbook.xml']);
 let calc=first(workbook,'calcPr');
 if(!calc){calc=workbook.createElementNS(NS,'calcPr');workbook.documentElement.append(calc);}
 calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('calcMode','auto');
 entries['xl/workbook.xml']=new TextEncoder().encode(new XMLSerializer().serializeToString(workbook));
 const bytes=window.fflate.zipSync(entries,{level:6});
 if(bytes.length>MAX)throw Error('Edited workbook exceeds 2 MB upload limit');
 return bytes;
}
async function cloudCall(method='',body=null,query=''){
 const response=await fetch('/api/brain/local-workbooks'+query,{
  method:method||'GET',credentials:'same-origin',cache:'no-store',
  ...(body?{body}:{}),redirect:'error'
 });
 const json=await response.json().catch(()=>({ok:false,error:'invalid-server-response'}));
 if(!response.ok||!json.ok)throw Error(json.error||'Cloud request failed');
 return json;
}
async function listCloud(){
 const container=$('files');container.textContent='Loading…';
 try{
  const d=await cloudCall();
  container.replaceChildren();
  if(!d.files.length){container.textContent='No private workbooks saved yet.';return;}
  for(const file of d.files){
   const row=document.createElement('div');row.className='file-item';
   const info=document.createElement('span');info.textContent=file.name+' ('+Math.ceil(file.bytes/1024)+' KB)';
   const button=document.createElement('button');button.type='button';button.textContent='Download';
   button.addEventListener('click',async()=>{
    button.disabled=true;
    try{
     const d=await cloudCall('GET',null,'?key='+encodeURIComponent(file.key));
     window.location.assign(d.url);
    }catch(e){status('Download failed: '+escapeStatus(e));}
    finally{button.disabled=false;}
   });
   row.append(info,button);container.append(row);
  }
 }catch(e){container.textContent='Private file listing unavailable: '+escapeStatus(e);}
}
$('open').addEventListener('click',async()=>{
 const f=$('file').files[0];
 if(!f)return status('Select a workbook first.');
 if(!/\.xlsx$/i.test(f.name)||f.size>MAX)return status('Only .xlsx files up to 2 MB are supported.');
 try{await openData(new Uint8Array(await f.arrayBuffer()),f.name);}
 catch(e){status('Unable to open workbook: '+escapeStatus(e));}
});
$('sheet').addEventListener('change',e=>selectSheet(Number(e.target.value)));
$('lookup').addEventListener('click',showCell);
$('stage').addEventListener('click',()=>{
 const a=$('cell-ref').value.trim().toUpperCase();
 if(!validAddr(a))return status('Invalid Excel cell address.');
 try{
  putCell(selected,a,$('cell-value').value);
  edits++;$('edits').textContent=edits+' staged edit(s)';
  showCell();preview();status('Staged '+selected.name+'!'+a+' locally. Export or upload when ready.');
 }catch(e){status(escapeStatus(e));}
});
$('export').addEventListener('click',()=>{
 try{
  const bytes=editedBytes(),file=new Blob([bytes],{type:MIME});
  const url=URL.createObjectURL(file);
  const a=document.createElement('a');a.href=url;
  a.download=edits?currentName.replace(/\.xlsx$/i,' - EDITED.xlsx'):currentName;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  status('Exported '+bytes.length+' workbook bytes locally; original Downloads file remains unchanged.');
 }catch(e){status('Export failed: '+escapeStatus(e));}
});
$('upload').addEventListener('click',async()=>{
 if(!current)return;
 const b=$('upload');b.disabled=true;
 try{
  const bytes=editedBytes();
  const filename=edits?currentName.replace(/\.xlsx$/i,' - EDITED.xlsx'):currentName;
  const fd=new FormData();
  fd.append('file',new File([bytes],filename,{type:MIME}));
  const json=await cloudCall('POST',fd);
  status('Private cloud copy saved: '+json.file.name+'. Original local file unchanged.');
  await listCloud();
 }catch(e){status('Cloud upload failed: '+escapeStatus(e));}
 finally{b.disabled=false;}
});
$('refresh').addEventListener('click',listCloud);
listCloud();