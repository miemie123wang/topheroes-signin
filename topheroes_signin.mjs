/**
 * TopHeroesBot - Signin v2 (single-file stable version)
 * Node.js 18+
 *
 * Required environment variables:
 *   GAS_APPROVED_UID_URL       Google Apps Script Web App URL, returns approved UIDs
 *   DISCORD_WEBHOOK_URL        Discord webhook URL
 *   TOPHEROES_LOGIN_URL        TopHeroes login API URL
 *   TOPHEROES_ACTIVITY_URL     TopHeroes activity/list API URL
 *   TOPHEROES_SIGNIN_URL       TopHeroes signin/claim API URL
 *
 * Optional:
 *   TOPHEROES_DRY_RUN=1
 *   TOPHEROES_TIMEOUT_MS=20000
 *   TOPHEROES_RETRY_TIMES=2
 *   TOPHEROES_MIN_SLEEP_MS=800
 *   TOPHEROES_MAX_SLEEP_MS=2500
 *
 * Run:
 *   node topheroes_signin_v2.mjs
 */

const CONFIG = {
  gasApprovedUidUrl: process.env.GAS_APPROVED_UID_URL || '',
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',

  endpoints: {
    login: process.env.TOPHEROES_LOGIN_URL || '',
    activity: process.env.TOPHEROES_ACTIVITY_URL || '',
    signin: process.env.TOPHEROES_SIGNIN_URL || '',
  },

  activityType: 4,
  dryRun: process.env.TOPHEROES_DRY_RUN === '1',
  timeoutMs: Number(process.env.TOPHEROES_TIMEOUT_MS || 20_000),
  retryTimes: Number(process.env.TOPHEROES_RETRY_TIMES || 2),
  minSleepMs: Number(process.env.TOPHEROES_MIN_SLEEP_MS || 800),
  maxSleepMs: Number(process.env.TOPHEROES_MAX_SLEEP_MS || 2500),
};

const summary = {
  startedAt: new Date(),
  total: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  details: [],
};

function time() {
  return new Date().toLocaleString('en-CA', { hour12: false });
}

const icon = {
  info: 'ℹ️',
  ok: '✅',
  warn: '⚠️',
  fail: '❌',
  sleep: '😴',
  uid: '👤',
  gift: '🎁',
};

function log(level, message, data) {
  const line = `[${time()}] ${icon[level] || ''} ${message}`;
  if (data === undefined) console.log(line);
  else console.log(line, data);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function randomSleep(reason = 'random sleep') {
  const ms = randomInt(CONFIG.minSleepMs, CONFIG.maxSleepMs);
  log('sleep', `${reason}: ${ms}ms`);
  await sleep(ms);
}

function requireConfig() {
  const missing = [];
  if (!CONFIG.gasApprovedUidUrl) missing.push('GAS_APPROVED_UID_URL');
  if (!CONFIG.discordWebhookUrl) missing.push('DISCORD_WEBHOOK_URL');
  if (!CONFIG.endpoints.login) missing.push('TOPHEROES_LOGIN_URL');
  if (!CONFIG.endpoints.activity) missing.push('TOPHEROES_ACTIVITY_URL');
  if (!CONFIG.endpoints.signin) missing.push('TOPHEROES_SIGNIN_URL');
  if (missing.length) throw new Error(`Missing env/config: ${missing.join(', ')}`);
}

function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 10) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

