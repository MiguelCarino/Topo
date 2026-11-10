# Topo server build. Pure Go (CGO_ENABLED=0, modernc.org/sqlite), so every
# target cross-compiles. Pre-release versions: 0.0.<number of commits>.
# The build is the short commit, with "-dirty" for uncommitted changes.
VERSION := 0.0.$(shell git rev-list --count HEAD 2>/dev/null || echo 0)
BUILD := $(shell git describe --always --dirty 2>/dev/null)
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.build=$(BUILD)
BUILDFLAGS := -trimpath -ldflags "$(LDFLAGS)"
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64

export CGO_ENABLED := 0
# The SQLite package is large: at most four compile jobs at once, so a build
# stays well inside a shared machine's memory (amendment D6).
export GOFLAGS := -p=4

.PHONY: stage build test vet cross container container-run dev e2e clean

# The app the binary embeds: desktop/stage.sh's web stage (byte for byte the
# website's files, the offline zip's allow-list) into web/dist.
stage:
	../desktop/stage.sh web/dist
	@touch web/dist/.gitkeep

build: stage
	go build $(BUILDFLAGS) -o dist/topo-server ./cmd/topo-server

# The race detector needs cgo; the binary does not. Without a C compiler the
# plain run is the gate and the race run is skipped (said so).
test:
	go test ./...
	@if command -v cc >/dev/null 2>&1; then \
		CGO_ENABLED=1 go test -race ./...; \
	else echo "no C compiler: the -race run was skipped"; fi

vet:
	go vet ./...
	GOOS=darwin go vet ./...
	GOOS=windows go vet ./...

# One target after another, never in parallel.
cross: stage
	@for p in $(PLATFORMS); do \
		os=$${p%/*}; arch=$${p#*/}; ext=; [ $$os = windows ] && ext=.exe; \
		echo "build $$os/$$arch"; \
		GOOS=$$os GOARCH=$$arch go build $(BUILDFLAGS) -o dist/topo-server-$$os-$$arch$$ext ./cmd/topo-server || exit 1; \
	done

clean:
	rm -rf dist
	find web/dist -mindepth 1 ! -name .gitkeep -exec rm -rf {} + 2>/dev/null || true

# Container image (podman first; CONTAINER=docker works too). The build
# context is the repository root, so the image stages the app itself;
# Containerfile.dockerignore lets in only what the build needs. docker
# format keeps the HEALTHCHECK.
CONTAINER ?= podman
IMAGE ?= localhost/topo-server
# podman and buildah take the ignore file and the format by flag; docker has
# neither flag, reads Containerfile.dockerignore by name and keeps the
# HEALTHCHECK anyway.
PODMANLIKE := $(filter podman buildah,$(notdir $(CONTAINER)))
FORMAT := $(if $(PODMANLIKE),--format docker --ignorefile Containerfile.dockerignore,)

container:
	$(CONTAINER) build $(FORMAT) -f Containerfile \
		--build-arg VERSION=$(VERSION) --build-arg BUILD=$(BUILD) \
		-t $(IMAGE):$(VERSION) -t $(IMAGE):latest ..

# A trial on 127.0.0.1:7380 with a named volume and mail to the log. The
# port is published on loopback only: plain http must not reach the LAN.
# Stop it with "$(CONTAINER) rm -f topo-server".
container-run:
	$(CONTAINER) run -d --name topo-server -p 127.0.0.1:7380:7380 -v topo-data:/data \
		-e TOPO_PUBLIC_URL=http://127.0.0.1:7380 -e TOPO_MAIL=log $(IMAGE):latest

# Development: stage into a temporary folder and serve it from there (never
# from the repository), mail to files in a temporary data folder, port 7381.
DEV_PORT ?= 7381
dev:
	@d=$$(mktemp -d); s=$$(mktemp -d); \
	../desktop/stage.sh $$s/app && \
	echo "data: $$d   app: $$s/app   mail: $$d/mail" && \
	TOPO_DATA=$$d TOPO_STATIC=$$s/app TOPO_MAIL=file TOPO_LISTEN=127.0.0.1:$(DEV_PORT) \
		go run ./cmd/topo-server serve

# The browser end-to-end run against the real binary (step 5a stage 5).
# The browser end to end against the real binary (tests/server-e2e.mjs):
# E2E_PORT must be free; nothing on it is stopped.
E2E_PORT ?= 7381
e2e: build
	node ../tests/server-e2e.mjs --no-build --port $(E2E_PORT)
