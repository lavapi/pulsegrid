import SwiftUI

/// Every grant that ended or failed, by the day it started, for approvers.
struct AccessHistoryView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loaded(id: "access-history") {
            try await app.api.get("database-access/history") as [DatabaseAccessGrant]
        } content: { grants, reload in
            Group {
                if grants.isEmpty {
                    ContentUnavailableView("No history yet", systemImage: "clock", description: Text("Access that ended or failed shows here."))
                } else {
                    List(DayGroup.grouping(grants, by: \.startsAt)) { day in
                        Section(day.title) {
                            ForEach(day.items) { GrantRow(grant: $0) }
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
    static func ofGrant(_ grant: DatabaseAccessGrant) -> Tone {
        switch grant.status {
        case "active": .good
        case "granting": .active
        case "failed": .bad
        default: grant.endReason == "manual" ? .warning : .neutral
        }
    }
}
