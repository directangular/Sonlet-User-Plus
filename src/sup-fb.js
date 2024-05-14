async function changeUrl(url) {
    try {
        const response = await browser.runtime.sendMessage({ action: "changeUrl", url });
        supLog("Response from background:", response.message);
    } catch (error) {
        supLog("Error changing URL", error);
    }
}

async function loadAlbumPage(message, sender, sendResponse) {
    supLog("loadAlbumPage", message);
    const { albumId } = message;
    const url = albumUrl(albumId);
    try {
        await changeUrl(url);
    } catch (error) {
        supLog("Couldn't change URL to ", url);
    }
}

const messageActions = {
    "loadAlbumPage": loadAlbumPage,
};

function onMessage(message, sender, sendResponse) {
    supLog("[FB] got message", message);
    const actionFn = messageActions[message.action];
    if (actionFn !== undefined) {
        actionFn(message, sender, sendResponse);
    }
}

function init() {
    supLog("Init sup-fb.js");
    browser.runtime.onMessage.addListener(onMessage);
}

init();
