# BiliStreamMonitor — Bilibili 直播 API 偵查報告（階段 0）

- 偵查日期：2026-07-29（UTC）
- 方法：chrome-devtools 實際抓包（已登入帳號 uid=a-test-account）＋ 公開文件庫交叉比對
- 證據目錄：`docs/evidence/`（所有原始回應 JSON）
- 文件來源：SocialSisterYi/bilibili-API-collect 已於 2026-01-30 因律師函封存刪文，本文件引用刪除前最後同步的 fork 鏡像（xrkorz/bilibili-API-collect，2026-01-28）
- **衝突時以抓包為準**（本文有兩處文件與實測不符，皆已標註）

## 端點總覽

| 端點 | 用途 | 認證 | wbi | 分頁 | 實測狀態 |
|---|---|---|---|---|---|
| `xlive/web-ucenter/user/following` | 完整關注列表（含直播狀態） | cookie | 無 | page/page_size（上限 29） | ✅ 抓包確認 |
| `xlive/web-interface/v1/index/getList` | 直播首頁（關注區僅 6 卡＋總數） | cookie | 頁面帶但非必要 | 無 | ✅ 抓包確認 |
| `xlive/web-ucenter/v1/xfetter/GetWebList` | 關注中正在直播列表 | cookie | 無 | 無（hit_ab 控制全量/前 10） | ⚠️ 僅文件收錄，**未實測** |
| `xlive/web-ucenter/user/MedalWall` | 勳章牆（目前監控源） | cookie | 無 | **無分頁** | ✅ 抓包確認 |
| `room/v1/Room/get_status_info_by_uids` | **批次**房間狀態 | 文件載明無需 cookie | 無 | 單次建議 ≤200 uid | ✅ 抓包確認 |
| `room/v1/Room/get_info` | 單房間資訊 | 公開 | 無 | — | ✅ 抓包確認 |
| `xlive/web-room/v1/index/getInfoByRoom` | 單房間完整資訊（含 uname） | 公開 | 無 | — | ✅ 抓包確認 |
| `live_user/v1/Master/info` | 主播資訊（暱稱/頭像） | 公開 | 無 | — | ✅ 文件＋現有程式使用 |

---

## 1. `GET https://api.live.bilibili.com/xlive/web-ucenter/user/following`

完整關注列表（link.bilibili.com 個人中心「我的關注」頁實際使用）。**全關注模式的核心端點。**

- 證據：`docs/evidence/follow_feed.json`、`follow_feed_pagination_probe.json`
- Query：`page`（1 起）、`page_size`、`ignoreRecord=1`、`hit_ab=true`
- 認證：僅 cookie（無 wbi）；未登入回 `code=-101`
- 回應（`data`）：
  - `count: int` 關注總數（實測 1769）
  - `live_count: int` 直播中數（實測 116）
  - `never_lived_count: int`
  - `pageSize / totalPage: int`（pageSize 回顯實際生效值）
  - `list[]`：`roomid:int`、`uid:int`、`uname`、`title`、`face`、`live_status:int`、`room_cover`、`room_news`、`area_name_v2`、`parent_area_id`、`area_id`、`text_small`、`is_attention`

### 分頁（實測，與文件不符，以抓包為準）

- 文件稱 page_size「有效值 1–10」；**實測 1–29 生效，≥30 被靜默夾回 10**（回應 `pageSize` 可驗證）。有效上限 = **29**。
- 越界頁（page=999）回 `code=0` + 空 list，不報錯。
- 排序：**live_status=1（直播中）排最前**，之後 0/2 混合。
- 載全策略：只要直播中者 → `page_size=29` 翻頁直到某頁無 `live_status=1` 即止（實測 116 直播中 ≈ 4–5 頁/週期）；載全部 1769 關注需 61 頁，無必要。

### live_status 語意（三態）

- `1` = 直播中；`0` = 未播；`2` = **輪播/回放**（經 `Room/get_info` 覆核：live_time 為零值）。
- **監控只認 1，必須排除 2**，否則輪播台會造成永久「開播中」假狀態。文件只標 0/1，三態區分以抓包為準。

## 1b. `GET https://api.live.bilibili.com/xlive/web-interface/v1/index/getList`

