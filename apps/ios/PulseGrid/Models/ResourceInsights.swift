import Foundation

nonisolated struct LoadPoint: Decodable, Equatable {
    let timestamp: Date
    let value: Double
}

nonisolated struct LoadSeries: Decodable, Equatable, Identifiable {
    let label: String
    let points: [LoadPoint]

    var id: String { label }
}

nonisolated struct LoadChart: Decodable, Equatable, Identifiable {
    let id: String
    let label: String
    let unit: String
    let limit: Double?
    let warnAbove: Double?
    let note: String?
    let series: [LoadSeries]

    /// The newest value of the first line, for the chart's heading.
    var latest: Double? { series.first?.points.last?.value }

    func format(_ value: Double) -> String {
        switch unit {
        case "percent": "\(Int(value.rounded()))%"
        case "bytes": Int64(value).formatted(.byteCount(style: .memory))
        case "milliseconds": "\(Int(value.rounded())) ms"
        default: value.formatted(.number.precision(.fractionLength(0...1)))
        }
    }
}

nonisolated struct CapacityFact: Decodable, Equatable {
    let label: String
    let value: String
}

nonisolated struct ResourceLoad: Decodable, Equatable {
    let available: Bool
    let charts: [LoadChart]
    let capacity: [CapacityFact]
    let error: String?
}

nonisolated struct LogLine: Decodable, Equatable, Identifiable {
    let id: String
    let timestamp: Date
    let stream: String
    let message: String
}

nonisolated struct LogView: Decodable, Equatable {
    struct Access: Decodable, Equatable {
        let allowed: Bool
        let reason: String?
    }

    let access: Access
    let available: Bool
    let lines: [LogLine]
    let error: String?
}

/// An action the person may start on a resource, with the reason when it can't start right now.
nonisolated struct ResourceActionOption: Decodable, Equatable, Identifiable {
    let permission: String
    let blockedReason: String?

    var id: String { permission }
    var action: CloudAction? { CloudAction(rawValue: permission) }
}

nonisolated struct ActionRun: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let status: String
    let summary: String
    let startedBy: String?
    let startedAt: Date
    let finishedAt: Date?

    var isRunning: Bool { status == "running" }
}

/// The resource actions the app offers, worded as on the web (CLOUD_ACTIONS). Failover tests start on the web only.
nonisolated enum CloudAction: String, CaseIterable {
    case redeployService = "service.redeploy"
    case rebootDatabase = "database.reboot"
    case rebootCache = "cache.reboot"
    case rebootServer = "server.reboot"

    var buttonLabel: String {
        switch self {
        case .redeployService: "Force deploy"
        case .rebootDatabase: "Reboot database"
        case .rebootCache: "Reboot cache"
        case .rebootServer: "Reboot server"
        }
    }

    var explanation: String {
        switch self {
        case .redeployService: "Starts new tasks and replaces the running ones. Nothing about the service changes."
        case .rebootDatabase: "Connections drop while the database restarts, usually for a minute or two."
        case .rebootCache: "Every node restarts. Data stored in the cache can be lost unless it is replicated or persisted."
        case .rebootServer: "The server goes offline briefly while it restarts."
        }
    }

    var systemImage: String {
        self == .redeployService ? "arrow.triangle.2.circlepath" : "power"
    }
}
