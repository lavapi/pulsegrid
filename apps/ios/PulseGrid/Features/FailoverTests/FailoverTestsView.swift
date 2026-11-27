import PDFKit
import SwiftUI

/// The selected account's failover tests: recent tests and group runs to follow live, what can be started, and the history.
struct FailoverTestsView: View {
    @Environment(AppModel.self) private var app
    @State private var starting: FailoverStart?
    @State private var following: FailoverLive?

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                Loaded(id: account.id) {
                    try await app.api.get("cloud/accounts/\(account.id)/experiments") as FailoverOverview
                } content: { overview, reload in
                    FailoverOverviewList(account: account, overview: overview) { starting = $0 }
                        .refreshable { await reload() }
                        .refreshing(while: overview.hasActiveTests, reload: reload)
                }
                .startingFailover($starting, following: $following, in: account)
            } else {
                NoAccountView()
            }
        }
        .navigationTitle("Failover tests")
        .accountTitleMenu()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { FailoverHistoryView() } label: { Label("History", systemImage: "clock.arrow.circlepath") }
            }
        }
    }
}

private struct FailoverOverviewList: View {
    let account: CloudAccount
    let overview: FailoverOverview
    let start: (FailoverStart) -> Void

    var body: some View {
        List {
            if let reason = overview.access.blockedReason {
                Section { Text(reason).font(.callout).foregroundStyle(.secondary) }
            }
            if let error = overview.error {
                Section { Text(error).foregroundStyle(.red) }
            }
            if !overview.experiments.isEmpty {
                Section {
                    ForEach(overview.experiments) { test in
                        NavigationLink { FailoverLiveView(account: account, live: .test(region: test.region, id: test.id)) } label: { FailoverTestRow(test: test) }
                    }
                } header: {
                    Text("Recent tests")
                } footer: {
                    Text("Started here or anywhere else in AWS.")
                }
            }
            if !overview.runs.isEmpty {
                Section("Group runs") {
                    ForEach(overview.runs) { run in
                        NavigationLink { FailoverLiveView(account: account, live: .run(id: run.id)) } label: { FailoverRunRow(run: run) }
                    }
                }
            }
            if overview.access.canRun && !overview.templates.isEmpty {
                Section {
                    StartRow(title: "Run all tests", detail: "\(overview.templates.count) tests, one at a time", symbol: "bolt.fill") {
                        start(.run(groupId: nil, label: "All tests"))
                    }
                    ForEach(overview.groups) { group in
                        StartRow(title: group.name, detail: "\(group.templates.count) \(group.templates.count == 1 ? "test" : "tests"), one at a time", symbol: "square.stack.3d.up.fill") {
                            start(.run(groupId: group.id, label: group.name))
                        }
                    }
                } header: {
                    Text("Start")
                } footer: {
                    Text("Groups are made on the website.")
                }
            }
            Section("Templates") {
                if overview.templates.isEmpty && overview.error == nil {
                    Text("No failover test templates. Create one in the AWS FIS console or with Terraform.").foregroundStyle(.secondary)
                }
                ForEach(overview.templates) { template in
                    NavigationLink { FailoverTemplateView(account: account, template: template, canRun: overview.access.canRun) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(template.label).font(.body.weight(.medium))
                            Text("\(template.steps.count) \(template.steps.count == 1 ? "step" : "steps") · \(template.region)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}

private struct StartRow: View {
    let title: String
    let detail: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.medium))
                    Text(detail).font(.caption).foregroundStyle(Color.secondary)
                }
            } icon: {
                IconTile(symbol: symbol, color: .orange)
            }
        }
    }
}

private struct FailoverTestRow: View {
    let test: FailoverTest

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(test.label).font(.body.weight(.medium)).lineLimit(2)
                if let startedAt = test.startedAt {
                    Text(startedAt, format: .relative(presentation: .named)).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            StatusBadge(text: FailoverState.label(of: test.state), tone: .ofTestResult(FailoverState.tone(of: test.state)))
        }
    }
}

