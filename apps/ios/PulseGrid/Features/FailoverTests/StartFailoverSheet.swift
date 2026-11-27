import SwiftUI

/// What the person is about to start: one template, or a group run (every template when there's no group).
enum FailoverStart: Identifiable {
    case template(FailoverTemplate)
    case run(groupId: String?, label: String)

    var id: String {
        switch self {
        case .template(let template): "template-\(template.region)-\(template.id)"
        case .run(let groupId, _): "run-\(groupId ?? "all")"
        }
    }

    /// The name the person types to confirm, as on the website.
    var label: String {
        switch self {
        case .template(let template): template.label
        case .run(_, let label): label
        }
    }
}

/// Confirms a start: what the tests do, the order a run follows, production's extra check, and the name typed out.
struct StartFailoverSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let account: CloudAccount
    let start: FailoverStart
    let started: (FailoverLive) -> Void

    @State private var order: FailoverRunOrder?
    @State private var typed = ""
    @State private var understood = false
    @State private var starting = false
    @State private var error: AppError?

    /// The server treats an account without an environment as production, so the app does too.
    private var production: Bool { account.isProduction || account.environmentId == nil }
    private var isRun: Bool { if case .run = start { true } else { false } }
    private var blocked: Bool { production && order?.busy != nil }
    private var ready: Bool {
        (!isRun || order != nil) && !blocked && FailoverConfirmation.matches(typed, start.label) && (!production || understood)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(isRun
                        ? "Each test deliberately breaks or slows the resources it targets until it finishes, a stop alarm fires, or someone stops it."
                        : "This deliberately breaks or slows the resources the template targets. It runs until it finishes, a stop alarm fires, or someone stops it.")
                }
                if case .run(let groupId, _) = start {
                    orderSection.task { await loadOrder(groupId: groupId) }
                }
                if production {
                    Section {
                        Toggle("I understand this runs in production", isOn: $understood)
                    } header: {
                        Text("Production")
                    } footer: {
                        Text("\(account.title) is a production account.")
                    }
                }
                Section("Type \(start.label) to confirm") {
                    TextField(start.label, text: $typed)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                if let message = error?.message {
                    Section { Text(message).foregroundStyle(.red) }
                }
            }
            .sensoryFeedback(.error, trigger: error) { _, new in new != nil }
            .navigationTitle(isRun ? "Start failover tests" : "Start failover test")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(starting ? "Starting…" : "Start", role: .destructive) { Task { await send() } }
                        .disabled(starting || !ready)
                }
            }
        }
    }

    @ViewBuilder private var orderSection: some View {
        Section {
            if let order {
                ForEach(Array(order.tests.enumerated()), id: \.offset) { index, test in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(index + 1). \(test.label)")
                        if test.zoneWide {
                            Text("Zone-wide, runs last").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if let busy = order.busy {
                    Text("\(busy) \(blocked ? "Production runs only start when nothing else is running." : "The first test waits until it ends.")")
                        .font(.callout).foregroundStyle(.orange)
                }
            } else {
                HStack { Text("Working out the order…").foregroundStyle(.secondary); Spacer(); ProgressView() }
            }
        } header: {
            Text("Order")
        } footer: {
            Text("Tests run one at a time in this order. Each starts only when the one before has ended and every service, load balancer target, database and cache is healthy again.")
        }
    }

    private func loadOrder(groupId: String?) async {
        do {
            order = try await app.api.get("cloud/accounts/\(account.id)/experiment-runs/order", query: groupId.map { ["groupId": $0] } ?? [:])
        } catch {
            let appError = AppError.from(error)
            if appError != .cancelled { self.error = appError }
        }
    }

    private func send() async {
        starting = true
        defer { starting = false }
        do {
            switch start {
            case .template(let template):
                struct Body: Encodable { let region: String; let templateId: String }
                let test: StartedFailover = try await app.api.post(
                    "cloud/accounts/\(account.id)/experiments", body: Body(region: template.region, templateId: template.id)
                )
                started(.test(region: test.region ?? template.region, id: test.id))
            case .run(let groupId, _):
                struct Body: Encodable { let groupId: String?; let confirmProduction: Bool? }
                let run: StartedFailover = try await app.api.post(
                    "cloud/accounts/\(account.id)/experiment-runs", body: Body(groupId: groupId, confirmProduction: production ? true : nil)
                )
                started(.run(id: run.id))
            }
        } catch {
            let appError = AppError.from(error)
            if appError != .cancelled { self.error = appError }
        }
    }
}

/// The typed name must match exactly, ignoring spaces around it.
nonisolated enum FailoverConfirmation {
    static func matches(_ typed: String, _ label: String) -> Bool {
        typed.trimmingCharacters(in: .whitespacesAndNewlines) == label
    }
}
