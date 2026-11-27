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
                    LabeledContent("Health") { StatusBadge(text: resource.health.sentenceCased, tone: .ofHealth(resource.health)) }
                    LabeledContent("Status", value: resource.status)
                    if let seen = resource.lastSeenAt {
                        LabeledContent("Checked") { Text(seen, format: .relative(presentation: .named)) }
                    }
                    if let clusterName = resource.clusterName, let membership = ClusterMembership.forMember(resource.type) {
                        NavigationLink {
                            ClusterView(account: account, membership: membership, name: clusterName, region: resource.region)
                        } label: {
                            LabeledContent("Cluster", value: clusterName)
                        }
                    }
                }
                ResourceActionsSection(resource: resource, isProduction: account.isProduction)
                if resource.hasLoad { ResourceLoadSection(resourceId: resource.id) }
                if resource.hasLogs || resource.hasRequestLogs || resource.hasDatabaseActivity {
                    Section {
                        if resource.hasLogs { NavigationLink("Logs") { ResourceLogsView(resource: resource) } }
                        if resource.hasRequestLogs { NavigationLink("Requests") { RequestLogsView(resource: resource) } }
                        if resource.hasDatabaseActivity {
                            NavigationLink("Top SQL") { TopSqlScreen(resource: resource) }
                            NavigationLink("Database logs") { DatabaseLogScreen(resource: resource) }
                        }
                    }
                }
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

/// A resource's icon, name, type and region, at the top of its page.
struct ResourceHeader: View {
    let resource: Resource

    var body: some View {
        HStack(spacing: 14) {
            IconTile(.type(resource.type), size: 52)
            VStack(alignment: .leading, spacing: 4) {
                Text(resource.title).font(.title3.bold()).lineLimit(2)
                Text("\(resource.typeLabel) · \(resource.region)").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}