async function requestJson(url, options = {}, label = 'request', retryTimes = CONFIG.retryTimes) {
  let lastError;

  for (let attempt = 0; attempt <= retryTimes; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    try {
      log('info', `${label} attempt ${attempt + 1}/${retryTimes + 1}`);
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8',
          'user-agent': 'Mozilla/5.0 TopHeroesBot/2.0',
          ...(options.headers || {}),
        },
      });

      const text = await res.text();
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }

      if (!res.ok) {
        const shortBody = typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
        throw new Error(`${label} HTTP ${res.status}: ${shortBody}`);
      }

      return body;
    } catch (err) {
      lastError = err;
      const finalTry = attempt >= retryTimes;
      log(finalTry ? 'fail' : 'warn', `${label} ${finalTry ? 'failed' : 'retrying'}: ${err.message}`);
      if (!finalTry) await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

async function sendDiscord(title, message, color = 0xffcc00) {
  if (!CONFIG.discordWebhookUrl) return;

  const payload = {
    embeds: [
      {
        title,
        description: message.slice(0, 3900),
        color,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  if (CONFIG.dryRun) {
    log('info', `DRY_RUN Discord: ${title}`, message);
    return;
  }

  try {
    await requestJson(
      CONFIG.discordWebhookUrl,
      { method: 'POST', body: JSON.stringify(payload) },
      'discord webhook',
      1,
    );
  } catch (err) {
    console.error(`[${time()}] Discord webhook failed: ${err.message}`);
  }
}

function collectValues(obj, keys) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (keys.includes(k) && v !== undefined && v !== null && v !== '') found.push(v);
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(obj);
  return found;
}

function extractToken(loginRes) {
  return collectValues(loginRes, ['authorization', 'Authorization', 'token', 'accessToken', 'access_token', 'authToken'])[0] || null;
}

function extractNickname(loginRes, uid) {
  return collectValues(loginRes, ['nickname', 'nickName', 'name', 'roleName', 'playerName'])[0] || `UID ${uid}`;
}

function looksSuccess(res) {
  if (!res) return false;
  if (res.success === true || res.ok === true) return true;
  if ([0, 200].includes(res.code) || [0, 200].includes(res.status) || [0, 200].includes(res.errCode)) return true;
  const text = JSON.stringify(res).toLowerCase();
  return /success|signed|claimed|already|ok|done/.test(text) && !/fail|error|denied|invalid/.test(text);
}

function isNoMoreCatchup(res) {
  const text = JSON.stringify(res || {}).toLowerCase();
  return /no.*补|no.*make|no.*retro|no.*available|not.*available|already|today|finished|complete|empty|none/.test(text);
}

function extractActivityId(activityRes) {
  const candidates = [];

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);

    const type = node.activity_type ?? node.activityType ?? node.type;
    const id = node.activity_id ?? node.activityId ?? node.id;
    if (Number(type) === CONFIG.activityType && id !== undefined && id !== null && id !== '') {
      candidates.push(id);
    }

    Object.values(node).forEach(visit);
  };

  visit(activityRes);
  return candidates[0] || null;
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
    note: item.note ?? item.name ?? '',
  };
}

async function fetchApprovedUids() {
  log('info', 'Fetching Approved UID from Google Apps Script');

  const data = await requestJson(CONFIG.gasApprovedUidUrl, { method: 'GET' }, 'fetch approved uid');
  const rawList = Array.isArray(data)
    ? data
    : data?.uids || data?.approvedUids || data?.approved || data?.data || data?.rows || [];

  const seen = new Set();
  const list = rawList
    .map(normalizeUidRecord)
    .filter(Boolean)
    .filter((row) => {
      if (!row.uid || seen.has(row.uid)) return false;
      seen.add(row.uid);
      return true;
    });

  if (!list.length) throw new Error('No approved UID returned from Google Apps Script');
  log('ok', `Approved UID loaded: ${list.length}`);
  return list;
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

async function login(account) {
  const runLogin = async (tag) => {
    const res = CONFIG.dryRun
      ? { code: 0, data: { token: `dry-token-${account.uid}`, nickname: account.note || `UID ${account.uid}` } }
      : await requestJson(
          CONFIG.endpoints.login,
          { method: 'POST', body: JSON.stringify(loginPayload(account)) },
          tag,
          CONFIG.retryTimes,
        );

    const token = extractToken(res);
    const nickname = extractNickname(res, account.uid);
    return { raw: res, token, nickname };
  };

  const first = await runLogin(`login ${account.uid}`);
  if (first.token) return first;

  log('warn', `login ${account.uid}: token missing, wait 2s then retry login once`);
  await sleep(2000);

  const second = await runLogin(`login retry ${account.uid}`);
  if (second.token) return second;

  throw new Error(`login token missing after retry, uid=${account.uid}, nickname=${second.nickname}`);
}

async function getCurrentSigninActivity(auth) {
  const body = {
    activity_type: CONFIG.activityType,
    activityType: CONFIG.activityType,
  };

  const res = CONFIG.dryRun
    ? { code: 0, data: [{ activity_type: CONFIG.activityType, activity_id: 'dry-activity-4' }] }
    : await requestJson(
        CONFIG.endpoints.activity,
        {
          method: 'POST',
          headers: { authorization: auth.token, Authorization: auth.token },
          body: JSON.stringify(body),
        },
        'get activity activity_type=4',
        CONFIG.retryTimes,
      );

  const activityId = extractActivityId(res);
  if (!activityId) throw new Error(`Cannot find current signin activityId from response: ${JSON.stringify(res).slice(0, 1000)}`);
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
    activity_type: CONFIG.activityType,
    activityType: CONFIG.activityType,
    // mode is intentionally duplicated for different backend naming styles.
    mode,
    type: mode,
    action: mode,
  };
}

