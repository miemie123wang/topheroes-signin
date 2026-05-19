# Top Heroes 自动签到 / 礼包码兑换

自动化处理 [Top Heroes](https://topheroes.store.kopglobal.com) 网页商店的每日签到与礼包码兑换，支持多账号批量操作，通过 GitHub Actions 定时运行。

---

## 功能

- **每日自动签到**：定时触发，对所有已审核账号执行签到
- **礼包码自动兑换**：定时检查 Discord 官方频道的新消息，自动识别网页兑换码（Purchase Center）并为所有账号兑换；游戏内兑换码则发送 Discord 通知提醒手动兑换
- **多账号支持**：账号列表存储于 Google Sheet，通过 Apps Script API 读取
- **注册页面**：用户可通过 Google Apps Script Web App 自助提交 UID，管理员在 Sheet 中审核后生效
- **Discord 通知**：新账号申请时自动发送 Webhook 通知

---

## 项目结构

```
topheroes-signin/
├── .github/
│   └── workflows/
│       ├── signin.yml            # 每日签到 workflow
│       ├── check_codes.yml       # Discord 监听礼包码 workflow
│       └── redeem.yml            # 手动兑换码 workflow
├── topheroes_signin.mjs          # 签到脚本
├── topheroes_redeem.mjs          # 手动兑换码脚本
├── monitor.js                    # Discord 监听 + 自动兑换脚本
├── package.json                  # Node.js 依赖
├── keepalive.txt                 # 防止 GitHub Actions 因无 push 停用
└── last_message_id.txt           # 已处理的最新 Discord 消息 ID 记录
```

---

## 账号管理（Google Sheet + Apps Script）

账号信息存储在 Google Sheet，表名为 `top heros uid`，包含以下列：

| 列名 | 说明 |
|------|------|
| UID | 游戏账号 UID |
| Username | 游戏内昵称 |
| Approved | 状态：`pending` / `approved` |
| 时间 | 申请时间 |

Apps Script 发布为 Web App，提供两个功能：
- **注册页面**（`index.html`）：用户填写 UID 提交申请，脚本自动验证 UID 有效性后写入 Sheet
- **API 接口**（`doGet`）：签到脚本通过带 `key` 参数的 GET 请求读取所有 `approved` 账号的 UID 列表

---

## GitHub Actions Workflows

### 每日签到（`signin.yml`）

```
触发时间：每天 UTC 02:01（对应 UTC+8 10:01）
随机延迟：0~5 分钟（避免固定时间触发）
```

### 礼包码兑换（`giftcode.yml`）

```
触发方式：repository_dispatch（由 cron-job.org 通过 GitHub API 触发）
监听来源：Top Heroes 官方 Discord 频道（2个频道）
网页码：自动为所有账号兑换，并发送 Discord 通知
游戏内码：发送 Discord 通知，提醒手动在游戏内兑换
去重机制：last_message_id.txt 记录已处理的最新消息 ID，每次运行后自动 commit
```

### 手动兑换码（`redeem.yml`）

```
触发方式：手动触发（workflow_dispatch），需输入兑换码
用途：手动为所有账号兑换指定礼包码
环境变量：REDEEM_CODE（从输入获取）、APPS_SCRIPT_URL、APPS_SCRIPT_KEY
```



---

## 环境变量（GitHub Secrets）

| 变量名 | 说明 |
|--------|------|
| `APPS_SCRIPT_URL` | Google Apps Script Web App 的 URL |
| `APPS_SCRIPT_KEY` | API 验证用的密钥（对应 Script Properties 的 `SECRET_KEY`） |
| `DISCORD_TOKEN` | Discord Bot/用户 Token，用于读取频道消息 |
| `DISCORD_WEBHOOK` | Discord Webhook URL，用于发送兑换通知 |

---

## Apps Script 环境变量（Script Properties）

| 属性名 | 说明 |
|--------|------|
| `SECRET_KEY` | 与 GitHub Secret `APPS_SCRIPT_KEY` 对应的密钥 |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL，新申请时发送通知（可选） |

---

## 定时触发设置

使用 [cron-job.org](https://cron-job.org) 触发 GitHub Actions workflow dispatch，请求格式：

- **URL**：`https://api.github.com/repos/miemie123wang/topheroes-signin/actions/workflows/signin.yml/dispatches`
- **Method**：POST
- **Headers**：`Authorization: Bearer <GitHub PAT>`
- **Body**：`{"ref":"main","inputs":{}}`

---

## 注意事项

- `ACTIVITY_ID` 为游戏签到活动 ID，活动到期后需更新（目前为 `3010`）
- 签到脚本每个账号之间有随机延迟（5~15 秒），避免触发频率限制
- 礼包码兑换每个账号登录前有随机延迟（3~6 秒），避免 "Frequent operations" 错误
- GitHub Actions 超过 60 天无 push 会停用 workflow，脚本内含 keepalive commit 步骤
