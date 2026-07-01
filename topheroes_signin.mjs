/**
 * TopHeroesBot signin v2 - conservative runnable single-file version
 * Node.js 18+
 *
 * Goal for GitHub Action:
 * - No reporting module
 * - Discord optional: missing webhook will NOT stop the script
 * - login() is NOT wrapped by generic retry
 * - Each UID login requests once; if token missing, wait 2s and retry login once only
 * - First UID gets activity_type=4 activityId; all other UIDs reuse it
 * - First UID activity/signin failure stops the whole script
 * - Later UID failures notify Discord if available and continue
 * - Catch up in loop, then sign in today
 *
 * Fill URLs either as GitHub Actions env/secrets OR directly below.
 */

const CONFIG = {
  // You can hardcode these 4 URLs here if you do not want to use GitHub Secrets.
  GAS_APPROVED_UID_URL: process.env.GAS_APPROVED_UID_URL || '',
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || '',
  TOPHEROES_LOGIN_URL: process.env.TOPHEROES_LOGIN_URL || '',
  TOPHEROES_ACTIVITY_URL: process.env.TOPHEROES_ACTIVITY_URL || '',
  TOPHEROES_SIGNIN_URL: process.env.TOPHEROES_SIGNIN_URL || '',

  // Emergency fallback: if GAS URL is empty, use APPROVED_UIDS, or default to 咩咩.
  // APPROVED_UIDS example: 1542207187328,1542311061888
  APPROVED_UIDS: process.env.APPROVED_UIDS || '1542207187328',

  ACTIVITY_TYPE: 4,
  TIMEOUT_MS: Number(process.env.TOPHEROES_TIMEOUT_MS || 20000),
  RETRY_TIMES: Number(process.env.TOPHEROES_RETRY_TIMES || 2),
  MIN_SLEEP_MS: Number(process.env.TOPHEROES_MIN_SLEEP_MS || 800),
  MAX_SLEEP_MS: Number(process.env.TOPHEROES_MAX_SLEEP_MS || 2200),
  DRY_RUN: process.env.TOPHEROES_DRY_RUN === '1',
};

const summary = {
  startedAt: Date.now(),
  total: 0,
  success: 0,
  failed: 0,
  details: [],
};

function ts() {
  return new Date().toLocaleString('en-CA', { hour12: false });
}

function log(type, msg, obj) {
  const icon = { info: 'ℹ️', ok: '✅', warn: '⚠️', fail: '❌', sleep: '😴', uid: '👤', gift: '🎁' }[type] || '';
  if (obj === undefined) console.log(`[${ts()}] ${icon} ${msg}`);
  else console.log(`[${ts()}] ${icon} ${msg}`, obj);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function randomSleep(reason) {
  const ms = randomInt(CONFIG.MIN_SLEEP_MS, CONFIG.MAX_SLEEP_MS);
  log('sleep', `${reason}: ${ms}ms`);
  await sleep(ms);
}

function assertEssentialConfig() {
  const missing = [];
  if (!CONFIG.TOPHEROES_LOGIN_URL) missing.push('TOPHEROES_LOGIN_URL');
  if (!CONFIG.TOPHEROES_ACTIVITY_URL) missing.push('TOPHEROES_ACTIVITY_URL');
  if (!CONFIG.TOPHEROES_SIGNIN_URL) missing.push('TOPHEROES_SIGNIN_URL');

  if (missing.length) {
    throw new Error(
      `Missing TopHeroes API URL(s): ${missing.join(', ')}. ` +
      `Put them in GitHub Action env/secrets, or hardcode them at the top of topheroes_signin.mjs. ` +
      `DISCORD_WEBHOOK_URL and GAS_APPROVED_UID_URL are optional in this conservative version.`
    );
  }
}

function buildHeaders(extra = {}) {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'user-agent': 'Mozilla/5.0 TopHeroesBot/2.0',
    ...extra,
  };
}

