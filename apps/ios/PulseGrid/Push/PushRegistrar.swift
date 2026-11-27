import Observation
import UIKit
import UserNotifications

/// Asks for notifications, registers the phone with Apple, and tells PulseGrid where to send them.
@Observable
final class PushRegistrar {
    private(set) var status: UNAuthorizationStatus = .notDetermined
    @ObservationIgnored weak var app: AppModel?

    var canAsk: Bool { status == .notDetermined }

    var statusText: String {
        switch status {
        case .authorized, .provisional, .ephemeral: "On"
        case .denied: "Off in Settings"
        default: "Not turned on"
        }
    }

    func ask() async {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshStatus()
        if granted { UIApplication.shared.registerForRemoteNotifications() }
    }

    /// After sign-in: registers again if allowed before, or asks the first time.
    func registerIfAllowed() async {
        await refreshStatus()
        switch status {
        case .notDetermined: await ask()
        case .authorized, .provisional, .ephemeral: UIApplication.shared.registerForRemoteNotifications()
        default: break
        }
    }

    func registered(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        struct Device: Encodable { let token: String; let environment: String }
        Task {
            try? await app?.api.put("devices/push", body: Device(token: token, environment: PushRegistrar.environment))
        }
    }

    /// Debug builds get notifications from Apple's sandbox; TestFlight and App Store builds from production.
    static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    private func refreshStatus() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}
