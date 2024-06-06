# Sonlet User Plus

Plus up yer Sonlet!

## Installation

Sonlet User Plus is available on the Chrome Web Store:

[![Chrome Web Store Badge](chrome-webstore-badge.png)](https://chromewebstore.google.com/detail/sonlet-user-plus/fffgbegeifgeemcbfochglhgpgnpdfig)

## Manual Installation

The recommended method for installing the browser extension is through the
Chrome Webstore or Firefox Add-Ons. However, it can also be installed
directly from this repository as an "unpacked extension".

To prepare the extension, first clone the repo and render the manifest for
your browser (Chrome or Firefox):

```
git clone https://github.com/directangular/Sonlet-User-Plus.git
cd Sonlet-User-Plus
make render_manifest_chrome  # or render_manifest_firefox for FF users
```

Once the manifest is rendered, the `src/` directory is ready for loading in
your browser. Using the "load unpacked extension" function of your
browser's add-ons manager, select the `src/` directory within your cloned
repo where you just ran the `make render_manifest_*` command.
