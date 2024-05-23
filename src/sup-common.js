let _supSuffix = "common";

const supLogInit = (suffix) => _supSuffix = suffix;

const supLog = (...args) => console.log(`[SUP-${_supSuffix}]`, ...args);

const albumUrl = (albumId) => `https://www.facebook.com/media/set/?set=oa.${albumId}&type=3`;
const groupUrl = (groupId) => `https://www.facebook.com/groups/${groupId}/media/albums`;

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

class SUPStorage {
    constructor() {}

    // Returns a storage handle
    async storeUrlAsFile(imageUrl, filename, options = {}) {
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Network response was not ok for ${imageUrl}`);
            }
            const blob = await response.blob();
            const base64 = await this._blobToBase64(blob);
            const type = options.type || blob.type;
            const fileData = {
                base64,
                type,
                filename: filename || filenameFromUrl(imageUrl),
            };

            await browser.storage.local.set({ [imageUrl]: fileData });
            return imageUrl;
        } catch (error) {
            supLog('Failed to store image:', error);
            throw error;
        }
    }

    async getFile(handle) {
        const result = await browser.storage.local.get(handle);
        if (result[handle]) {
            const { base64, type, filename } = result[handle];
            return this._base64ToFile(base64, filename, type);
        }
        return null;
    }

    async _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    _base64ToFile(base64, filename, type) {
        const arr = base64.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new File([u8arr], filename, { type: type || mime });
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
        // {proxyActionName: handlerFn}
        this._proxyActionListeners = {};
        // {channelName: {actionName: handlerFn}}
        this._connectionChannelListeners = {};
    }

    // actionListeners - [[actionName, actionHandlerFn], ...]
    // proxyListeners - [[actionName, actionHandlerFn], ...]
    // connectionListeners - [channelName, [[actionName, actionHandlerFn], ...], ...]
    init(options) {
        const { actionListeners, proxyActionListeners, connectionListeners } = options;
        if (actionListeners !== undefined) {
            for (const actionListener of actionListeners) {
                const [ action, listener ] = actionListener;
                this._actionListeners[action] = listener;
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
    }

    // Callers can listen for responses on the returned promise.
    sendMessage(action, message = {}) {
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
        }
        return false;
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
