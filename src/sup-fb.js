const storage = new SUPStorage();
const messaging = new SUPMessaging(browser);

// Returns true if URL change was successfull
const changeUrl = async (url, postNav) => {
    try {
        const response = await browser.runtime.sendMessage({ action: "changeUrl", url, postNav });
        // If we're here it's because the changeUrl failed. If changeUrl
        // succeeds then we lose our execution state since the tab loaded a
        // new page. Any subsequent action needs to happen in the post
        // navigation callback (which receives postNav).
        supLog("Unknown error changing URL");
        return false;
    } catch (error) {
        supLog("Error changing URL", error);
        return false;
    }
};

const addImageToUploadQueue = async (file, caption) => {
    // Get the file input element and set the File object
    const fileInput = document.querySelector('input[type="file"]');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    // TODO: add caption

    // Trigger events to let Facebook know the input changed
    const event = new Event('change', { bubbles: true });
    fileInput.dispatchEvent(event);
};

/// *** BEGIN proxy message handlers ***

// We must already be on the album page
const proxyPostImages = (message, session) => {
    const { cachedFbImages, fbAlbumId } = message;
    session.sendProxyResponse({status: "pending", message: "(Starting)"});
    supLog(`Posting ${cachedFbImages.length} images to ${fbAlbumId}`);
    let results, btn;
    (async () => {
        // first, navigate to the upload screen
        const addBtnXpath = "//a[@aria-label='Add photos or videos']//span[contains(text(), 'Add photos or videos')]";
        results = findElementsByXpath(addBtnXpath);
        if (results.length !== 1) {
            supLog("WEIRD number of add btns found", results);
            return;
        }
        btn = results[0];
        supLog("Clicking", btn);
        btn.click();
        await sleep(1000);
        // Now add the images to the upload area
        for (const cachedFbImage of cachedFbImages) {
            const { handle, caption } = cachedFbImage;
            supLog("Grabbing from storage", handle);
            try {
                const file = await storage.getFile(handle);
            } catch (error) {
                session.sendProxyResponse({
                    status: "error",
                    message: `Error retrieving ${handle} from cache: ${error}`,
                });
                continue;
            }
            supLog("Got file", file);
            session.sendProxyResponse({
                status: "pending",
                message: `Adding ${file.name} to post queue`,
            });
            addImageToUploadQueue(file, caption);
            supLog("One down... Sleeping a bit for observation");
            await sleepWithJitter(1000);
        }
        supLog("All queued! Sleeping 2 more seconds before clicking post btn");
        await sleepWithJitter(2000);
        const postBtnXpath = "//div[@aria-label='Post']//span[text()='Post']";
        results = findElementsByXpath(postBtnXpath);
        supLog("Got results", results);
        if (results.length !== 1) {
            supLog("WEIRD number of post btns found", results);
            return;
        }
        btn = results[0];
        supLog("Clicking", btn);
        btn.click();

        session.sendProxyResponse({status: "complete", success: true, message: "Upload complete!"});
    })();
};

/// *** END proxy message handlers ***

/// *** BEGIN message handlers ***

const loadAlbumPage = (message, sender, sendResponse) => {
    const { fbAlbumId } = message;
    const url = albumUrl(fbAlbumId);
    sendResponse({status: "pending"});
    // The .then callback will NOT execute if we successfully
    // navigate to the url. If we successfully navigate then our postNav
    // object passed to changeUrl here will get picked up by the post nav
    // task handler mechanism.
    changeUrl(url, { message, sender })
        .catch((error) => sendResponse({status: "complete", success: false}));
    return true;
};

const loadGroupAlbumsPage = (message, sender, sendResponse) => {
    const { fbGroupId } = message;
    const url = groupAlbumsUrl(fbGroupId);
    sendResponse({status: "pending"});
    // The .then callback will NOT execute if we successfully
    // navigate to the url. If we successfully navigate then our postNav
    // object passed to changeUrl here will get picked up by the post nav
    // task handler mechanism.
    changeUrl(url, { message, sender })
        .catch((error) => sendResponse({status: "complete", success: false}));
    return true;
};

