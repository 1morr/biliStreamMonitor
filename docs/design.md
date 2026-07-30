# BiliStreamMonitor — 設計決策（階段 2）

- 日期：2026-07-29
- 依據：`docs/api.md`（抓包證據）、`docs/audit.md`（現狀審計）
- 每題：選項 + 利弊 + 建議。**確認後才進入階段 3 實作。**

---

## 決策 1：監控模式 —— 勳章牆 vs 全關注

**背景（實測）**：MedalWall 只覆蓋關注直播中主播的 12%（14/115），漏掉 88% 開播。`following` 端點（cookie、無 wbi、page_size 上限 29、直播中排最前）可完整取得全關注的直播狀態。

### 選項 A：雙模式互斥切換，預設「全關注」（建議）

- 設定中一個模式開關：`medal`（現狀，給只在意勳章主播的用戶）/ `following`（全關注）。
- 全關注模式每週期：`following?page_size=29` 翻頁直到某頁無 `live_status=1`（實測 116 直播中 ≈ 4–5 次請求）；頁面資料已含 title/cover/uname/live_status，**無需額外補查**。
- 利：修復 88% 漏報；兩模式資料管線可共用正規化層；向後相容（老用戶設定不變）。
- 弊：每週期請求數從 1 升到 ~5（仍遠低於風控區間）；關注極多（>500 直播中）時頁數線性增長，需設上限（如最多 20 頁，超出截斷並提示）。

### 選項 B：雙模式互斥切換，預設維持「勳章牆」

- 同 A，但預設值保守。利：老用戶無感知升級。弊：新用戶預設仍漏 88%，核心價值打折。

### 選項 C：合併顯示（勳章牆 + 全關注並集，卡片標示來源）

- 利：一份列表看全部。弊：勳章牆主播是全關注的子集（實測 14/14 皆在關注內），合併只是加「勳章」標記——那不如在全關注列表上直接標勳章，等於選項 A + 標記，邏輯更複雜。

### 建議：**A**。全關注才是「開播監控」的正解；勳章牆保留為情懷/輕量模式。若選 A，可在卡片上加勳章標記（資料兩邊都有，零額外請求）。

### 資料量與效能處理（A 模式下）

- 排序：直播中優先（API 已排好），卡片網格只渲染可視區（IntersectionObserver 懶載入頭像）。
- 列表規模：直播中數量級 ~10²，DOM 無壓力；「全部關注」視圖（10³ 級）才需虛擬化，初版不做全部關注視圖，只顯示直播中 + 自訂房間。
- `live_status=2`（輪播）一律排除。
- 週期請求上限保護：翻頁 >20 頁即截斷。

## 決策 2：自訂房間的去留與改造

**背景**：全關注模式覆蓋「已關注」；自訂房間覆蓋「想看但未關注」（不想污染 B 站關注列表、監控未關注的主播）——需求仍然成立。

### 選項 A：保留 + 批次化 + 入口移到主介面（建議）

- 每週期自訂房間的 uid 合併成一次 `get_status_info_by_uids`（≤200/批），取代逐個 `Room/get_info`：C′ 次 → 1 次，中度情境呼叫量 -83%。
- 全關注模式下，自訂 uid 若不在關注內，併入同一批批次呼叫（總數 ≤200 通常一批解決）。
- 新增入口從設定彈窗移到主介面頂欄（「+」按鈕 / 輸入框）。
- 利：保留獨特價值、呼叫量與延遲大降、序列 await 問題消失。
- 弊：批次回應「無房間 uid 靜默省略」需補處理（標記為無效房間）；200 以上自訂需分批（邊際案例）。

### 選項 B：保留 + 僅批次化（入口留在設定）

- 利：UI 不動。弊：添加流程仍藏兩層，與「主介面即監控列表」的產品形態不符。

### 選項 C：移除自訂房間

- 利：最簡。弊：失去「未關注也想監控」場景，老用戶資料遷移麻煩。**不建議。**

### 建議：**A**。

## 決策 3：設定彈窗資訊架構

**現狀**：手動添加房間藏在設定彈窗裡（`popup.html` 設定區塊）。主流直播提醒擴展（Twitch Live Extensions、Haruka 等）慣例：**主列表 + 頂欄快捷操作 + 設定頁只做偏好與帳號**。

### 選項 A：主介面頂欄快捷添加 + 設定頁保留管理列表（建議）

