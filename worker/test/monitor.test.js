import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cutoff,parseIndex,parseBulletin,movement,eventFor,readOfficial,runMonitor,STATE_KEY,INDEX_URL} from '../src/monitor.js';
import {deliverMonitorEvent} from '../src/worker.js';
const base='https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin/2026/';
const link=(month)=>`${base}visa-bulletin-for-${month}-2026.html`;
const index=`<a href="${link('september')}">Visa Bulletin For September 2026</a><a href="${link('august')}">Visa Bulletin For August 2026</a>`;
function page(month,value='01SEP24',headerOrder=false) {
  return `<h1>Visa Bulletin For ${month} 2026</h1><h2>A. FINAL ACTION DATES FOR FAMILY-SPONSORED PREFERENCE CASES</h2><table><tr><td>3rd</td><td>01JAN00</td></tr></table>
  <h2>A. FINAL ACTION DATES FOR EMPLOYMENT-BASED PREFERENCE CASES</h2><table><tr><td>Employment-<br>based</td>${headerOrder ? '<td>CHINA</td>' : ''}<td>All Chargeability<br>Areas Except<br>Those Listed</td>${headerOrder ? '' : '<td>CHINA</td>'}</tr><tr><td>3rd</td>${headerOrder ? '<td>01JAN20</td>' : ''}<td>${value}</td>${headerOrder ? '' : '<td>01JAN20</td>'}</tr><tr><td>Other Workers</td><td>01JAN21</td><td>01JAN17</td></tr></table>
  <h2>B. DATES FOR FILING OF EMPLOYMENT-BASED VISA APPLICATIONS</h2><table><tr><td>3rd</td><td>01JAN29</td></tr></table>`;
}
const latest=parseIndex(index)[0];
class KV {
  data=new Map();
  async get(k,type){const v=this.data.get(k);return v == null ? null : type==='json'?JSON.parse(v):v;}
  async put(k,v){this.data.set(k,v);}
  async delete(k){this.data.delete(k);}
  async list(){return {keys:[...this.data.keys()].map(name=>({name})),list_complete:true};}
}
const fetcher=async url=>new Response(url===INDEX_URL?index:page(url===link('september')?'September':'August'),{headers:{'content-type':'text/html'}});
test('official links only, exact month/year URL',()=>{
 assert.equal(parseIndex(index+`<a href="https://evil.test/visa-bulletin-for-october-2026.html">Visa Bulletin For October 2026</a>`)[0].month,9);
 assert.throws(()=>parseIndex('<html>blocked</html>'));
});
test('extracts table A 3rd by header, not other workers or filing/family',()=>{
 assert.equal(parseBulletin(page('September'),latest),'01SEP24');
 assert.equal(parseBulletin(page('September','01SEP24',true),latest),'01SEP24');
 assert.throws(()=>parseBulletin(page('August'),latest),/month/);
 assert.throws(()=>parseBulletin(page('September')+page('September'),latest),/exactly one/);
 assert.throws(()=>parseBulletin(page('September').replace('All Chargeability','Unknown'),latest));
});
test('calendar validation and C/U status changes',()=>{
 assert.equal(cutoff('01 SEP 24'),'01SEP24');
 assert.throws(()=>cutoff('31FEB24'));
 assert.throws(()=>cutoff('01BAD24'));
 assert.equal(movement('01AUG24','01SEP24').days,31);
 assert.equal(movement('01SEP24','01AUG24').kind,'retrogressed');
 assert.equal(movement('C','U').kind,'status_changed');
});
test('official fetch builds verified month comparison and rejects HTTP errors',async()=>{
 const current=await readOfficial(null,fetcher);
 assert.equal(current.official_verified,true);
 assert.equal(current.movement_from_previous_bulletin.kind,'same');
 await assert.rejects(()=>readOfficial(null,async()=>new Response('Forbidden',{status:403})),/403/);
 await assert.rejects(()=>readOfficial({...latest,month:10},fetcher),/backwards/);
});
test('same-month revision compares against old value rather than previous month',()=>{
 const old={source_url:link('september'),eb3_all_chargeability_final_action_date:'01SEP24'};
 const current={...old,bulletin:'September 2026',eb3_all_chargeability_final_action_date:'01AUG24',previous_bulletin_eb3_all_chargeability_final_action_date:'01JAN24'};
 assert.match(eventFor(old,current).body,/倒退 31 天/);
 assert.equal(eventFor(old,{...old}),null);
});
test('successful notification is not resent on next unchanged check',async()=>{
 const env={PUSH_SUBSCRIPTIONS:new KV()}; let count=0;
 const deliver=async()=>{count++;return {sent:2,failed:0}};
 await runMonitor(env,deliver,fetcher);
 await runMonitor(env,deliver,fetcher);
 assert.equal(count,1);
 assert.equal((await env.PUSH_SUBSCRIPTIONS.get(STATE_KEY,'json')).pending.length,0);
});
test('failed notifications remain pending and retry independently of upstream failure',async()=>{
 const env={PUSH_SUBSCRIPTIONS:new KV()};
 await runMonitor(env,async()=>({sent:0,failed:1}),fetcher);
 const failed=await runMonitor(env,async()=>({sent:1,failed:0}),async()=>new Response('',{status:503}));
 assert.equal(failed.ok,false);
 assert.equal(failed.delivery.sent,1);
 assert.equal(failed.current.eb3_all_chargeability_final_action_date,'01SEP24');
 assert.equal(failed.failures,1);
});
test('per-recipient receipts prevent resending successful recipients on partial failure',async()=>{
 const kv=new KV(); const env={PUSH_SUBSCRIPTIONS:kv};
 for (const name of ['a','b']) await kv.put(name,JSON.stringify({endpoint:name,keys:{p256dh:'x',auth:'x'}}));
 await kv.put('monitor:state:v1','{}');
 let calls=[];
 const event={id:'one'};
 const first=await deliverMonitorEvent(event,env,async sub=>{calls.push(sub.endpoint);return {ok:sub.endpoint==='a'}});
 assert.deepEqual(first,{sent:1,failed:1,skipped:0});
 const second=await deliverMonitorEvent(event,env,async sub=>{calls.push(sub.endpoint);return {ok:true}});
 assert.deepEqual(second,{sent:1,failed:0,skipped:1});
 assert.deepEqual(calls,['a','b','b']);
});
test('persistent outage gets one alert per day, not every check',async()=>{
 const env={PUSH_SUBSCRIPTIONS:new KV()};let count=0;
 for(let i=0;i<8;i++) await runMonitor(env,async()=>{count++;return {sent:1,failed:0}},async()=>new Response('',{status:403}));
 assert.equal(count,1);
});
test('actual official October/September tables parse and report 109-day retrogression',async()=>{
 const {readFile}=await import('node:fs/promises');
 const october=await readFile(new URL('./fixtures/october-2026.html',import.meta.url),'utf8');
 const september=await readFile(new URL('./fixtures/september-2026.html',import.meta.url),'utf8');
 assert.equal(parseBulletin(october,{year:2026,month:10}),'15MAY24');
 assert.equal(parseBulletin(september,{year:2026,month:9}),'01SEP24');
 assert.equal(movement('01SEP24','15MAY24').days,-109);
});
test('primary 403 falls back only to State Department hosts and records provenance',async()=>{
 const result=await readOfficial(null,async (url,options)=>{
  assert.equal(options.redirect,'manual');
  const u=new URL(url);
  if(u.hostname==='travel.state.gov') return new Response('',{status:403});
  assert.equal(u.hostname,'childabduction.state.gov');
  return fetcher('https://travel.state.gov'+u.pathname);
 });
 assert.equal(result.official_verified,true);
 assert.equal(result.verification_sources.length,3);
 assert.ok(result.verification_sources.every(u=>u.startsWith('https://childabduction.state.gov/')));
});
