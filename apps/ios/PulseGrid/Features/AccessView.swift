import SwiftUI

/// Database access: approvers answer requests; everyone else asks for access and follows their request.
struct AccessView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack {
            Group {
                if app.user?.can(.grantDatabaseAccess) == true {
                    RequestsList()
                } else {
                    MyAccessView()
                }
            }
            .navigationTitle("Database access")
        }
    }
}

// MARK: - Approvers

private struct RequestsList: View {
    @Environment(AppModel.self) private var app
    @State private var answering: (request: DatabaseAccessRequest, approve: Bool)?

    var body: some View {
        Loaded(id: "requests") {
            try await app.api.get("database-access/requests") as [DatabaseAccessRequest]
        } content: { requests, reload in
            if requests.isEmpty {
                ContentUnavailableView("No one is waiting", systemImage: "tray", description: Text("You'll get a notification when someone asks for access."))
                    .refreshable { await reload() }
            } else {
                List(requests) { request in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(request.requestedBy) · \(request.hours) \(request.hours == 1 ? "hour" : "hours")").font(.headline)
                        Text(request.reason)
                        Text("\(request.userName) · \(request.createdAt, format: .relative(presentation: .named))")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button("Decline", role: .destructive) { answering = (request, false) }
                            Spacer()
                            Button("Approve") { answering = (request, true) }.buttonStyle(.borderedProminent)
                        }
                        .buttonStyle(.bordered)
                        .padding(.top, 4)
                    }
                    .padding(.vertical, 4)
                }
                .refreshable { await reload() }
                .sheet(isPresented: Binding(get: { answering != nil }, set: { if !$0 { answering = nil } })) {
                    if let answering {
                        AnswerSheet(request: answering.request, approve: answering.approve) {
                            self.answering = nil
                            Task { await reload() }
                        }
                    }
                }
            }
        }
    }
}

private struct AnswerSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let request: DatabaseAccessRequest
    let approve: Bool
    let done: () -> Void

    @State private var hours: Int
    @State private var code = ""
    @State private var reason = ""
    @State private var sending = false
    @State private var error: AppError?

    init(request: DatabaseAccessRequest, approve: Bool, done: @escaping () -> Void) {
        self.request = request
        self.approve = approve
        self.done = done
        _hours = State(initialValue: request.hours)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(request.reason)
                } header: {
                    Text("\(request.requestedBy) asks")
                }
                if approve {
                    Section {
                        Picker("For", selection: $hours) {
                            ForEach(1...8, id: \.self) { Text("\($0) \($0 == 1 ? "hour" : "hours")").tag($0) }
                        }
                        TextField("Code from your authenticator app", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                    } footer: {
                        Text("Read-only access to the production database, ending on its own.")
                    }
                } else {
                    Section("Reason, optional") {
                        TextField("They see this and can ask again", text: $reason, axis: .vertical)
                    }
                }
                if let message = error?.message {
                    Section { Text(message).foregroundStyle(.red) }
                }
            }
            .navigationTitle(approve ? "Approve access" : "Decline request")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(approve ? "Approve" : "Decline") { Task { await send() } }
                        .disabled(sending || (approve && code.trimmingCharacters(in: .whitespaces).count < 6))
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func send() async {
        sending = true
        defer { sending = false }
        struct Approval: Encodable { let hours: Int; let code: String }
        struct Decline: Encodable { let reason: String? }
        do {
            let path = "database-access/requests/\(request.id)/\(approve ? "approve" : "decline")"
            let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
            let _: DatabaseAccessRequest = approve
                ? try await app.api.post(path, body: Approval(hours: hours, code: code.trimmingCharacters(in: .whitespaces)))
                : try await app.api.post(path, body: Decline(reason: trimmed.isEmpty ? nil : trimmed))
            done()
        } catch {
            code = ""
            let appError = AppError.from(error)
            if appError != .cancelled { self.error = appError }
        }
    }
}

// MARK: - Everyone else

private struct MyAccessView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loaded(id: "mine") {
            try await app.api.get("database-access/mine") as MyDatabaseAccess
        } content: { access, reload in
            switch access {
            case .unavailable(let message):
                ContentUnavailableView("Not available here", systemImage: "cylinder", description: Text(message))
            case let .ready(maxHours, suggestedUserName, request, grant):
                Form {
                    if let grant, grant.status == "active" || grant.status == "granting" {
                        Section("Your access") {
                            LabeledContent("Status") {
                                StatusBadge(text: grant.status == "active" ? "Active" : "Granting", tone: grant.status == "active" ? .good : .active)
                            }
                            LabeledContent("Until") { Text(grant.expiresAt, format: .dateTime.hour().minute()) }
                            Text("Connect from your computer: open Database access on the PulseGrid website and choose How to connect.")
                                .font(.footnote).foregroundStyle(.secondary)
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
            LabeledContent("Status") { StatusBadge(text: "Waiting", tone: .warning) }
            Text("\(request.hours) \(request.hours == 1 ? "hour" : "hours"): \(request.reason)")
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
            Picker("For", selection: $hours) {
                ForEach(1...maxHours, id: \.self) { Text("\($0) \($0 == 1 ? "hour" : "hours")").tag($0) }
            }
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
