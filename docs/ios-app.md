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

The app is built with LavaPi's Apple team (`DEVELOPMENT_TEAM` in `Config/Base.xcconfig`) and signed for the App Store by hand, with the **Apple Distribution: LavaPi LLC** certificate and the **PulseGrid App Store** provisioning profile (`Config/ExportOptions.plist`). Uploads sign in with an App Store Connect API key with the App Manager role.

Once per Mac:

1. Put the certificate with its private key in the login Keychain, and the profile in `~/Library/Developer/Xcode/UserData/Provisioning Profiles`.
2. Put the API key file at `~/.appstoreconnect/private_keys/AuthKey_<key ID>.p8`, readable only by you (`chmod 600`).
3. Set `ASC_KEY_ID` and `ASC_ISSUER_ID` in your shell. They're under App Store Connect → Users and Access → Integrations.

For each upload:

1. Raise `CURRENT_PROJECT_VERSION` in `Config/Base.xcconfig`. App Store Connect takes each build number once. Raise `MARKETING_VERSION` too for a new version.
2. Run `apps/ios/scripts/upload-testflight.sh`. It archives the app and uploads it.
3. Apple checks the build, usually in 10 to 30 minutes. Then it shows up in TestFlight for the **LavaPi** internal testing group.

The app says it uses no encryption beyond the system's (`ITSAppUsesNonExemptEncryption = NO`), so builds go to testers without the export compliance question. In the App Store, the app is listed as **PulseGrid by LavaPi**, since "PulseGrid" was taken. On the phone it's still called PulseGrid.

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
| A service turned degraded | Everyone in the project who turned it on: production is on by default, staging off. Once per service until it's healthy again, and not again within 30 minutes of recovering |
| A pipeline you started or re-ran from PulseGrid failed | The person who started it. Runs are followed for up to 6 hours |
| Your production database access ends in 15 minutes | The person with the access, again if the access is extended. Under the database access switch |
| An AWS account's month is heading for at least 25% and $50 more than last month | People who can view costs, from the 5th of the month, once per account a month. Checked after each cost refresh |
| A failover test you started finished | The person who started it: a test on its own when its report is saved, a group run once when the whole run ends, with how many passed |

Each person chooses which of these they get, in the app under **More → Notifications** or on the web under **Your account → Notifications** (`GET` and `PUT /api/account/notifications`). The choice is kept per person and applies on all their phones.

A run started from PulseGrid is followed by its ID when GitHub returns it. Otherwise PulseGrid takes the first manual run of that pipeline on that branch since it was started.

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