async function requestJson(url, options = {}, label = 'request', retryTimes = CONFIG.RETRY_TIMES) {
  let lastErr;

  for (let attempt = 0; attempt <= retryTimes; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

    try {
      log('info', `${label} attempt ${attempt + 1}/${retryTimes + 1}`);
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: buildHeaders(options.headers || {}),
      });

      const text = await res.text();
      let body;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }

      if (!res.ok) {
        const shortBody = typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
        throw new Error(`${label} HTTP ${res.status}: ${shortBody}`);
      }
      return body;
    } catch (err) {
      lastErr = err;
      const last = attempt >= retryTimes;
      log(last ? 'fail' : 'warn', `${label} ${last ? 'failed' : 'retrying'}: ${err.message}`);
      if (!last) await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr;
}

async function sendDiscord(title, message, color = 0xffcc00) {
  if (!CONFIG.DISCORD_WEBHOOK_URL) {
    log('warn', `Discord webhook missing, skip Discord: ${title}`);
    return;
  }

  const payload = {
    embeds: [{ title, description: String(message).slice(0, 3900), color, timestamp: new Date().toISOString() }],
  };

  try {
    await requestJson(
      CONFIG.DISCORD_WEBHOOK_URL,
      { method: 'POST', body: JSON.stringify(payload) },
      'discord webhook',
      1
    );
  } catch (err) {
    log('warn', `Discord send failed: ${err.message}`);
  }
}

function normalizeUidRecord(item) {
  if (typeof item === 'string' || typeof item === 'number') return { uid: String(item).trim() };
  if (!item || typeof item !== 'object') return null;
  const uid = item.uid ?? item.UID ?? item.userId ?? item.user_id ?? item.id;
  if (!uid) return null;
  return {
    uid: String(uid).trim(),
    serverId: item.serverId ?? item.server_id ?? item.sid ?? item.server ?? '',
    region: item.region ?? item.country ?? item.area ?? '',
    note: item.note ?? item.name ?? item.nickname ?? '',
  };
}

async function fetchApprovedUids() {
  if (!CONFIG.GAS_APPROVED_UID_URL) {
    const list = CONFIG.APPROVED_UIDS.split(',').map(x => x.trim()).filter(Boolean).map(uid => ({ uid }));
    if (!list.length) throw new Error('No GAS_APPROVED_UID_URL and no APPROVED_UIDS fallback.');
    log('warn', `GAS_APPROVED_UID_URL missing; using APPROVED_UIDS fallback: ${list.length}`);
    return list;
  }

  log('info', 'Fetching Approved UID from Google Apps Script');
  const data = await requestJson(CONFIG.GAS_APPROVED_UID_URL, { method: 'GET' }, 'fetch approved uid');
  const raw = Array.isArray(data) ? data : (data?.uids || data?.approvedUids || data?.approved || data?.data || data?.rows || []);

  const seen = new Set();
  const list = raw.map(normalizeUidRecord).filter(Boolean).filter(x => {
    if (!x.uid || seen.has(x.uid)) return false;
    seen.add(x.uid);
    return true;
  });

  if (!list.length) throw new Error('No approved UID returned from Google Apps Script');
  log('ok', `Approved UID loaded: ${list.length}`);
  return list;
}

function collectValues(obj, keys) {
  const out = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [k, v] of Object.entries(node)) {
      if (keys.includes(k) && v !== undefined && v !== null && v !== '') out.push(v);
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(obj);
  return out;
}

function extractToken(res) {
  return collectValues(res, ['authorization', 'Authorization', 'token', 'accessToken', 'access_token', 'authToken'])[0] || null;
}

function extractNickname(res, uid) {
  return collectValues(res, ['nickname', 'nickName', 'name', 'roleName', 'playerName'])[0] || `UID ${uid}`;
}

