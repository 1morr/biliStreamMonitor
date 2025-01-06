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

let refreshIntervalId;

// Function to get the target ID from cookies
async function getTargetId() {
    console.log('getTargetId() at' , new Date().toLocaleString())
    try {
        const cookie = await chrome.cookies.get({
            url: 'https://www.bilibili.com',
            name: 'DedeUserID'
        });
        return cookie ? cookie.value : null;
    } catch (error) {
        console.error('Error getting target ID:', new Date().toLocaleString(), "\n", error);
        // chrome.runtime.sendMessage({ action: 'showError', message: String(error) });
        return null;
    }
}

// Function to fetch medal wall data
async function fetchMedalWallData() {
    console.log('fetchMedalWallData() at' , new Date().toLocaleString())
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
            .then(response => {
                // Handle the response here if needed
            })
            .catch(error => {
                if (error.message === "Could not establish connection. Receiving end does not exist.") {
                console.log("Popup is not open. Handling error gracefully.");
                // Perform alternative action or log the error
                } else {
                console.error("Unexpected error:", new Date().toLocaleString(), "\n", error);
                }
            });
        // throw error;
    }
}



async function updateBadgeForNewStreamers(streamingInfo) {
    console.log('updateBadgeForNewStreamers(streamingInfo) at', new Date().toLocaleString())
    try {
        // Retrieve favorite, previous, and newly streaming streamers
        const { favoriteStreamers = [] } = await chrome.storage.local.get('favoriteStreamers');
        const { previousStreamers = [] } = await chrome.storage.local.get('previousStreamers');
        const { deletedStreamers = [] } = await chrome.storage.local.get('deletedStreamers');
        const { refreshInterval = 30 } = await chrome.storage.local.get('refreshInterval');
        const { notification = 0 } = await chrome.storage.local.get('notification');
        let { newlyStreaming = [] } = await chrome.storage.local.get('newlyStreaming'); // Ensure it's initialized

        // console.log('this is deleted data', deletedStreamersData);

        // const deletedStreamers = deletedStreamersData.deletedStreamers || [];

        // console.log('this is deleted', deletedStreamers); // [30911397, 1768094747, 2829851, 1434027068, 1278545, 1043321643, 928123]

        // Get currently and previously streaming uids
        const currentlyStreaming = streamingInfo.filter(s => s.live_status === 1).map(s => s.uid);
        // const previouslyStreaming = previousStreamers.filter(s => s.live_status === 1).map(s => s.uid);

        // Find new streamers, excluding deleted streamers
        const newStreamers = currentlyStreaming.filter(uid => 
            !previousStreamers.includes(uid) && !deletedStreamers.includes(uid)
        );

        // Append unique new streamers to the newlyStreaming array
        const uniqueNewStreamers = newStreamers.filter(uid => !newlyStreaming.includes(uid));
        newlyStreaming.push(...uniqueNewStreamers);

        // Retain only those in newlyStreaming who are currently streaming
        newlyStreaming = newlyStreaming.filter(uid => currentlyStreaming.includes(uid));

        // Log new streamers information
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
            console.log('New streamers detected at:', new Date().toLocaleString(), 'newStreamersInfo');
            // console.table(newStreamersInfo);
            const newFavoriteStreamersCount = newlyStreaming.filter(uid => 
                favoriteStreamers.includes(uid)
            ).length;

            const newFavoriteStreamers = newlyStreaming.filter(uid => 
                favoriteStreamers.includes(uid)
            );



            if (notification === 0) { // no notification
                console.log('Notification setting = 0')
            } else if (notification === 1) { // Only favorite
                console.log('Notification setting = 1') 
                // Update badge if there are new favorite streamers streaming
                if (newFavoriteStreamersCount > 0) {
                    chrome.action.setBadgeText({ text: newFavoriteStreamersCount.toString() });
                    chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
                    console.log("New Favorite Streaming:", newFavoriteStreamers);
                } else {
                    console.log("No New Favorite Streaming");
                    chrome.action.setBadgeText({ text: newFavoriteStreamersCount.toString() });
                    chrome.action.setBadgeBackgroundColor({ color: '#ff9100' });
                }
            } else if (notification === 2) {
                console.log('Notification setting = 2') 
                if (newFavoriteStreamersCount > 0) {
                    chrome.action.setBadgeText({ text: newStreamersInfo.length.toString() });
                    chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
                    console.log("New Favorite Streaming:", newFavoriteStreamers);
                } else {
                    console.log("No New Favorite Streaming");
                    chrome.action.setBadgeText({ text: newStreamersInfo.length.toString() });
                    chrome.action.setBadgeBackgroundColor({ color: '#ff9100' });
                }
            } else {
                console.log('Notification setting error')
            }
        } else {
            console.log('No new streamers detected at:', new Date().toLocaleString());
            chrome.action.setBadgeText({ text: '' });
        }

        // Update newly streaming and previous streamers in storage
        await chrome.storage.local.set({ 
            'newlyStreaming': newlyStreaming, // Save updated newlyStreaming
            'previousStreamers': streamingInfo.filter(s => s.live_status === 1).map(s => s.uid), // Update previous streamers
            'favoriteStreamers': favoriteStreamers,
            'deletedStreamers': deletedStreamers,
            'refreshInterval': refreshInterval
        });

    } catch (error) {
        console.error('Error updating badge:', new Date().toLocaleString(), "\n", error);
    }
}

async function updateStreamers() {
    console.log('updateStreamers() at' , new Date().toLocaleString())
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
        
        // Update badge for new streamers
        await updateBadgeForNewStreamers(streamingInfo);
        
        // Notify popup to load streamer data
        chrome.runtime.sendMessage({ action: 'streamersUpdated' })
            .then(response => {
                // Handle the response here if needed
            })
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

// Function to schedule updates at a specified interval
function scheduleUpdateStreamers(interval) {
    console.log('scheduleUpdateStreamers(interval) at' , new Date().toLocaleString())
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId); // Clear previous interval
    }
    refreshIntervalId = setInterval(async () => {
        try {
            await updateStreamers();
        } catch (error) {
            console.error('Error during scheduled update:', new Date().toLocaleString(), "\n", error);
        }
    }, interval * 1000);
}


// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateStreamers') {
        console.log('Receving Update Streamers Request at' , new Date().toLocaleString())
        updateStreamers()
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    }
    if (request.action === 'setRefreshInterval') {
        console.log('Receving setRefreshInterval Request at' , new Date().toLocaleString())
        const newInterval = request.interval;
        scheduleUpdateStreamers(newInterval);
        sendResponse({ success: true });
        return true; // Will respond asynchronously
    }
});


// Optionally, listen for other events
chrome.runtime.onStartup.addListener(() => {
    console.log("Chrome started and background script running, doing Initial setup for updating streamers");
    async () => {
        const result = await new Promise((resolve) => {
            chrome.storage.local.get('refreshInterval', (result) => {
                resolve(result.refreshInterval || 30); // Default to 30 seconds
            });
        });
        
        scheduleUpdateStreamers(result);
        await updateStreamers(); // Initial update
    }
});





// Initial setup for updating streamers
(async () => {
    console.log('Initial setup for updating streamers' , new Date().toLocaleString())
    const result = await new Promise((resolve) => {
        chrome.storage.local.get('refreshInterval', (result) => {
            resolve(result.refreshInterval || 30); // Default to 30 seconds
        });
    });
    
    scheduleUpdateStreamers(result);
    await updateStreamers(); // Initial update
})();