import SwiftUI

/// What a person can get push notifications about, in the order the app lists them (NOTIFICATION_TOPICS).
nonisolated enum NotificationTopic: String, CaseIterable, Identifiable, Sendable {
    case databaseAccess = "database_access"
    case productionReleases = "production_releases"
    case unhealthyProduction = "unhealthy_production"
    case unhealthyStaging = "unhealthy_staging"
    case failedPipelines = "failed_pipelines"
    case failoverTests = "failover_tests"
    case costIncreases = "cost_increases"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .databaseAccess: "Database access requests and their answers"
        case .productionReleases: "Production releases waiting for a decision"
        case .unhealthyProduction: "Services turning unhealthy in production"
        case .unhealthyStaging: "Services turning unhealthy in staging"
        case .failedPipelines: "Pipelines I started that failed"
        case .failoverTests: "Failover tests I started, when they finish"
        case .costIncreases: "Costs rising sharply"
        }
    }
}

/// The person's choices, by topic; a topic the server didn't send counts as off.
nonisolated struct NotificationSettings: Decodable, Equatable, Sendable {
    private(set) var choices: [NotificationTopic: Bool]

    init(choices: [NotificationTopic: Bool]) {
        self.choices = choices
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode([String: Bool].self)
        choices = Dictionary(uniqueKeysWithValues: raw.compactMap { key, on in NotificationTopic(rawValue: key).map { ($0, on) } })
    }

    func isOn(_ topic: NotificationTopic) -> Bool { choices[topic] ?? false }

    func setting(_ topic: NotificationTopic, to on: Bool) -> NotificationSettings {
        var copy = self
        copy.choices[topic] = on
        return copy
    }
}

/// One change, sent as `{ "<topic>": true }`.
nonisolated struct NotificationChange: Encodable {
    let topic: NotificationTopic
    let on: Bool

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode([topic.rawValue: on])
    }
}

extension NotificationTopic {
    var symbol: String {
        switch self {
        case .databaseAccess: "cylinder.split.1x2.fill"
        case .productionReleases: "flag.checkered"
        case .unhealthyProduction: "exclamationmark.triangle.fill"
        case .unhealthyStaging: "exclamationmark.triangle"
        case .failedPipelines: "arrow.triangle.pull"
        case .failoverTests: "bolt.shield.fill"
        case .costIncreases: "dollarsign"
        }
    }

    var color: Color {
        switch self {
        case .databaseAccess: .blue
        case .productionReleases: .orange
        case .unhealthyProduction: .red
        case .unhealthyStaging: .pink
        case .failedPipelines: .indigo
        case .failoverTests: .orange
        case .costIncreases: .green
        }
    }
}
