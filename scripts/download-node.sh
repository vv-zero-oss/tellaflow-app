#!/bin/bash
# The Node runtime the assistant's agent backend (bb) runs on, bundled into the
# app so nobody has to install Node. Pinned and checksummed: what ships is the
# build this release was tested with, never whatever nodejs.org serves today.
#
#   scripts/download-node.sh                # this machine's platform
#   scripts/download-node.sh darwin-arm64   # a named one (the release build)
#
# Lands at resources/node/<platform>-<arch>/bin/node (electron-builder copies
# resources/node/ into the app; supervisor.js runs it from there).
set -euo pipefail

VERSION="v22.23.3"
# sha256 of node-$VERSION-<target>.tar.gz, from nodejs.org/dist/$VERSION/SHASUMS256.txt
sha_for() {
  case "$1" in
    darwin-arm64) echo "23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53" ;;
    darwin-x64)   echo "8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8" ;;
    linux-x64)    echo "1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af" ;;
    *) echo "" ;;
  esac
}

if [ $# -ge 1 ]; then
  TARGET="$1"
else
  case "$(uname -s)" in Darwin) OS=darwin ;; Linux) OS=linux ;; *) echo "unsupported OS"; exit 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) echo "unsupported arch"; exit 1 ;; esac
  TARGET="$OS-$ARCH"
fi

SHA="$(sha_for "$TARGET")"
if [ -z "$SHA" ]; then echo "No pinned Node build for $TARGET"; exit 1; fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/resources/node/$TARGET"
if [ -x "$DEST/bin/node" ] && [ "$("$DEST/bin/node" --version 2>/dev/null || true)" = "$VERSION" ]; then
  echo "Node $VERSION already at $DEST"
  exit 0
fi
# A cross-platform download cannot be run to check; trust the version file.
if [ -f "$DEST/VERSION" ] && [ "$(cat "$DEST/VERSION")" = "$VERSION" ] && [ -f "$DEST/bin/node" ]; then
  echo "Node $VERSION already at $DEST"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
NAME="node-$VERSION-$TARGET"
echo "Downloading Node $VERSION ($TARGET)..."
curl -fL --progress-bar "https://nodejs.org/dist/$VERSION/$NAME.tar.gz" -o "$WORK/node.tgz"

GOT="$( (command -v sha256sum >/dev/null && sha256sum "$WORK/node.tgz" || shasum -a 256 "$WORK/node.tgz") | awk '{print $1}')"
if [ "$GOT" != "$SHA" ]; then
  echo "Checksum mismatch for $NAME.tar.gz: got $GOT, want $SHA"
  exit 1
fi

tar xzf "$WORK/node.tgz" -C "$WORK"
# Only the runtime and its licence: npm, npx and headers are not needed to run bb.
rm -rf "$DEST.part"
mkdir -p "$DEST.part/bin"
cp "$WORK/$NAME/bin/node" "$DEST.part/bin/node"
cp "$WORK/$NAME/LICENSE" "$DEST.part/LICENSE"
echo "$VERSION" > "$DEST.part/VERSION"
chmod 755 "$DEST.part/bin/node"
rm -rf "$DEST"
mv "$DEST.part" "$DEST"
echo "Node $VERSION saved to $DEST"
