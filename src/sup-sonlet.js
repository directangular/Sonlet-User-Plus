const storage = new SUPStorage();
const messaging = new SUPMessaging(browser);

const withFbAlbumTab = (fbAlbumId, {onSuccess, onFailure, onStatus}) => {
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

const withFbGroupAlbumsTab = (fbGroupId, {onSuccess, onFailure, onStatus}) => {
    const port = browser.runtime.connect({name: "gotoGroupChannel"});
    port.onMessage.addListener((msg) => {
        supLog("Got gotoGroup ping", msg);
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
    port.postMessage({action: "gotoGroup", fbGroupId});
};

const postImagesToFb = async (fbTabId, fbAlbumId, imageUrls) => {
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

    const session = messaging.createSession(fbTabId);
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

const fetchAlbumsForTabFromBackend = (fbTabId) => {
    return new Promise((resolve, reject) => {
        const port = browser.runtime.connect({name: "fetchAlbumsChannel"});
        port.onMessage.addListener((msg) => {
            if (msg.status === "pending") {
                addMessage(L_DEBUG, "Fetching albums...");
            } else if (msg.status === "complete") {
                port.disconnect();
                if (msg.success) {
                    resolve(msg);
                } else {
                    reject(msg);
                }
            } else {
                console.error("Unknown message received", msg);
            }
        });
        port.postMessage({action: "fetchAlbums", fbTabId});
    });
};

const refreshAlbums = async (fbTabId, fbGroupId) => {
    try {
        const results = await fetchAlbumsForTabFromBackend(fbTabId);
        supLog("Got album data", results);
        addMessage(L_SUCCESS, `Fetched ${results.albums.length} albums from group ${fbGroupId}!`);
        for (const album of results.albums) {
            addMessage(L_DEBUG, `Album: ${album.name} | ID: ${album.id}`);
        }
    } catch (error) {
        supLog("Error fetching albums", results);
        addMessage(L_ERROR, `Error fetching albums: ${error.message}`);
    }
};

/// *** BEGIN proxy message handlers ***

/// *** END proxy message handlers ***

/// *** BEGIN message handlers ***

const linkFbGroup = (message, sender, sendResponse) => {
    // make api request to link group
    const { fbGroupId, fbGroupName, pictureUrl } = message;
    supFetch("/api/v2/link_fb_group/", {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({
            fbid: fbGroupId,
            name: fbGroupName,
            picture_url: pictureUrl,
        }),
    })
        .then(async rsp => {
            supLog("Got link_fb_group api rsp", rsp);
            return [rsp.ok, await rsp.json()];
        })
        .then(([ok, json]) => sendResponse({success: ok, data: {...json}}))
        .catch(error => sendResponse({success: false, error}));
    return true;
};

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
            ["linkFbGroup", linkFbGroup],
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
        withFbAlbumTab(fbAlbumId, {
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

    window.addEventListener("fetchAlbumsForGroup", function(event) {
        supLog("GOT fetchAlbumsForGroup EVENT!!!", event);
        const { fbGroupId } = event.detail;
        withFbGroupAlbumsTab(fbGroupId, {
            onSuccess: ({ fbTabId }) => {
                addMessage(L_INFO, `Loaded albums page for ${fbGroupId}`, fbTabId);
                refreshAlbums(fbTabId, fbGroupId);
            },
            onFailure: (rsp) => {
                addMessage(L_ERROR, `Couldn't load albums page for ${fbGroupId}`);
            },
            onStatus: (rsp) => {
                addMessage(L_DEBUG, `Backend is loading albums page for ${fbGroupId}`);
            },
        });
    });
}

init();
