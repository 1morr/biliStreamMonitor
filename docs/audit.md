# BiliStreamMonitor — 現狀審計與風險評估（階段 1）

- 日期：2026-07-29
- 性質：純分析，未改任何程式碼
- 依據：程式碼逐行審計（`background.js` 281 行、`popup.js` 968 行、`popup.html/css`、`manifest.json`、`content_script.js`）＋ `docs/api.md` 抓包結論 ＋ 公開風控情報

---

## 1. API 呼叫量模型

### 常數（程式碼實測）

| 常數 | 值 | 出處 |
|---|---|---|
| 預設刷新間隔 I₀ | 60 秒 | `background.js:274`、`popup.js:24,85` |
| UI 最小間隔 I_min | 30 秒 | `popup.html:164`（`min="30"`）、`popup.js:697` |
| 每週期固定呼叫 F | 1（MedalWall） | `background.js:34,71` |
| 每自訂房間每週期 | 1（`Room/get_info`，**逐個序列 await**） | `background.js:101-113` |
| 每則新開播通知 | +2（get_info 取標題 + 頭像轉 DataURL） | `background.js:186,191` |
| popup 開啟 | 0 次 API（只讀 storage） | `popup.js:59-123` |
| 每次 hover 未快取房間 | 1–2 次（get_info + 封面圖；live 模式另加播放器頁） | `popup.js:289,312,335` |
| 每次右鍵操作/手動刷新 | 1 個完整週期（1 + C′ 次） | `popup.js:504,602` |
| 每次新增自訂房間 | 2 次序列（get_info + Master/info） | `popup.js:826,850` |

### 公式

```
Calls/hour = (3600/I) × (1 + C′)  +  2×N  +  2×H  +  2×A  +  (3600/I) × R
  I  = 刷新間隔（秒）
  C′ = 未與勳章牆重疊的自訂房間數（線性放大因子，且序列 await）
  N  = 每小時新開播且應通知數
  H  = 每小時 hover 未快取房間次數（同 session 重複 hover 為 0）
  A  = 每小時新增自訂房間次數
  R  = 每小時右鍵操作＋手動刷新次數（每次 = 一個完整週期）
```

M（勳章主播數）不影響呼叫次數（單次批次 API），只影響回應大小——本架構的優點。

### 典型情境（A=0, R≈0 省略）

| 情境 | 參數 | 每小時 | 每天（24h 背景） |
|---|---|---|---|
| 輕度 | I=60s, C′=3, N=2, H=5 | 60×4 + 4 + 10 = **254** | ≈ 6,100 |
| 中度 | I=60s, C′=10, N=5, H=15 | 60×11 + 10 + 30 = **700** | ≈ 16,800 |
| 重度 | I=30s, C′=25, N=15, H=40 | 120×26 + 30 + 80 = **3,230** | ≈ 77,500 |

**對照：批次化改造後**（1 次 MedalWall/following + 1 次 get_status_info_by_uids/週期，≤200 uid/批）：中度情境 = 60×2 = **120/hr（-83%）**，且 C′ ≤200 前不隨房間數增長。

## 2. 封禁 / 限流風險評估

### 已知風控機制（證據見 `docs/api.md` §7）

- `-412`：IP 級攔截，主因是高頻並發、IP 信譽、UA/Referer 異常；純讀取輪詢無封帳號的公開記載。
- `-352` + `v_voucher`：UA/wbi 異常時的滑塊驗證流程。
- B 站**從未公布 QPS 上限**；社群安全錨點：直播輪詢 30–60s 為主流（Haruka、BililiveRecorder、bililive-go 15–20s/房間）。

### 本擴展現狀

- 目前預設 ≈ (1+C′) req/min，輕中度情境**遠低於已知觸發區間，IP 級 -412 風險低**。
- 殘餘風險：
  1. **重度情境（I=30s + C′=25）≈ 54 req/min 且序列集中爆發**——接近「同一用戶/IP 短時間多次請求同一接口」的風控畫像，是最危險的使用方式。
  2. SW fetch 的 Referer 為 `chrome-extension://<id>`，屬已知弱觸發因子（無封禁記載，但 popup 與 background 的 referrer 處理目前不一致，見問題清單 #10）。
  3. `fetchBili`（`background.js:6-12`）**無超時、無重試、無退避**；遇到 -412 會每 60 秒持續撞牆。

