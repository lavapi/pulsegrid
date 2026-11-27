import SwiftUI

/// Every environment with its health, opening what runs there and its addresses.
struct EnvironmentsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loaded(id: app.user?.tenant?.id ?? "") {
            try await app.api.get("environments") as [EnvironmentSummary]
        } content: { environments, reload in
            List {
                if environments.isEmpty {
                    Text("No environments yet. Add them on the PulseGrid website.").foregroundStyle(.secondary)
                }
                ForEach(environments) { environment in
                    NavigationLink { EnvironmentDetailView(environment: environment) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(environment.name).font(.body.weight(.medium))
                                Text(environment.accounts.map(\.name).joined(separator: ", ").nilIfEmpty ?? "No AWS account")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            HealthBadges(health: environment.health)
                        }
                    }
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle("Environments")
    }
}

struct EnvironmentDetailView: View {
    let environment: EnvironmentSummary

    var body: some View {
        List {
            Section {
                LabeledContent("Health") { HealthBadges(health: environment.health) }
                if let synced = environment.lastSyncedAt {
                    LabeledContent("Checked") { Text(synced, format: .relative(presentation: .named)) }
                }
            }
            if !environment.services.isEmpty {
                Section("Services") {
                    ForEach(environment.services) { service in
                        HStack {
                            Text(service.label)
                            Spacer()
                            HealthBadges(health: service.health)
                        }
                    }
                }
            }
            if !environment.domains.isEmpty {
                Section("Addresses") {
                    ForEach(environment.domains) { domain in
                        if let url = URL(string: domain.url) {
                            Link(destination: url) {
                                LabeledContent(domain.label ?? domain.kind.sentenceCased, value: url.host() ?? domain.url)
                            }
                        }
                    }
                }
            }
            Section("AWS accounts") {
                if environment.accounts.isEmpty { Text("None").foregroundStyle(.secondary) }
                ForEach(environment.accounts) { LabeledContent($0.name, value: $0.accountId) }
            }
        }
        .navigationTitle(environment.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
