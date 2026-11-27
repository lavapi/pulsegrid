import SwiftUI

/// Everything shipping for the selected account: a production release waiting for a decision, pipelines running now,
/// what is deployed where, and what failed. It refreshes while something runs.
struct DeploysView: View {
    @Environment(AppModel.self) private var app
    @State private var filter = DeployFilter.all
    @State private var starting = false
    @State private var refresh = 0

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                Loaded(id: "\(account.id)-\(refresh)") {
                    try await load(account)
                } content: { deploys, reload in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 20) {
                            if let release = deploys.waitingRelease {
                                CardLink { ProductionReleaseView() } content: { WaitingReleaseRow(release: release) }
                            }
                            Picker("Show", selection: $filter) {
                                ForEach(DeployFilter.allCases, id: \.self) { Text(deploys.title(of: $0)).tag($0) }
                            }
                            .pickerStyle(.segmented)
                            if filter != .failed { running(deploys.running) }
                            if filter == .all { releases(deploys.releases) }
                            if filter != .running { failed(deploys.failed) }
                            if !deploys.issues.isEmpty {
                                ForEach(deploys.issues, id: \.self) { issue in
                                    Label(issue, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
                                }
                            }
                            DeployLinks()
                        }
                        .padding(.horizontal)
                        .padding(.bottom, 24)
                        .animation(.snappy, value: filter)
                    }
                    .background(Color(.systemGroupedBackground))
                    .refreshable { await reload() }
                    .refreshing(while: !deploys.running.isEmpty, every: .seconds(10), reload: reload)
                }
            } else {
                NoAccountView()
            }
        }
        .navigationTitle("Deploys")
        .toolbar {
            if app.selectedAccount?.environmentId != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { starting = true } label: { Label("Start a pipeline", systemImage: "play.fill") }
                }
            }
        }
        .sheet(isPresented: $starting) {
            if let account = app.selectedAccount {
                StartPipelineView(account: account) { refresh += 1 }
            }
        }
    }

    private func load(_ account: CloudAccount) async throws -> Deploys {
        let api = app.api
        let canDecide = app.user?.can(.decideProductionReleases) == true
        async let releases: ReleasesOverview = api.get("releases", query: ["account": account.id])
        async let pipelines: PipelineActivity? = account.environmentId == nil
            ? nil
            : api.get("pipelines/apps/activity", query: ["environment": account.environmentId ?? ""])
        async let production: ProductionReleasesView? = canDecide ? try? await api.get("production-releases/current") : nil
        var waiting: ProductionRelease?
        if case .ready(let current?)? = await production, current.isWaiting { waiting = current }
        if canDecide { LiveActivities.follow(release: waiting) }
        let activity = try await pipelines
        return try await Deploys(
            waitingRelease: waiting,
            releases: releases.releases,
            running: activity?.running ?? [],
            failed: activity?.failed ?? [],
            issues: activity?.issues ?? []
        )
    }

    @ViewBuilder private func running(_ runs: [PipelineActivityItem]) -> some View {
        if !runs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                CardSectionHeader(title: "Running", count: runs.count)
                ForEach(runs) { RunCard(item: $0) }
            }
        }
    }

    @ViewBuilder private func releases(_ releases: [Release]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            CardSectionHeader(title: "Releases")
            if releases.isEmpty {
                Card { Text("Link pipelines to services on the PulseGrid website to follow releases here.").font(.subheadline).foregroundStyle(.secondary) }
            }
            ForEach(releases) { ReleaseCard(release: $0) }
        }
    }

    @ViewBuilder private func failed(_ runs: [PipelineActivityItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            CardSectionHeader(title: "Failed", count: runs.isEmpty ? nil : runs.count)
            if runs.isEmpty {
                Card { Label("No failed pipelines", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
            }
            ForEach(runs) { RunCard(item: $0) }
        }
    }
}

/// Which deploys to show.
enum DeployFilter: CaseIterable {
    case all, running, failed
}

/// The Deploys tab's data.
private struct Deploys {
    let waitingRelease: ProductionRelease?
    let releases: [Release]
    let running: [PipelineActivityItem]
    let failed: [PipelineActivityItem]
    let issues: [String]

    /// "Running 2", with the count when there is one.
    func title(of filter: DeployFilter) -> String {
        switch filter {
        case .all: "All"
        case .running: running.isEmpty ? "Running" : "Running \(running.count)"
        case .failed: failed.isEmpty ? "Failed" : "Failed \(failed.count)"
        }
    }
}

private struct WaitingReleaseRow: View {
    let release: ProductionRelease

    var body: some View {
        IconTile(symbol: "flag.checkered", color: .orange, size: 40)
        VStack(alignment: .leading, spacing: 2) {
            Text("Production release waiting").font(.headline)
            Text(release.components.map { "\($0.name) \($0.tag)" }.joined(separator: ", ")).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
        }
        Spacer(minLength: 8)
        if let deadline = release.holdUntil, deadline > .now {
            Text(timerInterval: Date.now...deadline, countsDown: true)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(.orange)
        }
    }
}

/// A pipeline run as a card: status, what ran and on which branch, opening the run.
private struct RunCard: View {
    let item: PipelineActivityItem

    var body: some View {
        CardLink { PipelineRunView(appId: item.appId, runId: item.run.id) } content: {
            PipelineStatusIcon(status: item.run.status)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(item.appName) · \(item.name)").font(.headline).lineLimit(1)
                Text(item.run.title).font(.subheadline).lineLimit(2)
                HStack(spacing: 6) {
                    BranchTag(branch: item.run.branch)
                    if let actor = item.run.actor { Text(actor).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    if let started = item.run.startedAt {
                        Text(started, format: .relative(presentation: .named)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }
}

/// What is deployed for one service: its state, stages and the run behind it.
private struct ReleaseCard: View {
    let release: Release

    var body: some View {
        Card {
            HStack(spacing: 12) {
                IconTile(symbol: "shippingbox.fill", color: .orange, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(release.appName).font(.headline)
                    Text([release.serviceTitle, release.environmentName].compactMap { $0 }.joined(separator: " · "))
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                StatusBadge(text: release.state.sentenceCased, tone: .ofRelease(release.state))
            }
            if !release.stages.isEmpty { SegmentLine(stages: release.stages) }
            if let run = release.run {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(run.commit) “\(run.title)”").font(.caption).lineLimit(2)
                    if let actor = run.actor, let started = run.startedAt {
                        Text("\(actor) · \(started, format: .relative(presentation: .named))").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if let issue = release.issue {
                Label(issue, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange)
            }
        }
    }
}

/// Production releases and the activity log.
private struct DeployLinks: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 10) {
            if app.user?.can(.decideProductionReleases) == true {
                CardLink { ProductionReleaseView() } content: { link("Production releases", symbol: "flag.checkered", color: .orange) }
            }
            if app.user?.can(.viewActivity) == true {
                CardLink { ActivityView() } content: { link("Activity", symbol: "clock.fill", color: .blue) }
            }
        }
    }

    private func link(_ title: String, symbol: String, color: Color) -> some View {
        Label { Text(title).font(.body.weight(.medium)) } icon: { IconTile(symbol: symbol, color: color) }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
