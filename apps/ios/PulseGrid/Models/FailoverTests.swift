import Foundation

nonisolated struct FailoverRunCounts: Decodable, Equatable {
    let total: Int
    let passed: Int
    let stopped: Int
    let failed: Int
}

/// A failover test, or a group run of several, from the history.
nonisolated struct FailoverHistoryEntry: Decodable, Equatable, Identifiable {
    let kind: String
    let id: String
    let label: String
    let accountId: String
    let accountName: String
    let environmentName: String?
    let startedBy: String?
    let startedAt: Date?
    let endedAt: Date?
    let result: String
    let counts: FailoverRunCounts?

    var isGroupRun: Bool { kind == "run" }

    /// Where the API serves this entry's PDF report.
    var reportPath: (path: String, query: [String: String]) {
        isGroupRun ? ("experiment-reports/runs/\(id)/pdf", ["account": accountId]) : ("experiment-reports/\(id)/pdf", [:])
    }
}

nonisolated struct FailoverHistory: Decodable, Equatable {
    let entries: [FailoverHistoryEntry]
}