// Assumes we're already on the group admin edit page
const getFbGroupDetails = (message, sender, sendResponse) => {
    // Get the current URL and remove the trailing "/edit" or "/edit/" if present
    let groupUrl = window.location.href.replace(/\/edit\/?$/, "");

    // Create an XPath expression that matches an anchor element with the href attribute equal to the current URL or with a trailing slash
    const groupNameXpath = `//a[(normalize-space(@href)='${groupUrl}' or normalize-space(@href)='${groupUrl}/') and @role='link']`;

    // Use the $X helper function to find the element
    const elements = $X(groupNameXpath);

    let fbGroupName = "";
    if (elements.length > 0) {
        fbGroupName = elements[0].textContent.trim();
    }

    // Xpath escaping fiascos! fbGroupName needs to be escaped since it
    // could contain single quotes that will break the xpath (by
    // prematurely terminating the expression). We replace all single
    // quotes with a sequence of characters that look like comma-separate
    // arguments that will be passed to concat() in the xpath. The
    // arguments terminate the string, adds the desired single quote, and
    // re-opens the string.
    const fbGroupNameEscaped = fbGroupName.replace(/'/g, '", "\'", "');
    const pictureXpath = `//a[@aria-label=concat("${fbGroupNameEscaped}", '') and contains(normalize-space(@href), '${groupUrl}') and @role='link']//image/@*[local-name()='href']`;
    // const pictureXpath = `//a[@aria-label='${fbGroupName}' and contains(normalize-space(@href), '${groupUrl}') and @role='link']//image/@*[local-name()='href']`;
    const pictureElements = $X(pictureXpath);

    let pictureUrl = null;
    if (pictureElements.length > 0) {
        pictureUrl = pictureElements[0].nodeValue.trim(); // Fetching the URL from the attribute node
    }

    sendResponse({status: "complete", success: true, fbGroupName, pictureUrl});
};

/// *** END message handlers ***

/// *** BEGIN connection handlers ***

// Should be called from group albums page
const fetchAlbums = async (port, message) => {
    port.postMessage({"status": "pending"});

    try {
        await scrollToBottom();
    } catch (error) {
        supLog("Unable to scroll to bottom");
        port.postMessage({
            "status": "complete",
            "success": false,
            "message": "Unable to scroll to bottom of albums page",
        });
    }

    const albumLinksXPath = "//a[contains(@href, 'https://www.facebook.com/media/set/?set=oa.')]";
    const albumLinks = findElementsByXpath(albumLinksXPath);

    let albums = albumLinks.map(link => {
        let id = link.href.match(/set=oa\.(\d+)/)[1];
        let nameSpans = findElementsByXpath(".//span", link);
        let name = nameSpans.length > 0 ? nameSpans[0].textContent : "Unknown";

        return {
            name: name,
            id: id
        };
    });

    supLog("Collected albums", albums);
    port.postMessage({
        "status": "complete",
        "success": true,
        "albums": albums,
    });
};

/// *** END connection handlers ***

const executeTask = (task) => {
    supLog("Executing post navigation task", task);
    if (task.type === "navigate") {
        // hand-rolled "proxy" response required since we don't have a
        // persistent tab and thus can't use our proxy connection framework
        // from SUPMessaging (which connects two tabs).
        supLog("Sending proxy response back via background script");
        messaging.sendMessageToBackground("navComplete", { originalMessage: task.details })
            .catch((error) => addMessage(L_ERROR, "Failed to send navComplete proxy response"));
        return;
    }
};

const handlePostNavigationTasks = () => {
    // Check if there's a post-navigation task that needs to be executed
    messaging.sendMessageToBackground("checkForPostNavigationTask").then(response => {
        if (response.hasTask) {
            executeTask(response.task);
        }
    }).catch(error => {
        supLog("Error checking for post-navigation task", error);
    });
};

function init() {
    supLogInit("FB");
    supLog("Init sup-fb.js");
    initMessageArea();
    messaging.init({
        actionListeners: [
            ["loadAlbumPage", loadAlbumPage],
            ["loadGroupAlbumsPage", loadGroupAlbumsPage],
            ["getFbGroupDetails", getFbGroupDetails],
        ],
        proxyActionListeners: [
            ["postImages", proxyPostImages],
        ],
        connectionListeners: [
            [
                "fetchAlbumsChannel",
                {
                    actionListeners: [
                        ["fetchAlbums", fetchAlbums],
                    ],
                },
            ],
        ],
    });
    handlePostNavigationTasks();
}

init();
