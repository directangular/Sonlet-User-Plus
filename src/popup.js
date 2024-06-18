const messaging = new SUPMessaging(browser);

const addMessage = (message) => {
    document.getElementById("id_content").innerHTML += `<div>${message}</div>`;
};

const setLoading = (loading) => {
    if (loading)
        setCTA("Loading...");
};

let onLogoClick = () => {};

const getLogo = () => document.getElementById("id_logo");
const getCTA = () => document.getElementById("id_cta");

const setLogoFilter = (filter) => getLogo().style.filter = filter;
const setLogoActive = (active) => {
    if (active)
        getLogo().classList.add("active");
    else
        getLogo().classList.remove("active");
};
const setLogoSrc = (url) => getLogo().src = url;
const setTitle = (title) => document.getElementById("id_header").innerHTML = title;
const setCTA = (cta) => getCTA().innerHTML = cta;
const setLogoClickHandler = (onClick) => onLogoClick = onClick;

const activateUI = (title, cta, onClick) => {
    console.log("activating UI");
    setLogoActive(true);
    setTitle(title);
    setCTA(cta);
    setLogoClickHandler(onClick);
};

const deactivateUI = () => {
    console.log("deactivating UI");
    setLogoActive(false);
    setTitle("");
    setCTA("Nothing to do here! Please visit the admin Group Settings page of a group you'd like to link to Sonlet.");
    setLogoClickHandler(() => {});
};

const enableCongratsMode = (fbGroupName) => {
    const logo = getLogo();
    logo.src = "icons/congrats-128x128.png"
    logo.style.border = "none";
    setCTA(`${fbGroupName} is linked to Sonlet!`);
    const cta = getCTA();
    cta.classList.add("success");
};

const onSendToSonletClick = async (event, details) => {
    console.log("onSendToSonletClick", details, event);
    // const logo = event.target;
    const { fbGroupId, fbGroupName, pictureUrl } = details;

    addMessage(`Sending group info for ${fbGroupName} (${fbGroupId}) to Sonlet...`);
    const rsp = await messaging.sendMessageToBackground("linkFbGroup", {
        fbGroupId, fbGroupName, pictureUrl,
    });
    supLog("Got link rsp", rsp);
    if (rsp.success) {
        addMessage("Done!");
        enableCongratsMode(fbGroupName);
    } else {
        const errMsg = rsp?.data?.message ?? "Unknown error";
        addMessage(`Failed to link group: ${errMsg}`);
    }
};

const loadGroupDetails = async (fbGroupId) => {
    const rsp = await messaging.sendMessageToBackground("getFbGroupDetailsOfCurrentTab");
    supLog("GOT FB DEETS", rsp);
    if (rsp && rsp.success === true) {
        return {
            fbGroupId,
            fbGroupName: rsp.fbGroupName,
            pictureUrl: rsp.pictureUrl,
        };
    }
    return null;
};

// each route should contain the following properties:
//  - regex: for matching the current page
//  - loadDetails: async function that loads details to be passed to the following:
//  - title: (details) => and returns a title string
//  - cta: (details) => returns a cta string
//  - clickHandler: (details) => returns a function to be used as the logo
//                  click handler (i.e. one that takes (event))
const routes = [{
    regex: /https:\/\/www.facebook.com\/groups\/(.*)\/edit/,
    loadDetails: (matches) => loadGroupDetails(matches[1]),
    title: (details) => `${details.fbGroupName} (ID: ${details.fbGroupId})`,
    cta: (details) => `Looks like you admin this group. Click above to link this group to your Sonlet account!`,
    clickHandler: (details) => (event) => onSendToSonletClick(event, details),
}];

// Runs the action associated with any matching routes
const checkRoutes = () => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const currentTabUrl = tabs[0].url;
        let matched = false;

        for (let route of routes) {
            const matches = currentTabUrl.match(route.regex);
            if (matches) {
                matched = true;
                setLoading(true);
                route.loadDetails(matches).then((details) => {
                    setLoading(false);
                    if (!details) {
                        supLog("Error getting group details");
                        return;
                    }
                    activateUI(
                        route.title(details),
                        route.cta(details),
                        route.clickHandler(details),
                    );
                });
                break; // stop after first match
            }
        }
        if (!matched) {
            deactivateUI();
        }
    });
};

const init = () => {
    supLogInit("FB");
    supLog("Init popup.js");
    checkRoutes();
    document.getElementById("id_logo").addEventListener("click", (event) => {
        console.log("Logo click!", event);
        onLogoClick(event);
    });
};

init();
