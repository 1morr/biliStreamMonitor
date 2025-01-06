const headers = {
    'authority': 'api.vc.bilibili.com',
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'content-type': 'application/x-www-form-urlencoded',
    'origin': 'https://message.bilibili.com',
    'referer': 'https://message.bilibili.com/',
    'sec-ch-ua': '"Chromium";v="116", "Not)A;Brand";v="24", "Microsoft Edge";v="116"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.81'
};

// Function to get the target ID from cookies
async function getTargetId() {
    console.log('getTargetId() at', new Date().toLocaleString());
    try {
        const cookie = await chrome.cookies.get({
            url: 'https://www.bilibili.com',
            name: 'DedeUserID'
        });
        return cookie ? cookie.value : null;
    } catch (error) {
        console.error('Error getting target ID:', new Date().toLocaleString(), "\n", error);
        return null;
    }
}

// Function to fetch medal wall data
async function fetchMedalWallData() {
    console.log('fetchMedalWallData() at', new Date().toLocaleString());
    try {
        const targetId = await getTargetId();
        if (!targetId) {
            throw new Error('Not logged in to Bilibili. Please log in and try again.');
        }

        const url = `https://api.live.bilibili.com/xlive/web-ucenter/user/MedalWall?target_id=${targetId}`;
        const response = await fetch(url, {
            headers: headers,
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch medal wall data: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (data.code !== 0) {
            throw new Error(`API Error: ${data.message || 'Unknown error'}`);
        }

        return data;
    } catch (error) {
        console.error('Error fetching medal wall data:', new Date().toLocaleString(), "\n", error);
        chrome.runtime.sendMessage({ action: 'showError', message: String(error) })
            .catch(error => {
                if (error.message === "Could not establish connection. Receiving end does not exist.") {
                    console.log("Popup is not open. Handling error gracefully.");
                } else {
                    console.error("Unexpected error:", new Date().toLocaleString(), "\n", error);
                }
            });
    }
}

// Function to update badge for new streamers
async function updateBadgeForNewStreamers(streamingInfo) {
    console.log('updateBadgeForNewStreamers(streamingInfo) at', new Date().toLocaleString());
    try {
        const { favoriteStreamers = [], previousStreamers = [], deletedStreamers = [], notification = 2 } = await chrome.storage.local.get(['favoriteStreamers', 'previousStreamers', 'deletedStreamers', 'notification']);
        let { newlyStreaming = [] } = await chrome.storage.local.get('newlyStreaming');

        const currentlyStreaming = streamingInfo.filter(s => s.live_status === 1).map(s => s.uid);
        const newStreamers = currentlyStreaming.filter(uid => !previousStreamers.includes(uid) && !deletedStreamers.includes(uid));
        const uniqueNewStreamers = newStreamers.filter(uid => !newlyStreaming.includes(uid));
        newlyStreaming.push(...uniqueNewStreamers);
        newlyStreaming = newlyStreaming.filter(uid => currentlyStreaming.includes(uid));

        const newStreamersInfo = streamingInfo
            .filter(s => newlyStreaming.includes(s.uid))
            .map(s => ({
                name: s.streamer_name,
                uid: s.uid,
                medal_name: s.medal_name,
                medal_level: s.medal_level,
                isFavorite: favoriteStreamers.includes(s.uid)
            }));

        if (newStreamersInfo.length > 0) {
            console.log('New streamers detected at:', new Date().toLocaleString(), newStreamersInfo);
            const newFavoriteStreamersCount = newlyStreaming.filter(uid => favoriteStreamers.includes(uid)).length;

            if (notification === 0) {
                console.log('Notification setting = 0');
                chrome.action.setBadgeText({ text: '' });
            } else if (notification === 1) {
                console.log('Notification setting = 1');
                if (newFavoriteStreamersCount > 0) {
                    chrome.action.setBadgeText({ text: newFavoriteStreamersCount.toString() });
                    chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
                    console.log("New Favorite Streaming:", newlyStreaming.filter(uid => favoriteStreamers.includes(uid)));
                } else {
                    console.log("No New Favorite Streaming");
                    chrome.action.setBadgeText({ text: '' });
                }
            } else if (notification === 2) {
                console.log('Notification setting = 2');
                if (newFavoriteStreamersCount > 0) {
                    chrome.action.setBadgeText({ text: newStreamersInfo.length.toString() });
                    chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
                } else {
                    chrome.action.setBadgeText({ text: newStreamersInfo.length.toString() });
                    chrome.action.setBadgeBackgroundColor({ color: '#ff9100' });
                }
            } else {
                console.log('Notification setting error');
            }
        } else {
            console.log('No new streamers detected at:', new Date().toLocaleString());
            chrome.action.setBadgeText({ text: '' });
        }

        await chrome.storage.local.set({
            'newlyStreaming': newlyStreaming,
            'previousStreamers': currentlyStreaming
        });
    } catch (error) {
        console.error('Error updating badge:', new Date().toLocaleString(), "\n", error);
    }
}

// Function to update streamers
async function updateStreamers() {
    console.log('updateStreamers() at', new Date().toLocaleString());
    try {
        const resp = await fetchMedalWallData();
        const medalList = resp.data.list;
        const streamingInfo = medalList.map(medal => ({
            uid: medal.medal_info.target_id,
            streamer_name: medal.target_name,
            streamer_icon: medal.target_icon,
            medal_name: medal.medal_info.medal_name,
            medal_level: medal.medal_info.level,
            live_status: medal.live_status,
            link: medal.link
        }));

        await chrome.storage.local.set({ 'streamingInfo': streamingInfo });
        console.log('Streamers updated successfully at:', new Date().toLocaleString(), streamingInfo);

        await updateBadgeForNewStreamers(streamingInfo);

        chrome.runtime.sendMessage({ action: 'streamersUpdated' })
            .catch(error => {
                if (error.message === "Could not establish connection. Receiving end does not exist.") {
                    console.log("Popup is not open. Handling error gracefully.");
                } else {
                    console.error("Unexpected error:", new Date().toLocaleString(), "\n", error);
                }
            });

        return streamingInfo;
    } catch (error) {
        console.error('Error updating streamers:', new Date().toLocaleString(), "\n", error);
    }
}

// Schedule updates using chrome.alarms
function scheduleUpdateStreamers(intervalInMinutes) {
    console.log('scheduleUpdateStreamers(intervalInMinutes) at', new Date().toLocaleString());
    chrome.alarms.create('updateStreamers', { periodInMinutes: intervalInMinutes });
}

// Listen for alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'updateStreamers') {
        try {
            await updateStreamers();
        } catch (error) {
            console.error('Error during scheduled update:', new Date().toLocaleString(), "\n", error);
        }
    }
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateStreamers') {
        console.log('Receiving Update Streamers Request at', new Date().toLocaleString());
        updateStreamers()
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    }
    if (request.action === 'setRefreshInterval') {
        console.log('Receiving setRefreshInterval Request at', new Date().toLocaleString());
        const newInterval = request.interval;
        scheduleUpdateStreamers(newInterval / 60); // Convert seconds to minutes
        sendResponse({ success: true });
        return true; // Will respond asynchronously
    }
});

// Initial setup for updating streamers
chrome.runtime.onStartup.addListener(() => {
    console.log("Chrome started and background script running, doing Initial setup for updating streamers");
    chrome.storage.local.get('refreshInterval', (result) => {
        const intervalInMinutes = (result.refreshInterval || 30) / 60; // Default to 30 seconds, converted to minutes
        scheduleUpdateStreamers(intervalInMinutes);
        updateStreamers(); // Initial update
    });
});

chrome.runtime.onInstalled.addListener(() => {
    console.log("Extension installed, doing Initial setup for updating streamers");
    chrome.storage.local.get('refreshInterval', (result) => {
        const intervalInMinutes = (result.refreshInterval || 30) / 60; // Default to 30 seconds, converted to minutes
        scheduleUpdateStreamers(intervalInMinutes);
        updateStreamers(); // Initial update
    });
});