function mask(s) {
  s = String(s || '');
  if (!s) return '';
  if (s.length <= 10) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function loginPayload(account) {
  return {
    uid: account.uid,
    user_id: account.uid,
    serverId: account.serverId,
    server_id: account.serverId,
    region: account.region,
  };
}

async function loginOnce(account, label) {
  if (CONFIG.DRY_RUN) {
    return { code: 0, data: { token: `dry-token-${account.uid}`, nickname: account.note || `UID ${account.uid}` } };
  }

  // IMPORTANT: retryTimes = 0 here. login really requests only once per call.
  return requestJson(
    CONFIG.TOPHEROES_LOGIN_URL,
    { method: 'POST', body: JSON.stringify(loginPayload(account)) },
    label,
    0
  );
}

async function login(account) {
  const first = await loginOnce(account, `login ${account.uid}`);
  let token = extractToken(first);
  let nickname = extractNickname(first, account.uid);
  if (token) return { raw: first, token, nickname };

  log('warn', `login ${account.uid}: token missing, wait 2s then retry login once`);
  await sleep(2000);

  const second = await loginOnce(account, `login retry ${account.uid}`);
  token = extractToken(second);
  nickname = extractNickname(second, account.uid);
  if (token) return { raw: second, token, nickname };

  throw new Error(`login token missing after 2 login requests, uid=${account.uid}`);
}

function extractActivityId(res) {
  const ids = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const type = node.activity_type ?? node.activityType ?? node.type;
    const id = node.activity_id ?? node.activityId ?? node.id;
    if (Number(type) === CONFIG.ACTIVITY_TYPE && id !== undefined && id !== null && id !== '') ids.push(id);
    Object.values(node).forEach(walk);
  };
  walk(res);
  return ids[0] || null;
}

async function getCurrentSigninActivity(auth) {
  const res = CONFIG.DRY_RUN
    ? { code: 0, data: [{ activity_type: CONFIG.ACTIVITY_TYPE, activity_id: 'dry-activity-4' }] }
    : await requestJson(
        CONFIG.TOPHEROES_ACTIVITY_URL,
        {
          method: 'POST',
          headers: { authorization: auth.token, Authorization: auth.token },
          body: JSON.stringify({ activity_type: CONFIG.ACTIVITY_TYPE, activityType: CONFIG.ACTIVITY_TYPE }),
        },
        'get activity activity_type=4'
      );

  const activityId = extractActivityId(res);
  if (!activityId) throw new Error(`Cannot find activityId for activity_type=4: ${JSON.stringify(res).slice(0, 1000)}`);
  log('ok', `Current signin activityId: ${activityId}`);
  return activityId;
}

function signinPayload(account, activityId, mode) {
  return {
    uid: account.uid,
    user_id: account.uid,
    serverId: account.serverId,
    server_id: account.serverId,
    activity_id: activityId,
    activityId,
    activity_type: CONFIG.ACTIVITY_TYPE,
    activityType: CONFIG.ACTIVITY_TYPE,
    mode,
    type: mode,
    action: mode,
  };
}

async function claim(account, auth, activityId, mode) {
  if (CONFIG.DRY_RUN) {
    return mode === 'catchup' ? { code: 1, message: 'no catchup available' } : { code: 0, message: 'signin success' };
  }

  return requestJson(
    CONFIG.TOPHEROES_SIGNIN_URL,
    {
      method: 'POST',
      headers: { authorization: auth.token, Authorization: auth.token },
      body: JSON.stringify(signinPayload(account, activityId, mode)),
    },
    `${mode} ${account.uid}`
  );
}

function looksSuccess(res) {
  if (!res) return false;
  if (res.success === true || res.ok === true) return true;
  if ([0, 200].includes(res.code) || [0, 200].includes(res.status) || [0, 200].includes(res.errCode)) return true;
  const text = JSON.stringify(res).toLowerCase();
  return /success|signed|claimed|already|ok|done|领取|签到|已/.test(text) && !/fail|error|denied|invalid|失败|错误/.test(text);
}

