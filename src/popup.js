// Polyfill to standardize the browser API for both Chrome and Firefox
const api = typeof browser === 'undefined' ? chrome : browser;

const addMessage = (message) => {
    document.getElementById("id_content").innerHTML += `<div>${message}</div>`;
};

const fetchAlbumData = () => {
    return new Promise((resolve) => {
        const port = api.runtime.connect({name: "popupChannel"});
        port.onMessage.addListener((msg) => {
            if (msg.status === "pending") {
                addMessage("Fetching albums...");
            } else if (msg.status === "complete") {
                resolve(msg);
                port.disconnect();
            } else {
                console.error("Unknown message received", msg);
            }
        });
        port.postMessage({action: "fetchAlbums"});
    });
};

const handleAlbumsPage = async () => {
    const results = await fetchAlbumData();
    console.log("Got album data", results);
    addMessage("Album data fetched!");
    for (const album of results.albums) {
        addMessage(`Album: ${album.name} | ID: ${album.id}`);
    }
};

const routes = [
    {
        regex: /https:\/\/www.facebook.com\/groups\/(.*)\/media\/albums/,
        action: handleAlbumsPage,
    }
];

// Runs the action associated with any matching routes
const checkRoutes = () => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const currentTabUrl = tabs[0].url;
        let matched = false;

        for (let route of routes) {
            if (currentTabUrl.match(route.regex)) {
                route.action();
            }
        }
    });
};

const init = () => {
    checkRoutes();
};

init();
