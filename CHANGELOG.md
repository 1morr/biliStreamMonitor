# 更新日志

本项目的所有重要变更都将记录在此文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [3.2.0] - 2026-07-29

### Added

- **通知對象新增「僅勳章牆主播」選項**（偏好碼 `'4'`）：Badge Notifications 與 Browser Notify 兩個下拉皆可選；僅勳章牆成員（以及手動添加的自訂房間）會觸發角標計數 / 桌面通知。全關注模式下直接利用 v3.1 的勳章 enrichment 資料判斷，零額外請求；勳章牆模式下等效「全部」。

## [3.1.0] - 2026-07-29

依使用者回饋調整預設模式與彈窗介面配置。

### Changed

- **預設監控模式改為勳章牆（badge）模式**：僅影響新安裝；既有使用者的已選模式保留不變。
- **彈窗介面回歸**：添加房間輸入組與手動刷新收回設定面板（自訂房間手風琴恢復添加輸入框）；設定按鈕改為右下角懸浮按鈕（FAB），頂欄只留品牌列。

### Added

- **懸浮模式切換鈕**：滑鼠懸停在設定 FAB 上時浮出模式切換小鈕（speed-dial），圖示顯示目前模式，點擊即在全關注 / 勳章牆之間切換；與設定面板內的模式選項雙向同步。
- **全關注模式補齊勳章顯示**：每週期 +1 次 MedalWall 請求做資料 enrichment，卡片照常顯示勳章名與等級，排序規則與勳章牆模式完全一致（直播中 > 特別關注 > 喜歡 > 勳章等級）；enrichment 失敗時僅缺少勳章資料，不影響刷新週期。

## [3.0.0] - 2026-07-29

首个公开记录版本：架构重写 + 全关注监控模式 + 审计问题集中修复。重构依据见 `docs/api.md`（抓包证据）、`docs/audit.md`（现状审计）、`docs/design.md`（设计决策）。

### Added

- **全关注监控模式（默认）**：基于 `following` 端点翻页（`page_size=29`，直播中排最前，遇无直播页即停，上限 20 页截断保护），覆盖全部关注主播的开播状态，修复勋章墙仅覆盖约 12%（实测 14/115）关注开播的漏报问题。
- **监控模式切换**：全关注 / 勋章墙双模式并存，可在设置面板中互斥切换；两种模式统一排除 `live_status=2`（轮播/回放）。
- **i18n 落地**：`chrome.i18n` + `_locales/{en,zh_CN,zh_TW}`，`default_locale=en`，界面自动跟随浏览器语言。
- **风控退避**：检测 `-412` / `-352` / `v_voucher` 响应后指数退避（5→10→20→30 分钟封顶），退避期间跳过所有周期（含手动刷新），恢复后自动回到正常节奏。
- **错误可见化**：角标红色 `!` + 弹窗顶部错误横幅（auth / risk / network 分类），登录过期（-101 / 无 Cookie）不再静默失效。
- **自定义房间批量刷新**：合并为单次 `get_status_info_by_uids` 调用（每批 ≤200 uid，超出自动分批），取代逐房间 `Room/get_info` 序列请求。
- **顶栏快捷添加**：自定义房间入口移至弹窗顶栏，粘贴房间号/URL 一步添加；设置面板保留管理清单。
- **通知点击映射**：`notifRoomMap` 持久化到 storage，点击通知直达对应直播间（映射缺失时回退直播首页），下播后自动清理条目。
- **通知稳定 ID 去重**：通知 ID 固定为 `live-<uid>`，同一主播重复开播替换旧通知而非堆叠。
- **storage schemaVersion=2**：幂等迁移（旧布尔通知开关→偏好码、外观键改名、隐藏列表归一为 Number、间隔钳制下限、清理死键）。
- **导入白名单校验**：仅接受设置类键，逐键类型校验，`refreshInterval` 钳制 ≥30 秒，`deletedStreamers` 归一为 Number。
- **周期重入防护**：`cycleInFlight` 守卫，alarm 与手动刷新并发时不再产生重复通知。

### Changed

- **架构重写**：单文件 → ES modules 分层（`background/` `popup/` `shared/` + `content_script.js`）；MV3 Service Worker 启用 `"type": "module"`（Chrome ≥89），无构建工具。
- **Font Awesome 本地化**：图标资源全部内置 `vendor/fontawesome/`，不再依赖 cdnjs CDN（离线可用，消除供应链风险）。
- **API 层统一**：popup 不再裸写 URL，全部经 `shared/api.js` 封装，集中识别风控/登录错误。
- **合并逻辑单一化**：「模式列表 + 自定义房间」合并收敛到 `shared/merge.js`（原重复三份）。
- **通知瘦身**：标题/内容直接取自合并列表，不再为每条通知额外调用 `get_info`；头像转 DataURL 失败时回退扩展图标。
- **referrer 策略一致化**：popup 的 `<img>` 统一 `referrerpolicy="no-referrer"` 与 http→https 归一化，与 background 行为对齐。
- **alarm 重建**：`onInstalled` / `onStartup` 均从 storage 读取用户间隔重建 alarm（不再硬编码）。
- **导出范围**：导出仅含设置类键 + `schemaVersion`，不再整包导出运行时状态。

### Fixed

- 登录过期完全静默：cookie 失效后整周期中止、badge 保留旧数字、弹窗显示陈旧列表无任何提示（审计 #1）。
- `onInstalled` 硬编码 1 分钟轮询，覆盖用户自定义刷新间隔（审计 #2）。
- 通知点击映射是死代码（`openTabsOnNotificationClick` 写入后从未读取），主播被移除后点击通知完全无反应（审计 #3）。
- 导入配置全盲写：无键白名单、无类型校验、可绕过刷新间隔下限；字符串 uid 导致隐藏功能静默失效（审计 #4）。
- 主播昵称/勋章名等 API 可控字符串拼接进 `innerHTML` 未转义 → 改用 `escapeHtml` / 安全 DOM（审计 #12）。
- 悬停预览 API 失败时加载动画永远转圈（审计 #14）。
- 通知 ID 含 `Date.now()` 无去重，主播反复上下播会重复通知（审计 #15）。
- `setRefreshInterval` 消息处理器悬空 port：`return true` 却从不 `sendResponse`（审计 #11）。
- 「勋章墙 + 自定义」合并逻辑在 popup/background 重复三份，易不一致（审计 #8）。
- popup 的 `<img>` 无 `referrerpolicy`，与 background 的 `no-referrer` 处理不一致，防盗链收紧时头像先挂（审计 #10）。
- `web_accessible_resources` 中 `images/NA.png` 死条目（全代码零引用却暴露给 `<all_urls>`，审计 #13）。

### Removed

- cdnjs 远程 CSS 依赖（Font Awesome 改为本地资源）。
- manifest 中无引用的 `web_accessible_resources` 条目（`NA.png`）。
- storage 死键：`openTabsOnNotificationClick`、`browserNotificationsEnabled`（迁移后移除）。
