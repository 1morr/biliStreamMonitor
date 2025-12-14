
let currentMuted = true;
let currentVolume = 0.5;
let settingsReceived = false;

function applySettings() {
    if (!settingsReceived) return;
    
    const video = document.querySelector('video');
    if (video) {
        // Bilibili player might override this, so we try to force it
        // Only apply if the state differs
        if (video.muted !== currentMuted) video.muted = currentMuted;
        if (Math.abs(video.volume - currentVolume) > 0.01) video.volume = currentVolume;
    }
}

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'BSM_UPDATE_VOLUME') {
        currentMuted = event.data.muted;
        currentVolume = event.data.volume;
        settingsReceived = true;
        applySettings();
    }
});

// Watch for video element
const observer = new MutationObserver(() => {
    applySettings();
});

// Start observing
if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
    });
}