async function claim(account, auth, activityId, mode) {
  if (CONFIG.dryRun) {
    if (mode === 'catchup') return { code: 1, message: 'no catchup available' };
    return { code: 0, message: 'signin success' };
  }

  return requestJson(
    CONFIG.endpoints.signin,
    {
      method: 'POST',
      headers: { authorization: auth.token, Authorization: auth.token },
      body: JSON.stringify(signinPayload(account, activityId, mode)),
    },
    `${mode} ${account.uid}`,
    CONFIG.retryTimes,
  );
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

function buildSummaryMessage() {
  const mins = ((Date.now() - summary.startedAt.getTime()) / 60000).toFixed(1);
  const lines = [
    `Total: ${summary.total}`,
    `Success: ${summary.success}`,
    `Failed: ${summary.failed}`,
    `Skipped: ${summary.skipped}`,
    `Duration: ${mins} min`,
    '',
    ...summary.details.slice(-25).map((x) => `• ${x}`),
  ];
  return lines.join('\n');
}

async function main() {
  log('info', 'TopHeroesBot signin v2 started');
  requireConfig();

  const accounts = await fetchApprovedUids();
  summary.total = accounts.length;

  let activityId = null;

  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index];
    const isFirst = index === 0;

    try {
      const result = await processAccount(account, activityId, isFirst);
      activityId = result.activityId;
      summary.success++;
      summary.details.push(`✅ ${account.uid} ${result.nickname || ''} catchup=${result.catchupCount}`);
    } catch (err) {
      summary.failed++;
      summary.details.push(`❌ ${account.uid}: ${err.message}`);

      const title = isFirst ? 'TopHeroes Signin v2 stopped on first UID' : 'TopHeroes Signin v2 UID failed';
      const message = `UID: ${account.uid}\nError: ${err.message}`;
      await sendDiscord(title, message, 0xff3333);

      if (isFirst) {
        log('fail', 'First UID failed. Stop whole program.');
        await sendDiscord('TopHeroes Signin v2 Summary', buildSummaryMessage(), 0xff3333);
        process.exitCode = 1;
        return;
      }

      log('warn', `Continue after UID failure: ${account.uid}`);
    }

    if (index < accounts.length - 1) await randomSleep('between accounts');
  }

  const color = summary.failed ? 0xffcc00 : 0x33cc66;
  await sendDiscord('TopHeroes Signin v2 Summary', buildSummaryMessage(), color);
  log(summary.failed ? 'warn' : 'ok', 'TopHeroesBot signin v2 finished');
}

main().catch(async (err) => {
  summary.failed++;
  summary.details.push(`❌ fatal: ${err.message}`);
  log('fail', `Fatal error: ${err.message}`);
  await sendDiscord('TopHeroes Signin v2 Fatal Error', err.message, 0xff3333);
  await sendDiscord('TopHeroes Signin v2 Summary', buildSummaryMessage(), 0xff3333);
  process.exitCode = 1;
});
