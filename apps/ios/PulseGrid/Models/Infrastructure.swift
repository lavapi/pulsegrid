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

    /// Load balancers, whose request logs the API reads.
    var hasRequestLogs: Bool { type == "load-balancer" }

    /// Databases with Performance Insights and logs the API reads.
    var hasDatabaseActivity: Bool { ["rds-cluster", "rds-instance"].contains(type) }

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
    var nextCursor: String?
}

extension APIClient {
    /// Every resource in a category, read page by page.
    func allResources(account: String, category: String, search: String = "") async throws -> [Resource] {
        var query = ["account": account, "category": category, "limit": "100"]
        if !search.isEmpty { query["q"] = search }
        var resources: [Resource] = []
        repeat {
            let page: ResourcePage = try await get("resources", query: query)
            resources += page.resources
            query["cursor"] = page.nextCursor
        } while query["cursor"] != nil
        return resources
    }
}
