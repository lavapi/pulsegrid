#!/bin/bash
# Builds the app for the App Store and uploads it to App Store Connect, where it shows up in TestFlight.
# Raise CURRENT_PROJECT_VERSION in Config/Base.xcconfig first: each build number can be uploaded once.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=build/testflight
rm -rf "$OUT"

xcodebuild archive \
  -project PulseGrid.xcodeproj \
  -scheme PulseGrid \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/PulseGrid.xcarchive" \
  -allowProvisioningUpdates

xcodebuild -exportArchive \
  -archivePath "$OUT/PulseGrid.xcarchive" \
  -exportOptionsPlist Config/ExportOptions.plist \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates
