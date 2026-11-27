import SwiftUI

/// What is deployed where for the selected account, as on the web's Releases page.
struct ReleasesView: View {
    @Environment(AppModel.self) private var app
    @Binding var showProduction: Bool

    var body: some View {
        NavigationStack {
            Group {
                if let account = app.selectedAccount {
                    Loaded(id: account.id) {
                        try await app.api.get("releases", query: ["account": account.id]) as ReleasesOverview
                    } content: { overview, reload in
                        List {
                            if app.user?.can(.decideProductionReleases) == true {
                                Section { NavigationLink { ProductionReleaseView() } label: { IconRow(title: "Production release", symbol: "flag.checkered", color: .orange) } }
                            }
                            if overview.releases.isEmpty {
                                ContentUnavailableView(
                                    "No releases",
                                    systemImage: "shippingbox",
                                    description: Text("Link pipelines to services on the PulseGrid website to follow releases here.")
                                )
                            }
                            ForEach(overview.releases) { ReleaseRow(release: $0) }
                        }
                        .refreshable { await reload() }
                    }
                } else {
                    NoAccountView()
                }
            }
            .navigationTitle("Releases")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountPicker() } }
            .navigationDestination(isPresented: $showProduction) { ProductionReleaseView() }
        }
    }
}

private struct ReleaseRow: View {
    let release: Release

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(release.appName).font(.headline)
                        Text([release.serviceTitle, release.environmentName].compactMap { $0 }.joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    StatusBadge(text: release.state.sentenceCased, tone: .ofRelease(release.state))
                }
            } icon: {
                IconTile(symbol: "shippingbox.fill", color: .orange)
            }
            if !release.stages.isEmpty { StageLine(stages: release.stages) }
            if let run = release.run {
                Text("\(run.commit) “\(run.title)”").font(.caption).lineLimit(2)
                if let actor = run.actor, let started = run.startedAt {
                    Text("\(actor) · \(started, format: .relative(presentation: .named))").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let issue = release.issue {
                Label(issue, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 4)
    }
}

/// A release's stages as a row of segments, colored by how far each got, with their names under them.
private struct StageLine: View {
    let stages: [ReleaseStage]

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            ForEach(Array(stages.enumerated()), id: \.offset) { _, stage in
                VStack(alignment: .leading, spacing: 3) {
                    Capsule()
                        .fill(Tone.ofStage(stage.status).color.opacity(stage.status == "waiting" ? 0.25 : 1))
                        .frame(height: 5)
                    Text(stage.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(stages.map { "\($0.label) \($0.status.sentenceCased)" }.joined(separator: ", "))
    }
}
