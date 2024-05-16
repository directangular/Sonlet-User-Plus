// import { waitForPageLoad } from "./sup-common.js";

// Polyfill to standardize the browser API for both Chrome and Firefox
const api = typeof browser === 'undefined' ? chrome : browser;

const supLog = (...args) => console.log("[SUP-BG]", ...args);

const albumNavHandlers = {};

// Always use strings for object keys. Without this, any totally numeric
// IDs get converted to Numbers, which makes subsequent access annoying
// (since our FB IDs are always strings elsewhere).
const _navHandlerIdToKey = (id) => `id_${id}`;

const addAlbumNavHandler = (fbAlbumId, fbTabId, handler) => {
    const fbKey = _navHandlerIdToKey(fbAlbumId);
    const tabKey = _navHandlerIdToKey(fbTabId);
    if (albumNavHandlers[fbKey] === undefined) {
        albumNavHandlers[fbKey] = [];
    }
    if (albumNavHandlers[fbKey][tabKey] === undefined) {
        albumNavHandlers[fbKey][tabKey] = [];
    }
    albumNavHandlers[fbKey][tabKey].push(handler);
};

const runAlbumNavHandlers = (fbAlbumId, fbTabId, message) => {
    const fbKey = _navHandlerIdToKey(fbAlbumId);
    const tabKey = _navHandlerIdToKey(fbTabId);
    if (albumNavHandlers[fbKey] && albumNavHandlers[fbKey][tabKey]) {
        albumNavHandlers[fbKey][tabKey].forEach(handler => handler(message));
    }
};

const getCurrentTab = () => {
    return api.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs.length > 0) {
            return tabs[0];
        } else {
            throw new Error('No active tab found');
        }
    });
};

const visitUrl = (tabId, url) => {
    api.tabs.update(tabId, { url });
};

const waitForPageLoad = (tabId) => {
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
};

// callback takes one arg: tab
const withFacebookTab = (callback) => {
    // TODO: Create recyclable FB tab pool
    api.tabs.create({ url: "https://www.facebook.com/groups/feed/", active: false }, (newTab) => {
        function checkTabAndExecuteCallback(tabId, changeInfo, tab) {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
                supLog("Have FB tab", tab.id, { tab });
                callback(tab);
                api.tabs.onUpdated.removeListener(checkTabAndExecuteCallback);
            }
        }

        // Listen for the tab update to ensure it is fully loaded
        api.tabs.onUpdated.addListener(checkTabAndExecuteCallback);
    });
};

const gotoAlbum = (port, message) => {
    const { fbAlbumId } = message;
    port.postMessage({status: "pending"});
    withFacebookTab((tab) => {
        // The loadAlbumPage message handler in sup-fb.js cannot send a
        // response since the tab changes URLs and thus closes the
        // connection. Instead, we add an album nav handler which gets
        // called in the navComplete handler below (which is the handler
        // for the message that gets sent from the fb tab when it loads and
        // finds a post nav task).
        addAlbumNavHandler(fbAlbumId, tab.id, (message) => {
            supLog("Album nav handled. Notifying sonlet.js", {fbAlbumId, tab, message});
            port.postMessage({status: "complete", success: true, fbTabId: tab.id});
        });
        // TODO: add timeout that will do a port.postMessage({status: "complete", success: false});
        api.tabs.sendMessage(tab.id, {
            action: "loadAlbumPage",
            fbAlbumId,
            originalMessage: message,
        });
    });
};

// To keep track of tasks that need to be performed by a content
// script. Handy to perform tasks across a tab reload, for example.
// Content scripts need to send a message with
// action=checkForPostNavigationTask during initializiation to grab any
// pending task. We'll just pass back the original message that caused a
// pending task to be queued for the tab, so the content script should be
// able to pick up from where they left off.
let pendingTasks = new Map();

const changeUrl = (message, sender, sendResponse) => {
    const { url } = message;
    const tabId = sender.tab.id;
    sendResponse({status: "pending"});

    api.tabs.update(tabId, { url }).then(() => {
        pendingTasks.set(tabId, {
            type: "navigate",
            details: {
                originalMessage: message,
            },
        });

        function onUpdated(updatedTabId, changeInfo, tab) {
            if (updatedTabId === tabId && changeInfo.status === "complete") {
                api.tabs.onUpdated.removeListener(onUpdated);
                sendResponse({
                    status: "complete",
                    message: `Changed URL for tab ${tabId} to ${url}`,
                });
            }
        }
        api.tabs.onUpdated.addListener(onUpdated);
    }).catch(error => {
        supLog("Failed to update tab url", error);
    });
    return true;
};

const checkForPostNavigationTask = (message, sender, sendResponse) => {
    const tabId = sender.tab.id;
    if (pendingTasks.has(tabId)) {
        const task = pendingTasks.get(tabId);
        sendResponse({
            hasTask: true,
            task,
        });
        pendingTasks.delete(tabId);
    } else {
        sendResponse({ hasTask: false });
    }
    return false;
};

const navComplete = (message, sender, sendResponse) => {
    // HOLY PROXY ONION BATMAN D:
    const originalMessageOuterOuter = message.originalMessage;
    const originalMessageOuter = originalMessageOuterOuter.originalMessage;

    supLog("navComplete has outer", { originalMessageOuter });

    if (originalMessageOuter.action === "changeUrl") {
        const { postNav } = originalMessageOuter;
        const originalMessageInner = postNav.message.originalMessage;
        supLog("have", {originalMessageInner});
        if (originalMessageInner.action === "gotoAlbum") {
            runAlbumNavHandlers(originalMessageInner.fbAlbumId, sender.tab.id, originalMessageInner);
        }
    }

    return false;
};

const _forwardProxyMessage = (message, sender) => {
    const { requestId, destTabId, message: proxiedMessage } = message;
    api.tabs.sendMessage(destTabId, {
        action: "proxyReceive",
        requestId,
        proxiedMessage,
        originalSender: sender,
    });
};

const proxySend = (message, sender, sendResponse) => {
    _forwardProxyMessage(message, sender);
    return false;
};

// onMessage action handlers by name
const messageActions = {
    "changeUrl": changeUrl,
    "checkForPostNavigationTask": checkForPostNavigationTask,
    "navComplete": navComplete,
    "proxySend": proxySend,
};

// port names to port onMessage action handlers by name
const portRoutes = {
    "gotoAlbumChannel": {
        "gotoAlbum": gotoAlbum,
    },
};

function onMessage(message, sender, sendResponse) {
    supLog(`got message from ${sender.tab.id}`, message.action, message);
    const actionFn = messageActions[message.action];
    if (actionFn !== undefined) {
        return actionFn(message, sender, sendResponse);
    }
}

function onConnect(port) {
    supLog(`got connect for ${port.name} on port:`, port);
    const route = portRoutes[port.name];
    if (route === undefined)
        return;
    port.onMessage.addListener((message) => {
        supLog(`got message for ${port.name} on port`, {message, port});
        const actionFn = route[message.action];
        if (actionFn === undefined)
            return;
        actionFn(port, message);
    });
}

function init() {
    supLog("Init sup-background.js");
    api.runtime.onMessage.addListener(onMessage);
    api.runtime.onConnect.addListener(onConnect);
}

init();
