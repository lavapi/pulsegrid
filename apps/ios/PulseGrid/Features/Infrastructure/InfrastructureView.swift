import SwiftUI

/// The selected account's services by category, each opening its resources, then failover tests and what changed in AWS.
struct InfrastructureView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                Loaded(id: account.id) {
                    try await app.api.get("resources/categories", query: ["account": account.id]) as [ServiceCategorySummary]
                } content: { categories, reload in
                    List {
                        ForEach(categories) { category in
                            NavigationLink {
                                CategoryResourcesView(account: account, category: category)
                            } label: {
                                CategoryRow(category: category)
                            }
                        }
                        Section {
                            NavigationLink { FailoverTestsView() } label: { IconRow(title: "Failover tests", symbol: "bolt.shield.fill", color: .orange) }
                            if app.user?.can(.viewActivity) == true {
                                NavigationLink { CloudActivityView() } label: { IconRow(title: "Cloud activity", symbol: "cloud.fill", color: .cyan) }
                            }
                        }
                    }
                    .refreshable { await reload() }
                }
            } else {
                NoAccountView()
            }
        }
        .navigationTitle("Services")
    }
}

/// A category with its icon, and its problems when there are any, shared by Overview and Infrastructure.
struct CategoryRow: View {
    let category: ServiceCategorySummary

    var body: some View {
        Label {
            HStack {
                Text(category.label).font(.body.weight(.medium))
                Spacer()
                CompactHealth(health: category.health)
            }
        } icon: {
            IconTile(.category(category.category))
        }
    }
}

/// Problems as badges, or a quiet count with a check when everything is healthy.
struct CompactHealth: View {
    let health: HealthCounts

    var body: some View {
        HStack(spacing: 6) {
            if health.degraded > 0 { StatusBadge(text: "\(health.degraded) degraded", tone: .bad) }
            if health.stopped > 0 { StatusBadge(text: "\(health.stopped) stopped", tone: .warning) }
            if health.degraded == 0 && health.stopped == 0 {
                Label("\(health.total)", systemImage: "checkmark.circle.fill")
                    .labelStyle(.titleAndIcon)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.green)
                    .accessibilityLabel("All \(health.total) healthy")
            }
        }
    }
}

/// One category's resources, searchable by name: clusters first, each opening its members, then everything else.
struct CategoryResourcesView: View {
    @Environment(AppModel.self) private var app
    let account: CloudAccount
    let category: ServiceCategorySummary
    @State private var search = ""

    var body: some View {
        Loaded(id: "\(account.id)-\(category.id)-\(search)") {
            try await app.api.allResources(account: account.id, category: category.category, search: search)
        } content: { resources, reload in
            List {
                if resources.isEmpty {
                    Text(search.isEmpty ? "Nothing here" : "No matches").foregroundStyle(.secondary)
                } else if search.isEmpty {
                    grouped(ResourceInventory(resources))
                } else {
                    rows(resources)
                }
            }
            .refreshable { await reload() }
        }
        .searchable(text: $search, prompt: "Search by name")
        .navigationTitle(category.label)
    }

    @ViewBuilder private func grouped(_ inventory: ResourceInventory) -> some View {
        if inventory.clusters.isEmpty {
            rows(inventory.standalone)
        } else {
            Section("Clusters") {
                ForEach(inventory.clusters) { cluster in
                    NavigationLink {
                        ClusterView(account: account, membership: cluster.membership, name: cluster.resource.name, region: cluster.resource.region)
                    } label: {
                        ClusterRow(cluster: cluster)
                    }
                }
            }
            if !inventory.standalone.isEmpty {
                Section("Not in a cluster") { rows(inventory.standalone) }
            }
        }
    }

    private func rows(_ resources: [Resource]) -> some View {
        ForEach(resources) { resource in
            NavigationLink { ResourceDetailView(resourceId: resource.id, account: account) } label: { ResourceRow(resource: resource) }
        }
    }
}

/// A resource with its type's icon, its type and status, and its health when it isn't healthy.
struct ResourceRow: View {
    let resource: Resource
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Label {
            // Large text puts the badge under the name, so the name keeps its room.
            let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout())
            layout {
                VStack(alignment: .leading, spacing: 2) {
                    Text(resource.title).font(.body.weight(.medium)).lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                    Text("\(resource.typeLabel) · \(resource.status)").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                if !typeSize.isAccessibilitySize { Spacer() }
                if resource.health != "healthy" {
                    StatusBadge(text: resource.health.sentenceCased, tone: .ofHealth(resource.health))
                }
            }
        } icon: {
            IconTile(.type(resource.type))
        }
    }
}
