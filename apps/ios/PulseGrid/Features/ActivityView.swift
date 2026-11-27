import SwiftUI

/// PulseGrid's own activity log: who did what, newest first, by day.
struct ActivityView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loaded(id: "activity") {
            try await app.api.get("audit-events", query: ["limit": "50"]) as AuditEventPage
        } content: { page, reload in
            List {
                if page.events.isEmpty {
                    ContentUnavailableView("Nothing yet", systemImage: "clock", description: Text("What people do in PulseGrid shows up here."))
                }
                ForEach(DayGroup.grouping(page.events, by: \.occurredAt)) { group in
                    Section(group.title) {
                        ForEach(group.items) { ActivityRow(event: $0) }
                    }
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle("Activity")
    }
}

private struct ActivityRow: View {
    let event: AuditEvent

    var body: some View {
        let style = ActivityStyle.of(action: event.action)
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title).font(.body.weight(.medium))
                if let subject = event.subject { Text(subject).font(.subheadline).lineLimit(2) }
                Text("\(event.actorEmail ?? "PulseGrid") · \(event.occurredAt, format: .dateTime.hour().minute())")
                    .font(.caption).foregroundStyle(.secondary)
            }
        } icon: {
            IconTile(symbol: style.symbol, color: style.color)
        }
    }
}
