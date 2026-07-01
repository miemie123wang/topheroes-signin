/**
 * TopHeroesBot - signin v2
 * ------------------------------------------------------------
 * Goal: stable daily sign-in / login flow with clear logs.
 * Runtime: Node.js 18+ (uses built-in fetch)
 * package.json: use "type": "module"
 *
 * How to run:
 *   1) npm init -y
 *   2) edit package.json, keep ONLY ONE "type": "module"
 *   3) node signin-v2.js
 *
 * Optional env vars:
 *   TOPHEROES_UID=1542207187328
 *   TOPHEROES_SERVER_ID=10627
 *   TOPHEROES_REGION=CA
 *   TOPHEROES_NICKNAME=咩咩
 *   TOPHEROES_DRY_RUN=1
 *
 * Notes:
 * - This file is intentionally defensive: retries, timeout, readable logs.
 * - Replace API_ENDPOINTS below if the game's endpoint changes.
 */

const CONFIG = {
  uid: process.env.TOPHEROES_UID || '1542207187328',
  serverId: process.env.TOPHEROES_SERVER_ID || '10627',
  region: process.env.TOPHEROES_REGION || 'CA',
  nickname: process.env.TOPHEROES_NICKNAME || '咩咩',
  dryRun: process.env.TOPHEROES_DRY_RUN === '1',

  timeoutMs: 20_000,
  retries: 2,
  retryDelayMs: 1200,

  // Put the real sign-in/login endpoints here.
  // Keep multiple candidates if you have tested more than one.
  apiEndpoints: {
    // Example placeholders. Replace with the working endpoints from your previous version.
    login: process.env.TOPHEROES_LOGIN_URL || '',
    signin: process.env.TOPHEROES_SIGNIN_URL || '',
  },
};

function now() {
  return new Date().toLocaleString('en-CA', { hour12: false });
}

function log(message, data = undefined) {
  const prefix = `[${now()}]`;
  if (data === undefined) console.log(`${prefix} ${message}`);
  else console.log(`${prefix} ${message}`, data);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertConfig() {
  const missing = [];
  if (!CONFIG.uid) missing.push('TOPHEROES_UID');
  if (!CONFIG.serverId) missing.push('TOPHEROES_SERVER_ID');
  if (!CONFIG.apiEndpoints.login) missing.push('TOPHEROES_LOGIN_URL or CONFIG.apiEndpoints.login');
  if (!CONFIG.apiEndpoints.signin) missing.push('TOPHEROES_SIGNIN_URL or CONFIG.apiEndpoints.signin');

  if (missing.length) {
    throw new Error(
      `Missing required config: ${missing.join(', ')}\n` +
      `Open signin-v2.js and fill CONFIG.apiEndpoints.login/signin, or set env vars.`
    );
  }
}

function buildHeaders(extra = {}) {
  return {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'user-agent': 'Mozilla/5.0 TopHeroesBot/2.0',
    ...extra,
  };
}

async function requestJson(url, options = {}, label = 'request') {
  let lastError;

  for (let attempt = 0; attempt <= CONFIG.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    try {
      log(`${label}: attempt ${attempt + 1}/${CONFIG.retries + 1}`);
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: buildHeaders(options.headers || {}),
      });

      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }

      if (!response.ok) {
        const detail = typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body);
        throw new Error(`${label} failed: HTTP ${response.status} ${response.statusText}; body=${detail}`);
      }

      return body;
    } catch (error) {
      lastError = error;
      const isLast = attempt >= CONFIG.retries;
      log(`${label}: ${isLast ? 'failed' : 'will retry'} - ${error.message}`);
      if (!isLast) await sleep(CONFIG.retryDelayMs * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function normalizeToken(loginResponse) {
  if (!loginResponse || typeof loginResponse !== 'object') return null;

  return (
    loginResponse.token ||
    loginResponse.data?.token ||
    loginResponse.result?.token ||
    loginResponse.accessToken ||
    loginResponse.data?.accessToken ||
    null
  );
}

function buildLoginPayload() {
  return {
    uid: CONFIG.uid,
    serverId: CONFIG.serverId,
    region: CONFIG.region,
    nickname: CONFIG.nickname,
  };
}

function buildSigninPayload(loginResponse) {
  return {
    uid: CONFIG.uid,
    serverId: CONFIG.serverId,
    region: CONFIG.region,
    nickname: CONFIG.nickname,
    // Some APIs need data returned by login. Keeping it here is harmless if ignored.
    loginData: loginResponse?.data ?? loginResponse ?? null,
  };
}

async function login() {
  const payload = buildLoginPayload();
  log('Login payload prepared', payload);

  if (CONFIG.dryRun) {
    log('DRY RUN: skip login request');
    return { dryRun: true, token: 'dry-run-token' };
  }

  return requestJson(
    CONFIG.apiEndpoints.login,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'login'
  );
}

async function signin(loginResponse) {
  const payload = buildSigninPayload(loginResponse);
  const token = normalizeToken(loginResponse);

  log('Signin payload prepared', { ...payload, loginData: payload.loginData ? '[present]' : null });

  if (CONFIG.dryRun) {
    log('DRY RUN: skip signin request');
    return { dryRun: true, success: true };
  }

  return requestJson(
    CONFIG.apiEndpoints.signin,
    {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(payload),
    },
    'signin'
  );
}

function isAlreadySigned(response) {
  const text = JSON.stringify(response || {}).toLowerCase();
  return text.includes('already') || text.includes('signed') || text.includes('claimed') || text.includes('repeat');
}

function isSuccess(response) {
  if (!response) return false;
  if (response.success === true) return true;
  if (response.code === 0 || response.errCode === 0 || response.status === 0) return true;
  if (response.message && /success|ok|signed|claimed/i.test(response.message)) return true;
  if (isAlreadySigned(response)) return true;
  return false;
}

async function main() {
  log('TopHeroesBot signin v2 started');
  log(`Account: ${CONFIG.nickname} / UID ${CONFIG.uid} / S${CONFIG.serverId} / ${CONFIG.region}`);

  assertConfig();

  const loginResponse = await login();
  log('Login response received', loginResponse);

  const signinResponse = await signin(loginResponse);
  log('Signin response received', signinResponse);

  if (isSuccess(signinResponse)) {
    log(isAlreadySigned(signinResponse) ? 'Result: already signed / already claimed.' : 'Result: signin success.');
    process.exitCode = 0;
    return;
  }

  throw new Error(`Signin did not look successful. Response: ${JSON.stringify(signinResponse)}`);
}

main().catch((error) => {
  console.error(`\n[${now()}] ERROR: ${error.message}`);
  console.error('Check: endpoint URL, UID/serverId, network, and whether the API response shape changed.');
  process.exitCode = 1;
});
