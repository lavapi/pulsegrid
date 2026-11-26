import SwiftUI

/// PulseGrid's own activity log: who did what, newest first.
struct ActivityView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loaded(id: "activity") {
            try await app.api.get("audit-events", query: ["limit": "50"]) as AuditEventPage
        } content: { page, reload in
            List(page.events) { event in
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.title).font(.body.weight(.medium))
                    if let subject = event.subject { Text(subject).font(.subheadline) }
                    Text("\(event.actorEmail ?? "PulseGrid") · \(event.occurredAt, format: .relative(presentation: .named))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle("Activity")
    }
}
