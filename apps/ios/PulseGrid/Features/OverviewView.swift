import SwiftUI

/// The selected account at a glance: overall health, what needs attention, and each kind of service.
struct OverviewView: View {
    @Environment(AppModel.self) private var app

    private struct Snapshot {
        let categories: [ServiceCategorySummary]
        let problems: [Resource]
    }

    var body: some View {
        NavigationStack {
            Group {
                if let account = app.selectedAccount {
                    Loaded(id: account.id) {
                        async let categories: [ServiceCategorySummary] = app.api.get("resources/categories", query: ["account": account.id])
                        async let problems: ResourcePage = app.api.get("resources", query: ["account": account.id, "health": "degraded", "limit": "50"])
                        return try await Snapshot(categories: categories, problems: problems.resources)
                    } content: { snapshot, reload in
                        List {
                            Section {
                                HealthSummary(health: .sum(snapshot.categories.map(\.health)))
                            } header: {
                                Text(account.title)
                            }
                            Section("Needs attention") {
                                if snapshot.problems.isEmpty {
                                    Label {
                                        Text("Everything is healthy")
                                    } icon: {
                                        IconTile(symbol: "checkmark", color: .green)
                                    }
                                }
                                ForEach(snapshot.problems) { resource in
                                    NavigationLink { ResourceDetailView(resourceId: resource.id, account: account) } label: {
                                        ResourceRow(resource: resource)
                                    }
                                }
                            }
                            Section("Services") {
                                ForEach(snapshot.categories) { CategoryRow(category: $0) }
                            }
                        }
                        .refreshable { await reload() }
                    }
                } else {
                    NoAccountView()
                }
            }
            .navigationTitle("Overview")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountPicker() } }
        }
    }
}
