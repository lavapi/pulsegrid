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

nonisolated struct Resource: Decodable, Identifiable {
    let id: String
    let type: String
    let name: String
    let displayName: String?
    let status: String
    let health: String
    let region: String

    var title: String { displayName ?? name }

    /// "ecs-service" → "ECS service", as the web names them.
    var typeLabel: String {
        let words = type.split(separator: "-").map(String.init)
        guard let service = words.first else { return type }
        let names = ["ecs": "ECS", "rds": "RDS", "ec2": "EC2", "s3": "S3", "elasticache": "ElastiCache", "vpc": "VPC"]
        return ([names[service] ?? service.capitalized] + words.dropFirst()).joined(separator: " ")
    }
}

nonisolated struct ResourcePage: Decodable {
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
