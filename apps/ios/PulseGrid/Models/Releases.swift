import Foundation

nonisolated struct ReleaseStage: Decodable, Equatable {
    let label: String
    let status: String
    let detail: String?
}

nonisolated struct Release: Decodable, Identifiable {
    let id: String
    let appName: String
    let pipelineName: String
    let serviceName: String
    let serviceDisplayName: String?
    let environmentName: String?
    let run: PipelineRun?
    let state: String
    let stages: [ReleaseStage]
    let readyAt: Date?
    let issue: String?

    var serviceTitle: String { serviceDisplayName ?? serviceName }
}

nonisolated struct ReleasesOverview: Decodable {
    let configured: Bool
    let releases: [Release]
}

nonisolated struct ProductionReleaseComponent: Decodable, Equatable, Identifiable {
    let name: String
    let tag: String

    var id: String { name }
}

nonisolated struct ProductionRelease: Decodable, Equatable {
    let id: String
    let status: String
    let components: [ProductionReleaseComponent]
    let requestedBy: String?
    let createdAt: Date?
    let holdUntil: Date?
    let decision: String?
    let decidedBy: String?

    /// In its hold and not yet finished or rolled back.
    var isWaiting: Bool { status == "HOLD" && decision == nil }
}

/// The production release page: not set up here, or the release in progress if there is one.
nonisolated enum ProductionReleasesView: Decodable {
    case notSetUp
    case ready(current: ProductionRelease?)

    private enum Keys: String, CodingKey { case ready, current }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        self = try container.decode(Bool.self, forKey: .ready)
            ? .ready(current: try container.decodeIfPresent(ProductionRelease.self, forKey: .current))
            : .notSetUp
    }
}

nonisolated struct ProductionReleaseDecisionResult: Decodable {
    let releaseId: String
    let decision: String
}
