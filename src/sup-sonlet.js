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
        supLog("Got gotoGroupAlbums ping", msg);
        if (msg.status === "complete") {
            if (msg.success) {
                onSuccess({fbTabId: msg.fbTabId, previousTabId: msg.previousTabId});
            } else {
                onFailure(msg);
            }
            port.disconnect();
        } else {
            onStatus(msg);
        }
    });
    port.postMessage({action: "gotoGroupAlbums", fbGroupId, foreground: true});
};

const closeTab = (tabId, tabIdToRestore) => {
    supLog("Requesting tab closure and restoration", tabId, tabIdToRestore);
    messaging.sendMessageToBackground("closeTab", { tabId, tabIdToRestore }, (response) => {
        if (response.success) {
            supLog("Closed tab successfully", tabId);
        } else {
            supLog("Error closing tab", tabId, response);
        }
    });
};

const cacheImages = (imgUrls) => {
    return new Promise((resolve, reject) => {
        const port = browser.runtime.connect({name: "cacheImagesByUrlChannel"});
        port.onMessage.addListener((msg) => {
            if (msg.status === "complete") {
                port.disconnect();
                const msgSuffix = msg.failures.length > 0 ? ` (${msg.failures.length} failed)` : "";
                addMessage(L_DEBUG, `Cached ${imgUrls.length} images${msgSuffix}`);
                resolve({successes: msg.successes, failures: msg.failures});
            } else {
                if (msg.posted) {
                    addMessage(L_DEBUG, `Cached ${msg.posted}`);
                } else if (msg.failed) {
                    addMessage(L_ERROR, `Failed to cache ${msg.failed}`);
                } else {
                    supLog("Unknown message", msg);
                    addMessage(L_DEBUG, `Unknown message: ${msg}`);
                }
            }
        });
        port.postMessage({action: "cacheImagesByUrl", urls: imgUrls});
    });
};

// Must already be on the album page
const postImagesToFb = async (fbTabId, fbAlbumId, fbImages, {onSuccess, onFailure}) => {
    let cachedUrls = [];
    try {
        const results = await cacheImages(fbImages.map(fbi => fbi.url));
        cachedUrls = results.successes.map(s => s.url);
        if (results.failures.length > 0) {
            addMessage(L_ERROR, "Couldn't cache ${results.failures.length} images.");
        }
    } catch (error) {
        addMessage(L_ERROR, "Error caching images: ${error}");
        return;
    }

    let cachedFbImages = [];

    for (const fbi of fbImages) {
        if (cachedUrls.includes(fbi.url)) {
            cachedFbImages.push({handle: fbi.url, caption: fbi.caption});
        }
    }

    let failed = 0, succeeded = 0;
    const session = messaging.createSession(fbTabId);
    session.onMessage.addListener((message) => {
        supLog("Got postImages ping", message);
        if (message.status === "complete") {
            if (message.success) {
                const failSuffix = failed > 0 ? ` (${failed} failed)` : "";
                addMessage(L_SUCCESS, `Posted ${succeeded} images!${failSuffix}`);
                if (onSuccess)
                    onSuccess();
            } else {
                addMessage(L_ERROR, `Posting failed: ${message.message}`);
                if (onFailure)
                    onFailure(message);
            }
        } else {
            const lvl = message.status === "error" ? L_ERROR : L_INFO;
            addMessage(lvl, `Posting images: ${message.message || "..."}`);
            if (message.step === "cacheRetrieve") {
                if (message.status === "error")
                    failed++;
                else
                    succeeded++;
            }
        }
    });
    session.sendProxyMessage("postImages", {fbAlbumId, cachedFbImages});
};

const refreshAlbumsForGroup = (fbGroupId, {onSuccess, onFailure}) => {
    withFbGroupAlbumsTab(fbGroupId, {
        onSuccess: ({ fbTabId, previousTabId }) => {
            addMessage(L_INFO, `Loaded albums page for ${fbGroupId}`, fbTabId);
            retrieveGroupAlbumsFromTab(fbTabId, fbGroupId)
                .then(albums => {
                    supLog("Got some albums from tab", albums, fbTabId, fbGroupId);
                    // TODO: close fbTabId (maybe add arg to retrieveGroupAlbumsFromTab?)
                    supFetch("/api/v2/sup_link_fb_albums/", "POST", {
                        group_fbid: fbGroupId,
                        album_infos: albums,
                    })
                        .then(rsp => {
                            supLog("link albums response", rsp);
                            if (rsp.ok) {
                                onSuccess();
                                closeTab(fbTabId, previousTabId);
                            } else {
                                supLog("Failed to post new albums", rsp);
                                addMessage(L_ERROR, `Failed to post new albums: ${rsp.statusText}`);
                                onFailure();
                            }
                        })
                        .catch(error => {
                            supLog("Error while posting new albums", error);
                            addMessage(L_ERROR, `Error posting new albums: ${error}`);
                            onFailure();
                        });
                })
                .catch(error => {
                    supLog("Error getting albums from tab", error, fbTabId, fbGroupId);
                    onFailure();
                });
        },
        onFailure: (rsp) => {
            addMessage(L_ERROR, `Couldn't load albums page for ${fbGroupId}`);
            onFailure();
        },
        onStatus: (rsp) => {
            addMessage(L_DEBUG, `Backend is loading albums page for ${fbGroupId}`);
        },
    });
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
                    addMessage(L_SUCCESS, "Albums fetched!");
                    resolve(msg);
                } else {
                    addMessage(L_ERROR, "Failed to fetch albums");
                    reject(msg);
                }
            } else {
                console.error("Unknown message received", msg);
            }
        });
        port.postMessage({action: "fetchAlbums", fbTabId});
    });
};

const retrieveGroupAlbumsFromTab = async (fbTabId, fbGroupId) => {
    try {
        const results = await fetchAlbumsForTabFromBackend(fbTabId);
        supLog("Got album data", results);
        return results.albums;
    } catch (error) {
        supLog("Error fetching albums", error);
        return null;
    }
};

/// *** BEGIN proxy message handlers ***

/// *** END proxy message handlers ***

/// *** BEGIN message handlers ***

const linkFbGroup = (message, sender, sendResponse) => {
    // make api request to link group
    const { fbGroupId, fbGroupName, pictureUrl } = message;
    supFetch("/api/v2/sup_link_fb_group/", "POST", {
        fbid: fbGroupId,
        name: fbGroupName,
        picture_url: pictureUrl,
    })
        .then(async rsp => {
            supLog("Got sup_link_fb_group api rsp", rsp);
            return [rsp.ok, await rsp.json()];
        })
        .then(([ok, json]) => sendResponse({success: ok, data: {...json}}))
        .catch(error => sendResponse({success: false, error}));
    return true;
};

const reportRefreshResults = (success, message) => {
    // const evt = new CustomEvent("refreshAlbumsForFbGroupResults", {
    //     detail: { success, message }
    // });
    // window.dispatchEvent(evt);
    window.postMessage({
        action: "refreshAlbumsForFbGroupResults",
        success,
        message,
    }, "*");
};

const onPing = (message) => {
    window.postMessage({"action": "pong"}, "*");
};

// Responds by sending a message to refreshAlbumsForFbGroupResults
const onRefreshAlbumsForFbGroup = (message) => {
    const { fbGroupId } = message;
    refreshAlbumsForGroup(fbGroupId, {
        onSuccess: () => {
            reportRefreshResults(true, "Albums refreshed");
        },
        onFailure: () => {
            reportRefreshResults(false, "Failed to refresh albums");
        },
    });
};

const reportPostImagesToAlbumResulst = (success, message) => {
    window.postMessage({
        action: "postImagesToAlbumResults",
        success,
        message,
    }, "*");
};

// message params:
//   - fbAlbumId: the fbid of the album
//   - fbImages: an array of the form:
// [{
//     "url": "...",
//     "caption": "...",
// }, ...]
const onPostImagesToAlbum = (message) => {
    const { fbAlbumId, fbImages } = message;
    const cnt = fbImages.length;
    const imagesPlural = "image" + (cnt === 1 ? "" : "s");
    withFbAlbumTab(fbAlbumId, {
        onSuccess: ({ fbTabId }) => {
            addMessage(L_INFO, `Loaded album ${fbAlbumId}`);
            addMessage(L_INFO, `Posting ${cnt} ${imagesPlural}`);
            postImagesToFb(fbTabId, fbAlbumId, fbImages, {
                onSuccess: () => {
                    reportPostImagesToAlbumResulst(true, `Posted ${cnt} ${imagesPlural}`);
                },
                onFailure: (error) => {
                    reportPostImagesToAlbumResulst(false, `Posting failed: ${error.message}`);
                },
            });
        },
        onFailure: (rsp) => {
            addMessage(L_ERROR, `Couldn't load album ${fbAlbumId}`);
        },
        onStatus: (rsp) => {
            addMessage(L_DEBUG, `Backend is loading album ${fbAlbumId}`);
        },
    });
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
        windowEventListeners: [
            ["ping", onPing],
            ["refreshAlbumsForFbGroup", onRefreshAlbumsForFbGroup],
            ["postImagesToAlbum", onPostImagesToAlbum],
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
        // fbImage needs .url and .caption (just slam the url in there as a
        // placeholder)
        const fbImages = imageUrls.map(url => ({"url": url, "caption": url}));
        withFbAlbumTab(fbAlbumId, {
            onSuccess: ({ fbTabId }) => {
                addMessage(L_INFO, `Loaded album ${fbAlbumId}`);
                addMessage(L_INFO, `Posting ${imageUrls.length} images`);
                postImagesToFb(fbTabId, fbAlbumId, fbImages);
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
            onSuccess: ({ fbTabId, previousTabId }) => {
                addMessage(L_INFO, `Loaded albums page for ${fbGroupId}`, fbTabId);
                retrieveGroupAlbumsFromTab(fbTabId, fbGroupId)
                    .then(albums => supLog("Got albums from tab", fbTabId, fbGroupId, albums))
                    .catch(error => supLog("Error getting albums", error, fbTabId, fbGroupId));
                closeTab(fbTabId, previousTabId);
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
