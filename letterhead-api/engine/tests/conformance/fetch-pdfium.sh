#!/bin/sh
# Download the pinned pdfium binary for the conformance runner (AC-1.3, amendment A5), verify it, and unpack it
# where the test looks for it. The same script runs in CI and on a developer's machine.
#
#   sh letterhead-api/engine/tests/conformance/fetch-pdfium.sh [destination]
#
# destination defaults to `.pdfium/` beside this script (git-ignored). The test finds the library there, or at
# $LETTERHEAD_PDFIUM_LIBRARY. Pins (release, SHA-256 of the archive and of the library) are in `pdfium.lock`.
#
# Nothing is run from the archive: it is checked against its digest, unpacked into an empty temporary directory,
# its library is checked against its digest, and only then copied.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
dest=${1:-"$here/.pdfium"}

# shellcheck source=pdfium.lock
. "$here/pdfium.lock"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_x64; asset=pdfium-linux-x64.tgz; library=libpdfium.so ;;
  Darwin-arm64) platform=mac_arm64; asset=pdfium-mac-arm64.tgz; library=libpdfium.dylib ;;
  Darwin-x86_64) platform=mac_x64; asset=pdfium-mac-x64.tgz; library=libpdfium.dylib ;;
  *)
    echo "fetch-pdfium: no pinned pdfium for $(uname -s) $(uname -m); the conformance runner supports linux x64 and macOS" >&2
    exit 2
    ;;
esac

eval "archive_sha=\${PDFIUM_ARCHIVE_SHA256_${platform}}"
eval "library_sha=\${PDFIUM_LIBRARY_SHA256_${platform}}"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

if [ -f "$dest/lib/$library" ] && [ "$(sha256 "$dest/lib/$library")" = "$library_sha" ]; then
  echo "fetch-pdfium: $dest already holds pdfium $PDFIUM_BUILD ($platform), digest verified"
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

url="https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F${PDFIUM_BUILD}/${asset}"
echo "fetch-pdfium: downloading $asset (pdfium $PDFIUM_BUILD)"
curl --fail --silent --show-error --location --retry 3 --output "$work/$asset" "$url"

got=$(sha256 "$work/$asset")
if [ "$got" != "$archive_sha" ]; then
  echo "fetch-pdfium: $asset has digest $got, expected $archive_sha. Refusing to use it." >&2
  exit 1
fi

mkdir "$work/unpacked"
tar -xzf "$work/$asset" -C "$work/unpacked"
got=$(sha256 "$work/unpacked/lib/$library")
if [ "$got" != "$library_sha" ]; then
  echo "fetch-pdfium: lib/$library has digest $got, expected $library_sha. Refusing to use it." >&2
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest"
cp -R "$work/unpacked/lib" "$work/unpacked/VERSION" "$dest/"
[ -d "$work/unpacked/licenses" ] && cp -R "$work/unpacked/licenses" "$dest/"
[ -f "$work/unpacked/LICENSE" ] && cp "$work/unpacked/LICENSE" "$dest/"
echo "fetch-pdfium: pdfium $PDFIUM_BUILD ($platform) installed in $dest"
