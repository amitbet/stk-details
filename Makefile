.PHONY: install dev dev-ui build package package-mac package-mac-portable package-win package-all clean

install:
	npm install

dev: dev-ui

dev-ui:
	VITE_PORT=$${VITE_PORT:-5173} npm run dev:ui

build:
	npm run build:ui

package: build
	npm run dist

package-mac: build
	npm run dist:mac

package-mac-portable: build
	npm run dist:mac:portable

package-win: build
	npm run dist:win

package-all: build
	npm run dist:all

clean:
	rm -rf dist dist-electron node_modules
