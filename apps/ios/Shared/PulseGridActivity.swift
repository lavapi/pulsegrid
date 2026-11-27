import ActivityKit
import Foundation

/// A countdown on the Lock Screen and in the Dynamic Island: a production release waiting for a decision,
/// or the person's own database access running out.
nonisolated struct PulseGridActivity: ActivityAttributes {
    enum Kind: String, Codable, Hashable {
        case productionRelease
        case databaseAccess
    }

    struct ContentState: Codable, Hashable {
        let startsAt: Date
        let endsAt: Date
    }

    let kind: Kind
    /// What this activity follows, such as the release's ID, so the app starts it once.
    let subject: String
    let title: String
    let detail: String

    var symbol: String {
        switch kind {
        case .productionRelease: "flag.checkered"
        case .databaseAccess: "cylinder.split.1x2.fill"
        }
    }

    /// What the countdown leads to, in a few words.
    var endsWith: String {
        switch kind {
        case .productionRelease: "Rolls back by itself in"
        case .databaseAccess: "Access ends in"
        }
    }
}
