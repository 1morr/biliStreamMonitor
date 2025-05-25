# BiliStreamMonitor

A Chrome extension for monitoring Bilibili streamers from your medal wall. Get notified when your favorite streamers go live and quickly access their streams.

## Features

*   **Medal Wall Monitoring:** Automatically fetches and displays streamers from your Bilibili medal wall.
*   **Live Status Updates:** Shows which streamers are currently live directly in the extension popup.
*   **Desktop Notifications:** Receive notifications when a favorite streamer starts streaming, including the stream title.
*   **Stream Information:** View stream titles and preview images via tooltips in the popup.
*   **Quick Access:** Click on a streamer to open their Bilibili live room directly.
*   **Favorites System:** Mark streamers as favorites to receive prioritized notifications.
*   **Context Menu:** Right-click (or long-press) on a streamer in the popup for quick actions like marking as favorite, liking (placeholder), or opening the stream.

## Installation

1.  **Download the Extension:**
    *   Clone this repository or download the ZIP file and extract it to a folder on your computer.
2.  **Load into Chrome:**
    *   Open Google Chrome.
    *   Navigate to `chrome://extensions/`.
    *   Enable **Developer mode** using the toggle switch in the top-right corner.
    *   Click the **Load unpacked** button.
    *   Select the folder where you extracted/cloned the extension files (the folder containing `manifest.json`).
3.  The BiliStreamMonitor extension icon should now appear in your Chrome toolbar.

## How to Use

1.  **Open the Popup:** Click the BiliStreamMonitor extension icon in your Chrome toolbar.
2.  **View Streamers:** The popup will display a list of streamers from your Bilibili medal wall. Streamers who are currently live will be highlighted.
3.  **Open Stream:** Click on a streamer's name or icon in the list to open their Bilibili live room in a new tab.
4.  **Tooltips:** Hover your mouse over the icon of a live streamer to see a tooltip displaying the current stream title and a preview image.
5.  **Context Menu:**
    *   Right-click on a streamer's entry in the popup to open a context menu.
    *   From the context menu, you can:
        *   Mark/unmark the streamer as a **Favorite** (heart icon).
        *   Like the streamer (star icon).
        *   Open the streamer's live room (external link icon - implicitly handled by clicking the streamer).
        *   Remove/hide the streamer from the list (delete icon).
6.  **Notifications:** If you have marked a streamer as a favorite, you will receive a desktop notification when they go live. The notification will include their name and the title of their current stream.
