import SwiftUI

/// One pipeline run with its jobs, re-run or cancelled from the phone by people allowed to.
struct PipelineRunView: View {
    @Environment(AppModel.self) private var app
    let appId: String
    let runId: String

    var body: some View {
        Loaded(id: runId) {
            try await app.api.get("pipelines/run", query: ["app": appId, "run": runId]) as PipelineRunDetail
        } content: { detail, reload in
            List {
                Section {
                    HStack(spacing: 12) {
                        PipelineStatusIcon(status: detail.run.status).font(.largeTitle)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(detail.run.title).font(.headline).lineLimit(3)
                            BranchTag(branch: detail.run.branch)
                        }
                    }
                    .padding(.vertical, 4)
                    LabeledContent("Status") { StatusBadge(text: detail.run.status.sentenceCased, tone: .ofPipeline(detail.run.status)) }
                    LabeledContent("Commit", value: detail.run.commit)
                    if let environment = detail.environmentName { LabeledContent("Environment", value: environment) }
                    if let actor = detail.run.actor { LabeledContent("Started by", value: actor) }
                    if let started = detail.run.startedAt {
                        LabeledContent("Started") { Text(started, format: .relative(presentation: .named)) }
                    }
                }
                RunActionsSection(detail: detail, reload: reload)
                Section("Jobs") {
                    if detail.jobs.isEmpty { Text("No jobs yet").foregroundStyle(.secondary) }
                    ForEach(detail.jobs) { job in
                        Label {
                            HStack {
                                Text(job.name).lineLimit(1)
                                Spacer()
                                if let seconds = job.durationSeconds {
                                    Text(Duration.seconds(seconds), format: .units(width: .narrow)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                                }
                            }
                        } icon: {
                            PipelineStatusIcon(status: job.status)
                        }
                    }
                }
                if let url = URL(string: detail.run.url) {
                    Section { Link(destination: url) { Label("Open on GitHub", systemImage: "arrow.up.right.square") } }
                }
            }
            .refreshable { await reload() }
            .navigationTitle("\(detail.app.name) #\(detail.run.number)")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct RunActionsSection: View {
    @Environment(AppModel.self) private var app
    let detail: PipelineRunDetail
    let reload: () async -> Void
    @State private var confirming: PipelineRunAction?
    @State private var working = false

    private var actions: [PipelineRunAction] {
        if detail.isActive { return [.cancel] }
        return detail.canRerunFailedJobs ? [.rerun(failedOnly: true), .rerun(failedOnly: false)] : [.rerun(failedOnly: false)]
    }

    var body: some View {
        Section {
            ForEach(actions, id: \.title) { action in
                Button(action.title, role: action == .cancel ? .destructive : nil) { confirming = action }
                    .disabled(!detail.access.canAct || working)
            }
        } footer: {
            if let reason = detail.access.reason, !detail.access.canAct { Text(reason) }
            else if detail.access.production { Text("This pipeline deploys to production.") }
        }
        .confirmationDialog(
            confirming.map { "\($0.title)?" } ?? "",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible,
            presenting: confirming
        ) { action in
            Button(action.title, role: action == .cancel ? .destructive : nil) { Task { await run(action) } }
        }
    }

    private func run(_ action: PipelineRunAction) async {
        working = true
        defer { working = false }
        do {
            switch action {
            case .cancel:
                try await app.api.postIgnoringResponse(action.path, body: RunRequest(appId: detail.app.id, runId: detail.run.id))
            case .rerun(let failedOnly):
                try await app.api.postIgnoringResponse(action.path, body: RerunRequest(appId: detail.app.id, runId: detail.run.id, failedOnly: failedOnly))
            }
            await reload()
        } catch {
            app.show(error)
        }
    }
}

private struct RunRequest: Encodable {
    let appId: String
    let runId: String
}

private struct RerunRequest: Encodable {
    let appId: String
    let runId: String
    let failedOnly: Bool
}
