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
                    console.log("Popup is not open. Does not need to show error.");
                } else {
                    console.error("Unexpected error:", new Date().toLocaleString(), "\n", error);
                }
            });
    }
}

// New function specifically for updating the badge
async function updateBadge(streamersToBadge) {
    console.log('updateBadge(streamersToBadge) called with:', streamersToBadge, 'at', new Date().toLocaleString());
    try {
        if (streamersToBadge.length > 0) {
            const { streamerStates = {} } = await chrome.storage.local.get('streamerStates');
            const { streamingInfo = [] } = await chrome.storage.local.get('streamingInfo'); // Need full info for name/state
            
            const badgeStreamerInfo = streamingInfo.filter(s => streamersToBadge.includes(s.uid));

            console.log('Setting badge text to:', String(badgeStreamerInfo.length));
            chrome.action.setBadgeText({ text: String(badgeStreamerInfo.length) });

            // Determine badge color based on priority: Favorite > Like > Other
            let badgeColor = '#2890a7'; // Default for 'other' or mixed including 'other'
            const hasBadgeFavorite = badgeStreamerInfo.some(s => streamerStates[s.uid] === 'favorite');
            const hasBadgeLike = badgeStreamerInfo.some(s => streamerStates[s.uid] === 'like');
            
            if (hasBadgeLike) {
                badgeColor = '#ff9100'; // Set for 'like' or mixed including 'like' but no 'favorite'
            }
            if (hasBadgeFavorite) {
                badgeColor = '#ff4444'; // Highest priority: set for 'favorite' or any mix including 'favorite'
            }
            
            console.log('Setting badge background color to:', badgeColor);
            chrome.action.setBadgeBackgroundColor({ color: badgeColor });

        } else {
            console.log('Clearing badge text.');
            chrome.action.setBadgeText({ text: '' });
        }
    } catch (error) {
        console.error('Error updating badge:', new Date().toLocaleString(), "\n", error);
    }
}

