import SwiftUI

/// Pipelines running now and those that failed, for the selected account's environment.
struct PipelinesView: View {
    @Environment(AppModel.self) private var app
    @State private var starting = false
    @State private var refresh = 0

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                Loaded(id: "\(account.id)-\(refresh)") {
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
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { AccountPicker() }
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
}

private struct PipelineRow: View {
    let item: PipelineActivityItem

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(item.appName) · \(item.name)").font(.body.weight(.medium)).lineLimit(1)
                Text("\(item.run.commit) “\(item.run.title)”").font(.caption).lineLimit(2)
                HStack(spacing: 6) {
                    BranchTag(branch: item.run.branch)
                    if let actor = item.run.actor { Text(actor).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
            }
        } icon: {
            PipelineStatusIcon(status: item.run.status)
        }
    }
}
