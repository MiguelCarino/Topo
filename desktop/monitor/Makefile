# topo-monitor build and packages (docs/SCOPE.md D455, D459, D461).
# Pre-release versions as the server's: 0.0.<number of commits>. A release
# passes its own: make packages VERSION=1.2.3.
VERSION ?= 0.0.$(shell git rev-list --count HEAD 2>/dev/null || echo 0)
# The machine's own architecture: a Rust binary is packed where it was built.
ARCH ?= $(shell uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/')
# At most four compile jobs at once, and nothing downloaded: a build stays
# inside a shared machine's memory and needs no network.
CARGOFLAGS ?= --offline -j4

.PHONY: build test packages packages-test clean

# The release binary, carrying its version (topo-monitor --version).
build:
	TOPO_MONITOR_VERSION=$(VERSION) cargo build --release $(CARGOFLAGS)

# One test of the app's shared files reads a file of the app's own crate.
test:
	cargo test $(CARGOFLAGS) -- --skip rust_vectors_for_javascript

# The tar.gz always; the rpm and the deb where rpmbuild and dpkg-deb are.
packages: build
	packaging/build.sh $(VERSION) $(ARCH)

# Build them and inspect them (tests/monitor-packages.sh); installing them
# needs root and is not done here.
packages-test: packages
	../../tests/monitor-packages.sh dist $(VERSION) $(ARCH)

clean:
	rm -rf dist
