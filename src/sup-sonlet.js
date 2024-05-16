const storage = new SUPStorage();
const messaging = new SUPMessaging(browser);

const withFbAlbum = (fbAlbumId, {onSuccess, onFailure, onStatus}) => {
    const port = browser.runtime.connect({name: "gotoAlbumChannel"});
    port.onMessage.addListener((msg) => {
        supLog("Got gotoAlbum ping", msg);
        if (msg.status === "complete") {
            if (msg.success) {
                onSuccess({fbTabId: msg.fbTabId});
            } else {
                onFailure(msg);
            }
            port.disconnect();
        } else {
            onStatus(msg);
        }
    });
    port.postMessage({action: "gotoAlbum", fbAlbumId});
};

const postImagesToFb = async (destTabId, fbAlbumId, imageUrls) => {
    const handles = [];
    for (const url of imageUrls) {
        try {
            const handle = await storage.storeUrlAsFile(url);
            addMessage(L_DEBUG, `Cached ${url}`);
            handles.push(handle);
        } catch (error) {
            addMessage(L_ERROR, `Error caching ${url}: ${error}`);
        }
    }

    const session = messaging.createSession(destTabId);
    session.onMessage.addListener((message) => {
        supLog("Got postImages ping", message);
        if (message.status === "complete") {
            if (message.success) {
                addMessage(L_SUCCESS, `Posted ${handles.length} images!`);
            } else {
                addMessage(L_ERROR, `Posting failed: ${message.message}`);
            }
        } else {
            addMessage(L_INFO, `Posting images: ${message.message || "..."}`);
        }
    });
    session.sendProxyMessage("postImages", {fbAlbumId, handles});
};

/// *** BEGIN proxy message handlers ***

/// *** END proxy message handlers ***

/// *** BEGIN message handlers ***

const navComplete = (message, sender, sendResponse) => {
    supLog("FIXMEEEEEEE NAV COMPLETE!!!", message, sender);
    // lots of message proxying :sob:
    const ogMessage = message.originalMessage.postNav.message.originalMessage;

    addMessage(L_SUCCESS, `Loaded album ${message.originalMessage.postNav.message.originalMessage.fbAlbumId}`);
};

/// *** END message handlers ***

function init() {
    supLogInit("SONLET");
    supLog("Init sup-sonlet.js");
    initMessageArea();
    messaging.init({
        actionListeners: [
            ["navComplete", navComplete],
        ],
        proxyActionListeners: [],
    });

    // For testing (TODO: break out similar to messageActions)
    window.addEventListener("gotoAlbum", function(event) {
        supLog("GOT gotoAlbum EVENT!!!", event);
        addMessage(L_INFO, `Loading album ${event.detail.fbAlbumId}`);
    });

    window.addEventListener("postImagesToFbAlbum", function(event) {
        supLog("GOT postImages EVENT!!!", event);
        const { imageUrls, fbAlbumId } = event.detail;
        withFbAlbum(fbAlbumId, {
            onSuccess: ({ fbTabId }) => {
                addMessage(L_INFO, `Loaded album ${fbAlbumId}`);
                addMessage(L_INFO, `Posting ${imageUrls.length} images`);
                postImagesToFb(fbTabId, fbAlbumId, imageUrls);
            },
            onFailure: (rsp) => {
                addMessage(L_ERROR, `Couldn't load album ${fbAlbumId}`);
            },
            onStatus: (rsp) => {
                addMessage(L_DEBUG, `Backend is loading album ${fbAlbumId}`);
            },
        });
    });
}

init();
