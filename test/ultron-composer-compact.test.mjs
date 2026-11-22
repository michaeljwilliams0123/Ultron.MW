import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../cloud/hatchable/public/',import.meta.url);
const source=()=>readFileSync(new URL('ultron-composer.js',root),'utf8');
const css=()=>readFileSync(new URL('ultron-chat.css',root),'utf8');

function fakeNode(name){
 const classes=new Set(),listeners=new Map(),attributes=new Map();
 return {
  name,hidden:false,disabled:false,value:'',type:null,textContent:'',title:'',
  className:'',attributes,listeners,
  classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x)},
  setAttribute:(k,v)=>attributes.set(k,String(v)),
  addEventListener:(event,handler)=>listeners.set(event,handler),
  append(node){this.lastChild=node;},
  insertAdjacentElement(_position,node){this.nextElementSibling=node;},
  focus(){this.focused=true;listeners.get('focus')?.({target:this});},
  blur(){this.focused=false;listeners.get('blur')?.({target:this});},
  click(){listeners.get('click')?.({target:this});},
  keydown(key){const e={key,preventDefault(){this.prevented=true;}};listeners.get('keydown')?.(e);return e}
 };
}
function boot({draft=''}={}){
 const composer=fakeNode('composer');
 const body=fakeNode('composer-body');body.value=draft;
 const actions=fakeNode('composer-actions');
 const top=fakeNode('composer-topline');
 composer.querySelector=selector=>selector==='.composer-topline'?top:null;
 const document={
  body:{classList:{contains:name=>name==='u-council'}},
  querySelector:selector=>selector==='.conversation > .composer'?composer:selector==='.composer-actions'?actions:null,
  getElementById:id=>id==='composer-body'?body:null,
  createElement:tag=>fakeNode(tag)
 };
 vm.runInNewContext(source(),{document});
 return {composer,body,actions,top,hide:actions.lastChild,opener:composer.nextElementSibling};
}

test('idle composer uses compact mode but keeps draft editing and sending possible',()=>{
 const ui=boot();
 assert.equal(ui.composer.classList.contains('ultron-composer-compact'),true);
 assert.equal(ui.composer.hidden,false);
 assert.equal(ui.opener.hidden,true);
 ui.body.focus();
 assert.equal(ui.composer.classList.contains('ultron-composer-compact'),false);
 ui.body.blur();
 assert.equal(ui.composer.classList.contains('ultron-composer-compact'),true);
});

test('hide and reopen preserve unsent draft and return keyboard focus',()=>{
 const ui=boot({draft:'Keep this unsubmitted draft'});
 assert.equal(ui.hide.type,'button');
 assert.equal(ui.opener.type,'button');
 assert.equal(ui.hide.attributes.get('aria-label'),'Hide message input');
 assert.equal(ui.opener.attributes.get('aria-controls'),ui.composer.id);
 ui.hide.click();
 assert.equal(ui.composer.hidden,true);
 assert.equal(ui.opener.hidden,false);
 assert.equal(ui.opener.focused,true);
 ui.opener.click();
 assert.equal(ui.composer.hidden,false);
 assert.equal(ui.opener.hidden,true);
 assert.equal(ui.body.focused,true);
 assert.equal(ui.body.value,'Keep this unsubmitted draft');
});

test('Esc compacts only empty drafts and never submits or deletes text',()=>{
 const ui=boot({draft:'An unfinished question'});
 ui.body.focus();
 ui.body.keydown('Escape');
 assert.equal(ui.body.value,'An unfinished question');
 assert.equal(ui.composer.classList.contains('ultron-composer-compact'),false);
 ui.body.value='';
 ui.body.keydown('Escape');
 assert.equal(ui.composer.classList.contains('ultron-composer-compact'),true);
 assert.equal(ui.composer.hidden,false);
});

test('compact layout uses single-row grid and explicit shorter textarea on desktop and mobile',()=>{
 const stylesheet=css();
 assert.match(stylesheet,/\.composer\.ultron-composer-compact\s*\{[^}]*display:grid/s);
 assert.match(stylesheet,/\.composer\.ultron-composer-compact\s+textarea\s*\{[^}]*height:40px!important/s);
 assert.match(stylesheet,/\.ultron-composer-reopen/);
 assert.match(stylesheet,/@media\s*\(max-width:\s*640px\)/);
 assert.match(stylesheet,/\.composer\.ultron-composer-compact\s+\.composer-actions\s+p\s*\{\s*display:none!important/s);
});

test('new behavior is scoped to Council chat and cannot mutate provider state',()=>{
 const s=source();
 assert.match(s,/classList\.contains\('u-council'\)/);
 assert.doesNotMatch(s,/\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b|\.submit\(|\.click\(\)/);
 const html=readFileSync(new URL('council-room.html',root),'utf8');
 assert.match(html,/src="\/ultron-composer\.js"\s+defer/);
 assert.match(html,/src="\/ultron-chat\.js"\s+defer/);
});
