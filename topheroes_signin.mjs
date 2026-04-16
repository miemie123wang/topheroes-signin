import { readFileSync } from "fs";

const BASE = "https://topheroes.store.kopglobal.com";
const ACTIVITY_ID = 2569;
const SITE_ID = 1028526;
const PROJECT_ID = 1028637;

const headers = {
  "Content-Type": "application/json",
  "accept": "application/json, text/plain, */*",
  "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
  "cookie": "lang=en"
};

async function signIn(uid) {
  console.log(`\n========== UID: ${uid} ==========`);

  // Step 1: reporting event
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

  // Step 2: login and get token
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

  const authedHeaders = { ...headers, authorization: token };

  // Step 3: get sign-in list
  const listRes = await fetch(
    `${BASE}/api/v2/store/sale/biz/sign-in-list?activity_id=${ACTIVITY_ID}&page_size=365&site_id=${SITE_ID}&page_no=1`,
    { headers: authedHeaders }
  );
  const listData = await listRes.json();
  if (!listData.data || !listData.data.sign_in_list) {
    console.error("沒有簽到資料:", listData);
    return;
  }
  console.log("Step 3: 取得簽到列表 ✓");

  const today = listData.data.sign_in_list.find(
    item => item.is_available_sign_in && !item.is_sign_in
  );
  if (!today) {
    console.log("今天已經簽到過了，或沒有可簽到的項目。");
    return;
  }
  console.log(`Step 3: 找到簽到項目 ✓ (day_no: ${today.day_no})`);

  // Step 4: sign in
  const todayDate = new Date().toISOString().split("T")[0];
  const receiveRes = await fetch(`${BASE}/api/v2/store/sale/biz/sign-in/gift/receive`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify({
      activity_id: ACTIVITY_ID,
      sign_in_type: 2,
      site_id: SITE_ID,
      appending_date: todayDate,
      day_no: today.day_no
    })
  });
  const receiveData = await receiveRes.json();
  if (receiveData.code === 1) {
    console.log(`Step 4: 簽到成功 ✓ (day ${today.day_no})`);
  } else {
    console.error("簽到失敗:", receiveData);
  }
}

// Read UIDs from file
const uids = readFileSync("uids.txt", "utf-8")
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.length > 0);

console.log(`找到 ${uids.length} 個帳號`);
for (const uid of uids) {
  await signIn(uid);
}
console.log("\n全部完成！");
