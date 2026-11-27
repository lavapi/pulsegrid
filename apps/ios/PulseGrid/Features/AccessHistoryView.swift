import SwiftUI

/// Every grant that ended or failed, by the day it started, for approvers.
struct AccessHistoryView: View {
    var body: some View {
        DayGroupedHistory(path: "database-access/history", empty: "Access that ended or failed shows here.", date: \.startsAt) { (grant: DatabaseAccessGrant) in
            GrantRow(grant: grant)
        }
    }
}

/// The person's own requests and what came of them, by the day they asked.
struct MyAccessHistoryView: View {
    var body: some View {
        DayGroupedHistory(path: "database-access/mine/history", empty: "Your requests and how they ended show here.", date: \.request.createdAt) {
            (entry: MyDatabaseAccessHistoryEntry) in
            MyRequestRow(entry: entry)
        }
    }
}

/// A history list read from the API, in sections by day, newest first.
private struct DayGroupedHistory<Item: Decodable & Identifiable, Row: View>: View {
    @Environment(AppModel.self) private var app
    let path: String
    let empty: String
    let date: (Item) -> Date
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        Loaded(id: path) {
            try await app.api.get(path) as [Item]
        } content: { items, reload in
            Group {
                if items.isEmpty {
                    ContentUnavailableView("No history yet", systemImage: "clock", description: Text(empty))
                } else {
                    List(DayGroup.grouping(items, by: date)) { day in
                        Section(day.title) {
                            ForEach(day.items) { row($0) }
                        }
                    }
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One of the person's own requests: what they asked for and why, and how it ended.
private struct MyRequestRow: View {
    let entry: MyDatabaseAccessHistoryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(entry.request.reason).font(.headline).lineLimit(3)
                Spacer(minLength: 8)
                StatusBadge(text: "\(entry.grant?.hours ?? entry.request.hours) h", tone: .neutral)
            }
            Text(entry.request.userName).font(.caption).foregroundStyle(.secondary)
            HStack {
                Text(entry.request.createdAt, format: .dateTime.hour().minute())
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                StatusBadge(text: entry.outcome, tone: .ofRequest(entry))
            }
            if let note = entry.note {
                Text(note).font(.caption).foregroundStyle(entry.grant?.status == "failed" ? .red : .secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Who had access, for how long and why, who granted it and how it ended.
struct GrantRow: View {
    let grant: DatabaseAccessGrant

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Initials(name: grant.userName, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(grant.userName).font(.headline).lineLimit(2)
                    Text("Granted by \(grant.grantedBy)").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                StatusBadge(text: "\(grant.hours) h", tone: .neutral)
            }
            if !grant.reason.isEmpty {
                Text(grant.reason).font(.callout)
            }
            HStack {
                Group {
                    if grant.status == "failed" {
                        Text(grant.startsAt, format: .dateTime.hour().minute())
                    } else {
                        Text("\(grant.startsAt, format: .dateTime.hour().minute()) – \(grant.endsAt, format: .dateTime.hour().minute())")
                    }
                }
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                StatusBadge(text: grant.ending, tone: .ofGrant(grant))
            }
            if let failure = grant.failure {
                Text(failure).font(.caption).foregroundStyle(grant.status == "failed" ? .red : .secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

extension Tone {
    static func ofRequest(_ entry: MyDatabaseAccessHistoryEntry) -> Tone {
        if let grant = entry.grant { return ofGrant(grant) }
        switch entry.request.status {
        case "pending": return .active
        case "declined": return .bad
        default: return .neutral
        }
    }

    static func ofGrant(_ grant: DatabaseAccessGrant) -> Tone {
        switch grant.status {
        case "active": .good
        case "granting": .active
        case "failed": .bad
        default: grant.endReason == "manual" ? .warning : .neutral
        }
    }
}
