let _supSuffix = "common";

const supLogInit = (suffix) => _supSuffix = suffix;

// const supLog = (...args) => console.log(`[SUP-${_supSuffix}]`, ...args);
const supLog = (...args) => {
    // All this stack stuff is to get the location of the actual supLog invocation
    const stack = new Error().stack;
    const callerLine = stack.split("\n")[2]; // This gets the second line of the stack trace, where the first line is the Error itself
    const formattedCallerLine = callerLine.substring(callerLine.indexOf("at ") + 3, callerLine.length);

    console.log(`[SUP-${_supSuffix}]`, ...args, `\n -> at ${formattedCallerLine}`);
};

const albumUrl = (albumId) => `https://www.facebook.com/media/set/?set=oa.${albumId}&type=3`;
const groupAlbumsUrl = (groupId) => `https://www.facebook.com/groups/${groupId}/media/albums`;

const getRandomNumber = (min, max) => Math.random() * (max - min) + min;

const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

// Sleep with "jitter" (1-3 seconds by default)
const sleepWithJitter = async (sleepMs, jitterMinMs = 1000, jitterMaxMs = 3000) => {
    await sleep(sleepMs);
    await sleep(getRandomNumber(jitterMinMs, jitterMaxMs));
};

const filenameFromUrl = (url) => {
    // Use a URL object to manage parsing
    const parsedUrl = new URL(url);

    // Get the pathname part of the URL, which includes the filename
    const pathname = parsedUrl.pathname;

    // Extract the filename by taking the last segment after the last '/'
    return pathname.substring(pathname.lastIndexOf('/') + 1);
};

// wrap fetch to include auth headers, etc
const supFetch = (url, method, data) => {
    const options = {
        method: method,
        headers: {
            "content-type": "application/json",
            "X-CSRFToken": Cookies.get("str-csrftoken"),
        },
        body: JSON.stringify(data),
    };
    return fetch(url, {
        credentials: "same-origin",
        ...options,
    });
};

class SUPStorage {
    constructor() {}

