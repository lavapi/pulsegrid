import SwiftUI

/// Finds any service, database, cache or server in the selected account by name.
struct SearchView: View {
    @Environment(AppModel.self) private var app
    @State private var query = ""

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                if trimmed.isEmpty {
                    ContentUnavailableView("Search \(account.title)", systemImage: "magnifyingglass", description: Text("Find a service, database, cache or server by name."))
                } else {
                    Loaded(id: "\(account.id)-\(trimmed)") {
                        try await Task.sleep(for: .milliseconds(300))
                        return try await app.api.get("resources", query: ["account": account.id, "q": trimmed, "limit": "50"]) as ResourcePage
                    } content: { page, _ in
                        if page.resources.isEmpty {
                            ContentUnavailableView.search(text: trimmed)
                        } else {
                            List(page.resources) { ResourceLink(account: account, resource: $0) }
                        }
                    }
                }
            } else {
                NoAccountView()
            }
        }
        .searchable(text: $query, prompt: "Services, databases, caches")
        .navigationTitle("Search")
    }
}
