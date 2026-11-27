import SwiftUI

/// The newest log lines of a service, from the last hour, searchable.
struct ResourceLogsView: View {
    @Environment(AppModel.self) private var app
    let resource: Resource
    @State private var search = ""

    var body: some View {
        Loaded(id: "\(resource.id)-\(search)") {
            var query = ["since": Date.now.addingTimeInterval(-3600).formatted(.iso8601)]
            if !search.isEmpty { query["search"] = search }
            return try await app.api.get("resources/\(resource.id)/logs", query: query) as LogView
        } content: { view, reload in
            List {
                if !view.access.allowed {
                    Text(view.access.reason ?? "You can't read these logs.").foregroundStyle(.secondary)
                } else if let error = view.error {
                    Text(error).foregroundStyle(.secondary)
                } else if view.lines.isEmpty {
                    Text("No log lines in the last hour").foregroundStyle(.secondary)
                }
                ForEach(view.lines.reversed()) { line in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(line.timestamp, format: .dateTime.hour().minute().second()).font(.caption2).foregroundStyle(.secondary)
                        Text(line.message).font(.caption.monospaced()).textSelection(.enabled)
                    }
                }
            }
            .listStyle(.plain)
            .refreshable { await reload() }
        }
        .searchable(text: $search, prompt: "Search the logs")
        .navigationTitle("Logs")
        .navigationBarTitleDisplayMode(.inline)
    }
}
