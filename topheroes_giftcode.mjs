import { readFileSync, writeFileSync, existsSync } from "fs";

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

async function fetchCodes() {
  const res = await fetch("https://topheroes.info/gift-codes.php");
  const html = await res.text();
  const webSection = html.match(/<section id="web-codes"[\s\S]*?<\/section>/)?.[0] ?? "";
  const matches = [...webSection.matchAll(/copyToClipboard\(this,\s*'([^']+)'\)/g)];
  return [...new Set(matches.map(m => m[1]))];
}

async function loginUid(uid) {
  await fetch(`${BASE}/api/v2/store/point/reporting`, {
    method: "POST", headers,
    body: JSON.stringify({
      project_id: PROJECT_ID, store_id: SITE_ID,
      merchant_id: 1002558, country: "CA",
      type: "UID_LOGIN_SHOW", device: "mobile", platform: "android"
    })
  });
  await sleep(1000);

  const loginRes = await fetch(`${BASE}/api/v2/store/login/player`, {
    method: "POST", headers,
    body: JSON.stringify({ site_id: SITE_ID, player_id: uid, server_id: "", device: "mobile" })
  });
  const loginData = await loginRes.json();
  if (loginData.code !== 1) return null;
  return loginRes.headers.get("authorization");
}

async function redeemForUid(uid, code, token) {
  const redeemRes = await fetch(`${BASE}/api/v2/store/redemption/redeem`, {
    method: "POST",
    headers: { ...headers, authorization: token },
    body: JSON.stringify({ project_id: PROJECT_ID, redemption_code: code })
  });
  const data = await redeemRes.json();
  if (data.code === 1) {
    console.log(`  ✓ UID ${uid} 兌換成功`);
  } else {
    console.log(`  ✗ UID ${uid} 失敗: ${data.message}`);
  }
}

// 读已兑换记录
const REDEEMED_FILE = "redeemed_codes.txt";
const redeemed = new Set(
  existsSync(REDEEMED_FILE)
    ? readFileSync(REDEEMED_FILE, "utf-8").split("\n").map(l => l.trim()).filter(Boolean)
    : []
);

// 读 UIDs
const uids = readFileSync("uids.txt", "utf-8")
  .split("\n").map(l => l.trim()).filter(Boolean);

console.log(`找到 ${uids.length} 個帳號`);

// 抓新 code
const allCodes = await fetchCodes();
const newCodes = allCodes.filter(c => !redeemed.has(c));
console.log(`網頁上共 ${allCodes.length} 個 code，其中 ${newCodes.length} 個未兌換`);

if (newCodes.length === 0) {
  console.log("沒有新 code，結束");
  process.exit(0);
}

for (const code of newCodes) {
  console.log(`\n開始兌換: ${code}`);
  for (const uid of uids) {
    const token = await loginUid(uid);
    if (!token) {
      console.log(`  ✗ UID ${uid} 登錄失敗`);
      continue;
    }
    await redeemForUid(uid, code, token);
    await sleep(3000 + Math.random() * 3000);
  }
  redeemed.add(code);
  writeFileSync(REDEEMED_FILE, [...redeemed].join("\n") + "\n");
}

console.log("\n全部完成！");
