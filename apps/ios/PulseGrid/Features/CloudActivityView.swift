import SwiftUI

/// What changed in the selected AWS account, from CloudTrail, newest first, with older pages on request.
struct CloudActivityView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let account = app.selectedAccount {
                CloudActivityList(account: account).id(account.id)
            } else {
                NoAccountView()
            }
        }
        .navigationTitle("Cloud activity")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountPicker() } }
    }
}

private struct CloudActivityList: View {
    @Environment(AppModel.self) private var app
    let account: CloudAccount
    @State private var query = CloudActivityQuery()
    @State private var events: [CloudActivityEvent] = []
    @State private var before: String?
    @State private var notice: String?
    @State private var error: AppError?
    @State private var loading = false

    var body: some View {
        List {
            Section {
                Picker("Search in", selection: $query.searchIn) {
                    ForEach(CloudActivitySearch.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                Toggle("Show reads", isOn: $query.includeReads)
            } footer: {
                Text("Reads are calls that only look, such as listing services.")
            }
            if let error { RefreshBanner(error: error).listRowBackground(Color.clear) }
            if let notice { Text(notice).foregroundStyle(.secondary) }
            if events.isEmpty && !loading && notice == nil && error == nil {
                Text("Nothing found").foregroundStyle(.secondary)
            }
            ForEach(DayGroup.grouping(events, by: \.occurredAt)) { group in
                Section(group.title) {
                    ForEach(group.items) { CloudActivityRow(event: $0) }
                }
            }
            if before != nil {
                Button(loading ? "Loading…" : "Load older") { Task { await load(more: true) } }.disabled(loading)
            }
        }
        .searchable(text: $query.text, prompt: query.searchIn == .actor ? "Who, such as an email or role" : "Resource name")
        .refreshable { await load(more: false) }
        .overlay { if loading && events.isEmpty { ProgressView() } }
        .task(id: query) {
            // Waits for a pause in typing, since the server allows only so many reads a minute.
            if !query.text.isEmpty { try? await Task.sleep(for: .milliseconds(500)) }
            if !Task.isCancelled { await load(more: false) }
        }
    }

    private func load(more: Bool) async {
        loading = true
        defer { loading = false }
        do {
            let page: CloudActivityPage = try await app.api.get(
                "cloud/accounts/\(account.id)/activity",
                query: query.parameters(before: more ? before : nil)
            )
            events = more ? events + page.events : page.events
            before = page.before
            notice = page.error
            error = nil
        } catch {
            let appError = AppError.from(error)
            if appError != .cancelled { self.error = appError }
        }
    }
}

private struct CloudActivityRow: View {
    let event: CloudActivityEvent

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(event.label).font(.body.weight(.medium)).lineLimit(2)
                    Spacer()
                    if let code = event.errorCode { StatusBadge(text: code, tone: .bad) }
                }
                if let resource = event.resource { Text(resource).font(.caption.monospaced()).lineLimit(1) }
                HStack(spacing: 4) {
                    if event.viaDashboard { Image(systemName: "square.grid.2x2").accessibilityLabel("Through PulseGrid") }
                    Text("\(event.actor) · \(event.occurredAt, format: .dateTime.hour().minute()) · \(event.region)").lineLimit(1)
                }
                .font(.caption).foregroundStyle(.secondary)
            }
        } icon: {
            IconTile(symbol: event.errorCode == nil ? "cloud.fill" : "exclamationmark.icloud.fill", color: event.errorCode == nil ? .cyan : .red)
        }
    }
}