### 安全邊際建議

- 最小刷新間隔維持 **≥30 秒**不變；批次化後重度情境呼叫量降到 ~4 req/min，風險反而比現狀低。
- 實作**指數退避**：偵測 `code=-412/-352` 或 HTTP 4xx 時暫停輪詢 5→10→20 分鐘，並在 badge 顯示錯誤態（`!`），恢復後自動回到正常週期。
- 把 `v_voucher` 回應視為風控信號（同 -352 處理）。
- 保留 `bili_ticket` 等既有 cookie（`credentials:'include'` 自然帶上，勿過濾）。

## 3. 自訂房間功能評估

### 現狀問題

1. **逐個序列 await**（`background.js:101-113`）：C′ 個房間每週期 C′ 次 RTT 串聯，C′=25 時單週期可能拖 10+ 秒，拉長 SW 存活時間、增加被終結中斷的機會，也放大了右鍵操作（每次 = 完整週期）的成本。
2. 失敗房間**永久保留舊狀態**（`background.js:108-110`），無陳舊上限、無錯誤可見性。
3. 呼叫量隨 C′ 線性成長（見 §1），是重度情境風險主因。
4. 每個自訂房間用 `Room/get_info` 單查——而 `get_status_info_by_uids` 一次 ≤200 uid 即可拿回**含 uname/標題/封面**的全部狀態。

### 批次化可行性（階段 0 已實測）

- `GET /room/v1/Room/get_status_info_by_uids?uids[]=...`：**1 次呼叫取代 C′ 次**，回應欄位比 get_info 更齊（多 uname）。
- 注意事項：CSV 參數格式不可用（`code:1`）；無房間的 uid 靜默省略；每批 ≤200。
- 自訂房間功能**仍有存在價值**：它覆蓋「想看但未關注」的房間（全關注模式也取代不了）。去留與 UI 改造見 `docs/design.md` 決策 2/3。

## 4. 架構問題清單（依嚴重度排序）

### 高

1. **登入過期完全靜默，監控失效無任何跡象** — cookie 過期 → `getTargetId` 回 null → 整週期中止；badge 保留舊數字、popup 顯示陳舊列表無提示、`showError` 訊息（`background.js:231`）**無人監聽**（`popup.js:964-968` 只處理 `streamersUpdated`）。使用者會以為「沒人開播」而實際監控已停擺。另：`updateStreamers` 無重入防護（`background.js:69`），alarm 與手動刷新可並發 → 同一批新開播可能重複通知。

### 中

2. **`onInstalled` 硬編碼 1 分鐘，覆蓋使用者間隔** — `background.js:281`；更新/重載後忽略 storage 的 `refreshInterval`，要等下次瀏覽器啟動才恢復。
3. **通知點擊映射是死代碼 + 點擊可能無反應** — `openTabsOnNotificationClick` 在 `background.js:208-209` 寫入記憶體後從未落盤、點擊處理器（`background.js:253-269`）從不讀它；實際靠 `notifId.split('-')[1]` 解析 uid 再查 storage，若主播已被移除則點擊完全無反應（靜默失敗）。
4. **storage schema 無版本/遷移機制，匯入全盲寫** — 匯入（`popup.js:765-768`）`JSON.parse` 後整包 `storage.local.set`：無 key 白名單、無型別驗證、可繞過 `refreshInterval ≥30` 下限；無 `schemaVersion`。型別隱患：`deletedStreamers` 存 Number，匯入字串 uid 時隱藏功能靜默失效（嚴格 `includes` 比較，`background.js:135`、`popup.js:165`）。
5. **i18n 完全未落地** — `manifest.json` 無 `default_locale`；`_locales/{en,zh_CN,zh_TW}` 空目錄；`popup.html` 約 48 處 + `popup.js` 約 20 處硬編碼英文字串；通知標題卻是中文「开播了!」（`background.js:200`），語言策略混亂。
6. **遠端 CSS + referrer/CSP 不一致** — `popup.html:7` 從 cdnjs 載 Font Awesome（離線破版、供應鏈與上架審查風險；`vendor/fontawesome/` 本地化做了一半，兩層空目錄）；popup 的 `<img>` 直接引 hdslb 無 `referrerpolicy`（`popup.js:230,900,925`），background 端卻特意 `no-referrer`（`background.js:40-41`）——防盜鏈收緊時 popup 頭像先掛；http→https 正規化也只做了 background 一側。

