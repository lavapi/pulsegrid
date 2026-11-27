# iPhone app

The PulseGrid iPhone app shows the dashboard on a phone. It sends push notifications for database access requests and their answers, and for production releases waiting for a decision.

Every company runs its own PulseGrid, so the app has no server built in. On first launch it asks for the address people open PulseGrid at in a browser, such as `pulsegrid.example.com`. It checks that the address answers as a PulseGrid that's been set up, then keeps it. **Change server** on the sign-in screen and under More signs out and asks again.

A PulseGrid that's only on the company network is reached the same way a laptop reaches it: through the company VPN. Whenever the app can't reach the server, it says to turn on the VPN.

## Screens

- **Overview:** health by service for the selected account, and what's degraded.
- **Releases:** what is deployed where, for the selected account.
- **Production:** for people who decide production releases, finish or roll back the release waiting in its hold.
- **Access:** approvers approve, with their authenticator code, or decline database access requests. Everyone else requests access and follows their request.
- **More:** pipelines running and failed, Activity, the project switcher, notifications, the server and sign out.

The account switcher sits at the top of the screens that follow it, as on the web. Every screen refreshes when pulled down. The app locks with Face ID, or the phone's passcode, whenever it goes to the background.

## Building the app

The app is in `apps/ios`, for iOS 17.4 and later. It needs Xcode 27; nothing else is installed. The Xcode project picks up every file in `PulseGrid/` and `PulseGridTests/` by itself, and build settings live in `Config/*.xcconfig`.

```bash
cd apps/ios
xcodebuild -project PulseGrid.xcodeproj -scheme PulseGrid -destination 'platform=iOS Simulator,name=iPhone 18 Pro' test
```

To check screens against a local API without signing in, a debug build accepts `-server <url> -PulseGridToken <app token> -PulseGridOpen <path>` as launch arguments. Release builds ignore them.

### Uploading to TestFlight

The app is signed with LavaPi's Apple team (`DEVELOPMENT_TEAM` in `Config/Base.xcconfig`), with Xcode's automatic signing. Xcode on the Mac must be signed in to an Apple account in that team (**Xcode → Settings → Accounts**).

1. Raise `CURRENT_PROJECT_VERSION` in `Config/Base.xcconfig`. App Store Connect takes each build number once. Raise `MARKETING_VERSION` too for a new version.
2. Run `apps/ios/scripts/upload-testflight.sh`. It archives the app and uploads it to App Store Connect, using `Config/ExportOptions.plist`.
3. Apple checks the build, which usually takes 10 to 30 minutes. Then it shows up in TestFlight for the internal testers.

The app says it uses no encryption beyond the system's (`ITSAppUsesNonExemptEncryption = NO`), so builds go to testers without the export compliance question.

## How the app signs in

The app never asks for a password itself. It opens PulseGrid's own sign-in page in the system browser, so email and password, Google and the authenticator code all work as on the web.

1. The app makes a secret (a PKCE verifier) and opens `/mobile/sign-in` with a challenge made from it, a random state and the phone's name.
2. Once the person is signed in, the page asks the API for a one-time code (`POST /api/auth/device/codes`) and opens the app at `pulsegrid://signed-in` with the code and state.
3. The app checks the state and swaps the code and its secret for its own token (`POST /api/auth/device/token`). A code works once, only with the secret that made it, and for 2 minutes.
4. The app sends the token as `Authorization: Bearer …`. Permissions are the same as in the browser, and anything sensitive still asks for the authenticator code.

A phone stays signed in for 30 days from when it was last used. **Your account → Devices** lists signed-in phones with **Sign out**. Signing out, or changing your password, signs the phone out and stops its notifications. Signing in and out of the app is recorded in Activity.

## Push notifications

The app registers its phone with `PUT /api/devices/push` after the person allows notifications. Each registration belongs to that phone's sign-in.

| Notification | Who gets it |
|---|---|
| A new database access request | People with **Grant production database access** |
| A request was approved or declined | The person who asked |
| A production release is waiting for a decision | People with **Finish or roll back production releases**, once per release |

Notifications for the App Store app work with no settings. The API and the worker send them through LavaPi's push relay (`https://push-pulsegrid.lavapi.com`), which holds the app's Apple key. The first time it sends, the server registers with the relay by itself and keeps its relay secret encrypted in the database. The relay passes each notification on to Apple and keeps no copy of it. See [Push relay](push-relay.md).

| Setting | What it does |
|---|---|
| `PUSH_RELAY_URL` | The relay to send through. Leave it out for LavaPi's relay, set it to your own relay, or set it empty to send no notifications |

With your own build of the app, your own Apple key is needed. Set these four settings, and the server sends to Apple directly instead of through the relay.

| Setting | What it is |
|---|---|
| `APNS_TEAM_ID` | The Apple Developer team ID |
| `APNS_KEY_ID` | The ID of the APNs key |
| `APNS_BUNDLE_ID` | The app's bundle ID |
| `APNS_PRIVATE_KEY` | The `.p8` key's contents. Line breaks may be written as `\n` |

Store the key as a secret, never in a task definition's plain environment. A phone that no longer takes notifications is forgotten when Apple says so.
