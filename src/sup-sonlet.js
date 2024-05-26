const storage = new SUPStorage();
const messaging = new SUPMessaging(browser);

const getSUPContainer = () => $byId("id_SUPContainer");

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

const refreshAlbumsForGroup = (fbGroupId, {onSuccess, onFailure}) => {
    withFbGroupAlbumsTab(fbGroupId, {
        onSuccess: ({ fbTabId }) => {
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
                            } else {
                                supLog("Failed to post new albums", rsp);
                                addMessage(L_ERROR, `Failed to post new albums: ${rsp.statusText}`);
                                onFailure();
                            }
                        })
                        .catch(error => {
                            supLog("Error while posting new albums", error);
                            addMessage(L_ERROR, `Error posting new ablums: ${error}`);
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
    }, '*');
};

// Responds by sending a message to refreshAlbumsForFbGroupResults
const refreshAlbumsForFbGroup = (message, sender, sendResponse) => {
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

const navComplete = (message, sender, sendResponse) => {
    supLog("FIXMEEEEEEE NAV COMPLETE!!!", message, sender);
    // lots of message proxying :sob:
    const ogMessage = message.originalMessage.postNav.message.originalMessage;

    addMessage(L_SUCCESS, `Loaded album ${message.originalMessage.postNav.message.originalMessage.fbAlbumId}`);
};

/// *** END message handlers ***

/// *** BEGIN route handlers ***

let selectedItemPks = [];
let selectedAlbum = null;

const refreshPostButtonDisability = () => {
    $byId("id_SUPPostBtn").disabled = selectedItemPks.length === 0 || selectedAlbum === null;
};

const setSelectedItemPks = (itemPks) => {
    selectedItemPks = itemPks;
    $byId("id_SUPHeader").innerHTML = `${itemPks.length} items selected`;
    refreshPostButtonDisability();
};

const setSelectedAlbum = (album) => {
    selectedAlbum = album;
    refreshPostButtonDisability();
};

const updateGroupSelect = (fbGroups, initiallySelectedGroupId) => {
    const groupSelect = $byId("id_SUPGroupSelect");
    const placeHolderOption = fbGroups.length === 0
          ? '<option value="">No groups found... Please link some groups.</option>'
          : '<option value="">Select a group</option>';
    const newGroupOptions = fbGroups.map(group =>
        `<option value="${group.fbid}">${group.name}</option>`
    ).join('');
    groupSelect.innerHTML = placeHolderOption + newGroupOptions;
    if (initiallySelectedGroupId) {
        groupSelect.value = initiallySelectedGroupId;
    }
    groupSelect.disabled = fbGroups.length === 0;
};

const setupGroupSelectListener = (fbGroups) => {
    const groupSelect = $byId("id_SUPGroupSelect");
    const albumSelect = $byId("id_SUPAlbumSelect");
    const groupInfo = $byId("id_SUPGroupInfo");

    groupSelect.addEventListener("change", () => {
        const selectedGroup = fbGroups.find(group => group.fbid === groupSelect.value);
        if (!selectedGroup) {
            supLog("Couldn't find group", groupSelect.value, fbGroups);
            return;
        }

        groupInfo.innerHTML = `
<button class="btn btn-default" id="id_refreshAlbumsBtn" type="button">Refresh Albums</button>
Last albums refresh: ${selectedGroup.last_refreshed_albums || 'Never'}
`;

        $byId("id_refreshAlbumsBtn").addEventListener("click", () => {
            refreshAlbumsForGroup(selectedGroup);
        });

        albumSelect.innerHTML = selectedGroup.albums.map(album =>
            `<option value="${album.fbid}">${album.name}</option>`
        ).join('');
        albumSelect.disabled = selectedGroup.albums.length === 0;

        albumSelect.addEventListener("change", () => {
            supLog("album selection change", albumSelect, selectedGroup);
            const selectedAlbum = selectedGroup.albums.find(alb => alb.fbid === albumSelect.value);
            setSelectedAlbum(selectedAlbum);
        });
    });
};

const updatePostingUI = (fbGroups, initiallySelectedGroupId = null) => {
    updateGroupSelect(fbGroups, initiallySelectedGroupId);
    setupGroupSelectListener(fbGroups);
};

const initFbPickUI = (initiallySelectedGroupId = null) => {
    // Initialize the SUP container with the relevant UI
    getSUPContainer().innerHTML = `<div>
<div id="id_SUPHeader"></div>
<select id="id_SUPGroupSelect" class="form-control" disabled><option>...</option></select>
<div id="id_SUPGroupInfo"></div>
<select id="id_SUPAlbumSelect" class="form-control" disabled><option>...</option></select>
<button id="id_SUPPostBtn" class="btn btn-primary" type="button" disabled>Post</button>
</div>`;

    window.addEventListener("onSelectedItemPks", function(event) {
        supLog("GOT onSelectedItemPks EVENT!!!", event);
        setSelectedItemPks(event.detail.itemPks);
    });

    $byId("id_SUPPostBtn").addEventListener("click", () => {
        supLog("Would like to post!!!!", selectedItemPks, selectedAlbum);
        supFetch("/api/v2/get_item_images/", "POST", {item_pks: selectedItemPks})
            .then(async rsp => {
                if (!rsp.ok) {
                    supLog("Failed to get item images", rsp, selectedAlbum, selectedItemPks);
                    addMessage(L_ERROR, `Failed to get item images: ${rsp.statusText}`);
                    return;
                }
                const json = await rsp.json();
                supLog("Got item images", json, selectedAlbum, selectedItemPks);
                const imageUrls = json.results.map(info => info.image_url);
                const fbAlbumId = selectedAlbum.fbid;
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
            })
            .catch(error => {
                supLog("Error getting item images", error, selectedAlbum, selectedItemPks);
                addMessage(L_ERROR, `Error getting item images: ${error}`);
            });
    });

    supFetch("/api/v2/sup_get_groups_info/", "GET")
        .then(async rsp => {
            return [rsp, await rsp.json()];
        })
        .then(([rsp, json]) => {
            if (!rsp.ok) {
                addMessage(L_ERROR, `Couldn't load FB group info: ${json.message}`);
            } else {
                supLog("Got SUP groups info", json);
                updatePostingUI(json.results, initiallySelectedGroupId);
            }
        });
};

const routeListings = () => {
    supLog("routeListings!!!");
    initFbPickUI();
};
/// *** END route handlers ***

const routes = [{
    pathRegex: /\/inventory\/(listed|listings)\/.*/,
    handler: routeListings,
}];

// Runs the first route from routes that matches the current URL
const runRoutes = () => {
    const urlPath = window.location.pathname;
    for (let route of routes) {
        if (urlPath.match(route.pathRegex)) {
            route.handler();
            return;
        }
    }
};

function init() {
    supLogInit("SONLET");
    supLog("Init sup-sonlet.js");
    initMessageArea();
    messaging.init({
        actionListeners: [
            ["linkFbGroup", linkFbGroup],
            ["refreshAlbumsForFbGroup", refreshAlbumsForFbGroup],
            ["navComplete", navComplete],
        ],
        proxyActionListeners: [],
    });
    runRoutes();

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
                retrieveGroupAlbumsFromTab(fbTabId, fbGroupId)
                    .then(albums => supLog("Got albums from tab", fbTabId, fbGroupId, albums))
                    .catch(error => supLog("Error getting albums", error, fbTabId, fbGroupId));
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
