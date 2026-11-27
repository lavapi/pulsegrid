import SwiftUI

/// The selected account's services by category, each opening its resources.
struct InfrastructureView: View {
    @Environment(AppModel.self) private var app
    @Binding var openResourceId: String?

    var body: some View {
        NavigationStack {
            Group {
                if let account = app.selectedAccount {
                    Loaded(id: account.id) {
                        try await app.api.get("resources/categories", query: ["account": account.id]) as [ServiceCategorySummary]
                    } content: { categories, reload in
                        List(categories) { category in
                            NavigationLink {
                                CategoryResourcesView(account: account, category: category)
                            } label: {
                                CategoryRow(category: category)
                            }
                        }
                        .refreshable { await reload() }
                    }
                } else {
                    NoAccountView()
                }
            }
            .navigationTitle("Infrastructure")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountPicker() } }
            .navigationDestination(item: $openResourceId) { id in
                if let account = app.selectedAccount { ResourceDetailView(resourceId: id, account: account) }
            }
        }
    }
}

/// A category's name with its health counts, shared by Overview and Infrastructure.
struct CategoryRow: View {
    let category: ServiceCategorySummary

    var body: some View {
        HStack {
            Text(category.label).font(.body.weight(.medium))
            Spacer()
            HealthBadges(health: category.health)
        }
    }
}

/// One category's resources, searchable by name.
struct CategoryResourcesView: View {
    @Environment(AppModel.self) private var app
    let account: CloudAccount
    let category: ServiceCategorySummary
    @State private var search = ""

    var body: some View {
        Loaded(id: "\(account.id)-\(category.id)-\(search)") {
            var query = ["account": account.id, "category": category.category, "limit": "100"]
            if !search.isEmpty { query["q"] = search }
            return try await app.api.get("resources", query: query) as ResourcePage
        } content: { page, reload in
            List {
                if page.resources.isEmpty {
                    Text(search.isEmpty ? "Nothing here" : "No matches").foregroundStyle(.secondary)
                }
                ForEach(page.resources) { resource in
                    NavigationLink { ResourceDetailView(resourceId: resource.id, account: account) } label: { ResourceRow(resource: resource) }
                }
            }
            .refreshable { await reload() }
        }
        .searchable(text: $search, prompt: "Search by name")
        .navigationTitle(category.label)
    }
}

/// A resource's name, type, status and health in a list.
struct ResourceRow: View {
    let resource: Resource

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(resource.title).font(.body.weight(.medium)).lineLimit(1)
                Spacer()
                StatusBadge(text: resource.health.sentenceCased, tone: .ofHealth(resource.health))
            }
            Text("\(resource.typeLabel) · \(resource.status) · \(resource.region)").font(.caption).foregroundStyle(.secondary)
        }
    }
}
