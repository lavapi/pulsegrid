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

    var report: FailoverReport {
        isGroupRun ? .run(accountId: accountId, runId: id, title: label) : .test(reportId: id, title: label)
    }
}

/// A failover test's or a group run's PDF report, from the history or a notification.
nonisolated enum FailoverReport: Hashable {
    case test(reportId: String, title: String)
    case run(accountId: String, runId: String, title: String)

    var id: String {
        switch self {
        case .test(let reportId, _): reportId
        case .run(_, let runId, _): runId
        }
    }

    var title: String {
        switch self {
        case .test(_, let title), .run(_, _, let title): title
        }
    }

    /// Where the API serves the PDF.
    var path: (path: String, query: [String: String]) {
        switch self {
        case .test(let reportId, _): ("experiment-reports/\(reportId)/pdf", [:])
        case .run(let accountId, let runId, _): ("experiment-reports/runs/\(runId)/pdf", ["account": accountId])
        }
    }

    /// The report a notification's path points at, such as "/failover-tests/tests/<id>".
    init?(path: String) {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.first == "failover-tests" else { return nil }
        if parts.count == 3, parts[1] == "tests" {
            self = .test(reportId: parts[2], title: "Failover test")
        } else if parts.count == 4, parts[1] == "runs" {
            self = .run(accountId: parts[2], runId: parts[3], title: "Failover tests")
        } else {
            return nil
        }
    }
}

nonisolated struct FailoverHistory: Decodable, Equatable {
    let entries: [FailoverHistoryEntry]
}
