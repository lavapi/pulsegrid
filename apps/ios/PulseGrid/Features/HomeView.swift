import Charts
import SwiftUI

/// What needs the person first, then the account's health, this month's costs and the latest changes.
struct HomeView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                Loaded(id: account.id) {
                    try await load(account)
                } content: { home, reload in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 24) {
                            NeedsYouSection(account: account, items: home.needsYou)
                            HealthSection(account: account, home: home)
                            if let costs = home.costs { CostsCard(costs: costs) }
                            if let activity = home.activity, !activity.isEmpty { RecentChanges(events: activity) }
                            CardLink { EnvironmentsView() } content: {
                                Label { Text("Environments").font(.body.weight(.medium)) } icon: { IconTile(symbol: "square.stack.3d.up.fill", color: .teal) }
                                Spacer()
                            }
                        }
                        .padding(.horizontal)
                        .padding(.bottom, 24)
                    }
                    .background(Color(.systemGroupedBackground))
                    .refreshable { await reload() }
                }
            } else {
                NoAccountView()
            }
        }
        .navigationTitle("Home")
    }

    private func load(_ account: CloudAccount) async throws -> HomeSnapshot {
        let api = app.api
        let user = app.user
        async let categories: [ServiceCategorySummary] = api.get("resources/categories", query: ["account": account.id])
        async let unhealthy: ResourcePage = api.get("resources", query: ["account": account.id, "health": "degraded", "limit": "20"])
        async let release = optional(user?.can(.decideProductionReleases) == true) {
            try await api.get("production-releases/current") as ProductionReleasesView
        }
        async let requests = optional(user?.can(.grantDatabaseAccess) == true) {
            try await api.get("database-access/requests") as [DatabaseAccessRequest]
        }
        async let pipelines = optional(account.environmentId != nil) {
            try await api.get("pipelines/apps/activity", query: ["environment": account.environmentId ?? ""]) as PipelineActivity
        }
        async let failover = optional(true) {
            try await api.get("cloud/accounts/\(account.id)/experiments") as FailoverOverview
        }
        async let costs = optional(user?.can(.viewCosts) == true) {
            try await api.get("costs") as CostOverview
        }
        async let activity = optional(user?.can(.viewActivity) == true) {
            try await api.get("audit-events", query: ["limit": "5"]) as AuditEventPage
        }
        var current: ProductionRelease?
        if case .ready(let release)? = await release { current = release }
        return try await HomeSnapshot(
            categories: categories,
            needsYou: NeedsYou.items(
                release: current,
                requests: await requests ?? [],
                unhealthy: unhealthy.resources,
                failedPipelines: await pipelines?.failed ?? [],
                failover: await failover?.experiments ?? []
            ),
            costs: await costs?.accounts.first { $0.accountId == account.id },
            activity: await activity?.events
        )
    }
}

/// A part of Home the person may not be allowed to see, or that may fail on its own: left out rather than failing Home.
private func optional<Value>(_ allowed: Bool, _ load: () async throws -> Value) async -> Value? {
    guard allowed else { return nil }
    return try? await load()
}

// MARK: - Needs you

private struct NeedsYouSection: View {
    @Environment(AppModel.self) private var app
    let account: CloudAccount
    let items: [NeedsYou]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardSectionHeader(title: "Needs you", count: items.isEmpty ? nil : items.count)
            if items.isEmpty {
                Card {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("All clear").font(.headline)
                            Text("Nothing is waiting for you.").font(.subheadline).foregroundStyle(.secondary)
                        }
                    } icon: {
                        IconTile(symbol: "checkmark", color: .green, size: 36)
                    }
                }
            }
            ForEach(items) { item in card(for: item) }
        }
    }

    @ViewBuilder private func card(for item: NeedsYou) -> some View {
        switch item {
        case .productionRelease(let release):
            CardLink { ProductionReleaseView() } content: {
                NeedsYouRow(symbol: "flag.checkered", color: .orange, title: "Production release waiting",
                            detail: release.components.map(\.name).joined(separator: ", ")) {
                    if let deadline = release.holdUntil, deadline > .now {
                        Text(timerInterval: Date.now...deadline, countsDown: true)
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.orange)
                    }
                }
            }
        case .accessRequests(let requests):
            CardButton { app.pendingPath = "/database-access" } content: {
                NeedsYouRow(symbol: "cylinder.split.1x2.fill", color: .blue,
                            title: requests.count == 1 ? "\(requests[0].requestedBy) asks for database access" : "\(requests.count) people ask for database access",
                            detail: requests.count == 1 ? "\(requests[0].hours) h · \(requests[0].reason)" : requests.map(\.requestedBy).joined(separator: ", ")) {
                    EmptyView()
                }
            }
        case .unhealthy(let resource):
            CardLink { ResourceDetailView(resourceId: resource.id, account: account) } content: {
                NeedsYouRow(symbol: ServiceStyle.of(resource).symbol, color: .red, title: "\(resource.title) is \(resource.health)",
                            detail: "\(resource.typeLabel) · \(resource.status)") {
                    EmptyView()
                }
            }
        case .failoverRunning(let tests):
            CardLink { FailoverTestsView() } content: {
                NeedsYouRow(symbol: "bolt.shield.fill", color: .purple,
                            title: tests.count == 1 ? "Failover test running" : "\(tests.count) failover tests running",
                            detail: tests.map(\.label).joined(separator: ", ")) {
                    EmptyView()
                }
            }
        case .failedPipelines(let runs):
            CardLink { PipelinesView() } content: {
                NeedsYouRow(symbol: "xmark.octagon.fill", color: .red,
                            title: runs.count == 1 ? "A pipeline failed" : "\(runs.count) pipelines failed",
                            detail: runs.prefix(3).map { "\($0.appName) · \($0.name)" }.joined(separator: ", ")) {
                    EmptyView()
                }
            }
        }
    }
}