直播首頁聚合接口。關注模組（`module_info.type=8`）的 `list[]` **只有 6 張卡片**；「N 人正在直播中」數字在同模組 `extra.follow_Online`（實測 115）。只能當計數器，不能拿名單。

- 證據：`docs/evidence/homepage_getList_full.json`
- 頁面發的請求帶 wbi 簽名，但**實測不帶簽名也回 code=0**（cookie 即可）。

## 1c. `GET https://api.live.bilibili.com/xlive/web-ucenter/v1/xfetter/GetWebList`（文件收錄，未實測）

「關注中且正在直播」專用列表（文件：docs/live/follow_up_live.md 第二節）。

- `hit_ab=true`：返回**全部**開播中的關注主播，但多數欄位（online/cover/link 等）被清空，`count` 為 0。
- `hit_ab=false`：欄位完整但**只回前 10 個**。
- 潛在用法：`hit_ab=true` 拿全量開播 uid → 一次 `get_status_info_by_uids` 補齊欄位 = **每週期僅 2 次請求**。
- **硬性要求：寫進程式碼前必須先在瀏覽器實測成功**（階段 3 前補測）。

## 2. `GET https://api.live.bilibili.com/xlive/web-ucenter/user/MedalWall`（目前監控源）

- 證據：`docs/evidence/medalwall_p1.json`、`medalwall_p2.json`、`medalwall_probe.json`
- Query：僅 `target_id`（必要；缺失回 `code=-400`）
- 認證：僅 cookie；**查別人的勳章牆也需登入**（`code=-101`）
- **無分頁**：`page=1` 與 `page=2` 回應完全相同（90 項一次全返），page 參數被忽略。
- 回應（`data`）：`count`、`list[]`：`medal_info{target_id(主播uid), level, medal_name, medal_color_*, wearing_status, guard_level, intimacy, day_limit...}`、`target_name`、`target_icon`、`live_status`(0/1/2)、`official`、`link`、`uinfo_medal{}`

### 致命覆蓋率問題（實測數字）

- 關注直播中 **115** 人，MedalWall `live_status=1` 只有 **14** 人（14 人全在關注列表內）。
- **101 人（88%）直播中的關注主播在 MedalWall 不可見**——只有領過粉絲勳章的主播才上牆，關注 ≠ 有勳章。
- 其他怪癖：
  - **無 `room_id` 欄位**，要從 `link` URL 解析（`live.bilibili.com/23307008?...`）。
  - 直播中房間的 `link` 內嵌 session 綁定的 FLV playurl，勿依賴。
  - 排序非按 live_status（疑似勳章等級序）；`live_status=2` 同樣是輪播。

## 3. `GET https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids`（批次，推薦）

一次查多個主播的房間狀態，**自訂房間批次化與全關注補欄位的關鍵端點**。

- 證據：`docs/evidence/batch_status_by_uids.json`、`batch_status_limits_probe.json`
- 參數格式：`?uids[]=a&uids[]=b`（`uids[0]=` 亦可；**CSV `uids=a,b,c` 回 `code:1 invalid params`**）
- 認證：文件明載「無需 Cookie」；帶 cookie 也可用。無 wbi。
- 回應：**`data` 是以 uid 字串為 key 的物件**（非陣列）：
  - 每項：`title`、`room_id`、`uid`、`uname`、`face`、`online`、`live_time`(unix ts)、`live_status`(0/1/2)、`short_id`、`area/area_name/area_v2_*`、`tag_name`、`cover_from_user`、`keyframe`、`broadcast_type`、`lock_till`、`hidden_till`
  - **一次給齊監控所需全部欄位（含 uname、標題、封面）**
- 行為：重複 uid 自動去重；**無直播間的 uid 靜默省略**（不報錯）——比對時要以「回應缺 key = 無房間」處理。
- **數量上限（實測）**：10/20/50/100/200 全數返回；300（URL 5086 字元）仍 OK；319（URL 5421 字元）→ **HTTP 400**（URL 長度牆）。文件無上限記載。**工程建議：每批 ≤200 個 uid。**

## 4. `GET https://api.live.bilibili.com/room/v1/Room/get_info`

