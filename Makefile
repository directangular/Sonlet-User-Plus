NAME = sonlet-user-plus
VERSION = 1.3
ZIP = zip --quiet

render_manifest_chrome: manifest.template.chrome.json
	VERSION=$(VERSION) envsubst < manifest.template.chrome.json > src/manifest.json

render_manifest_firefox: manifest.template.firefox.json
	VERSION=$(VERSION) envsubst < manifest.template.firefox.json > src/manifest.json

build_firefox: render_manifest_firefox
	mkdir -pv build
	rm -f build/$(NAME)-$(VERSION)_firefox.zip
	cd src && $(ZIP) -r ../build/$(NAME)-$(VERSION)_firefox.zip *
	@echo "Built package: build/$(NAME)-$(VERSION)_firefox.zip"

build_chrome: render_manifest_chrome
	mkdir -pv build
	rm -f build/$(NAME)-$(VERSION)_chrome.zip
	cd src && $(ZIP) -r ../build/$(NAME)-$(VERSION)_chrome.zip *
	@echo "Built package: build/$(NAME)-$(VERSION)_chrome.zip"

build: build_firefox build_chrome