// Function to update badge and send notifications for new streamers
async function updateBadgeAndNotifyForNewStreamers(streamingInfo) {
    console.log('updateBadgeAndNotifyForNewStreamers(streamingInfo) at', new Date().toLocaleString());
    try {
        const { 
            streamerStates = {}, 
            previousStreamers = [], 
            deletedStreamers = [], 
            notificationPreference = '2', // Default to 'All'
            browserNotificationsEnabled = true // Default to true
        } = await chrome.storage.local.get(['streamerStates', 'previousStreamers', 'deletedStreamers', 'notificationPreference', 'browserNotificationsEnabled']);
        
        let { newlyStreaming = [] } = await chrome.storage.local.get('newlyStreaming');

        const currentlyStreamingUIDs = streamingInfo.filter(s => s.live_status === 1).map(s => s.uid);
        
        // Identify streamers who just started streaming and are not deleted
        const newLiveStreamers = streamingInfo.filter(s => 
            s.live_status === 1 && 
            !previousStreamers.includes(s.uid) && 
            !deletedStreamers.includes(s.uid)
        );

        const uniqueNewLiveUIDs = newLiveStreamers.map(s => s.uid).filter(uid => !newlyStreaming.includes(uid));
        newlyStreaming.push(...uniqueNewLiveUIDs);
        newlyStreaming = newlyStreaming.filter(uid => currentlyStreamingUIDs.includes(uid)); // Keep only those still streaming

        // Filter newlyStreaming based on notificationPreference and streamerStates
        let streamersToNotifyOrBadge = [];
        if (notificationPreference === '0') { // Off
            // No one to notify or badge
        } else if (notificationPreference === '1') { // Favorite only
            streamersToNotifyOrBadge = newlyStreaming.filter(uid => streamerStates[uid] === 'favorite');
        } else if (notificationPreference === '3') { // Like & Favorite
            streamersToNotifyOrBadge = newlyStreaming.filter(uid => streamerStates[uid] === 'favorite' || streamerStates[uid] === 'like');
        } else if (notificationPreference === '2') { // All (includes those not in streamerStates)
            streamersToNotifyOrBadge = newlyStreaming;
        }

        const newStreamersInfoForBadge = streamingInfo.filter(s => streamersToNotifyOrBadge.includes(s.uid));

        if (newStreamersInfoForBadge.length > 0) {
            console.log('New streamers for badge/notification:', new Date().toLocaleString(), newStreamersInfoForBadge.map(s=>s.streamer_name));
            await updateBadge(streamersToNotifyOrBadge);
            
            // Send browser notifications for streamers who *just* came online in this cycle and are favorites
            if (browserNotificationsEnabled) {
                const favoriteNewlyLiveStreamers = newLiveStreamers.filter(
                    s => streamerStates[s.uid] === 'favorite'
                );

                if (favoriteNewlyLiveStreamers.length > 0) {
                    console.log('Sending browser notifications for newly live favorites:', favoriteNewlyLiveStreamers.map(s => s.streamer_name), new Date().toLocaleString());
                }

                favoriteNewlyLiveStreamers.forEach(streamer => {
                    // `streamer` is from newLiveStreamers, so they just came online in this cycle
                    chrome.notifications.create(`live-${streamer.uid}-${Date.now()}`, {
                        type: 'basic',
                        iconUrl: streamer.streamer_icon || 'images/icon128.png',
                        title: `${streamer.streamer_name} is now live!`,
                        message: `Click to watch ${streamer.streamer_name}`,
                        priority: 2
                    }, (notificationId) => {
                        // Store notificationId to handle click later if needed
                        chrome.storage.local.get({openTabsOnNotificationClick: {}}, function(data) {
                            data.openTabsOnNotificationClick[notificationId] = streamer.link;
                            chrome.storage.local.set({openTabsOnNotificationClick: data.openTabsOnNotificationClick});
                        });
                    });
                });
            }
        } else {
            console.log('No new streamers for badge based on preferences at:', new Date().toLocaleString());
            await updateBadge([]);
        }

        await chrome.storage.local.set({
            'newlyStreaming': newlyStreaming, // Persist the updated list of newly streaming UIDs
            'previousStreamers': currentlyStreamingUIDs // Update the list of previously known streaming UIDs
        });
    } catch (error) {
        console.error('Error updating badge and notifications:', new Date().toLocaleString(), "\n", error);
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

        await updateBadgeAndNotifyForNewStreamers(streamingInfo); // Changed function call

        chrome.runtime.sendMessage({ action: 'streamersUpdated' })
            .catch(error => {
                if (error.message === "Could not establish connection. Receiving end does not exist.") {
                    console.log("Popup is not open. Does not need to update popup");
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

// Handle notification click
chrome.notifications.onClicked.addListener(async (notificationId) => {
    try {
        // Extract UID from notificationId (assuming format `live-UID-timestamp`)
        const parts = notificationId.split('-');
        if (parts.length >= 2 && parts[0] === 'live') {
            const uidToRemove = parseInt(parts[1], 10);

            if (!isNaN(uidToRemove)) {
                // Fetch current newlyStreaming list
                const { newlyStreaming = [] } = await chrome.storage.local.get('newlyStreaming');
                
                // Filter out the clicked streamer
                const updatedNewlyStreaming = newlyStreaming.filter(uid => uid !== uidToRemove);
                
                // Save the updated list
                await chrome.storage.local.set({ newlyStreaming: updatedNewlyStreaming });
                console.log(`Removed UID ${uidToRemove} from newlyStreaming list after notification click.`, new Date().toLocaleString());
                
                // Update the badge immediately
                await updateBadge(updatedNewlyStreaming);
            }
        }
    } catch (error) {
        console.error('Error removing streamer from newlyStreaming on notification click:', new Date().toLocaleString(), "\n", error);
    }

    // Original logic to open tab and clear notification
    chrome.storage.local.get('openTabsOnNotificationClick', function(data) {
        const urlToOpen = data.openTabsOnNotificationClick[notificationId];
        if (urlToOpen) {
            chrome.tabs.create({ url: urlToOpen });
            // Clean up the stored URL for this notificationId
            delete data.openTabsOnNotificationClick[notificationId];
            chrome.storage.local.set({openTabsOnNotificationClick: data.openTabsOnNotificationClick});
        }
        chrome.notifications.clear(notificationId);
    });
});

// Initial setup for updating streamers
chrome.runtime.onStartup.addListener(() => {
    console.log("Chrome started and background script running, doing Initial setup for updating streamers");
    chrome.storage.local.get('refreshInterval', (result) => {
        const intervalInMinutes = (result.refreshInterval || 30) / 60; // Default to 30 seconds, converted to minutes
        scheduleUpdateStreamers(intervalInMinutes);
        updateStreamers(); // Initial update
    });
    // Clear any pending notification URLs on startup
    chrome.storage.local.set({openTabsOnNotificationClick: {}});
});

chrome.runtime.onInstalled.addListener((details) => {
    console.log("Extension installed or updated, doing Initial setup for updating streamers. Reason:", details.reason);
    chrome.storage.local.get('refreshInterval', (result) => {
        const intervalInMinutes = (result.refreshInterval || 30) / 60; // Default to 30 seconds, converted to minutes
        scheduleUpdateStreamers(intervalInMinutes);
        updateStreamers(); // Initial update
    });
    // Clear any pending notification URLs on install/update
    chrome.storage.local.set({openTabsOnNotificationClick: {}});
    // Notification permission is requested in manifest.json and granted on install.
});