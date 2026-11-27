import PDFKit
import SwiftUI

/// Past failover tests for the selected account, each opening its PDF report. Tests start on the website.
struct FailoverTestsView: View {
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
        .navigationTitle("Failover tests")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountPicker() } }
    }
}

private struct FailoverEntryRow: View {
    let entry: FailoverHistoryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(entry.label).font(.body.weight(.medium)).lineLimit(2)
                Spacer()
                StatusBadge(text: entry.result.sentenceCased, tone: .ofTestResult(entry.result))
            }
            if let counts = entry.counts, entry.isGroupRun {
                Text("\(counts.passed) of \(counts.total) passed").font(.caption)
            }
            Text([entry.startedBy, entry.startedAt?.formatted(date: .abbreviated, time: .shortened)].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary)
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
