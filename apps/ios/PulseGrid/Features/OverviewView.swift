import SwiftUI

/// The selected account's health by service, and what needs attention.
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
                            Section("Needs attention") {
                                if snapshot.problems.isEmpty {
                                    Label("Everything is healthy", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                                }
                                ForEach(snapshot.problems) { resource in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(resource.title).font(.body.weight(.medium))
                                        Text("\(resource.typeLabel) · \(resource.status) · \(resource.region)")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            Section("Services") {
                                ForEach(snapshot.categories) { category in
                                    CategoryRow(category: category)
                                }
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

private struct CategoryRow: View {
    let category: ServiceCategorySummary

    var body: some View {
        HStack {
            Text(category.label).font(.body.weight(.medium))
            Spacer()
            if category.health.degraded > 0 { StatusBadge(text: "\(category.health.degraded) degraded", tone: .bad) }
            if category.health.stopped > 0 { StatusBadge(text: "\(category.health.stopped) stopped", tone: .warning) }
            StatusBadge(text: "\(category.health.healthy) healthy", tone: .good)
        }
    }
}
