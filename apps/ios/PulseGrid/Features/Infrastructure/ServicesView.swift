import SwiftUI

/// Every service in the selected account, by kind and cluster, problems first; filtered by kind with the chips on top.
/// Failover tests and what changed in AWS follow at the end.
struct ServicesView: View {
    @Environment(AppModel.self) private var app
    @State private var only: String?

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                Loaded(id: account.id) {
                    try await app.api.allResources(account: account.id)
                } content: { resources, reload in
                    let all = ServiceSection.sections(of: resources)
                    List {
                        Section {
                            KindChips(sections: all, only: $only)
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        ForEach(all.filter { only == nil || $0.category == only }) { section in
                            Section {
                                InventoryRows(account: account, inventory: section.inventory)
                            } header: {
                                HStack {
                                    Text(section.label)
                                    Spacer()
                                    if section.problems > 0 {
                                        StatusBadge(text: section.problems == 1 ? "1 needs attention" : "\(section.problems) need attention", tone: .bad)
                                    }
                                }
                            }
                        }
                        Section("Tools") {
                            NavigationLink { FailoverTestsView() } label: { IconRow(title: "Failover tests", symbol: "bolt.shield.fill", color: .orange) }
                            if app.user?.can(.viewActivity) == true {
                                NavigationLink { CloudActivityView() } label: { IconRow(title: "Cloud activity", symbol: "cloud.fill", color: .cyan) }
                            }
                        }
                    }
                    .animation(.snappy, value: only)
                    .refreshable { await reload() }
                }
            } else {
                NoAccountView()
            }
        }
        .navigationTitle("Services")
    }
}

/// "All" and each kind of service as chips, with a red count on kinds that have problems.
private struct KindChips: View {
    let sections: [ServiceSection]
    @Binding var only: String?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", problems: sections.reduce(0) { $0 + $1.problems }, value: nil)
                ForEach(sections) { chip($0.label, problems: $0.problems, value: $0.category) }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)
        }
        .sensoryFeedback(.selection, trigger: only)
    }

    private func chip(_ title: String, problems: Int, value: String?) -> some View {
        let selected = only == value
        return Button { only = value } label: {
            HStack(spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold))
                if problems > 0 {
                    Text(problems, format: .number)
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(.red, in: .capsule)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .foregroundStyle(selected ? Color.white : .primary)
            .background(selected ? Color.accentColor : Color(.secondarySystemGroupedBackground), in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A kind of service's clusters, each opening its members, then the resources outside any cluster.
struct InventoryRows: View {
    let account: CloudAccount
    let inventory: ResourceInventory

    var body: some View {
        ForEach(inventory.clusters) { cluster in
            NavigationLink {
                ClusterView(account: account, membership: cluster.membership, name: cluster.resource.name, region: cluster.resource.region)
            } label: {
                ClusterRow(cluster: cluster)
            }
        }
        ForEach(inventory.standalone) { ResourceLink(account: account, resource: $0) }
    }
}

/// A resource's row, opening its page.
struct ResourceLink: View {
    let account: CloudAccount
    let resource: Resource

    var body: some View {
        NavigationLink { ResourceDetailView(resourceId: resource.id, account: account) } label: { ResourceRow(resource: resource) }
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
                    InventoryRows(account: account, inventory: ResourceInventory(resources))
                } else {
                    rows(resources)
                }
            }
            .refreshable { await reload() }
        }
        .searchable(text: $search, prompt: "Search by name")
        .navigationTitle(category.label)
    }

    private func rows(_ resources: [Resource]) -> some View {
        ForEach(resources) { ResourceLink(account: account, resource: $0) }
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
            IconTile(.of(resource))
        }
    }
}