### 低

7. **alarms 30 秒下限的版本相依性** — UI 允許 30s（`periodInMinutes: 0.5`），Chrome <120 靜默 clamp 成 60s，設定與實際不符且無提示。
8. **合併「勳章牆+自訂」邏輯重複三份** — `popup.js:152-156`（getMergedStreamers）、`popup.js:160-163`（renderGrid 內聯）、`background.js:116-117`。
9. **遷移邏輯重複** — `browserNotificationPreference` 遷移見 `background.js:127-132` 與 `popup.js:92-98` 兩份；appearance 遷移僅 popup 側；legacy key `browserNotificationsEnabled` 仍被讀但匯出不含。
10. **badge 語義與直覺不符** — badge 數字是「自上次開 popup 以來新開播數」（`background.js:153-164`），非「直播中數」；README「角标提醒」的直覺理解有落差（設計決策項）。
11. **`setRefreshInterval` handler 懸空 port** — `return true` 卻從未 `sendResponse`（`background.js:246-249`）。
12. **innerHTML 注入未轉義** — 主播暱稱/勳章名（API 可控字串）拼進 HTML（`popup.js:223-238,898-907,923-930`）；現實可利用性低，但屬依賴上游消毒的脆弱模式；對照 `popup.js:382` 用 `textContent` 是正確示範。
13. **`web_accessible_resources` 死條目** — `images/NA.png` 暴露給 `<all_urls>` 但全程式碼零引用。
14. **hover 預覽 API 失敗時 loader 永遠轉圈** — `code!==0` 時 `popup.js:291-305` 跳過渲染，標題停在 "Loading..."。
15. **其他散點** — 已隱藏的勳章牆主播無法改以自訂房間形式重新監控（`popup.js:834` 拒絕重複 uid）；通知 ID 含 `Date.now()` 無去重，反復上下播會重複通知；`content_script.js` 的 postMessage 雙向不驗證來源（`popup.js:959`、`content_script.js:18-25`，僅音量控制，實害極低）；`fetchBili` 無 AbortController 超時。

### 已確認的正向設計（保留）

- 用 `chrome.alarms` 而非 setInterval —— 正確，alarm 可喚醒休眠 SW。
- API 失敗時整週期中止、成功後才覆寫 `previousLiveUids` —— **不會**因單次失敗誤報「全部下播」。
- popup 開啟零 API 呼叫（純讀 storage）。
- 權限申請恰當無過度（cookies/storage/alarms/notifications/tabs + 兩個 host）。

## 5. 重構牽絆（階段 3 須注意）

- popup 與 background **各自直接 fetch**：API 層未共享（popup 三處裸寫 URL：`popup.js:289,826,850`）；`API_BASE` 僅 `background.js:3` 定義。
- 常數散落：預設間隔 60 出現 4 處、下限 30 出現 2 處；偏好碼 `'0'-'3'` 語義判斷散落 background 三處 + popup 預設。
- 共享層實際是 `chrome.storage.local`（15 個 key），無 `shared/` 模組（空目錄）。
- `manifest.json:29-36` content script match pattern 與 `popup.js:335` iframe URL 隱性耦合。
- 全專案無 ES module；MV3 SW 用 ES modules 的可行性見 `docs/design.md` 決策 5。
