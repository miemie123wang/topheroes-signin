import { readFileSync, writeFileSync, existsSync } from "fs";

const BASE = "https://topheroes.store.kopglobal.com";
const SITE_ID = 1028526;
const PROJECT_ID = 1028637;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = "1343771733173473311";
const LAST_MSG_FILE = "last_message_id.txt";

const gameHeaders = {
  "Content-Type": "application/json",
  "accept": "application/json, text/plain, */*",
  "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
  "cookie": "lang=en"
};

const discordHeaders = {
  "Authorization": DISCORD_TOKEN,
  "Content-Type": "application/json"
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function loadLastMessageId() {
  if (existsSync(LAST_MSG_FILE)) {
    return readFileSync(LAST_MSG_FILE, "utf-8").trim();
  }
  return null;
}

function saveLastMessageId(id) {
  writeFileSync(LAST_MSG_FILE, id);
}

function extractGiftCode(content) {
  const match = content.match(/`([A-Z0-9]{6,20})`/i);
  if (match && content.toLowerCase().includes("giftcode")) {
    return match[1].toUpperCase();
  }
  return null;
}

async function checkDiscordChannel(lastMessageId) {
  const params = new URLSearchParams({ limit: "10" });
  if (lastMessageId) params.append("after", lastMessageId);

  const res = await fetch(
    `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?${params}`,
    { headers: discordHeaders }
  );

  if (!res.ok) {
    console.error(`Discord API 錯誤: ${res.status} ${await res.text()}`);
    return { newLastId: lastMessageId, codes: [] };
  }

  const messages = await res.json();
  if (!messages.length) return { newLastId: lastMessageId, codes: [] };

  messages.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? 1 : -1));

  const codes = [];
  for (const msg of messages) {
    const code = extractGiftCode(msg.content);
    if (code) {
      console.log(`發現新 code: ${code}`);
      codes.push(code);
    }
  }

  return { newLastId: messages[messages.length - 1].id, codes };
}

async function redeemForUid(uid, code) {
  console.log(`  UID: ${uid}`);

  await fetch(`${BASE}/api/v2/store/point/reporting`, {
    method: "POST",
    headers: gameHeaders,
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

  const loginRes = await fetch(`${BASE}/api/v2/store/login/player`, {
    method: "POST",
    headers: gameHeaders,
    body: JSON.stringify({
      site_id: SITE_ID,
      player_id: uid,
      server_id: "",
      device: "mobile"
    })
  });
  const loginData = await loginRes.json();
  if (loginData.code !== 1) {
    console.error(`  登錄失敗: ${loginData.message}`);
    return;
  }
  const token = loginRes.headers.get("authorization");
  if (!token) {
    console.error("  沒有拿到 token");
    return;
  }
  console.log(`  登錄成功 ✓ (${loginData.data.user.nickname})`);
  await sleep(1000);

  const redeemRes = await fetch(`${BASE}/api/v2/store/redemption/redeem`, {
    method: "POST",
    headers: { ...gameHeaders, authorization: token },
    body: JSON.stringify({
      project_id: PROJECT_ID,
      redemption_code: code
    })
  });
  const redeemData = await redeemRes.json();
  if (redeemData.code === 1) {
    console.log(`  兌換成功 ✓`);
  } else {
    console.error(`  兌換失敗: ${redeemData.message}`);
  }
}

async function redeemAllUids(code) {
  const uids = readFileSync("uids.txt", "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  console.log(`開始為 ${uids.length} 個帳號兌換: ${code}`);
  for (const uid of uids) {
    await redeemForUid(uid, code);
    await sleep(3000 + Math.random() * 3000);
  }
  console.log("全部兌換完成 ✓");
}

async function main() {
  if (!DISCORD_TOKEN) {
    console.error("缺少 DISCORD_TOKEN 環境變量");
    process.exit(1);
  }

  console.log("檢查 Discord 頻道...");

  const uids = readFileSync("uids.txt", "utf-8")
    .split("\n").map(l => l.trim()).filter(l => l.length > 0);
  console.log(`找到 ${uids.length} 個帳號`);

  let lastMessageId = loadLastMessageId();

  if (!lastMessageId) {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=1`,
      { headers: discordHeaders }
    );
    const messages = await res.json();
    if (messages.length) {
      lastMessageId = messages[0].id;
      saveLastMessageId(lastMessageId);
      console.log("初始化完成，從現在開始監聽新消息");
    }
    return;
  }

  const { newLastId, codes } = await checkDiscordChannel(lastMessageId);

  if (newLastId !== lastMessageId) {
    saveLastMessageId(newLastId);
  }

  for (const code of codes) {
    await redeemAllUids(code);
  }

  if (!codes.length) {
    console.log("沒有新 code");
  }
}

main();
