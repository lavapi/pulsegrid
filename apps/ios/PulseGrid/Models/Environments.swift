import Foundation

nonisolated struct EnvironmentSummary: Decodable, Identifiable, Equatable {
    struct Account: Decodable, Equatable, Identifiable {
        let id: String
        let accountId: String
        let name: String
    }

    struct Service: Decodable, Equatable, Identifiable {
        let service: String
        let health: HealthCounts

        var id: String { service }

        /// The names the web uses for each cloud service.
        var label: String {
            [
                "ecs": "ECS", "rds": "RDS", "elasticache": "ElastiCache", "ec2": "EC2", "s3": "S3",
                "secrets": "Secrets Manager", "network": "Networking",
            ][service] ?? service.uppercased()
        }
    }

    struct Domain: Decodable, Equatable, Identifiable {
        let id: String
        let kind: String
        let label: String?
        let url: String
    }

    let id: String
    let name: String
    let accounts: [Account]
    let health: HealthCounts
    let services: [Service]
    let lastSyncedAt: Date?
    let domains: [Domain]
}