private struct FailoverRunRow: View {
    let run: FailoverRunSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(run.label).font(.body.weight(.medium)).lineLimit(2)
            Text([run.startedBy, run.startedAt.formatted(date: .abbreviated, time: .shortened)].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary)
            Text(run.failed > 0 ? "\(run.started) started · \(run.failed) didn't start" : "\(run.started) started")
                .font(.caption).foregroundStyle(run.failed > 0 ? .orange : .secondary)
        }
    }
}

/// A template: what it acts on, its steps and stop alarms, and Start for people who may run it.
private struct FailoverTemplateView: View {
    let account: CloudAccount
    let template: FailoverTemplate
    let canRun: Bool
    @State private var starting: FailoverStart?
    @State private var following: FailoverLive?

    var body: some View {
        List {
            if let description = template.description, description != template.label {
                Section { Text(description) }
            }
            Section("Steps") {
                ForEach(template.steps, id: \.name) { FailoverStepRow(step: $0) }
            }
            FailoverTargetsSection(resources: [], targets: template.targets, stopAlarms: template.stopAlarms)
            if canRun {
                Section {
                    Button("Start test", role: .destructive) { starting = .template(template) }
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .navigationTitle(template.label)
        .navigationBarTitleDisplayMode(.inline)
        .startingFailover($starting, following: $following, in: account)
    }
}

private extension View {
    /// Shows the start sheet, then opens the started test or run to follow it live.
    func startingFailover(_ starting: Binding<FailoverStart?>, following: Binding<FailoverLive?>, in account: CloudAccount) -> some View {
        sheet(item: starting) { start in
            StartFailoverSheet(account: account, start: start) { live in
                starting.wrappedValue = nil
                following.wrappedValue = live
            }
        }
        .navigationDestination(item: following) { FailoverLiveView(account: account, live: $0) }
    }
}

/// Past failover tests for the selected account, each opening its PDF report.
private struct FailoverHistoryView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                Loaded(id: account.id) {
                    try await app.api.get("experiment-reports", query: ["account": account.id]) as FailoverHistory
                } content: { history, reload in
                    List {
                        if history.entries.isEmpty {
                            Text("No failover tests have run in this account.").foregroundStyle(.secondary)
                        }
                        ForEach(history.entries) { entry in
                            NavigationLink { FailoverReportView(report: entry.report) } label: { FailoverEntryRow(entry: entry) }
                        }
                    }
                    .refreshable { await reload() }
                }
            } else {
                NoAccountView()
            }
        }
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct FailoverEntryRow: View {
    let entry: FailoverHistoryEntry

    private var icon: (symbol: String, color: Color) {
        switch entry.result {
        case "passed": ("checkmark.shield.fill", .green)
        case "failed": ("xmark.shield.fill", .red)
        case "stopped": ("stop.fill", .orange)
        case "running": ("bolt.fill", .blue)
        default: ("questionmark", .gray)
        }
    }

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(entry.label).font(.body.weight(.medium)).lineLimit(2)
                    Spacer()
                    StatusBadge(text: entry.result.sentenceCased, tone: .ofTestResult(entry.result))
                }
                if let counts = entry.counts, entry.isGroupRun {
                    ProgressView(value: Double(counts.passed), total: Double(max(counts.total, 1))) {
                        Text("\(counts.passed) of \(counts.total) passed").font(.caption)
                    }
                    .tint(counts.passed == counts.total ? .green : .orange)
                }
                Text([entry.startedBy, entry.startedAt?.formatted(date: .abbreviated, time: .shortened)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
            }
        } icon: {
            IconTile(symbol: icon.symbol, color: icon.color)
        }
    }
}

/// A test's or a group run's PDF report, which can be shared from the phone.
struct FailoverReportView: View {
    @Environment(AppModel.self) private var app
    let report: FailoverReport

    var body: some View {
        Loaded(id: report.id) {
            var query = report.path.query
            query["timeZone"] = TimeZone.current.identifier
            let data = try await app.api.file(report.path.path, query: query)
            let file = FileManager.default.temporaryDirectory.appending(path: "Failover test \(report.id.prefix(8)).pdf")
            try data.write(to: file, options: .atomic)
            return file
        } content: { file, _ in
            PDFReport(url: file)
                .ignoresSafeArea(edges: .bottom)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { ShareLink(item: file) } }
        }
        .navigationTitle(report.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PDFReport: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.document = PDFDocument(url: url)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {}
}
