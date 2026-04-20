import { readFileSync } from "fs";
import * as readline from "readline";

const BASE = "https://topheroes.store.kopglobal.com";
const SITE_ID = 1028526;
const PROJECT_ID = 1028637;

const headers = {
  "Content-Type": "application/json",
  "accept": "application/json, text/plain, */*",
  "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
  "cookie": "lang=en"
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getCode() {
  // Try environment variable first (GitHub Actions)
  if (process.env.REDEEM_CODE) {
    return process.env.REDEEM_CODE.trim();
  }
  // Otherwise prompt
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question("輸入兌換碼: ", (code) => {
      rl.close();
      resolve(code.trim().toUpperCase());
    });
  });
}

async function redeemForUid(uid, code) {
  console.log(`\n========== UID: ${uid} ==========`);

  // Step 1: reporting
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
  await sleep(1000);

  // Step 2: login
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
    console.error("登錄失敗:", loginData.message);
    return;
  }
  const token = loginRes.headers.get("authorization");
  if (!token) {
    console.error("沒有拿到 token");
    return;
  }
  console.log(`登錄成功 ✓ (${loginData.data.user.nickname})`);
  await sleep(1000);

  // Step 3: redeem
  const redeemRes = await fetch(`${BASE}/api/v2/store/redemption/redeem`, {
    method: "POST",
    headers: { ...headers, authorization: token },
    body: JSON.stringify({
      project_id: PROJECT_ID,
      redemption_code: code
    })
  });
  const redeemData = await redeemRes.json();
  if (redeemData.code === 1) {
    console.log(`兌換成功 ✓ (${code})`);
  } else {
    console.error(`兌換失敗: ${redeemData.message}`);
  }
}

// Read UIDs
const uids = readFileSync("uids.txt", "utf-8")
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.length > 0);

console.log(`找到 ${uids.length} 個帳號`);
const code = await getCode();
if (!code) {
  console.error("沒有輸入兌換碼");
  process.exit(1);
}

console.log(`\n開始兌換: ${code}`);
for (const uid of uids) {
  await redeemForUid(uid, code);
  await sleep(3000 + Math.random() * 3000);
}
console.log("\n全部完成！");
