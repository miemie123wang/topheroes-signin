import { readFileSync, writeFileSync, existsSync } from "fs";

const BASE = "https://topheroes.store.kopglobal.com";
const SITE_ID = 1028526;
const PROJECT_ID = 1028637;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_KEY = process.env.APPS_SCRIPT_KEY;

const CHANNEL_IDS = [
  "1343771733173473311",
  "1112595962515427338"
];
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

function loadLastMessageId() {
  if (existsSync(LAST_MSG_FILE)) {
    try {
      const content = readFileSync(LAST_MSG_FILE, "utf-8").trim();
      const parsed = JSON.parse(content);
      if (typeof parsed !== "object" || parsed === null) {
        return {};
      }
      return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

function saveLastMessageId(ids) {
  writeFileSync(LAST_MSG_FILE, JSON.stringify(ids));
}

function extractGiftCode(content) {
  const match = content.match(/`([A-Za-z0-9]{6,20})`/);
  if (
    match &&
    content.toLowerCase().includes("giftcode") &&
    content.toLowerCase().includes("purchase center")
  ) {
    return match[1];
  }
  return null;
}

function extractInGameCode(content) {
  if (!content.toLowerCase().includes("giftcode")) return null;
  if (content.toLowerCase().includes("purchase center")) return null;

  const backtickMatch = content.match(/`([A-Za-z0-9]{6,20})`/);
  if (backtickMatch) return backtickMatch[1];

  const labelMatch = content.match(/giftcode[:\s,，\n]+([A-Za-z0-9]{6,20})/i);
  if (labelMatch) return labelMatch[1];

  return null;
}

async function sendNotification(content) {
  if (!DISCORD_WEBHOOK) {
    console.error("缺少 DISCORD_WEBHOOK 環境變量");
    return;
  }
  const res = await fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
  if (!res.ok) {
    console.error("Webhook 發送失敗:", await res.text());
  }
}

async function checkDiscordChannel(lastMessageIds) {
  const allCodes = [];
  const inGameCodes = [];
  const newLastIds = { ...lastMessageIds };

  for (const channelId of CHANNEL_IDS) {
    const lastId = lastMessageIds[channelId];
    const params = new URLSearchParams({ limit: "10" });
    if (lastId) params.append("after", lastId);

    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?${params}`,
      { headers: discordHeaders }
    );

    if (!res.ok) {
      console.error(`頻道 ${channelId} 錯誤: ${res.status}`);
      continue;
    }

    const messages = await res.json();
    if (!messages.length) continue;

    messages.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? 1 : -1));

    for (const msg of messages) {
      const webCode = extractGiftCode(msg.content);
      if (webCode && !allCodes.includes(webCode)) {
        console.log(`頻道 ${channelId} 發現網頁兌換碼: ${webCode}`);
        allCodes.push(webCode);
      }

      const igCode = extractInGameCode(msg.content);
      if (igCode && !inGameCodes.includes(igCode)) {
        console.log(`頻道 ${channelId} 發現遊戲內兌換碼: ${igCode}`);
        inGameCodes.push(igCode);
      }
    }

    newLastIds[channelId] = messages[messages.length - 1].id;
  }

  return { newLastIds, codes: allCodes, inGameCodes };
}

async function redeemForUid(uid, code) {
  console.log(`  UID: ${maskUid(uid)}`);

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

async function redeemAllUids(code, uids) {
  console.log(`開始為 ${uids.length} 個帳號兌換: ${code}`);
  for (const uid of uids) {
    await redeemForUid(uid, code);
    await sleep(3000 + Math.random() * 3000);
  }

  console.log("全部兌換完成 ✓");
  const time = new Date().toLocaleString("zh-CN", { timeZone: "America/Toronto" });
  await sendNotification(`✅ 網頁碼兌換成功！\n碼：\`${code}\`\n時間：${time}`);
}

async function main() {
  if (!DISCORD_TOKEN) {
    console.error("缺少 DISCORD_TOKEN 環境變量");
    process.exit(1);
  }

  // 1. 先检查 Discord 频道
  console.log("檢查 Discord 頻道...");
  let lastMessageIds = loadLastMessageId();

  let needsSave = false;
  for (const channelId of CHANNEL_IDS) {
    if (!lastMessageIds[channelId]) {
      const res = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages?limit=1`,
        { headers: discordHeaders }
      );
      const messages = await res.json();
      if (messages.length) {
        lastMessageIds[channelId] = messages[0].id;
        console.log(`頻道 ${channelId} 初始化完成`);
        needsSave = true;
      }
    }
  }

  if (needsSave) {
    saveLastMessageId(lastMessageIds);
    console.log("初始化完成，下次運行開始監聽新消息");
    return;
  }

  const { newLastIds, codes, inGameCodes } = await checkDiscordChannel(lastMessageIds);
  saveLastMessageId(newLastIds);

  // 2. 没有任何 code 就直接结束，不去拿 UID
  if (!codes.length && !inGameCodes.length) {
    console.log("沒有新 code");
    return;
  }

  // 3. 有 code 才去拿 UID
  console.log("發現新 code，從 Google Sheet 獲取已 Approved 的 UID...");
  const uids = await fetchApprovedUids();
  if (uids.length === 0) {
    console.log("沒有已 Approved 的 UID，結束");
    return;
  }
  console.log(`找到 ${uids.length} 個已 Approved 的帳號`);

  for (const code of codes) {
    await redeemAllUids(code, uids);
  }

  for (const code of inGameCodes) {
    await sendNotification(`🎮 發現遊戲內兌換碼：\`${code}\`\n請手動在遊戲內兌換！`);
    console.log(`已發送通知: ${code}`);
  }
}

main();
