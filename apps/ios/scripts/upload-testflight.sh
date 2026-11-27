#!/bin/bash
# Builds the app for the App Store and uploads it to App Store Connect, where it shows up in TestFlight.
# Raise CURRENT_PROJECT_VERSION in Config/Base.xcconfig first: each build number can be uploaded once.
#
# With ASC_KEY_ID and ASC_ISSUER_ID set, it signs in with that App Store Connect API key, read from
# ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8. Without them, it uses the Apple account in Xcode.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=build/testflight
rm -rf "$OUT"

auth=(-allowProvisioningUpdates)
if [[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" ]]; then
  auth+=(
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
    -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
  )
fi

xcodebuild archive \
  -project PulseGrid.xcodeproj \
  -scheme PulseGrid \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/PulseGrid.xcarchive" \
  "${auth[@]}"

xcodebuild -exportArchive \
  -archivePath "$OUT/PulseGrid.xcarchive" \
  -exportOptionsPlist Config/ExportOptions.plist \
  -exportPath "$OUT/export" \
  "${auth[@]}"
