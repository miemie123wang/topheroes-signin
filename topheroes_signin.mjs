const BASE = "https://topheroes.store.kopglobal.com";
const SITE_ID = 1028526;
const PROJECT_ID = 1028637;

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_KEY = process.env.APPS_SCRIPT_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const headers = {
  "Content-Type": "application/json",
  "accept": "application/json, text/plain, */*",
  "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
  "cookie": "lang=en"
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function randomSleep(min, max) {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
}

const stats = {
  total: 0,
  success: 0,
  failed: 0,
  today: 0,
  makeup: 0,
  alreadyDone: 0,
  failures: []
};

function maskUid(uid) {
  uid = String(uid);
  if (uid.length <= 4) return "****";
  return uid.slice(0, 2) + "*".repeat(uid.length - 4) + uid.slice(-2);
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

async function sendDiscord(message) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch (err) {
    console.error("Discord 通知失敗:", err.message);
  }
}

async function fetchApprovedUids() {
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_KEY) {
    throw new Error("缺少 APPS_SCRIPT_URL 或 APPS_SCRIPT_KEY 環境變量");
  }

  const url = `${APPS_SCRIPT_URL}?key=${encodeURIComponent(APPS_SCRIPT_KEY)}`;
  const res = await fetch(url, { redirect: "follow" });

  if (!res.ok) {
    throw new Error(`Apps Script 請求失敗: ${res.status}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(`Apps Script 錯誤: ${data.error}`);
  }

  return data.uids || [];
}

async function login(uid) {
  const loginRes = await fetch(`${BASE}/api/v2/store/login/player`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      site_id: SITE_ID,
      player_id: uid,
      server_id: "",
      device: "mobile"
    })
  });

  const loginData = await loginRes.json();

  if (loginData.code !== 1) {
    throw new Error(`登錄失敗: ${loginData.message || JSON.stringify(loginData)}`);
  }

  const token = loginRes.headers.get("authorization");

  if (!token) {
    throw new Error("沒有拿到 token");
  }

  return {
    nickname: loginData.data.user.nickname,
    authedHeaders: {
      ...headers,
      authorization: token
    }
  };
}

async function getCurrentSignActivityId(authedHeaders) {
  const res = await fetch(
    `${BASE}/api/v2/store/sale/biz/list?project_id=${PROJECT_ID}&status=2`,
    { headers: authedHeaders }
  );

  const data = await res.json();

  if (!data?.data?.list) {
    throw new Error(`沒有取得活動列表: ${JSON.stringify(data)}`);
  }

  const activity = data.data.list.find(item =>
    item.activity_type === 4 &&
    item.status === 2 &&
    item.activity_switch === 1
  );

  if (!activity) {
    throw new Error("沒有找到進行中的簽到活動");
  }

  console.log(`目前簽到活動：${activity.name} / biz_id=${activity.biz_id}`);

  return activity.biz_id;
}

async function getSignInData(authedHeaders, activityId) {
  const res = await fetch(
    `${BASE}/api/v2/store/sale/biz/sign-in-list?activity_id=${activityId}&page_size=365&site_id=${SITE_ID}&page_no=1`,
    { headers: authedHeaders }
  );

  const data = await res.json();

  if (!data?.data?.sign_in_list) {
    throw new Error(`沒有簽到資料: ${JSON.stringify(data)}`);
  }

  return data.data;
}

function getMakeupItems(signInList) {
  return signInList.filter(item =>
    item.is_appending &&
    !item.is_sign_in
  );
}

function getTodayItem(signInList) {
  return signInList.find(item =>
    item.is_available_sign_in &&
    !item.is_sign_in &&
    !item.is_appending
  );
}

async function receiveMakeupSignIn(authedHeaders, activityId, item) {
  const res = await fetch(`${BASE}/api/v2/store/sale/biz/sign-in/gift/receive`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify({
      activity_id: activityId,
      sign_in_type: 2,
      site_id: SITE_ID,
      day_no: item.day_no,
      appending_date: getTodayDateString()
    })
  });

  return await res.json();
}

async function receiveTodaySignIn(authedHeaders, activityId) {
  const res = await fetch(`${BASE}/api/v2/store/sale/biz/sign-in/gift/receive`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify({
      activity_id: activityId,
      sign_in_type: 1,
      site_id: SITE_ID
    })
  });

  return await res.json();
}

async function processSignedInAccount(nickname, authedHeaders, activityId) {
  console.log(`登錄成功 ✓ (${nickname})`);

  let signInData = await getSignInData(authedHeaders, activityId);

  console.log(`已簽到天數: ${signInData.has_sign_in_days}`);
  console.log(`剩餘補簽次數: ${signInData.remain_appending_days}`);

  let makeupCount = 0;
  let todaySigned = false;

  while (true) {
    const makeupItems = getMakeupItems(signInData.sign_in_list);

    console.log(`目前可補簽 ${makeupItems.length} 天，剩餘補簽次數 ${signInData.remain_appending_days}`);

    if (makeupItems.length === 0 || signInData.remain_appending_days <= 0) {
      break;
    }

    const item = makeupItems[0];

    console.log(`開始補簽：day ${item.day_no}`);

    const receiveData = await receiveMakeupSignIn(authedHeaders, activityId, item);

    if (receiveData.code !== 1) {
      throw new Error(`補簽失敗: ${JSON.stringify(receiveData)}`);
    }

    makeupCount++;
    stats.makeup++;

    console.log(`補簽成功 ✓ day ${item.day_no}`);

    await randomSleep(1500, 3500);

    signInData = await getSignInData(authedHeaders, activityId);
  }

  const today = getTodayItem(signInData.sign_in_list);

  if (!today) {
    console.log("今天已經簽到，或沒有今天可簽項目。");
  } else {
    console.log(`今天可以簽到 day ${today.day_no}`);

    const receiveData = await receiveTodaySignIn(authedHeaders, activityId);

    if (receiveData.code !== 1) {
      throw new Error(`今天簽到失敗: ${JSON.stringify(receiveData)}`);
    }

    todaySigned = true;
    stats.today++;

    console.log("今天簽到成功 ✓");

    await randomSleep(1500, 3500);
  }

  if (makeupCount === 0 && !todaySigned) {
    stats.alreadyDone++;
  }

  stats.success++;

  return {
    nickname,
    makeupCount,
    todaySigned
  };
}

async function processUid(uid, activityId) {
  console.log(`\n========== UID: ${maskUid(uid)} ==========`);

  const loginInfo = await login(uid);

  return await processSignedInAccount(
    loginInfo.nickname,
    loginInfo.authedHeaders,
    activityId
  );
}

const uids = await fetchApprovedUids();
stats.total = uids.length;

console.log(`找到 ${uids.length} 個已 Approved 的帳號`);

if (uids.length === 0) {
  console.log("沒有 UID，結束。");
  process.exit(0);
}

let activityId = null;

// 第一個 UID：登录一次，拿 activityId，然后直接签到/补签。
// 如果第一個 UID 拿 activityId 或签到失败，停止整个程序。
try {
  const firstUid = uids[0];

  console.log(`\n========== 第一個 UID: ${maskUid(firstUid)} ==========`);

  const firstLogin = await login(firstUid);

  console.log(`第一個帳號登錄成功 ✓ (${firstLogin.nickname})`);

  activityId = await getCurrentSignActivityId(firstLogin.authedHeaders);

  console.log(`全局 Activity ID 已確認：${activityId}`);

  const firstResult = await processSignedInAccount(
    firstLogin.nickname,
    firstLogin.authedHeaders,
    activityId
  );

  console.log(`第一個帳號完成：${firstResult.nickname}，補簽 ${firstResult.makeupCount} 次，今天簽到：${firstResult.todaySigned ? "是" : "否"}`);

} catch (err) {
  stats.failed++;

  const msg =
`🚨 Top Heroes 簽到中止
第一個 UID 失敗，已停止後續帳號。
UID: ${maskUid(uids[0])}
原因: ${err.message}`;

  console.error(msg);
  await sendDiscord(msg);

  process.exit(1);
}

// 後續 UID：共用第一個帳號取得的 activityId。
// 後續單個帳號失敗只發 Discord，繼續下一個。
for (let i = 1; i < uids.length; i++) {
  const uid = uids[i];

  try {
    const result = await processUid(uid, activityId);

    console.log(`完成：${result.nickname}，補簽 ${result.makeupCount} 次，今天簽到：${result.todaySigned ? "是" : "否"}`);

  } catch (err) {
    stats.failed++;

    const msg =
`❌ Top Heroes 簽到失敗
進度: ${i + 1}/${uids.length}
UID: ${maskUid(uid)}
Activity ID: ${activityId}
原因: ${err.message}`;

    stats.failures.push(msg);

    console.error(msg);
    await sendDiscord(msg);
  }

  await randomSleep(5000, 10000);
}

const summary =
`✅ Top Heroes 簽到完成
總數: ${stats.total}
成功: ${stats.success}
失敗: ${stats.failed}
今日簽到: ${stats.today}
補簽次數: ${stats.makeup}
已完成/無需操作: ${stats.alreadyDone}
Activity ID: ${activityId}`;

console.log("\n" + summary);
await sendDiscord(summary);

console.log("\n全部完成！");
