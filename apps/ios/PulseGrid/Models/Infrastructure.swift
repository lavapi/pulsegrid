import Foundation

nonisolated struct HealthCounts: Decodable, Equatable {
    let healthy: Int
    let degraded: Int
    let stopped: Int
    let unknown: Int
    let total: Int
}

nonisolated struct ServiceCategorySummary: Decodable, Identifiable {
    let category: String
    let health: HealthCounts

    var id: String { category }

    /// The names the web uses for each category.
    var label: String {
        [
            "ecs": "ECS", "rds": "RDS", "elasticache": "ElastiCache", "ec2": "EC2", "s3": "S3",
            "secrets-manager": "Secrets Manager", "load-balancing": "Load Balancing", "vpc": "VPC",
        ][category] ?? category.uppercased()
    }
}

nonisolated struct Resource: Decodable, Identifiable, Sendable {
    let id: String
    let type: String
    let name: String
    let displayName: String?
    let status: String
    let health: String
    let region: String
    var details: [String: JSONValue] = [:]
    var lastSeenAt: Date?

    var title: String { displayName ?? name }

    private enum CodingKeys: String, CodingKey { case id, type, name, displayName, status, health, region, details, lastSeenAt }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        type = try container.decode(String.self, forKey: .type)
        name = try container.decode(String.self, forKey: .name)
        displayName = try container.decodeIfPresent(String.self, forKey: .displayName)
        status = try container.decode(String.self, forKey: .status)
        health = try container.decode(String.self, forKey: .health)
        region = try container.decode(String.self, forKey: .region)
        details = try container.decodeIfPresent([String: JSONValue].self, forKey: .details) ?? [:]
        lastSeenAt = try container.decodeIfPresent(Date.self, forKey: .lastSeenAt)
    }

    /// The details the cloud reports that read as plain text, by label, in a stable order.
    var facts: [(label: String, value: String)] {
        details.compactMap { key, value in value.displayText.map { (key.labelFromKey, $0) } }.sorted { $0.label < $1.label }
    }

    /// Types the API has load charts for, as in LOAD_RESOURCE_TYPES.
    var hasLoad: Bool {
        ["ecs-service", "ec2-instance", "rds-instance", "rds-cluster", "elasticache-cluster", "elasticache-replication-group"].contains(type)
    }

    /// Types the API reads logs for.
    var hasLogs: Bool { type == "ecs-service" }

    /// "ecs-service" → "ECS service", as the web names them.
    var typeLabel: String {
        let words = type.split(separator: "-").map(String.init)
        guard let service = words.first else { return type }
        let names = ["ecs": "ECS", "rds": "RDS", "ec2": "EC2", "s3": "S3", "elasticache": "ElastiCache", "vpc": "VPC"]
        return ([names[service] ?? service.capitalized] + words.dropFirst()).joined(separator: " ")
    }
}

nonisolated struct ResourcePage: Decodable, Sendable {
    let resources: [Resource]
}

nonisolated struct PipelineRun: Decodable, Equatable {
    let id: String
    let workflowName: String
    let repository: String
    let number: Int
    let title: String
    let branch: String
    let commit: String
    let actor: String?
    let status: String
    let startedAt: Date?
    let finishedAt: Date?
    let url: String
}

nonisolated struct PipelineActivityItem: Decodable, Identifiable {
    let appId: String
    let appName: String
    let workflowId: String
    let name: String
    let environmentName: String?
    let run: PipelineRun

    var id: String { "\(workflowId)-\(run.id)" }
}

nonisolated struct PipelineActivity: Decodable {
    let configured: Bool
    let running: [PipelineActivityItem]
    let failed: [PipelineActivityItem]
    let issues: [String]
}

nonisolated struct PipelineJob: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let status: String
    let durationSeconds: Int?
    let url: String
}

/// Whether the person may re-run or cancel a run, and why not when they can't.
nonisolated struct PipelineActionAccess: Decodable, Equatable {
    let canAct: Bool
    let production: Bool
    let reason: String?
}

nonisolated struct PipelineRunDetail: Decodable {
    struct App: Decodable, Equatable {
        let id: String
        let name: String
    }

    let app: App
    let rerunsFailedJobs: Bool
    let run: PipelineRun
    let jobs: [PipelineJob]
    let access: PipelineActionAccess
    let environmentName: String?

    var isActive: Bool { ["queued", "running"].contains(run.status) }
    var canRerunFailedJobs: Bool { rerunsFailedJobs && run.status == "failure" }
}

/// What a person can do with a finished or running pipeline run.
nonisolated enum PipelineRunAction: Equatable {
    case rerun(failedOnly: Bool)
    case cancel

    var title: String {
        switch self {
        case .rerun(failedOnly: true): "Re-run failed jobs"
        case .rerun: "Re-run all jobs"
        case .cancel: "Cancel run"
        }
    }

    var path: String {
        self == .cancel ? "pipelines/runs/cancel" : "pipelines/runs/rerun"
    }
}
