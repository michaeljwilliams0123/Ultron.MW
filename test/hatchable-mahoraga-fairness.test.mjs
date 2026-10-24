import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resumePendingMahoragaActions } from '../cloud/hatchable/lib/mahoraga-actions.js';

test('hourly recovery fairly visits a backlog larger than its scan budget', async () => {
  const keys = ['ultron:prepared-one','ultron:uncertain-two',
    'ultron:prepared-three','ultron:sent-four'];
  const states = ['prepared','uncertain','prepared','sent'];
  const rows = keys.map((action_key,id)=>({
    id:id+1, action_key, state:states[id], last_scanned_at:null,
    operation:'issue.create',request:{title:'Canary',body:'Readback-only audit',
      expectedMainSha:'a'.repeat(40)}
  }));
  const scans=[];let clock=0;
  const db = { async query(sql,params=[]) {
    if(sql.includes('SELECT action_key,operation,request FROM mahoraga_actions')) {
      const selected=rows.filter(x=>x.state!=='observed').sort((a,b)=>
        (a.last_scanned_at??-1)-(b.last_scanned_at??-1)||a.id-b.id);
      return {rows:selected.slice(0,params[0])};
    }
    if(sql.includes('SET last_scanned_at=now()')) {
      const row=rows.find(x=>x.action_key===params[0]);
      assert.ok(row);row.last_scanned_at=++clock;
      return {rows:[]};
    }
    throw Error('unexpected database operation');
  }};
  const execute=async(_runtime,action)=>{
    scans.push(action.key);
    return {ok:false,state:rows.find(x=>x.action_key===action.key).state};
  };
  const first=await resumePendingMahoragaActions({db,config:{},execute,limit:2});
  const second=await resumePendingMahoragaActions({db,config:{},execute,limit:2});
  assert.equal(first.pending,2);
  assert.equal(second.pending,2);
  assert.deepEqual(scans,keys);
  assert.deepEqual(rows.map(x=>x.state),states);
  assert.equal(clock,4);
});

test('an inspection bookkeeping failure is not silently reported as a successful scan',async()=>{
  const row={action_key:'ultron:readback-one',operation:'verify.dispatch',
    request:{ref:'mahoraga/verify',expectedHeadSha:'a'.repeat(40)}};
  const db={async query(sql){
    if(sql.includes('SELECT action_key'))return {rows:[row]};
    throw Error('write unavailable');
  }};
  await assert.rejects(resumePendingMahoragaActions({
    db,config:{},execute:async()=>({ok:true,state:'uncertain'}),limit:1
  }),/write unavailable/);
});

test('fairness migration is additive, indexed, and does not reset external checkpoints',async()=>{
  const sql=await readFile(new URL('../cloud/hatchable/migrations/0005_mahoraga_scan_fairness.sql',
    import.meta.url),'utf8');
  assert.match(sql,/ADD COLUMN last_scanned_at TIMESTAMPTZ/);
  assert.match(sql,/CREATE INDEX mahoraga_actions_pending_scans/);
  assert.doesNotMatch(sql,/\b(DELETE|TRUNCATE|DROP TABLE|UPDATE)\b/i);
});
