import SwiftUI

/// A test or a group run, followed live until it ends.
struct FailoverLiveView: View {
    let account: CloudAccount
    let live: FailoverLive

    var body: some View {
        switch live {
        case .test(let region, let id): FailoverTestView(account: account, region: region, id: id)
        case .run(let id): FailoverRunView(account: account, runId: id)
        }
    }
}

/// One test: its state, each step, what it acts on, and Stop while it runs.
private struct FailoverTestView: View {
    @Environment(AppModel.self) private var app
    let account: CloudAccount
    let region: String
    let id: String

    var body: some View {
        Loaded(id: "\(account.id)/\(region)/\(id)") {
            try await app.api.get("cloud/accounts/\(account.id)/experiments/\(region)/\(id)") as FailoverTestDetail
        } content: { test, reload in
            List {
                Section {
                    FailoverHeader(title: test.label, status: FailoverState.label(of: test.state), result: FailoverState.tone(of: test.state))
                    if let reason = test.reason {
                        Text(reason).font(.callout).foregroundStyle(.secondary)
                    }
                    FailoverTimes(startedBy: test.startedBy, startedAt: test.startedAt, endedAt: test.endedAt)
                }
                Section("Steps") {
                    ForEach(test.steps, id: \.name) { FailoverStepRow(step: $0) }
                }
                FailoverTargetsSection(resources: test.resources.map(\.title), targets: test.targets, stopAlarms: test.stopAlarms)
                if test.isActive && test.access.canRun {
                    StopFailoverSection(
                        label: "Stop test",
                        question: "Stop \(test.label)?",
                        path: "cloud/accounts/\(account.id)/experiments/\(region)/\(id)/stop",
                        explanation: "AWS stops every step that is still running and undoes what it can, such as removing injected faults.",
                        reload: reload
                    )
                }
            }
            .refreshable { await reload() }
            .refreshing(while: test.isActive, reload: reload)
        }
        .navigationTitle("Failover test")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A group run: each test in turn, why one waits or was skipped, what PulseGrid put right, and Stop all while it runs.
private struct FailoverRunView: View {
    @Environment(AppModel.self) private var app
    let account: CloudAccount
    let runId: String

    var body: some View {
        Loaded(id: "\(account.id)/runs/\(runId)") {
            try await app.api.get("cloud/accounts/\(account.id)/experiment-runs/\(runId)") as FailoverRunDetail
        } content: { run, reload in
            List {
                Section {
                    FailoverHeader(title: run.label, status: run.result.sentenceCased, result: run.result)
                    LabeledContent("Account", value: run.environmentName.map { "\(run.accountName) · \($0)" } ?? run.accountName)
                    FailoverTimes(startedBy: run.startedBy, startedAt: run.startedAt, endedAt: run.endedAt)
                    if let reason = run.stoppedReason {
                        Text(reason).font(.callout).foregroundStyle(.orange)
                    }
                    if let error = run.error {
                        Text(error).font(.callout).foregroundStyle(.red)
                    }
                }
                Section {
                    ForEach(Array(run.items.enumerated()), id: \.offset) { index, item in
                        FailoverRunItemRow(number: index + 1, item: item)
                    }
                } header: {
                    Text("Tests")
                } footer: {
                    if run.isRunning {
                        Text("Tests run one at a time. Each starts only when the one before has ended and everything is healthy again.")
                    }
                }
                if run.isRunning {
                    if run.access.canRun {
                        StopFailoverSection(
                            label: "Stop all",
                            question: "Stop every test in this run?",
                            path: "cloud/accounts/\(account.id)/experiment-runs/\(runId)/stop",
                            explanation: "AWS stops every test that is still running and undoes what it can, such as removing injected faults.",
                            reload: reload
                        )
                    }
                } else {
                    Section {
                        NavigationLink("Report") { FailoverReportView(report: .run(accountId: account.id, runId: runId, title: run.label)) }
                    }
                }
            }
            .refreshable { await reload() }
            .refreshing(while: run.isRunning, reload: reload)
        }
        .navigationTitle("Failover tests")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Parts

private struct FailoverHeader: View {
    let title: String
    let status: String
    let result: String

    var body: some View {
        HStack {
            Text(title).font(.headline)
            Spacer(minLength: 8)
            StatusBadge(text: status, tone: .ofTestResult(result))
        }
    }
}

private struct FailoverTimes: View {
    let startedBy: String?
    let startedAt: Date?
    let endedAt: Date?

    var body: some View {
        if let startedBy {
            LabeledContent("Started by", value: startedBy)
        }
        if let startedAt {
            LabeledContent("Started") { Text(startedAt, format: .dateTime.day().month().hour().minute().second()) }
        }
        if let endedAt {
            LabeledContent("Ended") { Text(endedAt, format: .dateTime.day().month().hour().minute().second()) }
        }
    }
}

struct FailoverStepRow: View {
    let step: FailoverStep

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(step.name).font(.body.weight(.medium))
                Spacer(minLength: 8)
                if let state = step.state {
                    StatusBadge(text: FailoverState.stepLabel(of: state), tone: .ofTestResult(FailoverState.stepTone(of: state)))
                } else if let duration = failoverDuration(step.duration) {
                    Text(duration).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            Text(step.description ?? step.actionId).font(.caption).foregroundStyle(.secondary)
            if let reason = step.reason {
                Text(reason).font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// What a test acts on, and the alarms that stop it.
struct FailoverTargetsSection: View {
    let resources: [String]
    let targets: [FailoverTarget]
    let stopAlarms: [String]

    var body: some View {
        Section("Acts on") {
            if resources.isEmpty {
                ForEach(targets, id: \.name) { target in
                    LabeledContent(target.name, value: target.resourceType)
                }
            } else {
                ForEach(resources, id: \.self) { Text($0) }
            }
        }
        if !stopAlarms.isEmpty {
            Section {
                ForEach(stopAlarms, id: \.self) { Text($0).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle) }
            } header: {
                Text("Stop alarms")
            } footer: {
                Text("The test stops on its own when one of these alarms fires.")
            }
        }
    }
}

private struct FailoverRunItemRow: View {
    let number: Int
    let item: FailoverRunItem

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(number). \(item.label)").font(.body.weight(.medium))
                Spacer(minLength: 8)
                StatusBadge(text: item.status.text, tone: .ofTestResult(item.status.result))
            }
            if let detail = item.detail {
                Text(detail).font(.caption).foregroundStyle(item.error == nil ? Color.secondary : Color.red)
            }
            if let startedAt = item.startedAt {
                Group {
                    if let endedAt = item.endedAt {
                        Text("\(startedAt, format: .dateTime.hour().minute()) – \(endedAt, format: .dateTime.hour().minute())")
                    } else {
                        Text("Started \(startedAt, format: .dateTime.hour().minute())")
                    }
                }
                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            ForEach(Array((item.repairs ?? []).enumerated()), id: \.offset) { _, repair in
                Label(repair.text, systemImage: repair.at == nil ? "exclamationmark.triangle" : "wrench.and.screwdriver")
                    .font(.caption)
                    .foregroundStyle(repair.at == nil ? .orange : .secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// A red Stop button that asks first, then tells AWS to stop.
private struct StopFailoverSection: View {
    @Environment(AppModel.self) private var app
    let label: String
    let question: String
    let path: String
    let explanation: String
    let reload: () async -> Void
    @State private var confirming = false
    @State private var stopping = false

    var body: some View {
        Section {
            Button(stopping ? "Stopping…" : label, role: .destructive) { confirming = true }
                .disabled(stopping)
                .frame(maxWidth: .infinity)
        }
        .confirmationDialog(question, isPresented: $confirming, titleVisibility: .visible) {
            Button(label, role: .destructive) { Task { await stop() } }
        } message: {
            Text(explanation)
        }
    }

    private func stop() async {
        stopping = true
        defer { stopping = false }
        do {
            try await app.api.postIgnoringResponse(path)
            await reload()
        } catch {
            app.show(error)
        }
    }
}
