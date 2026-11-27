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

/// Whether the person may read a resource's logs, and why not.
nonisolated struct LogAccess: Decodable, Equatable {
    let allowed: Bool
    let reason: String?
}

/// Why logs couldn't be read, such as a bucket refusing PulseGrid.
nonisolated struct LogProblem: Decodable, Equatable {
    let message: String
}

nonisolated struct LogView: Decodable, Equatable {
    let access: LogAccess
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

nonisolated struct CountedKey: Decodable, Equatable, Identifiable {
    let key: String
    let count: Int

    var id: String { key }
}

nonisolated struct RequestLogSummary: Decodable, Equatable {
    let access: LogAccess
    let problem: LogProblem?
    let requests: Int
    let errorRate: Double
    let p50Ms: Double?
    let p95Ms: Double?
    let p99Ms: Double?
    let topPaths: [CountedKey]
    let noTarget: Int
    let partial: Bool
}

nonisolated struct RequestLogEntry: Decodable, Equatable, Identifiable {
    let time: Date
    let host: String
    let method: String
    let path: String
    let elbStatus: Int?
    let targetStatus: Int?
    let responseMs: Double?
    let service: String?

    var id: String { "\(time.timeIntervalSince1970)-\(method)-\(path)-\(elbStatus ?? 0)" }
    /// The status the visitor got: the load balancer's, or the target's when the balancer passed it on.
    var status: Int? { elbStatus ?? targetStatus }
}

nonisolated struct RequestLogPage: Decodable, Equatable {
    let access: LogAccess
    let problem: LogProblem?
    let entries: [RequestLogEntry]
}

/// The request statuses the app filters by, as the API takes them.
nonisolated enum RequestStatusFilter: String, CaseIterable, Identifiable {
    case all, serverErrors = "5xx", clientErrors = "4xx"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: "All"
        case .serverErrors: "5xx"
        case .clientErrors: "4xx"
        }
    }

    /// The query for the last hour with this filter.
    func query(until now: Date) -> [String: String] {
        var query = ["from": now.addingTimeInterval(-3600).formatted(.iso8601), "to": now.formatted(.iso8601)]
        if self != .all { query["status"] = rawValue }
        return query
    }
}

nonisolated struct TopStatement: Decodable, Equatable, Identifiable {
    let id: String
    let statement: String
    let load: Double
    let share: Double
    let callsPerSecond: Double?
    let avgLatencyMs: Double?
}

nonisolated struct InstanceTopSql: Decodable, Equatable, Identifiable {
    let instance: String
    let unavailable: String?
    let load: Double?
    let statements: [TopStatement]

    var id: String { instance }
}

nonisolated struct TopSqlReport: Decodable, Equatable {
    let access: LogAccess
    let problem: LogProblem?
    let instances: [InstanceTopSql]
}

nonisolated struct DatabaseLogLine: Decodable, Equatable, Identifiable {
    let id: String
    let time: Date
    let instance: String
    let severity: String
    let message: String
}

nonisolated struct SlowQuery: Decodable, Equatable, Identifiable {
    let id: String
    let time: Date
    let instance: String
    let durationMs: Double
    let statement: String
}

nonisolated struct DatabaseLogReport: Decodable, Equatable {
    let access: LogAccess
    let problem: LogProblem?
    let lines: [DatabaseLogLine]
    let slowQueries: [SlowQuery]
    let partial: Bool
}

/// The database log filters, as DATABASE_LOG_LEVELS.
nonisolated enum DatabaseLogLevel: String, CaseIterable, Identifiable {
    case problems, errors, warnings, deadlocks, connections, all

    var id: String { rawValue }
    var label: String {
        switch self {
        case .problems: "Errors and warnings"
        case .errors: "Errors"
        case .warnings: "Warnings"
        case .deadlocks: "Deadlocks"
        case .connections: "Failed connections"
        case .all: "Everything"
        }
    }
}
