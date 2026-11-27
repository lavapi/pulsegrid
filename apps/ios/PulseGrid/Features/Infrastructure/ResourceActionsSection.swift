import SwiftUI

/// Force deploy or reboot, for people allowed to, each confirmed first; and how the last one went.
struct ResourceActionsSection: View {
    @Environment(AppModel.self) private var app
    let resource: Resource
    let isProduction: Bool
    @State private var options: [ResourceActionOption] = []
    @State private var latest: ActionRun?
    @State private var confirming: CloudAction?
    @State private var running = false

    var body: some View {
        Group {
            if !options.isEmpty || latest != nil {
                Section {
                    ForEach(options) { option in
                        if let action = option.action {
                            Button { confirming = action } label: { Label(action.buttonLabel, systemImage: action.systemImage) }
                                .disabled(option.blockedReason != nil || running || latest?.isRunning == true)
                            if let reason = option.blockedReason { Text(reason).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    if let latest { ActionRunRow(run: latest) }
                } header: {
                    Text("Actions")
                } footer: {
                    if isProduction { Text("This is a production account.") }
                }
            }
        }
        .task(id: resource.id) { await read() }
        .confirmationDialog(
            confirming.map { "\($0.buttonLabel) \(resource.title)?" } ?? "",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible,
            presenting: confirming
        ) { action in
            Button(action.buttonLabel, role: .destructive) { Task { await start(action) } }
        } message: { action in
            Text(action.explanation)
        }
    }

    private func read() async {
        let path = "resources/\(resource.id)/actions"
        async let options: [ResourceActionOption] = app.api.get(path)
        async let latest: ActionRun? = app.api.get("\(path)/runs/latest")
        self.options = ((try? await options) ?? []).filter { $0.action != nil }
        self.latest = (try? await latest) ?? nil
    }

    private func start(_ action: CloudAction) async {
        running = true
        defer { running = false }
        do {
            latest = try await app.api.post("resources/\(resource.id)/actions/\(action.rawValue)", body: APIClient.Empty())
        } catch {
            app.show(error)
        }
    }
}

private struct ActionRunRow: View {
    let run: ActionRun

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(run.title).font(.subheadline.weight(.medium))
                Spacer()
                StatusBadge(text: run.status.sentenceCased, tone: .ofActionRun(run.status))
            }
            Text(run.summary).font(.caption)
            Text("\(run.startedBy ?? "Someone") · \(run.startedAt, format: .relative(presentation: .named))").font(.caption).foregroundStyle(.secondary)
        }
    }
}
