NAME="sonlet-user-plus"
VERSION=1.0

render_manifest_chrome: src/manifest.template.chrome.json
	VERSION=$(VERSION) envsubst < src/manifest.template.chrome.json > src/manifest.json

render_manifest_firefox: src/manifest.template.firefox.json
	VERSION=$(VERSION) envsubst < src/manifest.template.firefox.json > src/manifest.json

build_firefox: render_manifest_firefox
	mkdir -pv build
	rm -f build/$(NAME)-$(VERSION)_firefox.zip
	cd src && zip -r ../build/$(NAME)-$(VERSION)_firefox.zip *

build_chrome: render_manifest_chrome
	mkdir -pv build
	rm -f build/$(NAME)-$(VERSION)_chrome.zip
	cd src && zip -r ../build/$(NAME)-$(VERSION)_chrome.zip *

build: build_firefox build_chrome
