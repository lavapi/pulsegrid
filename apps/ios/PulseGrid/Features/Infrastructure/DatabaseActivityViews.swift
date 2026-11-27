import SwiftUI

/// The statements that load a database most, from Performance Insights.
struct TopSqlScreen: View {
    @Environment(AppModel.self) private var app
    let resource: Resource
    @State private var range = "1h"

    private static let ranges = [("1h", "1 hour"), ("24h", "24 hours"), ("7d", "7 days")]

    var body: some View {
        Loaded(id: "\(resource.id)-\(range)") {
            try await app.api.get("resources/\(resource.id)/top-sql", query: ["range": range]) as TopSqlReport
        } content: { report, reload in
            List {
                Section {
                    Picker("Range", selection: $range) {
                        ForEach(Self.ranges, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.segmented)
                    InsightNotice(access: report.access, problem: report.problem)
                }
                ForEach(report.instances) { instance in
                    Section(instance.instance) {
                        if let unavailable = instance.unavailable { Text(unavailable).foregroundStyle(.secondary) }
                        ForEach(instance.statements) { statement in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(statement.statement).font(.caption.monospaced()).lineLimit(6).textSelection(.enabled)
                                Text([
                                    "\(statement.share.formatted(.percent.precision(.fractionLength(0)))) of the load",
                                    statement.avgLatencyMs.map { "\($0.formatted(.number.precision(.fractionLength(0...1)))) ms" },
                                    statement.callsPerSecond.map { "\($0.formatted(.number.precision(.fractionLength(0...1))))/s" },
                                ].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle("Top SQL")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A database's log lines and slow queries from the last hour, by level.
struct DatabaseLogScreen: View {
    @Environment(AppModel.self) private var app
    let resource: Resource
    @State private var level: DatabaseLogLevel = .problems

    var body: some View {
        Loaded(id: "\(resource.id)-\(level.rawValue)") {
            let query = ["since": Date.now.addingTimeInterval(-3600).formatted(.iso8601), "level": level.rawValue]
            return try await app.api.get("resources/\(resource.id)/database-log", query: query) as DatabaseLogReport
        } content: { report, reload in
            List {
                Section {
                    Picker("Show", selection: $level) {
                        ForEach(DatabaseLogLevel.allCases) { Text($0.label).tag($0) }
                    }
                    InsightNotice(access: report.access, problem: report.problem)
                } footer: {
                    if report.partial { Text("Older lines from this hour may be missing.") }
                }
                if !report.slowQueries.isEmpty {
                    Section("Slow queries") {
                        ForEach(report.slowQueries) { query in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(query.statement).font(.caption.monospaced()).lineLimit(5).textSelection(.enabled)
                                Text("\(query.time.formatted(date: .omitted, time: .standard)) · \(Int(query.durationMs)) ms · \(query.instance)")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Log") {
                    if report.lines.isEmpty && report.access.allowed { Text("Nothing in the last hour").foregroundStyle(.secondary) }
                    ForEach(report.lines.reversed()) { line in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.message).font(.caption.monospaced()).textSelection(.enabled)
                            Text("\(line.time.formatted(date: .omitted, time: .standard)) · \(line.severity) · \(line.instance)")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle("Database logs")
        .navigationBarTitleDisplayMode(.inline)
    }
}