- 頂欄：搜尋/添加輸入框（貼 URL 或房間號即加）；設定彈窗保留：自訂房間清單管理（刪除）、刷新間隔、通知、外觀、匯入匯出、模式切換。
- 利：添加動作一步完成；設定彈窗回歸「偏好」本職。
- 弊：頂欄空間需重排（現有頂欄已有刷新/設定按鈕）。

### 選項 B：維持現狀（設定彈窗內添加）

- 利：不動 UI。弊：高頻動作藏兩層，可用性差。

### 建議：**A**。

## 決策 4：i18n 方案

### 選項 A：Chrome 標準 `chrome.i18n` + `_locales`（建議）

- `manifest.json` 加 `default_locale`；`_locales/{en,zh_CN,zh_TW}/messages.json` 補齊全部字串（popup.html ~48 處、popup.js ~20 處、background 通知字串）。
- HTML：`data-i18n="key"` 屬性 + 啟動時 JS 批次套用（`chrome.i18n.getMessage`）；動態字串（JS/通知）全部走 `getMessage` 與 `getMessage` 的 `$1` 佔位符。
- `default_locale` 選 `en`：現有 UI 全英文，英文訊息可直接以現有字串為底；CWS 上架慣例也以 en 為預設。
- 利：零依賴、瀏覽器自動按 UI 語言選 locale、無建置工具。
- 弊：`getMessage` 不支援巢狀/複數（本專案用不到）；HTML 需一次性加 data 屬性（機械工作）。

### 選項 B：自製 JS i18n 字典

- 利：彈性。弊：重造輪子、脫離 Chrome 生態（manifest 的 `__MSG_*__` 也用不上）。**不建議。**

### 建議：**A**，`default_locale: "en"`，翻譯以現有英文字串為 key 底稿，zh_TW 為參照用戶語言精修。

## 決策 5：目錄結構與模組化

**可行性確認**：MV3 service worker 原生支援 ES modules（`manifest.json` 的 `background.service_worker` + `"type": "module"`，Chrome ≥89，**僅限 static import**，不可動態 import）；popup 用 `<script type="module">` 同樣可行。無需建置工具。

### 選項 A：ES modules + 遷入既有空目錄（建議）

```
manifest.json            （background 改 "type": "module"）
background/
  index.js               SW 入口：alarms、訊息路由、通知點擊
  poller.js              刷新週期、模式分派、退避
  notify.js              通知建立/點擊/去重
popup/
  index.js               入口、事件綁定
  cards.js               卡片網格渲染（合併邏輯單一化）
  preview.js             hover 預覽（縮圖/iframe/音量橋）
  settings.js            設定彈窗、匯入匯出、自訂房間管理
shared/
  api.js                 bilibili API 層（fetchBili、following、MedalWall、批次狀態、get_info、Master/info）
  storage.js             storage 存取 + schemaVersion 遷移
  constants.js           API_BASE、間隔、偏好碼語義
  i18n.js                data-i18n 套用、getMessage 包裝
content_script.js        維持（音量橋）
_locales/{en,zh_CN,zh_TW}/messages.json
vendor/fontawesome/      補齊本地化（替換 cdnjs）
```

- 利：消除三份合併邏輯/兩份遷移/散落常數；shared/api.js 讓 popup 不再裸寫 URL；職責清晰可測。
- 弊：一次性搬移量大（~1250 行重排）；ES module 的 SW 除錯體驗略不同（stack 含模組路徑，其實更好）。
- 注意：popup.html 引 script 路徑改 `popup/index.js`；content script **不支援 ES module**，維持傳統單檔。

### 選項 B：傳統 script（importScripts / 多 script 標籤）+ 同樣目錄拆分

- 利：相容性保險。弊：全域命名空間污染、載入順序耦合；Chrome 89+ 無必要。**不建議。**

### 選項 C：不拆，只在單檔內整理

- 利：diff 最小。弊：970 行單檔是本次多數問題的溫床，治標不治本。**不建議。**

### 建議：**A**。

---

## 階段 3 前的剩餘驗證項（硬性要求：新端點先實測）

1. `GetWebList`（hit_ab 全量模式）——若採用「2 請求/週期」最佳化才需要；選項 A 的翻頁方案不依賴它，可作後續最佳化。
2. **擴展上下文 fetch 實測**：在 load unpacked 後從 SW 對 `following` 與 `get_status_info_by_uids` 發 `credentials:'include'` 請求，確認 `chrome-extension://` Referer/Origin 不影響回應（階段 3 第一步即驗證）。
