import SwiftUI

/// What is deployed where for the selected account, as on the web's Releases page.
struct ReleasesView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack {
            Group {
                if let account = app.selectedAccount {
                    Loaded(id: account.id) {
                        try await app.api.get("releases", query: ["account": account.id]) as ReleasesOverview
                    } content: { overview, reload in
                        if overview.releases.isEmpty {
                            ContentUnavailableView(
                                "No releases",
                                systemImage: "shippingbox",
                                description: Text("Link pipelines to services on the PulseGrid website to follow releases here.")
                            )
                        } else {
                            List(overview.releases) { release in
                                ReleaseRow(release: release)
                            }
                            .refreshable { await reload() }
                        }
                    }
                } else {
                    NoAccountView()
                }
            }
            .navigationTitle("Releases")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountPicker() } }
        }
    }
}

private struct ReleaseRow: View {
    let release: Release

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(release.appName).font(.headline)
                Spacer()
                StatusBadge(text: release.state.sentenceCased, tone: .ofRelease(release.state))
            }
            Text([release.serviceTitle, release.environmentName].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline).foregroundStyle(.secondary)
            if let run = release.run {
                Text("\(run.commit) “\(run.title)”").font(.caption).lineLimit(2)
                if let actor = run.actor, let started = run.startedAt {
                    Text("\(actor) · \(started, format: .relative(presentation: .named))").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let issue = release.issue {
                Text(issue).font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 2)
    }
}
