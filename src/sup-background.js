// import { waitForPageLoad } from "./sup-common.js";

// Polyfill to standardize the browser API for both Chrome and Firefox
const api = typeof browser === 'undefined' ? chrome : browser;

function supLog(...args) {
    console.log("[BG-SUP]", ...args);
}

function getCurrentTab() {
    return api.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs.length > 0) {
            return tabs[0];
        } else {
            throw new Error('No active tab found');
        }
    });
}

function visitUrl(tabId, url) {
    api.tabs.update(tabId, { url });
}

function waitForPageLoad(tabId) {
    return new Promise((resolve, reject) => {
	function listener(details) {
	    if (details.tabId === tabId) {
		api.webNavigation.onCompleted.removeListener(listener);
		resolve();
	    }
	}

	api.webNavigation.onCompleted.addListener(listener, {
	    url: [{ schemes: ["http", "https"] }],
	});

	setTimeout(() => {
	    api.webNavigation.onCompleted.removeListener(listener);
	    reject(new Error('Page load timeout'));
	}, 30000); // 30 seconds timeout
    });
}

// callback takes one arg: tab
function withFacebookTab(callback) {
    // TODO: Create recyclable FB tab pool
    api.tabs.create({ url: "https://www.facebook.com/", active: false }, (newTab) => {
        function checkTabAndExecuteCallback(tabId, changeInfo, tab) {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
                callback(tab);
                api.tabs.onUpdated.removeListener(checkTabAndExecuteCallback);
            }
        }

        // Listen for the tab update to ensure it is fully loaded
        api.tabs.onUpdated.addListener(checkTabAndExecuteCallback);
    });
}

function gotoAlbum(message, sender, sendResponse) {
    const { albumId } = message;
    withFacebookTab((tab) => {
        supLog("Have FB tab. Sending message to load album", albumId);
        api.tabs.sendMessage(tab.id, {
            action: "loadAlbumPage",
            albumId: albumId,
        });
    });
}

function changeUrl(message, sender, sendResponse) {
    const { url } = message;
    const tabId = sender.tab.id;
    api.tabs.update(tabId, { url }).then(() => {
        function onUpdated(updatedTabId, changeInfo, tab) {
            if (updatedTabId === tabId && changeInfo.status === "complete") {
                api.tabs.onUpdated.removeListener(onUpdated);
                sendResponse({message: `Changed URL for tab ${tabId} to ${url}`});
            }
        }
        api.tabs.onUpdated.addListener(onUpdated);
    }).catch(error => {
        supLog("Failed to update tab url", error);
    });
}

const messageActions = {
    "gotoAlbum": {fn: gotoAlbum},
    "changeUrl": {fn: changeUrl, willSendResponse: true},
};

function onMessage(message, sender, sendResponse) {
    supLog("got message", message);
    const actionSpec = messageActions[message.action];
    if (actionSpec !== undefined) {
        const { fn, willSendResponse } = actionSpec;
        fn(message, sender, sendResponse);
        return willSendResponse || false; // return true to keep message channel open for sendResponse
    }
}

function init() {
    supLog("Init sup-background.js");
    api.runtime.onMessage.addListener(onMessage);
}

init();