- 證據：`docs/evidence/room_get_info.json`
- Query：`room_id`（可用短號）；公開接口，無 wbi。
- 回應：`uid`、`room_id`（長號）、`short_id`、`title`、`live_status`(0/1/2)、`live_time`（字串 `"YYYY-MM-DD HH:mm:ss"`，離線為 `"0000-00-00 00:00:00"`）、`online`、`attention`、`area_*`、`user_cover`、`keyframe`、`description`、`room_silent_*` 等。
- **注意：無 `uname`**（要名字用 §3 批次或 §5）。`code=1` = 房間不存在。

## 5. `GET https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom`

- 證據：`docs/evidence/room_getInfoByRoom_xlive.json`（code=0）
- 回應巨大：`data.room_info{uid, room_id, title, live_status, live_start_time:unix, online, cover, keyframe...}` + `data.anchor_info.base_info.uname`。
- **候選端點 `room/v1/Room/get_info_by_room` 不存在**：HTTP 200 但 `code=1000003`「方法未在控制器中找到」（證據：`docs/evidence/room_get_info_by_room.json`）。文件庫亦未收錄該名稱。

## 6. `GET https://api.live.bilibili.com/live_user/v1/Master/info`

- 現有用法：新增自訂房間時取暱稱/頭像（`popup.js:850`）。
- Query：`uid`；公開接口，無 wbi。
- 回應：`info{uid, uname, face, official_verify}`、`exp.master_level{}`、`follower_num`、`room_id`（**短號**，長號需配合 get_info/room_init）、`medal_name`、`room_news{}`。

---

## 7. 認證、簽名與風控

### wbi 簽名

- 本文所有端點**均不需 wbi**（cookie 或公開）。直播域內文件僅 `getDanmuInfo` 强制 wbi。
- 風險：wbi.md 明載「大部分查詢性接口都已經或準備採用 WBI 簽名」——未來收緊屬需持續觀察項。
- 簽名缺失的「假成功」陷阱：可能回 `code=0` + `data.v_voucher`，程式需把 `v_voucher` 視為失敗。

### 風控錯誤碼（文件 docs/misc/errcode.md）

- `-412` 请求被拦截：**IP 級風控**，換 cookie 無效；觸發主因是短時間高頻/並發、IP 信譽差、UA/Referer 異常。恢復：等待或換 IP（有用戶回報刷新 B 站主頁過人機驗證即解）。
- `-352` 风控校验失败：UA/wbi 不合法，走 v_voucher + geetest 滑塊流程。
- 風控計數是「同一用戶/IP/UA」三維的；`bili_ticket` cookie「非必需，但存在可降低风控概率」。
- **官方從未公布 QPS 上限**；社群經驗錨點：Haruka 擴展 ~60s 輪詢、biliLiveNotification 60s、bililive-go 15–20s/房間、cq-picsearcher-bot 自建下限 30s。

### 擴展上下文注意事項（未實測項）

- api.live.bilibili.com 的 CORS 反射 origin 且 allow-credentials（站內 XHR 即如此運作），擴展 background `fetch(..., {credentials:'include'})` 預期可用，但 **SW 的 Referer 為 `chrome-extension://<id>`**，屬「Referer 異常」弱觸發因子（無確切封禁記載）。
- **階段 3 前需在瀏覽器實測：擴展上下文 fetch（Referer/Origin 影響）與 GetWebList 端點。**

## 8. 證據檔案清單（`docs/evidence/`）

| 檔案 | 內容 |
|---|---|
| `follow_feed.json` | following page=1 原始回應（count=1769, live_count=116） |
| `follow_feed_pagination_probe.json` | page_size 邊界（上限 29、≥30 夾回 10）、排序、越界、live_status=2 覆核 |
| `homepage_getList_full.json` | 首頁 getList（關注模組 6 卡 + extra.follow_Online=115） |
| `medalwall_p1.json` / `medalwall_p2.json` | MedalWall 原始回應（兩者相同 → 無分頁） |
| `medalwall_probe.json` | MedalWall 組成/覆蓋率對比（14/115） |
| `batch_status_by_uids.json` | 批次 10 uid 原始回應 |
| `batch_status_limits_probe.json` | 參數格式、10→319 上限掃描、逐欄位 schema |
| `room_get_info.json` | get_info 原始回應 |
| `room_get_info_by_room.json` | code=1000003（端點不存在之證據） |
| `room_getInfoByRoom_xlive.json` | xlive 版 getInfoByRoom 原始回應 |
