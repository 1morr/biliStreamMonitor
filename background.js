// background.js

const API_BASE = 'https://api.live.bilibili.com';

// 通用 Fetch 包装器
async function fetchBili(url) {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== 0) throw new Error(data.message || 'API Error');
    return data;
}

// 获取房间详细信息
async function fetchRoomInfo(roomId) {
    return await fetchBili(`${API_BASE}/room/v1/Room/get_info?room_id=${roomId}`);
}

// 获取用户 Target ID (Uid)
async function getTargetId() {
    try {
        const cookie = await chrome.cookies.get({ url: 'https://www.bilibili.com', name: 'DedeUserID' });
        return cookie ? cookie.value : null;
    } catch (e) {
        console.error('Cookie error:', e);
        return null;
    }
}

// 获取勋章墙（关注的主播列表）
async function fetchMedalWallData() {
    const targetId = await getTargetId();
    if (!targetId) throw new Error('Not logged in');
    return await fetchBili(`${API_BASE}/xlive/web-ucenter/user/MedalWall?target_id=${targetId}`);
}

// 辅助函数：下载图片并转换为 Data URL
async function fetchImageAsDataURL(url) {
    try {
        if (url.startsWith('http:')) url = url.replace('http:', 'https:');
        const response = await fetch(url, { referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('Failed to fetch image as Data URL:', e);
        return null;
    }
}

// 更新徽章 (Badge)
async function updateBadge(count, colorType = 'normal') {
    if (count > 0) {
        chrome.action.setBadgeText({ text: String(count) });
        // 颜色优先级: Favorite (Red) > Like (Orange) > Normal (Blue)
        const color = colorType === 'favorite' ? '#FF3B30' : (colorType === 'like' ? '#FF9500' : '#007AFF');
        chrome.action.setBadgeBackgroundColor({ color });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// 核心更新逻辑
async function updateStreamers() {
    try {
        const data = await fetchMedalWallData();
        const rawList = data.data.list;

        // 格式化数据
        const streamingInfo = rawList.map(medal => ({
            uid: medal.medal_info.target_id,
            streamer_name: medal.target_name,
            streamer_icon: medal.target_icon,
            medal_name: medal.medal_info.medal_name,
            medal_level: medal.medal_info.level,
            live_status: medal.live_status, // 1 is live
            link: medal.link,
            roomId: medal.link.split('/').pop().split('?')[0] // 预解析 RoomID
        }));

        // 获取旧状态和配置
        const storage = await chrome.storage.local.get([
            'streamerStates', // {uid: 'favorite' | 'like'}
            'previousLiveUids', 
            'deletedStreamers',
            'notificationPreference', // '0':Off, '1':Fav, '2':All, '3':Like+Fav
            'browserNotificationPreference', // New logic: '0', '1', '2', '3'
            'browserNotificationsEnabled',   // Old logic: bool
            'newlyStreaming'
        ]);

        const deletedStreamers = storage.deletedStreamers || [];
        const streamerStates = storage.streamerStates || {};
        const previousLiveUids = storage.previousLiveUids || [];
        let newlyStreaming = storage.newlyStreaming || [];
        const badgePref = storage.notificationPreference || '2';
        
        // Browser Notify Preference Migration Logic
        let browserPref;
        if (storage.browserNotificationPreference !== undefined) {
            browserPref = storage.browserNotificationPreference;
        } else {
            const enabled = storage.browserNotificationsEnabled !== false;
            browserPref = enabled ? (storage.notificationPreference || '2') : '0';
        }

        // 过滤当前正在直播且未被删除的
        const currentLiveStreamers = streamingInfo.filter(s => s.live_status === 1 && !deletedStreamers.includes(s.uid));
        const currentLiveUids = currentLiveStreamers.map(s => s.uid);

        // 检测新开播
        const justStartedUids = currentLiveUids.filter(uid => !previousLiveUids.includes(uid));

        // 更新 newlyStreaming 列表 (用于 UI 高亮)
        // 移除已经下播的，添加新开播的
        newlyStreaming = newlyStreaming.filter(uid => currentLiveUids.includes(uid));
        justStartedUids.forEach(uid => {
            if (!newlyStreaming.includes(uid)) newlyStreaming.push(uid);
        });

        // 徽章计数逻辑
        let badgeCount = 0;
        let badgeColorType = 'normal';
        
        // 根据偏好计算徽章显示的列表 (仅统计 newlyStreaming)
        const validNewlyStreamingUids = newlyStreaming.filter(uid => {
            const streamer = currentLiveStreamers.find(s => s.uid === uid);
            if (!streamer) return false;

            const state = streamerStates[uid];
            if (badgePref === '0') return false;
            if (badgePref === '1') return state === 'favorite';
            if (badgePref === '3') return state === 'favorite' || state === 'like';
            return true; // '2' All
        });
        
        badgeCount = validNewlyStreamingUids.length;
        if (validNewlyStreamingUids.some(uid => streamerStates[uid] === 'favorite')) badgeColorType = 'favorite';
        else if (validNewlyStreamingUids.some(uid => streamerStates[uid] === 'like')) badgeColorType = 'like';

        await updateBadge(badgeCount, badgeColorType);

        // 浏览器通知逻辑
        if (browserPref !== '0' && justStartedUids.length > 0) {
            for (const uid of justStartedUids) {
                const streamer = currentLiveStreamers.find(s => s.uid === uid);
                if (!streamer) continue;

                const state = streamerStates[uid];
                // 检查通知权限
                let shouldNotify = false;
                if (browserPref === '2') shouldNotify = true;
                if (browserPref === '1' && state === 'favorite') shouldNotify = true;
                if (browserPref === '3' && (state === 'favorite' || state === 'like')) shouldNotify = true;

                if (shouldNotify) {
                    // 获取房间标题用于通知
                    try {
                        const roomData = await fetchRoomInfo(streamer.roomId);
                        const title = roomData.data.title;
                        
                        // 预下载图片转为 DataURL
                        let iconUrl = 'images/icon128.png'; // 默认
                        const dataUrl = await fetchImageAsDataURL(streamer.streamer_icon);
                        if (dataUrl) {
                            iconUrl = dataUrl;
                        }

                        const notifId = `live-${uid}-${Date.now()}`;
                        const notifOptions = {
                            type: 'basic',
                            iconUrl: iconUrl,
                            title: `${streamer.streamer_name} 开播了!`,
                            message: title,
                            priority: 2
                        };

                        chrome.notifications.create(notifId, notifOptions);
                        
                        // 存储点击跳转链接
                        const { openTabsOnNotificationClick = {} } = await chrome.storage.local.get('openTabsOnNotificationClick');
                        openTabsOnNotificationClick[`live-${uid}`] = streamer.link; // 简化key
                        // 这里有个小逻辑问题，notificationId是动态的，但点击事件处理需要匹配。
                        // 简单处理：点击事件解析 ID
                    } catch (e) {
                        console.error('Notification fetch error', e);
                    }
                }
            }
        }

        // 保存状态
        await chrome.storage.local.set({
            streamingInfo,
            previousLiveUids: currentLiveUids,
            newlyStreaming
        });

        // 通知 Popup 更新 (如果打开)
        chrome.runtime.sendMessage({ action: 'streamersUpdated' }).catch(() => {});

    } catch (error) {
        console.error('Update streamers failed:', error);
        chrome.runtime.sendMessage({ action: 'showError', message: error.message }).catch(() => {});
    }
}

// 闹钟调度
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'updateStreamers') updateStreamers();
});

// 监听消息
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'updateStreamers') {
        updateStreamers().then(() => sendResponse({ success: true }));
        return true;
    }
    if (req.action === 'setRefreshInterval') {
        chrome.alarms.create('updateStreamers', { periodInMinutes: req.interval / 60 });
        return true;
    }
});

// 通知点击
chrome.notifications.onClicked.addListener(async (notifId) => {
    const uid = notifId.split('-')[1]; // live-UID-timestamp
    if (uid) {
        const { streamingInfo } = await chrome.storage.local.get('streamingInfo');
        const streamer = streamingInfo?.find(s => String(s.uid) === uid);
        if (streamer) {
            chrome.tabs.create({ url: streamer.link });
        }
        
        // 点击后从高亮列表移除
        const { newlyStreaming = [] } = await chrome.storage.local.get('newlyStreaming');
        const updated = newlyStreaming.filter(u => String(u) !== uid);
        await chrome.storage.local.set({ newlyStreaming: updated });
    }
    chrome.notifications.clear(notifId);
});

// 初始化
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get('refreshInterval', (res) => {
        chrome.alarms.create('updateStreamers', { periodInMinutes: (res.refreshInterval || 60) / 60 });
        updateStreamers();
    });
});

chrome.runtime.onInstalled.addListener(() => {
    updateStreamers();
    chrome.alarms.create('updateStreamers', { periodInMinutes: 1 }); // Default 60s
});