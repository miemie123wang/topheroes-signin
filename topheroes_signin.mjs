const BASE = "https://topheroes.store.kopglobal.com";
const ACTIVITY_ID = 3261;
const SITE_ID = 1028526;
const PROJECT_ID = 1028637;

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_KEY = process.env.APPS_SCRIPT_KEY;

const headers = {
  "Content-Type": "application/json",
  "accept": "application/json, text/plain, */*",
  "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
  "cookie": "lang=en"
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function maskUid(uid) {
  if (uid.length <= 4) return "****";
  return uid.slice(0, 2) + "*".repeat(uid.length - 4) + uid.slice(-2);
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

async function getSignInList(authedHeaders) {
  const listRes = await fetch(
    `${BASE}/api/v2/store/sale/biz/sign-in-list?activity_id=${ACTIVITY_ID}&page_size=365&site_id=${SITE_ID}&page_no=1`,
    { headers: authedHeaders }
  );

  const listData = await listRes.json();

  if (!listData.data || !listData.data.sign_in_list) {
    console.error("沒有簽到資料:", listData);
    return null;
  }

  return listData.data.sign_in_list;
}

async function receiveSignIn(authedHeaders) {
  const receiveRes = await fetch(`${BASE}/api/v2/store/sale/biz/sign-in/gift/receive`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify({
      activity_id: ACTIVITY_ID,
      sign_in_type: 1,
      site_id: SITE_ID
    })
  });

  return await receiveRes.json();
}

async function signIn(uid) {
  console.log(`\n========== UID: ${maskUid(uid)} ==========`);

  await fetch(`${BASE}/api/v2/store/point/reporting`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      project_id: PROJECT_ID,
      store_id: SITE_ID,
      merchant_id: 1002558,
      country: "CA",
      type: "UID_LOGIN_SHOW",
      device: "mobile",
      platform: "android"
    })
  });

  console.log("Step 1: reporting ✓");
  await sleep(2000);

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
    console.error("登錄失敗:", loginData);
    return;
  }

  const token = loginRes.headers.get("authorization");

  if (!token) {
    console.error("沒有拿到 token");
    return;
  }

  console.log(`Step 2: 登錄成功 ✓ (${loginData.data.user.nickname})`);
  await sleep(2000);

  const authedHeaders = {
    ...headers,
    authorization: token
  };

  let signInList = await getSignInList(authedHeaders);

  if (!signInList) return;

  console.log("Step 3: 取得簽到列表 ✓");

  // Step 4: 先循環補簽，直到沒有可補簽項目
  while (true) {
    const makeupItems = signInList.filter(item =>
      item.is_available_sign_in &&
      !item.is_sign_in &&
      item.is_appending
    );

    if (makeupItems.length === 0) {
      console.log("沒有需要補簽的項目。");
      break;
    }

    console.log(`發現 ${makeupItems.length} 個需要補簽：`);
    for (const item of makeupItems) {
      console.log(`- day ${item.day_no}`);
    }

    const receiveData = await receiveSignIn(authedHeaders);

    if (receiveData.code === 1) {
      console.log("補簽成功 ✓");
    } else {
      console.error("補簽失敗:", receiveData);
      return;
    }

    await sleep(3000);

    signInList = await getSignInList(authedHeaders);

    if (!signInList) return;
  }

  // Step 5: 補簽完成後，再簽今天
  const today = signInList.find(item =>
    item.is_available_sign_in &&
    !item.is_sign_in &&
    !item.is_appending
  );

  if (!today) {
    console.log("今天已經簽到，或沒有今天可簽項目。");
  } else {
    console.log(`Step 5: 今天可以簽到 day ${today.day_no}`);

    const receiveData = await receiveSignIn(authedHeaders);

    if (receiveData.code === 1) {
      console.log("今天簽到成功 ✓");
    } else {
      console.error("今天簽到失敗:", receiveData);
      return;
    }

    await sleep(3000);
  }

  // Step 6: 簽完今天後，再檢查一次補簽，直到沒有
  while (true) {
    signInList = await getSignInList(authedHeaders);

    if (!signInList) return;

    const remainingMakeupItems = signInList.filter(item =>
      item.is_available_sign_in &&
      !item.is_sign_in &&
      item.is_appending
    );

    if (remainingMakeupItems.length === 0) {
      console.log("最後檢查：沒有剩餘補簽項目 ✓");
      break;
    }

    console.log(`最後檢查：還有 ${remainingMakeupItems.length} 個補簽項目，繼續補簽...`);

    const receiveData = await receiveSignIn(authedHeaders);

    if (receiveData.code === 1) {
      console.log("補簽成功 ✓");
    } else {
      console.error("補簽失敗:", receiveData);
      return;
    }

    await sleep(3000);
  }
}

const uids = await fetchApprovedUids();

console.log(`找到 ${uids.length} 個已 Approved 的帳號`);

for (const uid of uids) {
  await signIn(uid);
  await sleep(5000);
}

console.log("\n全部完成！");
