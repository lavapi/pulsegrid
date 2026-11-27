import SwiftUI

/// Database access: approvers answer requests and manage who has access; everyone else asks for access and follows their request.
struct AccessView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if app.user?.can(.grantDatabaseAccess) == true {
                ApproverAccessView()
            } else {
                MyAccessView()
            }
        }
        .navigationTitle("Access")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    if app.user?.can(.grantDatabaseAccess) == true { AccessHistoryView() } else { MyAccessHistoryView() }
                } label: {
                    Label("History", systemImage: "clock.arrow.circlepath")
                }
            }
        }
    }
}

// MARK: - Everyone else

private struct MyAccessView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loaded(id: "mine") {
            let access = try await app.api.get("database-access/mine") as MyDatabaseAccess
            if case .ready(_, _, _, let grant) = access { LiveActivities.follow(access: grant) }
            return access
        } content: { access, reload in
            switch access {
            case .unavailable(let message):
                ContentUnavailableView("Not available here", systemImage: "cylinder", description: Text(message))
            case let .ready(maxHours, suggestedUserName, request, grant):
                Form {
                    if let grant, grant.status == "active" || grant.status == "granting" {
                        Section {
                            Label {
                                HStack {
                                    Text("Production database").font(.headline)
                                    Spacer()
                                    StatusBadge(text: grant.status == "active" ? "Active" : "Granting", tone: grant.status == "active" ? .good : .active)
                                }
                            } icon: {
                                IconTile(symbol: "cylinder.split.1x2.fill", color: .blue)
                            }
                            if grant.status == "active" {
                                AccessCountdown(grant: grant, size: 84)
                            }
                        } header: {
                            Text("Your access")
                        } footer: {
                            Text("Connect from your computer: open Database access on the PulseGrid website and choose How to connect.")
                        }
                    } else if let request, request.status == "pending" {
                        WaitingSection(request: request, reload: reload)
                    } else {
                        if let note = outcome(of: request, grant: grant) {
                            Section { Text(note).foregroundStyle(.secondary) }
                        }
                        RequestSection(maxHours: maxHours, suggestedUserName: suggestedUserName, reload: reload)
                    }
                }
                .refreshable { await reload() }
            }
        }
    }

    private func outcome(of request: DatabaseAccessRequest?, grant: DatabaseAccessGrant?) -> String? {
        switch request?.status {
        case "declined":
            let by = request?.decidedBy ?? "An approver"
            return request?.declineReason.map { "\(by) declined your last request: \($0)" } ?? "\(by) declined your last request."
        case "expired":
            return "Your last request expired before anyone answered it."
        case "approved" where grant?.status == "failed":
            return "Your last request was approved, but AWS couldn't grant it: \(grant?.failure ?? "unknown reason")"
        default:
            return nil
        }
    }
}

private struct WaitingSection: View {
    @Environment(AppModel.self) private var app
    let request: DatabaseAccessRequest
    let reload: () async -> Void

    var body: some View {
        Section {
            Label {
                HStack {
                    Text("Waiting for an approver").font(.headline)
                    Spacer()
                    StatusBadge(text: "\(request.hours) h", tone: .neutral)
                }
            } icon: {
                IconTile(symbol: "hourglass", color: .orange)
            }
            Text(request.reason).font(.callout)
            Text("You'll get a notification when someone answers.").font(.footnote).foregroundStyle(.secondary)
            Button("Cancel request", role: .destructive) {
                Task {
                    do {
                        let _: DatabaseAccessRequest = try await app.api.post("database-access/requests/\(request.id)/cancel", body: APIClient.Empty())
                        await reload()
                    } catch {
                        app.show(error)
                    }
                }
            }
        } header: {
            Text("Your request")
        }
    }
}

private struct RequestSection: View {
    @Environment(AppModel.self) private var app
    let maxHours: Int
    let reload: () async -> Void
    @State private var userName: String
    @State private var hours = 1
    @State private var reason = ""
    @State private var sending = false

    init(maxHours: Int, suggestedUserName: String, reload: @escaping () async -> Void) {
        self.maxHours = maxHours
        self.reload = reload
        _userName = State(initialValue: suggestedUserName)
    }

    var body: some View {
        Section {
            TextField("Identity Center user name", text: $userName)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
            HoursPicker(title: "For", maxHours: maxHours, hours: $hours)
            TextField("What you need to look at", text: $reason, axis: .vertical)
            Button("Request access") { Task { await send() } }
                .disabled(sending || userName.trimmingCharacters(in: .whitespaces).isEmpty || reason.trimmingCharacters(in: .whitespaces).isEmpty)
        } header: {
            Text("Request access")
        } footer: {
            Text("Read-only access to the production database, ending on its own. An approver answers it.")
        }
    }

    private func send() async {
        sending = true
        defer { sending = false }
        struct Ask: Encodable { let userName: String; let hours: Int; let reason: String }
        do {
            let _: DatabaseAccessRequest = try await app.api.post(
                "database-access/requests",
                body: Ask(userName: userName.trimmingCharacters(in: .whitespaces), hours: hours, reason: reason.trimmingCharacters(in: .whitespacesAndNewlines))
            )
            reason = ""
            await reload()
        } catch {
            app.show(error)
        }
    }
}
