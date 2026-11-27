import SwiftUI

/// A cluster with its members' health and the members themselves, each opening its own page.
struct ClusterView: View {
    @Environment(AppModel.self) private var app
    let account: CloudAccount
    let membership: ClusterMembership
    let name: String
    let region: String

    var body: some View {
        Loaded(id: "\(account.id)-\(membership.clusterType)-\(region)-\(name)") {
            let resources = try await app.api.allResources(account: account.id, category: membership.category)
            return ResourceInventory(resources).cluster(named: name, in: region)
        } content: { cluster, reload in
            Group {
                if let cluster {
                    content(cluster)
                } else {
                    ContentUnavailableView("Cluster not found", systemImage: "questionmark.circle", description: Text("It may have been removed since the last check."))
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ cluster: ResourceCluster) -> some View {
        List {
            Section {
                ResourceHeader(resource: cluster.resource)
                if cluster.members.isEmpty {
                    LabeledContent("Health") { StatusBadge(text: cluster.resource.health.sentenceCased, tone: .ofHealth(cluster.resource.health)) }
                } else {
                    HealthSummary(health: cluster.health)
                }
                LabeledContent("Status", value: cluster.resource.status)
                NavigationLink("Cluster details") { ResourceDetailView(resourceId: cluster.resource.id, account: account) }
            }
            Section(cluster.membership.membersTitle) {
                if cluster.members.isEmpty {
                    Text("No \(cluster.membership.memberNoun)s yet").foregroundStyle(.secondary)
                }
                ForEach(cluster.members) { member in
                    NavigationLink { ResourceDetailView(resourceId: member.id, account: account) } label: { ResourceRow(resource: member) }
                }
            }
        }
    }
}

/// A cluster in a category's list: its members' count and their health.
struct ClusterRow: View {
    let cluster: ResourceCluster

    var body: some View {
        Label {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(cluster.resource.title).font(.body.weight(.medium)).lineLimit(2)
                    Text("\(cluster.membership.counting(cluster.members.count)) · \(cluster.resource.status)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if cluster.members.isEmpty {
                    if cluster.resource.health != "healthy" {
                        StatusBadge(text: cluster.resource.health.sentenceCased, tone: .ofHealth(cluster.resource.health))
                    }
                } else {
                    CompactHealth(health: cluster.health)
                }
            }
        } icon: {
            IconTile(.type(cluster.resource.type))
        }
    }
}
