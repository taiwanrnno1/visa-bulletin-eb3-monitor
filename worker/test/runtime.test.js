import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,createFetchMock} from 'miniflare';
import {readFile} from 'node:fs/promises';
test('Worker runtime serves verified data and protects monitor operations',async()=>{
 const root=new URL('../src/',import.meta.url);
 const fetchMock=createFetchMock();
 fetchMock.disableNetConnect();
 const pool=fetchMock.get('https://travel.state.gov');
 const prefix='/content/travel/en/legal/visa-law0/visa-bulletin';
 pool.intercept({path:prefix+'.html'}).reply(200,`<a href="${prefix}/2026/visa-bulletin-for-september-2026.html">Visa Bulletin For September 2026</a><a href="${prefix}/2026/visa-bulletin-for-august-2026.html">Visa Bulletin For August 2026</a>`,{headers:{'content-type':'text/html'}});
 for(const month of ['september','august']) pool.intercept({path:`${prefix}/2026/visa-bulletin-for-${month}-2026.html`}).reply(200,`<h1>Visa Bulletin For ${month} 2026</h1><h2>A. FINAL ACTION DATES FOR EMPLOYMENT-BASED PREFERENCE CASES</h2><table><tr><td>Employment-based</td><td>All Chargeability Areas Except Those Listed</td></tr><tr><td>3rd</td><td>01SEP24</td></tr></table>`,{headers:{'content-type':'text/html'}});
 const mf=new Miniflare({fetchMock,modules:[{type:'ESModule',path:'worker.js',contents:await readFile(new URL('worker.js',root),'utf8')},{type:'ESModule',path:'monitor.js',contents:await readFile(new URL('monitor.js',root),'utf8')}],compatibilityDate:'2026-06-01',kvNamespaces:['PUSH_SUBSCRIPTIONS'],bindings:{MONITOR_ENABLED:'false',BROADCAST_SECRET:'test-only',MONITOR_ADMIN_SECRET:'probe-only',ALLOWED_ORIGIN:'https://taiwanrnno1.github.io'}});
 try {
  const status=await mf.dispatchFetch('https://example.test/api/status');
  assert.equal((await status.json()).ok,false);
  const denied=await mf.dispatchFetch('https://example.test/api/monitor/check',{method:'POST'});
  assert.equal(denied.status,401);
  const probe=await mf.dispatchFetch('https://example.test/api/monitor/probe',{method:'POST',headers:{Authorization:'Bearer probe-only'}});
  const probed=await probe.json();
  assert.equal(probe.status,200,JSON.stringify(probed));
  assert.equal(probed.state.official_verified,true);
  assert.equal(probed.state.eb3_all_chargeability_final_action_date,'01SEP24');
  const kv=await mf.getKVNamespace('PUSH_SUBSCRIPTIONS');
  await kv.put('monitor:state:v1',JSON.stringify({current:{official_verified:true,bulletin:'test'}}));
  await kv.put('monitor:health',JSON.stringify({last_success:new Date().toISOString()}));
  const state=await (await mf.dispatchFetch('https://example.test/api/status')).json();
  assert.equal(state.state.official_verified,true);
  assert.equal(state.stale,false);
  const health=await (await mf.dispatchFetch('https://example.test/api/health')).json();
  assert.equal(health.monitor_enabled,false);
  assert.equal(health.healthy,false);
 } finally {await mf.dispose();}
});
