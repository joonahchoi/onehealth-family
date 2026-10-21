import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { proxy, upstreamUrl, MAX_BODY_BYTES } from '../api/index.mjs';

const origin = 'https://campaign.example';
const base = 'https://test-project.supabase.co/functions/v1/family-health';
const env = { FAMILY_API_URL: base, FAMILY_GATEWAY_TOKEN: 'gateway-'.repeat(8), FAMILY_SETUP_TOKEN: 'setup-'.repeat(12) };
const write = (path, headers = {}, body = '{}') => new Request(`${origin}${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body });

test('rewritten and direct routes preserve only API paths and other query values', () => {
  assert.equal(upstreamUrl(`${origin}/api/index?route=photos%2Fid&download=1`, base), `${base}/api/photos/id?download=1`);
  assert.equal(upstreamUrl(`${origin}/api/admin?after=2`, base), `${base}/api/admin?after=2`);
  for (const route of ['..%2Frest', '%252frest', 'https%3A%2F%2Fattacker.example']) {
    assert.throws(() => upstreamUrl(`${origin}/api/index?route=${route}`, base));
  }
});

test('server gateway and platform IP replace spoofed client headers; only user auth is forwarded', async () => {
  const response = await proxy(write('/api/records', {
    authorization: 'Bearer team-token', 'x-family-gateway': 'spoof', 'x-family-client-ip': '1.1.1.1',
    'x-family-setup': 'do-not-forward', 'x-vercel-forwarded-for': '203.0.113.8', 'x-forwarded-for': '192.0.2.9', cookie: 'secret=cookie', apikey: 'spoof',
  }), env, async (url, init) => {
    assert.equal(url, `${base}/api/records`);
    assert.equal(init.headers.get('x-family-gateway'), env.FAMILY_GATEWAY_TOKEN);
    assert.equal(init.headers.get('x-family-client-ip'), '203.0.113.8');
    assert.equal(init.headers.get('authorization'), 'Bearer team-token');
    for (const name of ['cookie', 'apikey', 'origin', 'x-family-setup']) assert.equal(init.headers.get(name), null);
    return Response.json({ ok: true }, { headers: { 'x-private': 'secret', 'cache-control': 'public' } });
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-private'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('untrusted private IP is not forwarded without platform headers', async () => {
  const response = await proxy(new Request(`${origin}/api/team`, { headers: { 'x-family-client-ip': '1.1.1.1' } }), env, async (_url, init) => {
    assert.equal(init.headers.get('x-family-client-ip'), null);
    return Response.json({});
  });
  assert.equal(response.status, 200);
});

test('private image stream and real authentication failure are preserved', async () => {
  const denied = await proxy(new Request(`${origin}/api/team`), env, async () => Response.json({ error: '인증 필요' }, { status: 401 }));
  assert.equal(denied.status, 401);
  const image = await proxy(new Request(`${origin}/api/photos/id`), env, async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [1, 2, 3]);
});

test('cross-origin or originless writes stop before upstream', async () => {
  for (const headers of [{ origin: 'https://other.example' }, {}]) {
    const response = await proxy(new Request(`${origin}/api/teams`, { method: 'POST', headers, body: '{}' }), env, async () => assert.fail('blocked request reached upstream'));
    assert.equal(response.status, 403);
  }
});

test('initial teacher setup always requires private setup key, including rewrite/trailing slash', async () => {
  for (const path of ['/api/campaign', '/api/campaign/', '/api/index?route=campaign']) {
    const denied = await proxy(write(path), env, async () => assert.fail('setup bypass'));
    assert.equal(denied.status, 401);
  }
  const missing = await proxy(write('/api/campaign'), { ...env, FAMILY_SETUP_TOKEN: '' }, async () => assert.fail('missing setup configuration'));
  assert.equal(missing.status, 503);
  const allowed = await proxy(write('/api/campaign', { 'x-family-setup': env.FAMILY_SETUP_TOKEN }), env, async (_url, init) => {
    assert.equal(init.headers.get('x-family-setup'), null);
    return Response.json({ configured: true }, { status: 201 });
  });
  assert.equal(allowed.status, 201);
});

test('oversized declared and actual request bodies stop before upstream', async () => {
  const deniedFetch = async () => assert.fail('oversized request forwarded');
  assert.equal((await proxy(write('/api/records', { 'content-length': String(MAX_BODY_BYTES + 1) }), env, deniedFetch)).status, 413);
  assert.equal((await proxy(write('/api/records', {}, new Uint8Array(MAX_BODY_BYTES + 1)), env, deniedFetch)).status, 413);
});

test('open proxy attempts and upstream exception messages never expose credentials', async () => {
  const invalid = await proxy(new Request(`${origin}/api/campaign`), { ...env, FAMILY_API_URL: 'https://attacker.example/functions/v1/family-health' }, async () => assert.fail('open proxy'));
  assert.equal(invalid.status, 400);
  const failed = await proxy(new Request(`${origin}/api/campaign`), env, async () => { throw new Error(env.FAMILY_GATEWAY_TOKEN); });
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes(env.FAMILY_GATEWAY_TOKEN));
});

test('offline generator creates two matching downloads and only the intended SQL row', async () => {
  const page = await readFile(new URL('../02-연결-설정-만들기.html', import.meta.url), 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  let generate;
  const elements = new Map(['#generate', '#status', '#downloads', '#env-download', '#sql-download'].map(id => [id, { addEventListener(_event, listener) { generate = listener; } }]));
  const blobs = [];
  runInNewContext(script, { document: { querySelector: id => elements.get(id) }, crypto: webcrypto, Uint8Array, TextEncoder, Blob, URL: { createObjectURL(blob) { blobs.push(blob); return `blob:test-${blobs.length}`; }, revokeObjectURL() {} } });
  await generate();
  assert.equal(blobs.length, 2);
  const variables = Object.fromEntries((await blobs[0].text()).trim().split('\n').map(line => line.split('=')));
  assert.match(variables.FAMILY_GATEWAY_TOKEN, /^[a-f0-9]{64}$/);
  assert.match(variables.FAMILY_SETUP_TOKEN, /^[a-f0-9]{64}$/);
  assert.notEqual(variables.FAMILY_GATEWAY_TOKEN, variables.FAMILY_SETUP_TOKEN);
  assert.equal(variables.FAMILY_API_URL, 'https://fodqwrxugebizkysighk.supabase.co/functions/v1/family-health');
  const sql = await blobs[1].text();
  assert.ok(sql.includes(createHash('sha256').update(variables.FAMILY_GATEWAY_TOKEN).digest('hex')));
  assert.ok(sql.includes('insert into public.family_gateway'));
  assert.ok(sql.includes("'vercel'"));
  assert.ok(!/\b(?:drop|delete|alter)\b/i.test(sql));
  assert.equal(elements.get('#downloads').hidden, false);
});
