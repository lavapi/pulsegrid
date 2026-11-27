import Foundation

/// What the Home Screen widgets show: the account's health and how much waits on the person,
/// saved by the app each time Home loads. Nothing secret, so the widgets never need the sign-in.
nonisolated struct WidgetSnapshot: Codable, Equatable {
    let account: String
    let healthy: Int
    let degraded: Int
    let stopped: Int
    let total: Int
    let needsYou: Int
    let savedAt: Date

    var healthyShare: Double { total == 0 ? 1 : Double(healthy) / Double(total) }

    static let appGroup = "group.com.lavapi.pulsegrid"
    private static let key = "widgetSnapshot"

    static func read() -> WidgetSnapshot? {
        guard let data = UserDefaults(suiteName: appGroup)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: Self.appGroup)?.set(data, forKey: Self.key)
    }
}
