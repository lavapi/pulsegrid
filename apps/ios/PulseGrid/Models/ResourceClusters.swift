import Foundation

/// How a cluster's members name it: the member type and the detail that holds the cluster's name.
nonisolated struct ClusterMembership: Sendable {
    let clusterType: String
    let memberType: String
    let detailKey: String
    let memberNoun: String

    static let all: [ClusterMembership] = [
        .init(clusterType: "ecs-cluster", memberType: "ecs-service", detailKey: "cluster", memberNoun: "service"),
        .init(clusterType: "rds-cluster", memberType: "rds-instance", detailKey: "cluster", memberNoun: "instance"),
        .init(clusterType: "elasticache-replication-group", memberType: "elasticache-cluster", detailKey: "replicationGroup", memberNoun: "node"),
    ]

    /// "Services", as a section title.
    var membersTitle: String { memberNoun.capitalized + "s" }

    /// "1 service", "3 services".
    func counting(_ count: Int) -> String { "\(count) \(memberNoun)\(count == 1 ? "" : "s")" }

    /// The category both types are listed under, such as "rds".
    var category: String { String(clusterType.split(separator: "-").first ?? "") }

    static func forCluster(_ type: String) -> ClusterMembership? { all.first { $0.clusterType == type } }
    static func forMember(_ type: String) -> ClusterMembership? { all.first { $0.memberType == type } }
}

/// A cluster with the resources that belong to it.
nonisolated struct ResourceCluster: Identifiable, Sendable {
    let resource: Resource
    let members: [Resource]
    let membership: ClusterMembership

    var id: String { resource.id }

    var hasProblem: Bool { !resource.isHealthy || members.contains { !$0.isHealthy } }

    var health: HealthCounts {
        let states = members.map(\.health)
        func count(_ state: String) -> Int { states.filter { $0 == state }.count }
        return HealthCounts(
            healthy: count("healthy"), degraded: count("degraded"), stopped: count("stopped"),
            unknown: states.count - count("healthy") - count("degraded") - count("stopped"), total: states.count
        )
    }
}

/// One category's resources: clusters with their members, and the resources outside any cluster.
nonisolated struct ResourceInventory: Sendable {
    let clusters: [ResourceCluster]
    let standalone: [Resource]

    init(_ resources: [Resource]) {
        let all = resources.compactMap { cluster -> ResourceCluster? in
            guard let membership = ClusterMembership.forCluster(cluster.type) else { return nil }
            let members = resources.filter { $0.isMember(of: cluster, through: membership) }
            return ResourceCluster(resource: cluster, members: members, membership: membership)
        }
        // Clusters with a problem, in themselves or a member, come first; otherwise the order stays as given.
        clusters = all.filter(\.hasProblem) + all.filter { !$0.hasProblem }
        let grouped = Set(clusters.flatMap { [$0.id] + $0.members.map(\.id) })
        standalone = resources.filter { !grouped.contains($0.id) }
    }

    /// The cluster with this name in this region.
    func cluster(named name: String, in region: String) -> ResourceCluster? {
        clusters.first { $0.resource.name == name && $0.resource.region == region }
    }
}

extension Resource {
    /// The name of the cluster this resource belongs to, as its details report it.
    nonisolated var clusterName: String? {
        guard let membership = ClusterMembership.forMember(type), case .string(let name) = details[membership.detailKey] else { return nil }
        return name.nilIfEmpty
    }

    nonisolated func isMember(of cluster: Resource, through membership: ClusterMembership) -> Bool {
        type == membership.memberType && region == cluster.region && clusterName == cluster.name
    }
}

/// One kind of service on the Services tab, with its clusters and other resources, problems first.
nonisolated struct ServiceSection: Identifiable, Sendable {
    let category: String
    let inventory: ResourceInventory
    let problems: Int

    var id: String { category }
    var label: String { ServiceCategorySummary.label(of: category) }

    /// The account's resources by category, in the app's order, each listing unhealthy resources before healthy ones.
    static func sections(of resources: [Resource], only category: String? = nil) -> [ServiceSection] {
        let sorted = resources.sorted { ($0.isHealthy ? 1 : 0, $0.title) < ($1.isHealthy ? 1 : 0, $1.title) }
        let grouped = Dictionary(grouping: sorted, by: \.category)
        let rank = { (category: String) in ServiceCategorySummary.order.firstIndex(of: category) ?? .max }
        return grouped.keys
            .filter { category == nil || $0 == category }
            .sorted { (rank($0), $0) < (rank($1), $1) }
            .map { key in
                let members = grouped[key] ?? []
                return ServiceSection(category: key, inventory: ResourceInventory(members), problems: members.filter { !$0.isHealthy }.count)
            }
    }
}

