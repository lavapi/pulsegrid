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
                List {
                    Section {
                        ForEach(requests) { request in
                            RequestCard(request: request) { approve in answering = (request, approve) }
                                .swipeActions(edge: .trailing) {
                                    Button { answering = (request, true) } label: { Label("Approve", systemImage: "checkmark") }.tint(.green)
                                }
                                .swipeActions(edge: .leading) {
                                    Button { answering = (request, false) } label: { Label("Decline", systemImage: "xmark") }.tint(.red)
                                }
                        }
                    } header: {
                        Text("\(requests.count) waiting")
                    } footer: {
                        Text("Swipe left to approve, or right to decline.")
                    }
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

/// Who asks, for how long and why, with the two answers.
private struct RequestCard: View {
    let request: DatabaseAccessRequest
    let answer: (_ approve: Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Initials(name: request.requestedBy)
                VStack(alignment: .leading, spacing: 2) {
                    Text(request.requestedBy).font(.headline)
                    Text("\(request.userName) · \(request.createdAt, format: .relative(presentation: .named))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                StatusBadge(text: "\(request.hours) h", tone: .neutral)
            }
            Text(request.reason)
                .font(.callout)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 10, style: .continuous))
            HStack(spacing: 10) {
                Button(role: .destructive) { answer(false) } label: { Text("Decline").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                Button { answer(true) } label: { Text("Approve").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
            }
            .controlSize(.regular)
        }
        .padding(.vertical, 6)
    }
}

/// A person's initials in a tinted circle.
struct Initials: View {
    let name: String
    var size: CGFloat = 40

    private var letters: String {
        // An email's initials come from the part before the "@", so "vic@example.test" reads "V".
        let person = name.split(separator: "@").first.map(String.init) ?? name
        let words = person.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "_" || $0 == "-" })
        return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }

    var body: some View {
        Text(letters.isEmpty ? "?" : letters)
            .font(.system(size: size * 0.38, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color.accentColor.gradient, in: .circle)
            .accessibilityHidden(true)
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
            .sensoryFeedback(.error, trigger: error) { _, new in new != nil }
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
                            if grant.status == "active", grant.expiresAt > .now {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text("Ends in")
                                        Spacer()
                                        Text(timerInterval: Date.now...grant.expiresAt, countsDown: true)
                                            .font(.title3.weight(.semibold).monospacedDigit())
                                    }
                                    ProgressView(timerInterval: grant.startsAt...grant.expiresAt, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                                        .tint(.accentColor)
                                }
                                .padding(.vertical, 4)
                            }
                            LabeledContent("Until") { Text(grant.expiresAt, format: .dateTime.hour().minute()) }
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
