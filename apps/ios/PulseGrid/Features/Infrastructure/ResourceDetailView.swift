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
                    LabeledContent("Health") { StatusBadge(text: resource.health.sentenceCased, tone: .ofHealth(resource.health)) }
                    LabeledContent("Status", value: resource.status)
                    LabeledContent("Type", value: resource.typeLabel)
                    LabeledContent("Region", value: resource.region)
                    if let seen = resource.lastSeenAt {
                        LabeledContent("Checked") { Text(seen, format: .relative(presentation: .named)) }
                    }
                }
                ResourceActionsSection(resource: resource, isProduction: account.isProduction)
                if resource.hasLoad { ResourceLoadSection(resourceId: resource.id) }
                if resource.hasLogs {
                    Section { NavigationLink("Logs") { ResourceLogsView(resource: resource) } }
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
