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

// MARK: - Running tests

/// Whether the person may start and stop tests in this account, and why not.
nonisolated struct FailoverAccess: Decodable, Equatable {
    let canRun: Bool
    let blockedReason: String?
}

nonisolated struct FailoverTarget: Decodable, Equatable {
    let name: String
    let resourceType: String
    let resourceIds: [String]
}

nonisolated struct FailoverStep: Decodable, Equatable {
    let name: String
    let actionId: String
    let description: String?
    let duration: String?
    /// The step's state in AWS, on a test that has started.
    let state: String?
    let reason: String?
}

/// A failover test template from AWS FIS.
nonisolated struct FailoverTemplate: Decodable, Equatable, Identifiable {
    let id: String
    let region: String
    let label: String
    let description: String?
    let targets: [FailoverTarget]
    let steps: [FailoverStep]
    let stopAlarms: [String]
}

/// A test that started, here or anywhere else in AWS.
nonisolated struct FailoverTest: Decodable, Equatable, Identifiable {
    let id: String
    let region: String
    let label: String
    let state: String
    let reason: String?
    let startedAt: Date?
    let endedAt: Date?

    var isActive: Bool { FailoverState.isActive(state) }
}

nonisolated struct FailoverTemplateRef: Decodable, Equatable {
    let region: String
    let templateId: String
}

nonisolated struct FailoverGroup: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let templates: [FailoverTemplateRef]
}

nonisolated struct FailoverRunSummary: Decodable, Equatable, Identifiable {
    let id: String
    let label: String
    let startedAt: Date
    let startedBy: String?
    let started: Int
    let failed: Int
}

/// The account's templates, groups, recent tests and recent group runs.
nonisolated struct FailoverOverview: Decodable, Equatable {
    let templates: [FailoverTemplate]
    let experiments: [FailoverTest]
    let groups: [FailoverGroup]
    let runs: [FailoverRunSummary]
    let access: FailoverAccess
    let error: String?

    var hasActiveTests: Bool { experiments.contains(where: \.isActive) }
}

nonisolated struct FailoverResource: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let displayName: String?

    var title: String { displayName ?? name }
}

/// One test, live while it runs.
nonisolated struct FailoverTestDetail: Decodable, Equatable {
    let id: String
    let region: String
    let label: String
    let state: String
    let reason: String?
    let startedAt: Date?
    let endedAt: Date?
    let description: String?
    let steps: [FailoverStep]
    let targets: [FailoverTarget]
    let stopAlarms: [String]
    let startedBy: String?
    let resources: [FailoverResource]
    let access: FailoverAccess

    var isActive: Bool { FailoverState.isActive(state) }
}

/// The order a group run starts its tests in, and what's running already.
nonisolated struct FailoverRunOrder: Decodable, Equatable {
    struct Test: Decodable, Equatable {
        let label: String
        let zoneWide: Bool
    }

    let tests: [Test]
    let busy: String?
}

nonisolated struct FailoverRepair: Decodable, Equatable {
    let at: Date?
    let text: String
}

/// One test in a group run.
nonisolated struct FailoverRunItem: Decodable, Equatable {
    struct Report: Decodable, Equatable {
        let result: String
        let reason: String?
    }

    let region: String
    let templateId: String
    let label: String
    let experimentId: String?
    let error: String?
    let waiting: Bool?
    let cancelled: Bool?
    let skipped: String?
    let note: String?
    let startedAt: Date?
    let endedAt: Date?
    let repairs: [FailoverRepair]?
    let state: String?
    let report: Report?

    /// Where the test stands, in the website's words, with its tone's result name.
    var status: (text: String, result: String) {
        if error != nil { return ("Didn't start", "failed") }
        if skipped != nil { return ("Skipped", "unknown") }
        if cancelled == true { return ("Cancelled", "stopped") }
        if let report { return (report.result.sentenceCased, report.result) }
        if let state, FailoverState.isActive(state) { return (state.sentenceCased, "running") }
        if waiting == true { return ("Waiting", "unknown") }
        if let state, let result = FailoverState.result(of: state) { return (result.sentenceCased, result) }
        return ("Unknown", "unknown")
    }

    /// Why it didn't start, was skipped or is waiting, or how its report ended.
    var detail: String? { error ?? skipped ?? note ?? report?.reason }
}

/// A group run, live while its tests run one at a time.
nonisolated struct FailoverRunDetail: Decodable, Equatable {
    let id: String
    let label: String
    let startedAt: Date
    let startedBy: String?
    let accountName: String
    let environmentName: String?
    let stoppedReason: String?
    let result: String
    let endedAt: Date?
    let items: [FailoverRunItem]
    let access: FailoverAccess
    let error: String?

    var isRunning: Bool { result == "running" }
}

nonisolated struct StartedFailover: Decodable {
    let id: String
    let region: String?
}

/// The states AWS FIS reports for a test.
nonisolated enum FailoverState {
    static func isActive(_ state: String) -> Bool { ["pending", "initiating", "running", "stopping"].contains(state) }

    /// The result of an ended test: passed, stopped or failed.
    static func result(of state: String) -> String? {
        ["completed": "passed", "stopped": "stopped", "failed": "failed", "cancelled": "failed"][state]
    }

    /// "Running", or the result once it has ended.
    static func label(of state: String) -> String { (result(of: state) ?? state).sentenceCased }

    /// The result name its badge is coloured by.
    static func tone(of state: String) -> String { isActive(state) ? "running" : result(of: state) ?? "unknown" }

    /// A step that hasn't started yet waits; otherwise steps read like tests.
    static func stepLabel(of state: String) -> String { state == "pending" ? "Waiting" : label(of: state) }

    static func stepTone(of state: String) -> String { state == "pending" ? "unknown" : tone(of: state) }
}

/// A test or group run to follow live.
nonisolated enum FailoverLive: Hashable, Identifiable {
    case test(region: String, id: String)
    case run(id: String)

    var id: String {
        switch self {
        case .test(let region, let id): "\(region)/\(id)"
        case .run(let id): id
        }
    }
}

/// "PT5M" → "5 min", the way AWS FIS writes a step's duration.
nonisolated func failoverDuration(_ iso: String?) -> String? {
    guard let iso, iso.hasPrefix("PT") else { return nil }
    let units: [(Character, String)] = [("H", "h"), ("M", "min"), ("S", "s")]
    var number = ""
    var parts: [String] = []
    for character in iso.dropFirst(2) {
        if character.isNumber {
            number.append(character)
        } else if let unit = units.first(where: { $0.0 == character }), !number.isEmpty {
            parts.append("\(number) \(unit.1)")
            number = ""
        } else {
            return nil
        }
    }
    return parts.isEmpty ? nil : parts.joined(separator: " ")
}
