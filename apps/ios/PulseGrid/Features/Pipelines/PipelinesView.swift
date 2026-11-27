import SwiftUI

/// Pipelines running now and those that failed, for the selected account's environment.
struct PipelinesView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                Loaded(id: account.id) {
                    try await app.api.get("pipelines/apps/activity", query: ["environment": account.environmentId ?? "none"]) as PipelineActivity
                } content: { activity, reload in
                    List {
                        ForEach(activity.issues, id: \.self) { issue in
                            Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                        }
                        Section("Running") {
                            if activity.running.isEmpty { Text("Nothing is running").foregroundStyle(.secondary) }
                            ForEach(activity.running) { item in
                                NavigationLink { PipelineRunView(appId: item.appId, runId: item.run.id) } label: { PipelineRow(item: item) }
                            }
                        }
                        Section("Failed") {
                            if activity.failed.isEmpty { Text("No failed pipelines").foregroundStyle(.secondary) }
                            ForEach(activity.failed) { item in
                                NavigationLink { PipelineRunView(appId: item.appId, runId: item.run.id) } label: { PipelineRow(item: item) }
                            }
                        }
                    }
                    .refreshable { await reload() }
                }
            } else {
                NoAccountView()
            }
        }
        .navigationTitle("Pipelines")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountPicker() } }
    }
}

private struct PipelineRow: View {
    let item: PipelineActivityItem

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("\(item.appName) · \(item.name)").font(.body.weight(.medium))
                Spacer()
                StatusBadge(text: item.run.status.sentenceCased, tone: .ofPipeline(item.run.status))
            }
            Text("\(item.run.branch) · \(item.run.commit) “\(item.run.title)”").font(.caption).lineLimit(2)
            if let actor = item.run.actor { Text(actor).font(.caption).foregroundStyle(.secondary) }
        }
    }
}
