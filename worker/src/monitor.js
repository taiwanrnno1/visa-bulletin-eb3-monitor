// No model calls: official HTML -> validated table cell -> durable change/outbox.
export const INDEX_URL = 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html';
export const STATE_KEY = 'monitor:state:v1';
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const DATE_MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const plain = s => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export function cutoff(value) {
  const v = value.replace(/\s+/g, '').toUpperCase();
  if (v === 'C' || v === 'U') return v;
  const m = /^(\d{2})([A-Z]{3})(\d{2})$/.exec(v);
  if (!m) throw new Error('Invalid cutoff date');
  const month = DATE_MONTHS.indexOf(m[2]);
  const d = new Date(Date.UTC(2000 + Number(m[3]), month, Number(m[1])));
  if (month < 0 || d.getUTCMonth() !== month || d.getUTCDate() !== Number(m[1])) throw new Error('Invalid calendar date');
  return v;
}
function dateNumber(value) {
  return Date.UTC(2000 + Number(value.slice(5)), DATE_MONTHS.indexOf(value.slice(2,5)), Number(value.slice(0,2)));
}
export function movement(old, value) {
  if (!old) return { kind: 'unknown', label: '無已確認的比較資料', days: null, months: null };
  if (old === value) return { kind: 'same', label: '維持不變', days: 0, months: 0 };
  if (['C','U'].includes(old) || ['C','U'].includes(value)) return { kind: 'status_changed', label: `狀態由 ${old} 改為 ${value}（C：無排期限制；U：無名額）`, days: null, months: null };
  const days = (dateNumber(value) - dateNumber(old)) / 86400000;
  return { kind: days > 0 ? 'advanced' : 'retrogressed', label: `${days > 0 ? '前進' : '倒退'} ${Math.abs(days)} 天`, days, months: Math.round(Math.abs(days) / 30.4375 * 10) / 10 };
}
export function parseIndex(html) {
  const links = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = plain(m[2]).match(/Visa Bulletin\s+(?:For\s+)?([a-z]+)\s+(\d{4})/i);
    if (!label) continue;
    const month = MONTHS.indexOf(label[1].toLowerCase()) + 1, year = Number(label[2]);
    if (!month) continue;
    const url = new URL(m[1], INDEX_URL);
    if (url.origin !== 'https://travel.state.gov' || !url.pathname.endsWith(`/visa-bulletin-for-${MONTHS[month-1]}-${year}.html`)) continue;
    links.set(year * 12 + month, { year, month, bulletin: `Visa Bulletin For ${label[1][0].toUpperCase()+label[1].slice(1).toLowerCase()} ${year}`, source_url: url.href });
  }
  const sorted = [...links.values()].sort((a,b) => b.year*12+b.month-a.year*12-a.month);
  if (!sorted.length) throw new Error('Official index has no valid bulletin links');
  return sorted;
}
export function parseBulletin(html, bulletin) {
  const text = plain(html);
  const title = new RegExp(`Visa Bulletin (?:For )?${MONTHS[bulletin.month-1]} ${bulletin.year}`, 'i');
  if (!title.test(text)) throw new Error('Bulletin month/title does not match URL');
  // Match section headings in normalized HTML, preserving table boundaries.
  const normalized = html.replace(/&nbsp;|&#160;/gi, ' ');
  const tables = [...normalized.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  const matches = [];
  for (const table of tables) {
    const before = plain(normalized.slice(0,table.index)).toUpperCase();
    const finalAt = before.lastIndexOf('FINAL ACTION DATES FOR EMPLOYMENT-BASED PREFERENCE CASES');
    const filingAt = before.lastIndexOf('DATES FOR FILING OF EMPLOYMENT-BASED VISA APPLICATIONS');
    if (finalAt < 0 || filingAt > finalAt) continue;
    const rows = [...table[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => plain(c[1])));
    const header = rows.find(r => r.some(c => /All Chargeability Areas Except Those Listed/i.test(c)));
    if (!header || !/Employment.*based/i.test(header[0])) continue;
    const column = header.findIndex(c => /All Chargeability Areas Except Those Listed/i.test(c));
    const eb3 = rows.filter(r => r[0] === '3rd');
    if (eb3.length !== 1 || eb3[0].length !== header.length || column < 1) throw new Error('Ambiguous EB-3 table');
    matches.push(cutoff(eb3[0][column]));
  }
  if (matches.length !== 1) throw new Error('Expected exactly one official EB-3 Final Action table');
  return matches[0];
}
async function officialHtml(url, fetcher, sources) {
  let lastError;
  // Public State Department hosts serve the same canonical bulletin pages.
  for (const origin of ['https://travel.state.gov','https://childabduction.state.gov','https://adoptions.state.gov']) {
    try {
      const actual = origin + new URL(url).pathname;
      const html = await fetchOfficialHtml(url, actual, fetcher);
      sources.push(actual);
      return html;
    } catch(error) { lastError = error; }
  }
  throw lastError;
}
async function fetchOfficialHtml(url, actual, fetcher) {
  if (new URL(url).origin !== 'https://travel.state.gov') throw new Error('Non-official source rejected');
  const response = await fetcher(actual, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'Accept': 'text/html', 'Cache-Control': 'no-cache', 'User-Agent': 'Mozilla/5.0 (compatible; VisaBulletinMonitor/2.0)' } });
  if (!response.ok) throw new Error(`Official source HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Official source is not HTML');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, html = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2000000) throw new Error('Official page exceeds safe size');
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally { await reader.cancel(); }
}
export async function readOfficial(previous, fetcher = fetch) {
  const sources = [];
  const links = parseIndex(await officialHtml(INDEX_URL, fetcher, sources));
  const latest = links[0];
  if (previous && latest.year*12+latest.month < previous.year*12+previous.month) throw new Error('Official index moved backwards; retained verified state');
  const priorMonth = latest.month === 1 ? {year:latest.year-1,month:12} : {year:latest.year,month:latest.month-1};
  const prior = links.find(b => b.year === priorMonth.year && b.month === priorMonth.month);
  if (!prior) throw new Error('Previous calendar month missing from official index');
  const value = parseBulletin(await officialHtml(latest.source_url, fetcher, sources), latest);
  // Re-read the previous official bulletin so silent revisions are reflected too.
  const old = parseBulletin(await officialHtml(prior.source_url, fetcher, sources), prior);
  const history = (previous?.history || []).filter(b => b.source_url !== latest.source_url && b.source_url !== prior.source_url);
  history.push({...prior, eb3_all_chargeability_final_action_date:old}, {...latest, eb3_all_chargeability_final_action_date:value});
  return { ...latest, checked_at:new Date().toISOString(), official_verified:true, verification_sources:sources, data_source:'U.S. Department of State (official)', eb3_all_chargeability_final_action_date:value, previous_bulletin:prior.bulletin, previous_bulletin_source_url:prior.source_url, previous_bulletin_eb3_all_chargeability_final_action_date:old, movement_from_previous_bulletin:movement(old,value), history:history.slice(-24) };
}
export function eventFor(previous, current) {
  const sameMonth = previous?.source_url === current.source_url;
  const value = current.eb3_all_chargeability_final_action_date;
  if (sameMonth && previous.eb3_all_chargeability_final_action_date === value) return null;
  const old = sameMonth ? previous.eb3_all_chargeability_final_action_date : current.previous_bulletin_eb3_all_chargeability_final_action_date;
  const title = sameMonth ? 'EB-3 All Chargeability 數值更新' : '新的 Visa Bulletin 已公布';
  return { id:crypto.randomUUID(), title, body:`${current.bulletin}\nEB-3 All Chargeability 表 A：${value}\n${sameMonth ? '修訂前' : '上個月'}：${old}\n${movement(old,value).label}\n官方來源：${current.source_url}`, url:current.source_url, tag:'visa-bulletin-eb3', data:{bulletin:current.bulletin,cutoff:value} };
}
export async function runMonitor(env, deliver, fetcher = fetch) {
  const kv = env.PUSH_SUBSCRIPTIONS;
  const saved = await kv.get(STATE_KEY, 'json') || { pending:[], failures:0 };
  saved.pending = (await Promise.all(saved.pending.map(async e => await kv.get(`monitor:done:${e.id}`) ? null : e))).filter(Boolean);
  let fetchError;
  try {
    const current = await readOfficial(saved.current, fetcher);
    const event = eventFor(saved.current, current);
    if (event) saved.pending.push(event);
    saved.current = current;
    saved.failures = 0;
    saved.last_success = current.checked_at;
    saved.last_error = null;
  } catch (error) {
    fetchError = error;
    saved.failures += 1;
    saved.last_error = String(error.message).slice(0,240);
    // A daily outage notice; never describe a failed fetch as no change.
    const day = new Date().toISOString().slice(0,10);
    if (saved.failures >= 6 && saved.alert_day !== day) {
      saved.alert_day = day;
      saved.pending.push({id:crypto.randomUUID(),title:'Visa Bulletin 官方監測暫時異常',body:'已連續一小時無法確認官方資料，現有排期保留為歷史資料；系統會每十分鐘重試。',url:INDEX_URL,tag:'visa-bulletin-health'});
    }
  }
  saved.last_attempt = new Date().toISOString();
  // Persist observation and outbox before any external delivery.
  await kv.put(STATE_KEY, JSON.stringify(saved));
  let sent = 0, failed = 0;
  for (const event of [...saved.pending]) {
    const result = await deliver(event);
    sent += result.sent; failed += result.failed;
    if (!result.failed) {
      await kv.put(`monitor:done:${event.id}`, '1', {expirationTtl:7776000});
      saved.pending = saved.pending.filter(e => e.id !== event.id);
    }
  }
  saved.delivery = {sent,failed,at:new Date().toISOString()};
  // Separate completion receipts avoid writing the same KV key twice/second.
  await kv.put('monitor:health', JSON.stringify({last_attempt:saved.last_attempt,last_success:saved.last_success,last_error:saved.last_error,failures:saved.failures,pending:saved.pending.length,delivery:saved.delivery}));
  console.log(JSON.stringify({event:'visa_monitor',ok:!fetchError,sent,failed,pending:saved.pending.length,error:saved.last_error}));
  return { ...saved, ok:!fetchError && !failed };
}
