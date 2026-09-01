# BiliStreamMonitor

不用打開 Bilibili 網站，就能知道你在乎的實況主什麼時候開播。

<p>
  <a href="https://github.com/1morr/biliStreamMonitor/actions/workflows/ci.yml"><img src="https://github.com/1morr/biliStreamMonitor/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/1morr/biliStreamMonitor" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Chrome-120%2B-4285F4" alt="Chrome 120+">
</p>

[English](README.md) · **繁體中文**

這是一款 Chrome 擴充功能，會持續關注你追蹤的實況主，只要你在乎的人開播，工具列圖示上就會顯示數字。把滑鼠移到頭像上可以預覽直播畫面，點擊就能直接開啟。

![彈出視窗](docs/images/popup.png)

## 安裝

目前還沒有上架 Chrome Web Store，所以要用未封裝的方式載入：

1. 下載或 clone 這個 repository。
2. 打開 `chrome://extensions/`，開啟 **Developer mode**。
3. 點擊 **Load unpacked**，選擇裡面有 `manifest.json` 的那個資料夾。

沒有建置步驟 —— 原始碼就是擴充功能本身。你需要 **Chrome 120 或以上版本**（更舊的版本會默默把重新整理間隔限制在 60 秒），而且要在同一個 profile 裡**登入 Bilibili**；擴充功能是靠讀取你的 `DedeUserID` cookie 來找到你的追蹤清單。

## 提醒範圍

這個擴充功能的重點在於：「我追蹤的人」跟「我想被打斷通知的人」是兩組不同的集合。你選的是後者。

五種來源會餵給兩個獨立的管道 —— 工具列圖示上的**徽章**，以及**桌面通知**。勾選你想要的每一格：

| Source | Who it is | Cost per cycle |
|---|---|---|
| Medal wall | 你持有粉絲勳章的實況主 | 1 次請求，每輪都會抓 |
| Custom rooms | 你用房號加入的房間，不論有沒有追蹤 | 共用 1 次批次請求 |
| Favorite / Like | 你用右鍵標記過的實況主 | 免費 —— 他們的 uid 已經知道了 |
| All other follows | 你追蹤的其他所有人 | 約 +5 次請求（分頁） |

每個實況主只會算進他符合的**第一個**分類，所以數字加總不會重複。設定面板會即時顯示每個管道的總數，以及因此產生的請求數量。

預設每輪只有 2 次請求，因為「all other follows」預設是關閉的。只有打開它，這個擴充功能才會去翻你完整的追蹤清單。

![設定畫面](docs/images/settings.png)

## 功能

- **徽章** —— 顯示範圍內剛開播的實況主人數，依優先順序上色（favorite 紅色、like 橘色、其餘藍色），上限顯示為 `99+`。
- **通知** —— 點擊通知就能直接跳進直播間。每輪最多 5 則，其餘的會合併成一則「還有 N 人開播了」。
- **靜默播種** —— 剛安裝完、改了提醒範圍之後，或是限速暫停結束之後的第一輪，只會同步狀態，不會發送任何通知。這樣徽章才不會一次跳成三位數。
- **hover 預覽** —— 顯示直播標題、封面與開播時長，或是一個帶音量控制的即時小型播放器。
- **四種顯示模式** —— 把滑鼠移到齒輪圖示上就會展開：提醒範圍（預設）、medal wall、只顯示標記過的，或是目前所有正在直播的人。
- **右鍵點擊某個實況主**，可以標記為 Favorite 或 Like，或把他隱藏。
- **Custom rooms** —— 貼上房號或網址就能關注你沒有追蹤的人，他們的狀態會跟其他人一起在同一次批次請求裡更新。
- **匯入／匯出**你的設定，匯入時會逐一驗證每個欄位。
- **English / 简体中文 / 繁體中文**，跟隨瀏覽器語言。
- **限速退避** —— 當 Bilibili 開始限制請求時，擴充功能會暫停 5 → 10 → 20 → 30 分鐘，並在徽章與 popup 上說明，之後會自動恢復。

## 權限

| Permission | 用途 |
|---|---|
| `cookies` | 讀取 `DedeUserID` 來識別你的帳號。除此之外不讀取、不儲存，也不傳送任何東西 |
| `storage` | 你的設定、標記，以及上一次已知的直播狀態 |
| `alarms` | 驅動重新整理的週期（service worker 沒辦法自己保有計時器） |
| `notifications` | 開播通知 |
| `*.bilibili.com` | 直播 API 與預覽播放器 |
| `*.hdslb.com` | 頭像與直播封面 |

沒有 `<all_urls>`，沒有任何分析工具，也不會對第三方發出請求。content script 只作用在唯一一個網址模式上，用來讓預覽播放器保持同步。

## 設定

所有設定都收在 popup 裡的齒輪圖示後面：重新整理間隔（最短 30 秒、預設 60 秒）、popup 大小、頭像大小、間距、字型大小、亮／暗主題、預覽模式、隱藏清單，以及提醒範圍矩陣。

## 開發

沒有建置流程，也沒有 bundler。改完檔案，在擴充功能卡片上按重新整理就好。

```bash
npm install      # only to get eslint
npm run lint
npm test         # node --test over the pure modules in shared/
```

`shared/scope.js` 是判斷「哪個實況主屬於哪個提醒來源」的唯一依據；poller、notifier 與 popup 都讀它，測試涵蓋的也是這一份程式碼。更多細節見 [docs/](docs/)。

## 授權

[MIT](LICENSE)
