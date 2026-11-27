import SwiftUI

/// A load balancer's last hour: how many requests, how fast, the busiest paths, and the requests themselves.
struct RequestLogsView: View {
    @Environment(AppModel.self) private var app
    let resource: Resource
    @State private var filter: RequestStatusFilter = .all

    private struct Snapshot {
        let summary: RequestLogSummary
        let page: RequestLogPage
    }

    var body: some View {
        Loaded(id: "\(resource.id)-\(filter.rawValue)") {
            let path = "resources/\(resource.id)/request-log"
            let query = filter.query(until: .now)
            async let summary: RequestLogSummary = app.api.get("\(path)/summary", query: RequestStatusFilter.all.query(until: .now))
            async let page: RequestLogPage = app.api.get(path, query: query)
            return try await Snapshot(summary: summary, page: page)
        } content: { snapshot, reload in
            List {
                Section {
                    InsightNotice(access: snapshot.summary.access, problem: snapshot.summary.problem)
                    if snapshot.summary.access.allowed && snapshot.summary.problem == nil {
                        SummaryRows(summary: snapshot.summary)
                    }
                } header: {
                    Text("Last hour")
                } footer: {
                    if snapshot.summary.partial { Text("Only the newest part of the hour was read.") }
                }
                if !snapshot.summary.topPaths.isEmpty {
                    Section("Busiest paths") {
                        ForEach(snapshot.summary.topPaths.prefix(5)) { LabeledContent($0.key, value: $0.count.formatted()) }
                    }
                }
                Section {
                    Picker("Status", selection: $filter) {
                        ForEach(RequestStatusFilter.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if snapshot.page.entries.isEmpty && snapshot.page.access.allowed {
                        Text("No requests").foregroundStyle(.secondary)
                    }
                    ForEach(snapshot.page.entries) { RequestRow(entry: $0) }
                } header: {
                    Text("Requests")
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle("Requests")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct SummaryRows: View {
    let summary: RequestLogSummary

    var body: some View {
        LabeledContent("Requests", value: summary.requests.formatted())
        LabeledContent("Errors (5xx)", value: summary.errorRate.formatted(.percent.precision(.fractionLength(0...1))))
        if let p50 = summary.p50Ms, let p95 = summary.p95Ms {
            LabeledContent("Response time", value: "\(Int(p50)) ms typical · \(Int(p95)) ms slowest 5%")
        }
        if summary.noTarget > 0 { LabeledContent("Answered without a service", value: summary.noTarget.formatted()) }
    }
}

private struct RequestRow: View {
    let entry: RequestLogEntry

    private var tone: Tone {
        switch entry.status ?? 0 {
        case 500...: .bad
        case 400..<500: .warning
        default: .good
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("\(entry.method) \(entry.path)").font(.caption.monospaced()).lineLimit(2)
                Spacer()
                StatusBadge(text: entry.status.map(String.init) ?? "–", tone: tone)
            }
            Text([entry.time.formatted(date: .omitted, time: .standard), entry.host, entry.responseMs.map { "\(Int($0)) ms" }].compactMap { $0 }.joined(separator: " · "))
                .font(.caption2).foregroundStyle(.secondary)
        }
    }
}
