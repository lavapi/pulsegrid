import SwiftUI

/// A resource's status and facts, its load, its logs and the actions the person may start.
struct ResourceDetailView: View {
    @Environment(AppModel.self) private var app
    let resourceId: String
    let account: CloudAccount

    var body: some View {
        Loaded(id: resourceId) {
            try await app.api.get("resources/\(resourceId)") as Resource
        } content: { resource, reload in
            List {
                Section {
                    ResourceHeader(resource: resource)
                    if let clusterName = resource.clusterName, let membership = ClusterMembership.forMember(resource.type) {
                        NavigationLink {
                            ClusterView(account: account, membership: membership, name: clusterName, region: resource.region)
                        } label: {
                            LabeledContent("Cluster", value: clusterName)
                        }
                    }
                }
                if resource.hasLoad { ResourceLoadSection(resourceId: resource.id) }
                ResourceShortcuts(resource: resource)
                ResourceActionsSection(resource: resource, isProduction: account.isProduction)
                if !resource.facts.isEmpty {
                    Section("Details") {
                        ForEach(resource.facts, id: \.label) { fact in
                            LabeledContent(fact.label, value: fact.value)
                        }
                    }
                }
            }
            .refreshable { await reload() }
            .navigationTitle(resource.title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// A resource's icon, name and type, with its health, status and when it was last checked, at the top of its page.
struct ResourceHeader: View {
    let resource: Resource

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                IconTile(.of(resource), size: 52)
                VStack(alignment: .leading, spacing: 4) {
                    Text(resource.title).font(.title3.bold()).lineLimit(2)
                    Text("\(resource.typeLabel) · \(resource.region)").font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                StatusBadge(text: resource.health.sentenceCased, tone: .ofHealth(resource.health))
                StatusBadge(text: resource.status.sentenceCased, tone: .neutral)
                Spacer(minLength: 0)
                if let seen = resource.lastSeenAt {
                    Text("Checked \(seen, format: .relative(presentation: .named))").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Logs, requests and database activity as tiles, for the resources that have them.
private struct ResourceShortcuts: View {
    let resource: Resource
    @State private var open: Shortcut?

    private enum Shortcut: Hashable { case logs, requests, topSql, databaseLogs }

    var body: some View {
        if resource.hasLogs || resource.hasRequestLogs || resource.hasDatabaseActivity {
            Section {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], spacing: 10) {
                    if resource.hasLogs { tile("Logs", symbol: "text.alignleft", color: .indigo, opens: .logs) }
                    if resource.hasRequestLogs { tile("Requests", symbol: "arrow.left.arrow.right", color: .purple, opens: .requests) }
                    if resource.hasDatabaseActivity {
                        tile("Top SQL", symbol: "chart.bar.xaxis", color: .blue, opens: .topSql)
                        tile("Database logs", symbol: "doc.text.magnifyingglass", color: .teal, opens: .databaseLogs)
                    }
                }
                .padding(.vertical, 4)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            .navigationDestination(item: $open) { shortcut in
                switch shortcut {
                case .logs: ResourceLogsView(resource: resource)
                case .requests: RequestLogsView(resource: resource)
                case .topSql: TopSqlScreen(resource: resource)
                case .databaseLogs: DatabaseLogScreen(resource: resource)
                }
            }
        }
    }

    private func tile(_ title: String, symbol: String, color: Color, opens shortcut: Shortcut) -> some View {
        Button { open = shortcut } label: {
            HStack(spacing: 10) {
                IconTile(symbol: symbol, color: color, size: 30)
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