    // Returns a storage handle
    async storeUrlAsFile(imageUrl, filename, options = {}) {
        try {
            const isCached = await this.isImageCached(imageUrl);
            if (isCached) {
                supLog(`Already cached: ${imageUrl}`);
                return imageUrl;
            }

            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Network response was not ok for ${imageUrl}`);
            }
            const blob = await response.blob();
            const mimeType = options.type || blob.type;
            const fileData = {
                url: imageUrl,
                blob,
                mimeType,
                filename: filename || filenameFromUrl(imageUrl),
            };

            const db = await this._openIndexedDB();
            const txn = db.transaction("images", "readwrite");
            const store = txn.objectStore("images");
            store.put(fileData);

            return new Promise((resolve, reject) => {
                txn.oncomplete = () => resolve(imageUrl);
                txn.onerror = (event) => reject(event.target.error);
            });
        } catch (error) {
            supLog('Failed to store image:', error);
            throw error;
        }
    }

    async getFile(handle) {
        try {
            const db = await this._openIndexedDB();
            const txn = db.transaction("images", "readonly");
            const store = txn.objectStore("images");

            return new Promise((resove, reject) => {
                const request = store.get(handle);

                request.onsuccess = (event) => {
                    const result = event.target.result;
                    if (result) {
                        const file = new File([result.blob], result.filename, { type: result.type });
                        resolve(file);
                    } else {
                        reject(new Error(`No file found for handle: ${handle}`));
                    }
                };

                request.onerror = (event) => {
                    reject(event.target.error);
                };
            });
        } catch (error) {
            supLog('Failed to retrieve file:', handle, error);
            throw error;
        }
    }

    async isImageCached(imageUrl) {
        try {
            const db = await this._openIndexedDB();
            const txn = db.transaction("images", "readonly");
            const store = txn.objectStore("images");
            const request = store.get(imageUrl);
            return new Promise((resolve, reject) => {
                request.onsuccess = (event) => resolve(!!event.target.result);
                request.onerror = (event) => reject(event.target.error);
            });
        } catch (error) {
            supLog(`Failed to check if image is cached:`, error);
            throw error;
        }
    }

    _openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("ImageDatabase", 1);

            request.onupgradeneeded = function(event) {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images', { keyPath: 'url' });
                }
            };

            request.onsuccess = function(event) {
                resolve(event.target.result);
            };

            request.onerror = function(event) {
                reject(event.target.error);
            };
        });
    }
}

/// SUPMessaging - class to encapsulate message handling, including support
/// for tab-to-tab communication (by way of a proxy via the background
/// script).
///
/// In order for proxy messaging to work, the background script needs to
/// install a handler for "proxySend", which forwards the message to the
/// indicated destination tab, like so:
///
///     _forwardProxyMessage(message, sender) {
///         const { requestId, destTabId, message: proxiedMessage } = message;
///         this.api.tabs.sendMessage(destTabId, {
///             action: "proxyReceive",
///             requestId,
///             proxiedMessage,
///             originalSender: sender,
///         });
///     }
class SUPMessaging {
    constructor(api) {
        this.api = api;
        this.requestIdCounter = 0;

        // Map of requestId -> listeners array
        this._sessionListeners = {};
        // {actionName: handlerFn}
        this._actionListeners = {};
        // {actionName: handlerFn}
        this._windowEventListeners = {};
        // {proxyActionName: handlerFn}
        this._proxyActionListeners = {};
        // {channelName: {actionName: handlerFn}}
        this._connectionChannelListeners = {};
    }

    // actionListeners - [[actionName, actionHandlerFn], ...]
    // windowEventListeners - [[actionName, actionHandlerFn]]
    // proxyListeners - [[actionName, actionHandlerFn], ...]
    // connectionListeners - [channelName, [[actionName, actionHandlerFn], ...], ...]
    init(options) {
        const {
            actionListeners,
            windowEventListeners,
            proxyActionListeners,
            connectionListeners,
        } = options;
        if (actionListeners !== undefined) {
            for (const actionListener of actionListeners) {
                const [ action, listener ] = actionListener;
                this._actionListeners[action] = listener;
            }
        }
        if (windowEventListeners !== undefined) {
            for (const windowEventListener of windowEventListeners) {
                const [ action, listener ] = windowEventListener;
                this._windowEventListeners[action] = listener;
            }
        }
        if (proxyActionListeners !== undefined) {
            for (const proxyActionListener of proxyActionListeners) {
                const [ proxyAction, listener ] = proxyActionListener;
                this._proxyActionListeners[proxyAction] = listener;
            }
        }
        if (connectionListeners !== undefined) {
            for (const connectionListener of connectionListeners) {
                const [ channelName, channelInfo ] = connectionListener;
                const { actionListeners } = channelInfo;
                if (actionListeners !== undefined) {
                    this._connectionChannelListeners[channelName] = {};
                    for (const channelActionListener of actionListeners) {
                        const [ actionName, listener ] = channelActionListener;
                        this._connectionChannelListeners[channelName][actionName] = listener;
                    }
                }
            }
        }
        this.api.runtime.onMessage.addListener(this._handleReceive.bind(this));
        this.api.runtime.onConnect.addListener(this._handleConnect.bind(this));
        window.addEventListener("message", this._handleWindowEventMessage.bind(this));
    }

    // Callers can listen for responses on the returned promise.
    sendMessageToBackground(action, message = {}) {
        message.action = action;
        return this.api.runtime.sendMessage(message);
    }

    createSession(destTabId) {
        const requestId = `${destTabId}-${this.requestIdCounter++}`;
        this._sessionListeners[requestId] = [];

        return {
            sendProxyMessage: (action, message) => {
                message.action = action;
                this.api.runtime.sendMessage({
                    destTabId,
                    action: "proxySend",
                    requestId,
                    message,
                });
            },
            onMessage: {
                // listener call signature: (message, session)
                addListener: (listener) => {
                    this._sessionListeners[requestId].push(listener);
                },
            },
        };
    }

    _connectProxySession(message) {
        const { requestId } = message;
        return {
            sendProxyResponse: (response) => {
                this.api.runtime.sendMessage({
                    destTabId: message.originalSender.tab.id,
                    action: "proxySend",
                    requestId,
                    message: response,
                });
            },
            onMessage: {
                addListener: (listener) => {
                    this._sessionListeners[requestId].push(listener);
                },
            },
        };
    }

    // called by content scripts on proxyReceive to trigger listeners
    _handleProxyReceive(message) {
        supLog("_handleProxyReceive", { message });

        const { requestId, proxiedMessage, originalSender } = message;

        // Trigger listeners. If this message is associated with a
        // connected proxy session with registered listeners then call
        // them. Otherwise it might be a global (non-session) proxy message
        // that should be routed to the appropriate proxy action handler.
        const session = this._connectProxySession(message);
        const listeners = this._sessionListeners[requestId];
        if (listeners) {
            supLog("Itz a sesh with registered listeners", requestId);
            listeners.forEach(listener => listener(proxiedMessage, session));
        } else {
            supLog("Ain't no registered listeners", proxiedMessage.action, this._proxyActionListeners);
            // No registered listeners. Call any associated top-level proxy
            // action listener.
            const actionFn = this._proxyActionListeners[proxiedMessage.action];
            if (actionFn !== undefined) {
                actionFn(proxiedMessage, session);
            }
        }
    }

    // called by content and background scripts to trigger action listeners
    _handleReceive(message, sender, sendResponse) {
        supLog("_handleReceive", { message, sender, sendResponse }, this._actionListeners);
        if (message.action === "proxyReceive") {
            this._handleProxyReceive(message);
            // No need to maintain return value since sendResponse
            // doesn't work through the proxy session.
            return false;
        }
        const actionFn = this._actionListeners[message.action];
        if (actionFn !== undefined) {
            // Pass along return value so that clients can make use of
            // sendResponse
            return actionFn(message, sender, sendResponse);
        } else {
            supLog("Unhandled message", message.action, Object.keys(this._actionListeners));
        }
        return false;
    }

    _handleWindowEventMessage(event) {
        if (event.source === window) {
            const actionFn = this._windowEventListeners[event.data.action];
            if (actionFn !== undefined) {
                supLog("_handleWindowEventMessage", { event }, this._windowEventListeners);
                return actionFn(event.data, event);
            }
        }
    }

    _handleConnect(port, message) {
        supLog("_handleConnect", { port, message }, this._connectionChannelListeners);
        const channelActions = this._connectionChannelListeners[port.name];
        if (channelActions === undefined)
            return;
        port.onMessage.addListener((message) => {
            supLog(`got message for ${port.name}`, {message, port, channelActions});
            const actionFn = channelActions[message.action];
            if (actionFn === undefined)
                return;
            actionFn(port, message);
        });
    }
}