private struct NeedsYouRow<Trailing: View>: View {
    let symbol: String
    let color: Color
    let title: String
    let detail: String
    @ViewBuilder let trailing: Trailing

    var body: some View {
        IconTile(symbol: symbol, color: color, size: 36)
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.headline).lineLimit(2)
            Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
        }
        Spacer(minLength: 8)
        trailing
    }
}

// MARK: - Health

private struct HealthSection: View {
    let account: CloudAccount
    let home: HomeSnapshot

    private var health: HealthCounts { home.health }
    private var share: Double { health.total == 0 ? 1 : Double(health.healthy) / Double(health.total) }
    private var tone: Tone { health.degraded > 0 ? .bad : health.stopped > 0 ? .warning : .good }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardSectionHeader(title: "Health")
            Card {
                HStack(spacing: 20) {
                    HealthRing(share: share, tone: tone)
                    VStack(alignment: .leading, spacing: 6) {
                        CountLine(value: health.healthy, label: "healthy", color: .green)
                        CountLine(value: health.degraded, label: "degraded", color: .red)
                        CountLine(value: health.stopped, label: "stopped", color: .orange)
                    }
                }
                Divider()
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], spacing: 10) {
                    ForEach(home.categories) { category in
                        NavigationLink { CategoryResourcesView(account: account, category: category) } label: {
                            CategoryTile(category: category)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private struct CountLine: View {
        let value: Int
        let label: String
        let color: Color

        var body: some View {
            HStack(spacing: 8) {
                Circle().fill(value > 0 ? color : Color.secondary.opacity(0.3)).frame(width: 8, height: 8)
                Text(value, format: .number).font(.headline.monospacedDigit()).contentTransition(.numericText())
                Text(label).font(.subheadline).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// A kind of service as a small tile: its icon, name, and its problems or healthy count.
private struct CategoryTile: View {
    let category: ServiceCategorySummary

    private var problem: (text: String, color: Color)? {
        if category.health.degraded > 0 { return ("\(category.health.degraded) degraded", .red) }
        if category.health.stopped > 0 { return ("\(category.health.stopped) stopped", .orange) }
        return nil
    }

    var body: some View {
        HStack(spacing: 10) {
            IconTile(.category(category.category), size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(category.label).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(problem?.text ?? "\(category.health.total) healthy")
                    .font(.caption.weight(problem == nil ? .regular : .semibold))
                    .foregroundStyle(problem?.color ?? .secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Color(.tertiarySystemGroupedBackground), in: .rect(cornerRadius: 14, style: .continuous))
        .contentShape(.rect(cornerRadius: 14))
    }
}

// MARK: - Costs and changes

private struct CostsCard: View {
    let costs: AccountCosts

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardSectionHeader(title: "Costs") { CostsView() }
            Card {
                if let error = costs.error {
                    Text(error).font(.subheadline).foregroundStyle(.secondary)
                } else {
                    HStack(alignment: .firstTextBaseline) {
                        Text(costs.format(costs.thisMonth)).font(.title.weight(.bold).monospacedDigit())
                        Spacer()
                        if let change = costs.monthChange { ChangeBadge(change: change) }
                    }
                    Text("This month so far, against \(costs.format(costs.lastMonth)) last month").font(.caption).foregroundStyle(.secondary)
                    let biggest = costs.biggest(4)
                    if !biggest.isEmpty {
                        Chart(biggest) { service in
                            BarMark(x: .value("Cost", service.thisMonth), y: .value("Service", service.service))
                                .foregroundStyle(Color.accentColor.gradient)
                                .cornerRadius(6)
                        }
                        .chartXAxis(.hidden)
                        .frame(height: CGFloat(biggest.count) * 30)
                    }
                }
            }
        }
    }
}

private struct RecentChanges: View {
    let events: [AuditEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardSectionHeader(title: "Recent changes") { ActivityView() }
            Card {
                ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                    if index > 0 { Divider() }
                    ActivityRow(event: event)
                }
            }
        }
    }
}
