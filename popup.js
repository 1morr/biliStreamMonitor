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

// Add the missing variable definition
let activeTooltipTarget = null;

// popup.js


// The old toggleNotificationState and updateNotificationButton are no longer needed as we use a select dropdown and a checkbox.
// These will be removed or replaced by logic handling the new select and checkbox.



async function exportConfig() {
    try {
        // Get all the configuration data from storage
        const config = await chrome.storage.local.get([
            'deletedStreamers',
            'streamerStates', // Changed from favoriteStreamers
            'refreshInterval',
            'notificationPreference', // Changed from notification
            'browserNotificationsEnabled' // Added new setting
        ]);

        // Ensure all required keys exist with defaults if necessary
        const defaultConfig = {
            deletedStreamers: [],
            streamerStates: {},
            refreshInterval: 30,
            notificationPreference: '2', // Default to 'All'
            browserNotificationsEnabled: true // Default to enabled
        };

        // Merge fetched config with defaults to ensure all keys are present
        const finalConfig = { ...defaultConfig, ...config };

        // Create a JSON blob using the guaranteed complete config
        const blob = new Blob([JSON.stringify(finalConfig, null, 2)], { type: 'application/json' });
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bilibili_streamer_config_${new Date().toISOString().split('T')[0]}.json`;
        
        // Trigger download
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // showMessage('Configuration exported successfully!');

        // Show loading message only when manually refreshing
        const loading = document.createElement('div');
        loading.className = 'loading';
        loading.textContent = 'Configuration exported successfully!';
        document.body.appendChild(loading);

        // Create a promise that resolves after 1 second
        const minimumLoadingTime = new Promise(resolve => setTimeout(resolve, 1000));

        try {
            // Run both promises in parallel and wait for both to complete
            await Promise.all([
                minimumLoadingTime
            ]);
            // await loadStreamerData();
        } catch (error) {
            showError(`Error updating streamer data: ${error.message}`);
        } finally {
            // Remove loading message after refresh attempt
            if (document.body.contains(loading)) {
                document.body.removeChild(loading);
            }
        }
    } catch (error) {
        showError('Failed to export configuration: ' + error.message);
    }
}

async function importConfig(file) {
    try {
        const text = await file.text();
        const config = JSON.parse(text);
        
        // Validate the config file
        const requiredKeys = ['deletedStreamers', 'streamerStates', 'refreshInterval', 'notificationPreference', 'browserNotificationsEnabled'];
        const hasAllKeys = requiredKeys.every(key => key in config);
        
        if (!hasAllKeys) {
            throw new Error('Invalid configuration file format');
        }
        
        // Store the imported configuration
        await chrome.storage.local.set(config);
        
        // Refresh the display
        await loadStreamerData();
        
        // Update the refresh interval input
        document.getElementById('refreshTime').value = config.refreshInterval || 30;

        // Update the notification buttons
        updateNotificationButton(config.notificationPreference || '2');
        updateBrowserNotificationButton(config.browserNotificationsEnabled !== undefined ? config.browserNotificationsEnabled : true);
        
        // Show loading message only when manually refreshing
        const loading = document.createElement('div');
        loading.className = 'loading';
        loading.textContent = 'Configuration imported successfully!';
        document.body.appendChild(loading);

        // Create a promise that resolves after 1 second
        const minimumLoadingTime = new Promise(resolve => setTimeout(resolve, 1000));

        try {
            // Run both promises in parallel and wait for both to complete
            await Promise.all([
                minimumLoadingTime
            ]);
            // await loadStreamerData();
        } catch (error) {
            showError(`Error updating streamer data: ${error.message}`);
        } finally {
            // Remove loading message after refresh attempt
            if (document.body.contains(loading)) {
                document.body.removeChild(loading);
            }
        }
    } catch (error) {
        showError('Failed to import configuration: ' + error.message);
    }
}

/*
function showMessage(message) {
    // Remove any existing error messages
    console.log('Showing Message at', new Date().toLocaleString())
    removeError();

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const messageDiv = document.createElement('div');
    messageDiv.className = 'normal-message';
    
    const messageText = document.createElement('div');
    messageText.textContent = message;
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.onclick = removeMessage;

    messageDiv.appendChild(messageText);
    messageDiv.appendChild(closeButton);
    
    document.body.appendChild(overlay);
    document.body.appendChild(messageDiv);
    
    console.log(message);
}

function removeMessage() {
    console.log('Removing Message at', new Date().toLocaleString())
    const existingMessage = document.querySelector('.normal-message');
    const existingOverlay = document.querySelector('.overlay');
    if (existingMessage) {
        existingMessage.remove();
    }
    if (existingOverlay) {
        existingOverlay.remove();
    }
}
*/


function showError(message) {
    // Remove any existing error messages
    console.log('Showing Error at', new Date().toLocaleString())
    removeError();

    const overlay = document.createElement('div');
    overlay.className = 'error-overlay';

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    
    const errorText = document.createElement('div');
    errorText.textContent = message;
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.onclick = removeError;

    errorDiv.appendChild(errorText);
    errorDiv.appendChild(closeButton);
    
    document.body.appendChild(overlay);
    document.body.appendChild(errorDiv);
    
    console.error(message);
}


function removeError() {
    console.log('Removing Error at', new Date().toLocaleString())
    const existingError = document.querySelector('.error-message');
    const existingOverlay = document.querySelector('.error-overlay');
    if (existingError) {
        existingError.remove();
    }
    if (existingOverlay) {
        existingOverlay.remove();
    }
}






// Function to format the duration
function formatDuration(milliseconds) {
    console.log('Formating Duration', new Date().toLocaleString())
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const displayMinutes = String(minutes % 60).padStart(2, '0'); // Zero-pad minutes
    const displaySeconds = String(seconds % 60).padStart(2, '0'); // Zero-pad seconds

    if (hours > 0) {
        const displayHours = String(hours).padStart(2, '0'); // Zero-pad hours
        return `${displayHours}:${displayMinutes}:${displaySeconds}`;
    } else {
        return `${displayMinutes}:${displaySeconds}`;
    }
}


// 获取流媒体数据
async function fetchStreamerData() {
    const streamers = await chrome.storage.local.get('streamingInfo');
    const deletedStreamersData = await chrome.storage.local.get('deletedStreamers');
    const streamerStatesData = await chrome.storage.local.get('streamerStates'); // Changed favoriteStreamers to streamerStates
    const newStreamersData = await chrome.storage.local.get('newlyStreaming');

    return {
        streamersList: streamers.streamingInfo || [],
        deletedStreamers: deletedStreamersData.deletedStreamers || [],
        streamerStates: streamerStatesData.streamerStates || {}, // Changed favoriteStreamers to streamerStates, default to empty object
        newlyStreaming: newStreamersData.newlyStreaming || []
    };
}

// 对流媒体数据进行排序
function sortStreamers(streamersList, streamerStates) { // Changed favoriteStreamers to streamerStates
    return streamersList.sort((a, b) => {
        if (a.live_status === 1 && b.live_status !== 1) return -1;
        if (a.live_status !== 1 && b.live_status === 1) return 1;

        const aState = streamerStates[a.uid];
        const bState = streamerStates[b.uid];

        // Favorite has higher priority than like, and both higher than normal
        const getPriority = (state) => {
            if (state === 'favorite') return 2;
            if (state === 'like') return 1;
            return 0;
        };

        const aPriority = getPriority(aState);
        const bPriority = getPriority(bState);

        if (aPriority !== bPriority) {
            return bPriority - aPriority; // Higher priority comes first
        }

        return b.medal_level - a.medal_level;
    });
}

// 渲染流媒体数据到页面
function renderStreamers(sortedStreamers, deletedStreamers, streamerStates, newlyStreaming) { // Changed favoriteStreamers to streamerStates
    const container = document.getElementById('streamerContainer');
    container.innerHTML = '';

    sortedStreamers.forEach(streamer => {
        if (deletedStreamers.includes(streamer.uid)) return;

        const iconDiv = createStreamerIcon(streamer, streamerStates, newlyStreaming); // Pass streamerStates
        container.appendChild(iconDiv);
    });
}

// popup.js

// 显示 tooltip
function showTooltip(event, content) {
    const tooltip = document.getElementById('tooltip');
    
    // 先设置内容但不显示
    tooltip.innerHTML = content;
    
    // 先将tooltip放在屏幕外，避免闪烁
    tooltip.style.left = '-9999px';
    tooltip.style.top = '0';
    tooltip.style.display = 'block';
    tooltip.style.opacity = '0';
    
    // 使用requestAnimationFrame确保DOM更新后再计算位置
    requestAnimationFrame(() => {
        // 计算 tooltip 的位置
        const iconRect = event.target.getBoundingClientRect(); // 获取图标的边界信息
        const tooltipWidth = tooltip.offsetWidth; // 获取 tooltip 的宽度
        const tooltipHeight = tooltip.offsetHeight; // 获取 tooltip 的高度

        // 将 tooltip 显示在图标正下方
        let left = iconRect.left + (iconRect.width / 2) - (tooltipWidth / 2); // 图标水平中心 - tooltip 宽度的一半
        let top = iconRect.bottom + 10; // 图标底部 + 10px

        // 如果 tooltip 超出窗口右侧，则向左调整
        if (left + tooltipWidth > window.innerWidth) {
            left = window.innerWidth - tooltipWidth - 10; // 窗口右侧 - tooltip 宽度 - 10px
        }

        // 如果 tooltip 超出窗口左侧，则向右调整
        if (left < 0) {
            left = 10; // 窗口左侧 + 10px
        }

        // 如果 tooltip 超出窗口底部，则显示在图标上方
        if (top + tooltipHeight > window.innerHeight) {
            top = iconRect.top - tooltipHeight - 10; // 图标顶部 - tooltip 高度 - 10px
        }

        // 设置 tooltip 的位置
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        
        // 平滑显示tooltip
        requestAnimationFrame(() => {
            tooltip.style.opacity = '1';
            tooltip.style.transition = 'opacity 0.2s ease-in-out';
        });
    });
}

// 隐藏 tooltip
function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    tooltip.style.display = 'none';
}

// 获取房间信息并更新 tooltip 内容
async function fetchRoomInfo(roomid) {
    const url = `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomid}`;
    const response = await fetch(url, {
        headers: headers,
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch room info: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
        throw new Error(`API Error: ${data.message || 'Unknown error'}`);
    }

    return data;
}


// Load the NA.png image
// 缓存NA图片，避免重复加载
let cachedNAImage = null;

async function loadNAPicture() {
    // 如果已经缓存了NA图片，直接返回
    if (cachedNAImage) {
        return cachedNAImage;
    }
    
    try {
        // 使用chrome.runtime.getURL获取扩展内资源的完整URL
        const naImageURL = chrome.runtime.getURL('images/NA.png');
        const response = await fetch(naImageURL);
        if (!response.ok) {
            throw new Error(`Failed to fetch NA.png: ${response.status} ${response.statusText}`);
        }
        
        // 创建Blob URL并缓存
        cachedNAImage = URL.createObjectURL(await response.blob());
        return cachedNAImage;
    } catch (error) {
        console.error('Error loading NA image:', error);
        // 如果加载失败，返回一个简单的占位符URL
        return chrome.runtime.getURL('images/NA.png');
    }
}

// Function to show the NA.png image when the original image fails to load
function showNAPicture(tooltipImage) {
    // 先设置占位图样式，避免显示丢失图标
    tooltipImage.style.width = '100%';
    tooltipImage.style.height = 'auto';
    tooltipImage.style.minHeight = '120px';
    tooltipImage.style.backgroundColor = '#f0f0f0';
    tooltipImage.style.border = '1px solid #ccc';
    tooltipImage.style.opacity = '0';
    tooltipImage.style.transition = 'opacity 0.3s ease-in';
    tooltipImage.alt = '加载中...';
    
    // 预加载NA.png图片
    const naImage = new Image();
    naImage.src = chrome.runtime.getURL('images/NA.png');
    
    naImage.onload = () => {
        // 图片加载完成后，使用淡入效果显示
        tooltipImage.src = naImage.src;
        setTimeout(() => {
            tooltipImage.style.opacity = '1';
        }, 10);
    };
    
    // 添加错误处理，以防NA.png也无法加载
    naImage.onerror = () => {
        console.error('Failed to load NA.png fallback image');
        tooltipImage.alt = '图片无法加载';
        tooltipImage.style.opacity = '1';
    };
}

// 处理鼠标悬停事件，显示 tooltip
function handleTooltipHover(event, streamer) {
    let tooltipTimeout;
    let preloadResult = null;
    let isLoading = false;
    let preloadStarted = false;

    // Ensure event target is an img element
    if (event.target.tagName.toLowerCase() !== 'img') return;

    // 预加载处理函数
    const preloadHandler = (mouseOverEvent) => { // Changed: Add mouseOverEvent parameter
        const currentTargetElement = mouseOverEvent.currentTarget; // Changed: Use currentTarget

        if (streamer.live_status === 1 && !preloadResult && !preloadStarted) {
            preloadStarted = true; // 标记预加载已开始，防止重复触发
            // 开始后台预加载
            preloadRoomInfoAndImage(streamer).then(result => {
                preloadResult = result;
                // 如果正在显示加载动画，则显示tooltip
                // Changed: Check activeTooltipTarget and use currentTargetElement
                if (activeTooltipTarget === currentTargetElement && isLoading) {
                    showTooltipWithData(mouseOverEvent, preloadResult); // Pass mouseOverEvent
                    // 隐藏小型加载动画
                    hideIconLoadingSpinner(currentTargetElement.parentNode);
                    isLoading = false;
                }
            }).catch(error => {
                console.error('Error preloading room info:', error);
                // 如果正在显示加载动画，则隐藏它
                // Changed: Check activeTooltipTarget and use currentTargetElement
                if (activeTooltipTarget === currentTargetElement && isLoading) {
                    hideIconLoadingSpinner(currentTargetElement.parentNode);
                    isLoading = false;
                }
            }).finally(() => {
                preloadStarted = false; // 重置标记, moved to finally
            });
        }
    };

    // 提前预加载房间信息和图片（在鼠标接近图标前）
    event.target.addEventListener('mouseover', preloadHandler);

    // 鼠标进入图标
    event.target.onmouseenter = async (mouseEnterEvent) => { // Changed: Add mouseEnterEvent parameter
        activeTooltipTarget = mouseEnterEvent.currentTarget; // Changed: Set active target, use currentTarget

        if (streamer.live_status === 1) {
            // 清除之前的超时
            clearTimeout(tooltipTimeout);
            hideTooltip();

            // 如果已经有预加载结果，直接显示tooltip
            if (preloadResult) {
                if (activeTooltipTarget === mouseEnterEvent.currentTarget) { // Changed: Check active target
                    showTooltipWithData(mouseEnterEvent, preloadResult);
                }
                return;
            }

            // 防止重复显示加载动画
            if (!isLoading) {
                // 显示小型加载动画在头像下方
                if (activeTooltipTarget === mouseEnterEvent.currentTarget) { // Changed: Check active target
                    // Add null check before accessing parentNode
                    if (mouseEnterEvent.currentTarget && mouseEnterEvent.currentTarget.parentNode) {
                        showIconLoadingSpinner(mouseEnterEvent.currentTarget.parentNode);
                        isLoading = true;
                    }
                } else {
                    return; // Mouse moved away before spinner could be shown
                }
            }

            // 设置新的超时，由于我们在预加载，所以减少延迟
            tooltipTimeout = setTimeout(async () => {
                if (activeTooltipTarget !== mouseEnterEvent.currentTarget) { // Changed: Check active target
                    if (isLoading && mouseEnterEvent.currentTarget && mouseEnterEvent.currentTarget.parentNode) {
                        hideIconLoadingSpinner(mouseEnterEvent.currentTarget.parentNode);
                        isLoading = false;
                    }
                    return;
                }

                try {
                    // 使用缓存数据（如果可用），否则获取它
                    if (!preloadResult) {
                        // Wait a moment for mouseover preload to potentially complete
                        await new Promise(resolve => setTimeout(resolve, 50)); 

                        if (activeTooltipTarget !== mouseEnterEvent.currentTarget) { // Changed: Check active target again
                            if (isLoading && mouseEnterEvent.currentTarget && mouseEnterEvent.currentTarget.parentNode) { 
                                hideIconLoadingSpinner(mouseEnterEvent.currentTarget.parentNode); 
                                isLoading = false; 
                            }
                            return;
                        }

                        if (!preloadResult) { // If still not there, fetch
                           if (!preloadStarted) { 
                                preloadStarted = true; 
                                try {
                                    preloadResult = await preloadRoomInfoAndImage(streamer);
                                } finally {
                                    preloadStarted = false; 
                                }
                           } else {
                                // Preload is already in progress from mouseover, wait a bit longer
                                await new Promise(resolve => setTimeout(resolve, 150)); 
                                if (activeTooltipTarget !== mouseEnterEvent.currentTarget) { // Changed: Check active target again
                                    if (isLoading && mouseEnterEvent.currentTarget && mouseEnterEvent.currentTarget.parentNode) { 
                                        hideIconLoadingSpinner(mouseEnterEvent.currentTarget.parentNode); 
                                        isLoading = false; 
                                    }
                                    return;
                                }
                           }
                        }
                    }
                    
                    if (activeTooltipTarget === mouseEnterEvent.currentTarget && preloadResult) { // Changed: Final check and ensure preloadResult exists
                        showTooltipWithData(mouseEnterEvent, preloadResult);
                    }
                    
                } catch (error) {
                    console.error('Error showing tooltip:', error);
                } finally {
                    // Hide spinner if it was shown for this icon
                    if (isLoading && mouseEnterEvent.currentTarget && mouseEnterEvent.currentTarget.parentNode) { 
                        hideIconLoadingSpinner(mouseEnterEvent.currentTarget.parentNode);
                        isLoading = false;
                    }
                }
            }, 50); // 减少延迟以提高响应速度
        }
    };

    // 鼠标离开图标
    event.target.onmouseleave = (mouseLeaveEvent) => { // Changed: Add mouseLeaveEvent parameter
        if (mouseLeaveEvent.currentTarget === activeTooltipTarget) { // Changed: Check if this was the active target
            activeTooltipTarget = null; // Clear active target
        }
        clearTimeout(tooltipTimeout);
        hideTooltip();
        // 隐藏小型加载动画
        if (isLoading && mouseLeaveEvent.currentTarget && mouseLeaveEvent.currentTarget.parentNode) {
            hideIconLoadingSpinner(mouseLeaveEvent.currentTarget.parentNode); // Changed: use currentTarget
            isLoading = false;
        }
    };
}

// 显示小型加载动画
function showIconLoadingSpinner(iconElement) {
    // Add null check for iconElement
    if (!iconElement) return;
    
    // 检查是否已存在加载动画
    let spinner = iconElement.querySelector('.icon-loading-spinner');
    if (!spinner) {
        // 创建加载动画
        spinner = document.createElement('div');
        spinner.className = 'icon-loading-spinner';
        iconElement.appendChild(spinner);
    }
    // 防止重复触发动画
    if (spinner.style.display === 'block' || spinner.style.opacity === '1') {
        return; // 如果已经显示，则不重复触发
    }
    // 先设置样式再显示，确保平滑过渡
    spinner.style.opacity = '0';
    spinner.style.display = 'block';
    
    // 使用requestAnimationFrame确保在下一帧渲染时设置不透明度
    // 这样可以触发CSS过渡效果
    requestAnimationFrame(() => {
        spinner.style.opacity = '1';
    });
}

// 隐藏小型加载动画
function hideIconLoadingSpinner(iconElement) {
    // Add null check for iconElement
    if (!iconElement) return;
    
    const spinner = iconElement.querySelector('.icon-loading-spinner');
    if (spinner) {
        // 使用淡出效果隐藏动画，防止下次显示时闪烁
        spinner.style.opacity = '0';
        // 使用setTimeout确保CSS过渡效果完成后再隐藏元素
        setTimeout(() => {
            if (spinner.style.opacity === '0') { // 确保在过渡期间没有被重新显示
                spinner.style.display = 'none';
            }
        }, 150);
    }
}

// 显示带有数据的tooltip
function showTooltipWithData(event, preloadResult) {
    try {
        const roomInfo = preloadResult.roomInfo;
        
        // 确定要使用的图片（优先级：高分辨率 > 缩略图 > 用户封面 > NA图片）
        let displayImage = preloadResult.highRes || preloadResult.thumbnail || preloadResult.userCover || null;
        let isImageLoaded = !!displayImage;

        const startTime = new Date(roomInfo.data.live_time.replace(/ /, 'T'));
        const elapsedTime = Date.now() - startTime.getTime();
        const duration = formatDuration(elapsedTime);

        // 确定图片方向
        let isPortrait = false;
        if (displayImage) {
            isPortrait = displayImage.naturalHeight > displayImage.naturalWidth;
        } else {
            // 如果图片尚未加载，则回退到URL解析
            const highResImageUrl = roomInfo.data.keyframe;
            const sizeMatch = highResImageUrl.match(/\/(\d+)x(\d+)\//);
            if (sizeMatch) {
                const width = parseInt(sizeMatch[1], 10);
                const height = parseInt(sizeMatch[2], 10);
                isPortrait = height > width;
            }
        }

        // 创建一个临时图片元素来预加载图片
        const preloadImg = new Image();
        preloadImg.crossOrigin = "Anonymous";
        
        // 设置图片源
        let imgSrc;
        if (isImageLoaded) {
            imgSrc = displayImage.src;
        } else if (roomInfo.data.keyframe) {
            imgSrc = `${roomInfo.data.keyframe}@50w_50h`;
        } else if (roomInfo.data.user_cover) {
            imgSrc = roomInfo.data.user_cover;
        } else {
            imgSrc = chrome.runtime.getURL('images/NA.png');
        }
        
        // 当图片加载完成或失败时显示tooltip
        preloadImg.onload = () => {
            // 生成tooltip内容
            const tooltipContent = `
                <div class="tooltip-content ${isPortrait ? 'portrait' : 'landscape'}">
                    <img class="tooltip-image" 
                         src="${imgSrc}" 
                         alt="${roomInfo.data.title}" 
                         style="opacity: 0; transition: opacity 0.3s ease-in;">
                    <div class="live-time">${duration}</div>
                    <div class="tooltip-title">${roomInfo.data.title}</div>
                </div>
            `;

            // 显示tooltip
            showTooltip(event, tooltipContent);

            // 获取tooltip图片元素
            const tooltipImage = document.querySelector('.tooltip-content .tooltip-image');

            // 添加淡入效果
            if (tooltipImage) {
                // 图片已经预加载完成，可以立即显示
                requestAnimationFrame(() => {
                    tooltipImage.style.opacity = '1';
                });
                
                // 为图片添加错误处理
                tooltipImage.onerror = () => {
                    console.log('Failed to load thumbnail image, showing user cover or NA image.');
                    // 如果有用户封面图，尝试使用
                    if (preloadResult.userCover) {
                        console.log('Using user cover image.');
                        tooltipImage.src = preloadResult.userCover.src;
                    } else {
                        // 显示NA图片
                        console.log('Showing NA image.');
                        showNAPicture(tooltipImage);
                    }
                };
            }

            // 如果我们还没有加载高分辨率图片，现在加载它
            if (tooltipImage && !preloadResult.highRes && preloadResult.thumbnail) {
                // 如果有缩略图但没有高分辨率图片，尝试加载高分辨率图片
                const highResImage = new Image();
                highResImage.crossOrigin = "Anonymous";
                highResImage.src = roomInfo.data.keyframe;

                // 高分辨率图片加载完成后，替换低分辨率图片
                highResImage.onload = () => {
                    tooltipImage.style.opacity = '0';
                    setTimeout(() => {
                        tooltipImage.src = highResImage.src;
                        tooltipImage.style.opacity = '1';
                    }, 300);
                    
                    // 更新缓存
                    preloadResult.highRes = highResImage;
                };
            }
        };
        
        // 处理图片加载失败的情况
        preloadImg.onerror = () => {
            // 尝试使用备用图片
            if (preloadResult.userCover) {
                preloadImg.src = preloadResult.userCover.src;
            } else {
                // 如果没有可用的图片，使用NA图片并显示tooltip
                const tooltipContent = `
                    <div class="tooltip-content ${isPortrait ? 'portrait' : 'landscape'}">
                        <img class="tooltip-image" 
                             alt="${roomInfo.data.title}" 
                             style="opacity: 0; transition: opacity 0.3s ease-in;">
                        <div class="live-time">${duration}</div>
                        <div class="tooltip-title">${roomInfo.data.title}</div>
                    </div>
                `;
                
                showTooltip(event, tooltipContent);
                
                const tooltipImage = document.querySelector('.tooltip-content .tooltip-image');
                if (tooltipImage) {
                    showNAPicture(tooltipImage);
                }
            }
        };
        
        // 开始加载图片
        preloadImg.src = imgSrc;
    } catch (error) {
        console.error('Error showing tooltip with data:', error);
    }
}

// Helper function to preload room info and image
// 图片缓存对象，用于存储已加载的图片
const imageCache = {};

async function preloadRoomInfoAndImage(streamer) {
    // Get roomid
    const roomid = streamer.link.split('//')[1].split('/')[1].split('?')[0];
    
    // 检查缓存中是否已有该房间信息和图片
    const cacheKey = `room_${roomid}`;
    if (imageCache[cacheKey] && Date.now() - imageCache[cacheKey].timestamp < 60000) { // 缓存1分钟
        console.log('Using cached room info and image for', streamer.streamer_name);
        return imageCache[cacheKey].data;
    }
    
    // Get room info
    const roomInfo = await fetchRoomInfo(roomid);
    
    // 预先创建低分辨率缩略图和高分辨率图片对象
    const thumbnailImage = new Image();
    thumbnailImage.crossOrigin = "Anonymous";
    thumbnailImage.src = `${roomInfo.data.keyframe}@50w_50h`; // 使用低分辨率版本加快加载
    
    const highResImage = new Image();
    highResImage.crossOrigin = "Anonymous";
    highResImage.src = roomInfo.data.keyframe;
    
    // 创建用户封面图像作为备用
    const userCoverImage = new Image();
    userCoverImage.crossOrigin = "Anonymous";
    userCoverImage.src = roomInfo.data.user_cover;
    
    // 并行加载所有图片
    const imagePromises = [
        loadImageWithTimeout(thumbnailImage, 1000),
        loadImageWithTimeout(highResImage, 3000),
        loadImageWithTimeout(userCoverImage, 3000)
    ];
    
    // 等待任意一个图片加载完成
    const images = await Promise.allSettled(imagePromises);
    
    // 找到第一个成功加载的图片
    let loadedImage = null;
    for (const result of images) {
        if (result.status === 'fulfilled' && result.value) {
            loadedImage = result.value;
            break;
        }
    }
    
    // 如果高分辨率图片已加载，优先使用它
    if (images[1].status === 'fulfilled' && images[1].value) {
        loadedImage = images[1].value;
    }
    // 如果只有缩略图加载成功，使用缩略图
    else if (images[0].status === 'fulfilled' && images[0].value) {
        loadedImage = images[0].value;
    }
    // 如果用户封面图加载成功，使用封面图
    else if (images[2].status === 'fulfilled' && images[2].value) {
        loadedImage = images[2].value;
    }
    
    const result = {
        roomInfo,
        image: loadedImage,
        thumbnail: images[0].status === 'fulfilled' ? images[0].value : null,
        highRes: images[1].status === 'fulfilled' ? images[1].value : null,
        userCover: images[2].status === 'fulfilled' ? images[2].value : null
    };
    
    // 存入缓存
    imageCache[cacheKey] = {
        timestamp: Date.now(),
        data: result
    };
    
    return result;
}

// 辅助函数：带超时的图片加载
function loadImageWithTimeout(image, timeout) {
    return new Promise((resolve) => {
        // 如果图片已经加载完成，直接返回
        if (image.complete) {
            resolve(image);
            return;
        }
        
        // 图片加载成功
        image.onload = () => resolve(image);
        
        // 图片加载失败
        image.onerror = () => resolve(null);
        
        // 设置超时
        setTimeout(() => resolve(null), timeout);
    });
}

// 在 createStreamerIcon 中调用 handleTooltipHover
function createStreamerIcon(streamer, streamerStates, newlyStreaming) { // Changed favoriteStreamers to streamerStates
    const iconDiv = document.createElement('div');
    iconDiv.className = 'icon' + (streamer.live_status === 1 ? '' : ' not-streaming');

    if (newlyStreaming.includes(streamer.uid)) {
        iconDiv.classList.add('new-streamer');
    }

    iconDiv.onclick = () => {
        chrome.tabs.create({ url: streamer.link });
        const tooltip = document.getElementById('tooltip');
        tooltip.style.display = 'none'; // Hide the tooltip
    };

    iconDiv.oncontextmenu = (event) => {
        showContextMenu(event, streamer, iconDiv);
        const tooltip = document.getElementById('tooltip');
        tooltip.style.display = 'none'; // Hide the tooltip
    };

    iconDiv.onmousedown = (event) => {
        if (event.button === 1) { // Middle mouse button
            chrome.tabs.create({ url: streamer.link, active: false });
            event.preventDefault(); // Prevent default middle button behavior
            const tooltip = document.getElementById('tooltip');
            tooltip.style.display = 'none'; // Hide the tooltip
        }
    };

    const img = document.createElement('img');
    img.src = streamer.streamer_icon;
    img.alt = streamer.streamer_name;

    // 将 tooltip 事件绑定到 img 上
    handleTooltipHover({ target: img }, streamer);

    const nameDiv = document.createElement('div');
    nameDiv.className = 'streamer-name ' + (streamer.live_status === 1 ? 'live' : 'not-streaming');
    nameDiv.textContent = streamer.streamer_name;

    const medalDiv = document.createElement('div');
    medalDiv.className = 'medal-level';
    medalDiv.textContent = `${streamer.medal_name} (Level ${streamer.medal_level})`;

    if (streamer.live_status === 1) {
        const liveBadge = document.createElement('div');
        liveBadge.className = 'live-badge';
        liveBadge.textContent = 'Live';
        if (newlyStreaming.includes(streamer.uid)) {
            liveBadge.classList.add('new-live');
        }
        iconDiv.appendChild(liveBadge);
    }

    updateStreamerIndicator(iconDiv, streamer.uid, streamerStates); // Use new indicator function

    iconDiv.appendChild(img);
    iconDiv.appendChild(nameDiv);
    iconDiv.appendChild(medalDiv);

    return iconDiv;
}

// 处理新流媒体的逻辑
function handleNewStreamers(newlyStreaming) {
    if (document.visibilityState === 'visible') {
        console.log('Popup showed, Removing newlyStreaming', new Date().toLocaleString());
        chrome.action.setBadgeText({ text: '' });
        chrome.storage.local.set({ 'newlyStreaming': [] });
    }
}

// 主函数：加载流媒体数据
async function loadStreamerData() {
    try {
        const { streamersList, deletedStreamers, streamerStates, newlyStreaming } = await fetchStreamerData(); // Changed favoriteStreamers to streamerStates

        if (streamersList.length === 0) {
            // Do not throw error here, allow empty list for new users or after clearing all streamers
            // showError('No streamer data found. Please make sure you are logged into Bilibili and try refreshing.');
            const container = document.getElementById('streamerContainer');
            container.innerHTML = '<p style="text-align: center; margin-top: 20px;">No streamers being monitored. Add streamers via the background page or by importing a configuration.</p>';
        }

        const sortedStreamers = sortStreamers(streamersList, streamerStates);
        renderStreamers(sortedStreamers, deletedStreamers, streamerStates, newlyStreaming);
        handleNewStreamers(newlyStreaming);

        console.log('Streamers info loaded successfully at:', new Date().toLocaleString());
    } catch (error) {
        showError(error.message);
    }
}




// Function to refresh data
async function refreshData() {
    // Log the current time every time data is refreshed
    console.log('Manual Refreshing data at:', new Date().toLocaleString());

    // Show loading message only when manually refreshing
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Updating streamer data...';
    document.body.appendChild(loading);

    // Create a promise that resolves after 1 second
    const minimumLoadingTime = new Promise(resolve => setTimeout(resolve, 150));

    try {
        // Run both promises in parallel and wait for both to complete
        await Promise.all([
            chrome.runtime.sendMessage({ action: 'updateStreamers' }),
            minimumLoadingTime
        ]);
        // await loadStreamerData();
    } catch (error) {
        showError(`Error updating streamer data: ${error.message}`);
    } finally {
        // Remove loading message after refresh attempt
        if (document.body.contains(loading)) {
            document.body.removeChild(loading);
        }
    }
}



// Function to toggle settings dialog visibility
function toggleSettingsDialog() {
    console.log('Toggling Settings Dialog at', new Date().toLocaleString())
    const dialog = document.getElementById('settingsDialog');
    const deletedStreamersContainer = document.getElementById('deletedStreamersContainer');



    const existingOverlay = document.querySelector('.overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    } else {
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        document.body.appendChild(overlay);
    }

    

    
    // Toggle the visibility of the settings dialog
    dialog.style.display = dialog.style.display === 'block' ? 'none' : 'block';
    
    // Reset the deleted streamers container to closed state
    if (dialog.style.display === 'none') {
        deletedStreamersContainer.style.display = 'none'; // Close the deleted streamers container
    }
}

async function loadDeletedStreamers() {
    console.log('Loading Deleted Streamer Data at', new Date().toLocaleString())
    const deletedStreamersData = await chrome.storage.local.get('deletedStreamers');
    const deletedStreamers = deletedStreamersData.deletedStreamers || []; // Ensure it's an array

    const container = document.getElementById('deletedStreamersContainer');
    container.innerHTML = ''; // Clear previous entries

    // Check if there are no deleted streamers
    if (deletedStreamers.length === 0) {
        container.innerHTML = '<p>No deleted streamers.</p>';
        container.style.display = 'block'; // Show the message
        return;
    }

    // Continue processing if there are deleted streamers
    const streamerData = await chrome.storage.local.get('streamingInfo');
    const streamersList = streamerData.streamingInfo || [];

    deletedStreamers.forEach(uid => {
        const streamer = streamersList.find(s => s.uid === uid);
        if (streamer) {
            const iconDiv = document.createElement('div');
            iconDiv.className = 'deleted-streamer-icon';
            iconDiv.onclick = async () => {
                await removeStreamerFromDeleted(uid);
                iconDiv.remove(); // Remove the icon from the display
            };

            const img = document.createElement('img');
            img.src = streamer.streamer_icon;
            img.alt = streamer.streamer_name;

            const nameDiv = document.createElement('span');
            nameDiv.textContent = streamer.streamer_name;

            iconDiv.appendChild(img);
            iconDiv.appendChild(nameDiv);
            container.appendChild(iconDiv);
        }
    });

    container.style.display = 'block'; // Show the deleted streamers container
}

async function removeStreamerFromDeleted(uid) {
    console.log('Removing Streamer From Deleted at', new Date().toLocaleString())
    const deletedStreamersData = await chrome.storage.local.get('deletedStreamers');
    let deletedStreamers = deletedStreamersData.deletedStreamers || [];

    deletedStreamers = deletedStreamers.filter(id => id !== uid); // Remove the streamer
    await chrome.storage.local.set({ 'deletedStreamers': deletedStreamers });

    // Refresh data after removing the streamer
    loadStreamerData();
}


async function showContextMenu(event, streamer, iconDiv) {
    console.log('Showing Context Menu for:', streamer.streamer_name, 'at', new Date().toLocaleString());
    event.preventDefault();
    removeContextMenu();

    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu'; // Styles for this are in popup.html

    const { streamerStates: currentStreamerStates } = await chrome.storage.local.get('streamerStates');
    const streamerStates = currentStreamerStates || {};
    const currentState = streamerStates[streamer.uid];

    // Create Favorite (Heart) Icon
    const favoriteIcon = document.createElement('i');
    favoriteIcon.className = `fas fa-heart context-menu-item ${currentState === 'favorite' ? 'active' : ''}`;
    favoriteIcon.title = currentState === 'favorite' ? 'Unfavorite' : 'Favorite';
    favoriteIcon.onclick = async () => {
        const newStates = { ...streamerStates };
        if (currentState === 'favorite') {
            delete newStates[streamer.uid];
        } else {
            newStates[streamer.uid] = 'favorite';
        }
        await chrome.storage.local.set({ streamerStates: newStates });
        updateStreamerIndicator(iconDiv, streamer.uid, newStates);
        removeContextMenu();
        await loadStreamerData(); // Refresh to re-sort and update UI fully
    };

    // Create Like (Star) Icon
    const likeIcon = document.createElement('i');
    likeIcon.className = `fas fa-star context-menu-item ${currentState === 'like' ? 'active' : ''}`;
    likeIcon.title = currentState === 'like' ? 'Unlike' : 'Like';
    likeIcon.onclick = async () => {
        const newStates = { ...streamerStates };
        if (currentState === 'like') {
            delete newStates[streamer.uid];
        } else {
            newStates[streamer.uid] = 'like';
        }
        await chrome.storage.local.set({ streamerStates: newStates });
        updateStreamerIndicator(iconDiv, streamer.uid, newStates);
        removeContextMenu();
        await loadStreamerData(); // Refresh to re-sort and update UI fully
    };

    // Create Delete (Cross) Icon
    const deleteIcon = document.createElement('i');
    deleteIcon.className = 'fas fa-times context-menu-item';
    deleteIcon.title = 'Delete';
    deleteIcon.onclick = async () => {
        const container = document.getElementById('streamerContainer');
        if (container.contains(iconDiv)) {
             container.removeChild(iconDiv);
        }
        const deletedStreamersData = await chrome.storage.local.get('deletedStreamers');
        const deletedStreamers = deletedStreamersData.deletedStreamers || [];
        if (!deletedStreamers.includes(streamer.uid)) {
            deletedStreamers.push(streamer.uid);
            await chrome.storage.local.set({ 'deletedStreamers': deletedStreamers });
        }
        // Also remove from streamerStates if present
        const newStates = { ...streamerStates };
        if (newStates[streamer.uid]) {
            delete newStates[streamer.uid];
            await chrome.storage.local.set({ streamerStates: newStates });
        }
        removeContextMenu();
        // No loadStreamerData() here as it's a delete, the icon is already removed.
    };

    contextMenu.appendChild(favoriteIcon);
    contextMenu.appendChild(likeIcon);
    contextMenu.appendChild(deleteIcon);
    document.body.appendChild(contextMenu);

    // Positioning logic
    const menuRect = contextMenu.getBoundingClientRect();
    let left = event.clientX - menuRect.width / 2 + 60;
    let top = event.clientY + 20; // Position below cursor

    if (left < 0) left = 5;
    if (top < 0) top = 5; // Should not happen if positioned below cursor
    if (left + menuRect.width > window.innerWidth) left = window.innerWidth - menuRect.width - 5;
    if (top + menuRect.height > window.innerHeight) top = event.clientY - menuRect.height - 10; // Position above cursor if not enough space below
    
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;

    document.addEventListener('click', handleClickOutsideMenu, true);
}

function handleClickOutsideMenu(event) {
    const contextMenu = document.querySelector('.context-menu');
    if (contextMenu && !contextMenu.contains(event.target)) {
        removeContextMenu();
    }
}


function removeContextMenu() {
    console.log('Removing Context Menu at', new Date().toLocaleString());
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    document.removeEventListener('click', handleClickOutsideMenu, true);
}


function updateStreamerIndicator(iconDiv, uid, streamerStates) {
    console.log('Updating indicator for UID:', uid, 'at', new Date().toLocaleString());
    let indicator = iconDiv.querySelector('.streamer-indicator');
    if (indicator) {
        indicator.remove();
    }

    const state = streamerStates[uid];
    if (state === 'favorite') {
        indicator = document.createElement('div');
        indicator.className = 'streamer-indicator favorite-indicator'; // Uses .favorite-indicator style from HTML
        indicator.innerHTML = '<i class="fas fa-heart" style="color: #ff6b81; font-size: 16px;"></i>'; // Heart icon
        iconDiv.appendChild(indicator);
    } else if (state === 'like') {
        indicator = document.createElement('div');
        indicator.className = 'streamer-indicator like-indicator'; // Uses .like-indicator style from HTML
        indicator.innerHTML = '<i class="fas fa-star" style="color: #FFD700; font-size: 16px;"></i>'; // Star icon
        iconDiv.appendChild(indicator);
    }
}






document.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded, loadStreamerData() at', new Date().toLocaleString())
    loadStreamerData();
    // Add this listener in popup.js
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'streamersUpdated') {
            console.log('Receving streamersUpdated, loadStreamerData', new Date().toLocaleString())
            loadStreamerData(); // Call loadStreamerData when streamers are updated
        }
    // Listen for messages from background.js

        if (request.action === 'showError') {
            console.log('Receving Show Error Request', new Date().toLocaleString())
            showError(request.message);
            sendResponse({ status: 'error displayed' });
        }
    });
    
    // Load the saved refresh interval or set the default to 30 seconds
    chrome.storage.local.get('refreshInterval', (result) => {
        const initialInterval = result.refreshInterval || 30;

        // Set the input value to the initial interval
        document.getElementById('refreshTime').value = initialInterval;

        // Set the refresh interval in the background
        chrome.runtime.sendMessage({ action: 'setRefreshInterval', interval: initialInterval });

    });

    document.getElementById('settingsButton').addEventListener('click', toggleSettingsDialog);
    document.getElementById('closeSettingsButton').addEventListener('click', toggleSettingsDialog);
    document.getElementById('manualRefreshButton').addEventListener('click', async () => {
        await refreshData();
    });

    document.getElementById('viewDeletedButton').addEventListener('click', loadDeletedStreamers);

    // Export button click handler
    document.getElementById('exportConfigButton').addEventListener('click', exportConfig);
        
    // Import button click handler
    document.getElementById('importConfigButton').addEventListener('click', () => {
        document.getElementById('configFileInput').click();
    });

    // File input change handler
    document.getElementById('configFileInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            importConfig(file);
        }
        // Reset the input so the same file can be selected again
        event.target.value = '';
    });


    // Initialize notification buttons
    chrome.storage.local.get(['notificationPreference', 'browserNotificationsEnabled'], (result) => {
        const notificationPreference = result.notificationPreference !== undefined ? result.notificationPreference : '2'; // Default to '2' (All)
        updateNotificationButton(notificationPreference);

        const browserNotificationsEnabled = result.browserNotificationsEnabled !== undefined ? result.browserNotificationsEnabled : true;
        updateBrowserNotificationButton(browserNotificationsEnabled);
    });

    // Add click event listener for notification button
    document.getElementById('notificationButton').addEventListener('click', toggleNotificationState);

    // Add click event listener for browser notification button
    document.getElementById('browserNotificationButton').addEventListener('click', toggleBrowserNotifications);

    
    document.getElementById('refreshTime').addEventListener('change', (event) => {
        const intervalSeconds = Math.max(parseInt(event.target.value, 10), 30);
        event.target.value = intervalSeconds; // Ensure it does not go below 30
        
        // Save the new interval to chrome.storage.local
        chrome.storage.local.set({ refreshInterval: intervalSeconds });

        // Send the new interval to the background script
        chrome.runtime.sendMessage({ action: 'setRefreshInterval', interval: intervalSeconds });

    });
});

// Add these functions back to handle the notification button cycling
async function toggleNotificationState() {
    const button = document.getElementById('notificationButton');
    const result = await chrome.storage.local.get('notificationPreference');
    let currentState = result.notificationPreference;
    
    // If notification setting doesn't exist, start with state '2' (all notifications)
    if (currentState === undefined) {
        currentState = '2';
    }

    // Cycle through states: '2' (All) -> '3' (Like & Favorite) -> '1' (Favorite) -> '0' (Off) -> '2' (All)
    if (currentState === '2') {
        currentState = '3';
    } else if (currentState === '3') {
        currentState = '1';
    } else if (currentState === '1') {
        currentState = '0';
    } else {
        currentState = '2';
    }

    // Update storage
    await chrome.storage.local.set({ notificationPreference: currentState });

    // Update button appearance
    updateNotificationButton(currentState);
}

function updateNotificationButton(state) {
    const button = document.getElementById('notificationButton');
    
    // Remove all possible classes first
    button.classList.remove('no-notification', 'favorite-only', 'all-notification', 'like-favorite');
    
    // Add appropriate class and text based on state
    switch (state) {
        case '0':
            button.classList.add('no-notification');
            button.textContent = 'Notifications: Off';
            break;
        case '1':
            button.classList.add('favorite-only');
            button.textContent = 'Notifications: Favorites Only';
            break;
        case '3':
            button.classList.add('like-favorite'); // Use the new class
            button.textContent = 'Notifications: Like & Favorite';
            break;
        case '2':
        default:
            button.classList.add('all-notification');
            button.textContent = 'Notifications: All';
            break;
    }
}

// Add function to toggle browser notifications
async function toggleBrowserNotifications() {
    const button = document.getElementById('browserNotificationButton');
    const result = await chrome.storage.local.get('browserNotificationsEnabled');
    let enabled = result.browserNotificationsEnabled;
    
    // If setting doesn't exist, default to true
    if (enabled === undefined) {
        enabled = true;
    }
    
    // Toggle the setting
    enabled = !enabled;
    
    // Update storage
    await chrome.storage.local.set({ browserNotificationsEnabled: enabled });
    
    // Update button appearance
    updateBrowserNotificationButton(enabled);
}

function updateBrowserNotificationButton(enabled) {
    const button = document.getElementById('browserNotificationButton');
    
    // Remove potentially existing classes first
    button.classList.remove('no-notification', 'browser-notification-on');

    if (enabled) {
        button.classList.add('browser-notification-on'); // Use the new class
        button.textContent = 'Browser Notifications: On';
    } else {
        button.classList.add('no-notification'); // Keep using this for Off
        button.textContent = 'Browser Notifications: Off';
    }
}

