import Foundation

/// Something waiting on the person, most urgent first.
nonisolated enum NeedsYou: Identifiable {
    /// A production release holding for a decision, which rolls back by itself at the end of its hold.
    case productionRelease(ProductionRelease)
    /// Database access requests waiting for an approver, oldest first.
    case accessRequests([DatabaseAccessRequest])
    case unhealthy(Resource)
    case failedPipelines([PipelineActivityItem])
    case failoverRunning([FailoverTest])

    var id: String {
        switch self {
        case .productionRelease(let release): "release-\(release.id)"
        case .accessRequests: "requests"
        case .unhealthy(let resource): "resource-\(resource.id)"
        case .failedPipelines: "pipelines"
        case .failoverRunning: "failover"
        }
    }

    /// The items to show, in order of urgency: a release about to roll back, people waiting for access,
    /// services that are down, failover tests breaking things on purpose, then failed pipelines.
    static func items(
        release: ProductionRelease?,
        requests: [DatabaseAccessRequest],
        unhealthy: [Resource],
        failedPipelines: [PipelineActivityItem],
        failover: [FailoverTest]
    ) -> [NeedsYou] {
        var items: [NeedsYou] = []
        if let release, release.isWaiting { items.append(.productionRelease(release)) }
        if !requests.isEmpty { items.append(.accessRequests(requests)) }
        items += unhealthy.map(NeedsYou.unhealthy)
        let running = failover.filter(\.isActive)
        if !running.isEmpty { items.append(.failoverRunning(running)) }
        if !failedPipelines.isEmpty { items.append(.failedPipelines(failedPipelines)) }
        return items
    }
}

/// Everything Home shows. Only health is required; each other part is left out when the person can't see it
/// or it fails to load, so one missing piece never blanks the screen.
nonisolated struct HomeSnapshot {
    let categories: [ServiceCategorySummary]
    let needsYou: [NeedsYou]
    let costs: AccountCosts?
    let activity: [AuditEvent]?

    var health: HealthCounts { .sum(categories.map(\.health)) }
}
