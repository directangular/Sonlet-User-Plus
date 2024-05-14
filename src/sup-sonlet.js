function init() {
    supLog("Init sup-sonlet.js");
    window.addEventListener("gotoAlbum", function(event) {
        supLog("GOT gotoAlbum EVENT!!!", event);
        browser.runtime.sendMessage({
            action: "gotoAlbum",
            albumId: event.detail.albumId,
        });
    });
}

init();
