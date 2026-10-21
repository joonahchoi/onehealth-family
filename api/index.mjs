import { createHash, timingSafeEqual } from 'node:crypto';

const DEFAULT_API_URL = 'https://fodqwrxugebizkysighk.supabase.co/functions/v1/family-health';
export const MAX_BODY_BYTES = 5 * 1024 * 1024 + 64 * 1024;
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function error(status, code, message) {
  return Response.json({ error: message, code }, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}

function apiBase(value) {
  const url = new URL(value || DEFAULT_API_URL);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/$/, '') !== '/functions/v1/family-health') throw new Error('Invalid API configuration');
  return url.toString().replace(/\/$/, '');
}

export function upstreamUrl(requestUrl, base) {
  const incoming = new URL(requestUrl);
  const path = incoming.pathname === '/api/index' && incoming.searchParams.has('route')
    ? `/api/${incoming.searchParams.get('route')}` : incoming.pathname;
  incoming.searchParams.delete('route');
  if (!path.startsWith('/api/') || /[\\:?#]/.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path) || /%(?:2e|2f|5c)/i.test(path)) {
    throw new Error('Invalid API path');
  }
  return `${base}${path}${incoming.search}`;
}

async function bodyBytes(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function proxy(request, env = process.env, fetcher = fetch) {
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return error(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청이에요.');
  const incoming = new URL(request.url);
  if (WRITE_METHODS.has(method) && request.headers.get('origin') !== incoming.origin) {
    return error(403, 'ORIGIN', '캠페인 페이지에서 다시 시도해 주세요.');
  }
  const gateway = env.FAMILY_GATEWAY_TOKEN || '';
  if (gateway.length < 40 || gateway.length > 200) return error(503, 'NOT_CONFIGURED', '저장소 연결을 준비하고 있어요.');
  let target;
  try { target = upstreamUrl(request.url, apiBase(env.FAMILY_API_URL)); }
  catch { return error(400, 'INVALID_REQUEST', '요청 주소를 확인해 주세요.'); }
  if (method === 'POST' && new URL(target).pathname.replace(/\/+$/, '').endsWith('/api/campaign')) {
    const expected = env.FAMILY_SETUP_TOKEN || '';
    if (expected.length < 40 || expected.length > 200) return error(503, 'SETUP_NOT_READY', '선생님 초기 설정을 준비하고 있어요.');
    const provided = request.headers.get('X-Family-Setup') || '';
    const digest = value => createHash('sha256').update(value).digest();
    if (provided.length > 200 || !timingSafeEqual(digest(expected), digest(provided))) {
      return error(401, 'SETUP_KEY', '선생님 전용 설정키를 확인해 주세요.');
    }
  }
  let body;
  if (WRITE_METHODS.has(method)) {
    try { body = await bodyBytes(request); }
    catch { return error(400, 'BODY', '입력 내용을 다시 확인해 주세요.'); }
    if (body === null) return error(413, 'TOO_LARGE', '사진 용량이 커요. 작은 사진으로 다시 시도해 주세요.');
  }
  const headers = new Headers({ 'X-Family-Gateway': gateway });
  for (const name of ['authorization', 'content-type']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Vercel overwrites its forwarding header. Never accept incoming X-Family IP.
  const ip = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (ip && /^[a-fA-F0-9:.]{3,64}$/.test(ip)) headers.set('X-Family-Client-IP', ip);
  try {
    const upstream = await fetcher(target, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(25_000) });
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-type', 'content-disposition']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return error(502, 'UPSTREAM', '저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

export default { async fetch(request) { return proxy(request); } };