function isNoMoreCatchup(res) {
  const text = JSON.stringify(res || {}).toLowerCase();
  return /no.*补|no.*make|no.*retro|no.*available|not.*available|already|today|finished|complete|empty|none|没有|不可|已补|已签/.test(text);
}

async function catchupAll(account, auth, activityId) {
  let count = 0;
  for (let i = 1; i <= 31; i++) {
    const res = await claim(account, auth, activityId, 'catchup');
    if (looksSuccess(res) && !isNoMoreCatchup(res)) {
      count++;
      log('gift', `${account.uid} catchup success #${count}`);
      await randomSleep('after catchup');
      continue;
    }
    if (isNoMoreCatchup(res) || looksSuccess(res)) {
      log('info', `${account.uid} no more catchup`);
      return count;
    }
    throw new Error(`catchup failed: ${JSON.stringify(res).slice(0, 1000)}`);
  }
  return count;
}

async function signinToday(account, auth, activityId) {
  const res = await claim(account, auth, activityId, 'signin');
  if (!looksSuccess(res)) throw new Error(`today signin failed: ${JSON.stringify(res).slice(0, 1000)}`);
  return res;
}

async function processAccount(account, activityId, isFirst) {
  log('uid', `Start UID ${account.uid}${isFirst ? ' (first UID)' : ''}`);

  const auth = await login(account);
  log('ok', `Login OK: ${auth.nickname} / token=${mask(auth.token)}`);

  const finalActivityId = activityId || await getCurrentSigninActivity(auth);
  const catchupCount = await catchupAll(account, auth, finalActivityId);
  await randomSleep('before today signin');
  await signinToday(account, auth, finalActivityId);

  log('ok', `UID ${account.uid} done. catchup=${catchupCount}, today=success`);
  return { activityId: finalActivityId, nickname: auth.nickname, catchupCount };
}

function summaryText() {
  const min = ((Date.now() - summary.startedAt) / 60000).toFixed(1);
  return [
    `Total: ${summary.total}`,
    `Success: ${summary.success}`,
    `Failed: ${summary.failed}`,
    `Duration: ${min} min`,
    '',
    ...summary.details.slice(-25),
  ].join('\n');
}

async function main() {
  log('info', 'TopHeroesBot signin v2 started');
  assertEssentialConfig();

  const accounts = await fetchApprovedUids();
  summary.total = accounts.length;
  let activityId = null;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const isFirst = i === 0;

    try {
      const result = await processAccount(account, activityId, isFirst);
      activityId = result.activityId;
      summary.success++;
      summary.details.push(`✅ ${account.uid} ${result.nickname} catchup=${result.catchupCount}`);
    } catch (err) {
      summary.failed++;
      summary.details.push(`❌ ${account.uid}: ${err.message}`);
      await sendDiscord(isFirst ? 'TopHeroes stopped on first UID' : 'TopHeroes UID failed', `UID: ${account.uid}\nError: ${err.message}`, 0xff3333);

      if (isFirst) {
        log('fail', 'First UID failed. Stop whole program.');
        await sendDiscord('TopHeroes Summary', summaryText(), 0xff3333);
        process.exitCode = 1;
        return;
      }

      log('warn', `Continue after UID failure: ${account.uid}`);
    }

    if (i < accounts.length - 1) await randomSleep('between accounts');
  }

  await sendDiscord('TopHeroes Summary', summaryText(), summary.failed ? 0xffcc00 : 0x33cc66);
  log(summary.failed ? 'warn' : 'ok', 'TopHeroesBot signin v2 finished');
}

main().catch(async err => {
  log('fail', `Fatal error: ${err.message}`);
  summary.failed++;
  summary.details.push(`❌ fatal: ${err.message}`);
  await sendDiscord('TopHeroes Fatal Error', err.message, 0xff3333);
  process.exitCode = 1;
});
