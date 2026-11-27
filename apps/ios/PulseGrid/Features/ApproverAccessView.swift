import SwiftUI

/// Approvers: waiting requests, who has access now and access granted outside PulseGrid,
/// with every change they can make. It refreshes while AWS is still granting or changing access.
struct ApproverAccessView: View {
    @Environment(AppModel.self) private var app
    @State private var action: ApproverAction?

    var body: some View {
        Loaded(id: "approver") {
            async let overview: DatabaseAccessOverview = app.api.get("database-access")
            async let requests: [DatabaseAccessRequest] = app.api.get("database-access/requests")
            return try await ApproverAccess(overview: overview, requests: requests)
        } content: { access, reload in
            switch access.overview {
            case .unavailable(let problems):
                ContentUnavailableView("Not set up", systemImage: "cylinder", description: Text(problems.joined(separator: "\n")))
                    .refreshable { await reload() }
            case let .ready(maxHours, grants, outside, outsideCheckedAt):
                List {
                    RequestsSection(requests: access.requests) { action = .answer($0, approve: $1) }
                    GrantsSection(grants: grants) { action = $0 }
                    OutsideSection(outside: outside, checkedAt: outsideCheckedAt)
                }
                .refreshable { await reload() }
                .refreshing(while: access.overview.isBusy, reload: reload)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { action = .give } label: { Label("Give access", systemImage: "plus") }
                    }
                }
                .sheet(item: $action) { action in
                    ApproverActionSheet(action: action, maxHours: maxHours) {
                        self.action = nil
                        Task { await reload() }
                    }
                }
            }
        }
    }
}

private struct ApproverAccess {
    let overview: DatabaseAccessOverview
    let requests: [DatabaseAccessRequest]
}

/// A change an approver is making.
private enum ApproverAction: Identifiable {
    case answer(DatabaseAccessRequest, approve: Bool)
    case give
    case extend(DatabaseAccessGrant)
    case revoke(DatabaseAccessGrant)

    var id: String {
        switch self {
        case .answer(let request, let approve): "\(approve ? "approve" : "decline")-\(request.id)"
        case .give: "give"
        case .extend(let grant): "extend-\(grant.id)"
        case .revoke(let grant): "revoke-\(grant.id)"
        }
    }
}

// MARK: - Sections

private struct RequestsSection: View {
    let requests: [DatabaseAccessRequest]
    let answer: (DatabaseAccessRequest, Bool) -> Void

    var body: some View {
        Section {
            if requests.isEmpty {
                Text("No one is waiting").foregroundStyle(.secondary)
            }
            ForEach(requests) { request in
                RequestCard(request: request) { answer(request, $0) }
                    .swipeActions(edge: .trailing) {
                        Button { answer(request, true) } label: { Label("Approve", systemImage: "checkmark") }.tint(.green)
                    }
                    .swipeActions(edge: .leading) {
                        Button { answer(request, false) } label: { Label("Decline", systemImage: "xmark") }.tint(.red)
                    }
            }
        } header: {
            Text(requests.isEmpty ? "Requests" : "\(requests.count) waiting")
        } footer: {
            Text(requests.isEmpty ? "You'll get a notification when someone asks for access." : "Swipe left to approve, or right to decline.")
        }
    }
}

private struct GrantsSection: View {
    let grants: [DatabaseAccessGrant]
    let change: (ApproverAction) -> Void

    var body: some View {
        Section {
            if grants.isEmpty {
                Text("No one has access to the production database.").foregroundStyle(.secondary)
            }
            ForEach(grants) { grant in
                ActiveGrantRow(grant: grant, change: change)
                    .swipeActions(edge: .trailing) {
                        if grant.isChangeable {
                            Button { change(.revoke(grant)) } label: { Label("Revoke", systemImage: "xmark.circle") }.tint(.red)
                        }
                    }
                    .swipeActions(edge: .leading) {
                        if grant.isChangeable {
                            Button { change(.extend(grant)) } label: { Label("Extend", systemImage: "clock.badge.plus") }.tint(.accentColor)
                        }
                    }
            }
        } header: {
            Text("Access now")
        } footer: {
            Text("Access ends on its own at the time shown.")
        }
    }
}

private struct ActiveGrantRow: View {
    let grant: DatabaseAccessGrant
    let change: (ApproverAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Initials(name: grant.userName, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(grant.userName).font(.headline).lineLimit(2)
                    Text("Granted by \(grant.grantedBy)").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                StatusBadge(text: grant.progress ?? grant.ending, tone: grant.progress == nil ? .ofGrant(grant) : .active)
            }
            Text(grant.reason).font(.callout)
            if grant.progress == nil {
                AccessCountdown(grant: grant)
            } else {
                Text("AWS is working on it. This updates on its own.").font(.caption).foregroundStyle(.secondary)
            }
            if let failure = grant.failure {
                Text(failure).font(.caption).foregroundStyle(.red)
            }
            if grant.isChangeable {
                HStack(spacing: 10) {
                    Button(role: .destructive) { change(.revoke(grant)) } label: { Text("Revoke").frame(maxWidth: .infinity) }
                    Button { change(.extend(grant)) } label: { Text("Extend").frame(maxWidth: .infinity) }
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 6)
    }
}

private struct OutsideSection: View {
    let outside: [OutsideDatabaseAccess]
    let checkedAt: Date?

    var body: some View {
        if !outside.isEmpty {
            Section {
                ForEach(outside) { access in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(access.userId).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle)
                        Group {
                            if let expiresAt = access.expiresAt {
                                Text("Ends \(expiresAt, format: .dateTime.day().month().hour().minute())")
                            } else {
                                Text("End time unknown")
                            }
                        }
                        .font(.caption).foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Granted outside PulseGrid")
            } footer: {
                if let checkedAt {
                    Text("AWS has access for these Identity Center users that wasn't granted here. PulseGrid doesn't remove it. Checked \(checkedAt, format: .relative(presentation: .named)).")
                } else {
                    Text("AWS has access for these Identity Center users that wasn't granted here. PulseGrid doesn't remove it.")
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

// MARK: - Changes

private struct ApproverActionSheet: View {
    let action: ApproverAction
    let maxHours: Int
    let done: () -> Void

    var body: some View {
        switch action {
        case .answer(let request, let approve):
            AnswerSheet(request: request, approve: approve, maxHours: maxHours, done: done)
        case .give:
            GiveAccessSheet(maxHours: maxHours, done: done)
        case .extend(let grant):
            ExtendSheet(grant: grant, maxHours: maxHours, done: done)
        case .revoke(let grant):
            RevokeSheet(grant: grant, done: done)
        }
    }
}

private struct AnswerSheet: View {
    @Environment(AppModel.self) private var app
    let request: DatabaseAccessRequest
    let approve: Bool
    let maxHours: Int
    let done: () -> Void
    @State private var hours: Int
    @State private var reason = ""

    init(request: DatabaseAccessRequest, approve: Bool, maxHours: Int, done: @escaping () -> Void) {
        self.request = request
        self.approve = approve
        self.maxHours = maxHours
        self.done = done
        _hours = State(initialValue: min(request.hours, maxHours))
    }

    var body: some View {
        ApproverSheet(approve ? "Approve access" : "Decline request", confirm: approve ? "Approve" : "Decline", destructive: !approve, needsCode: approve) {
            Section {
                Text(request.reason)
            } header: {
                Text("\(request.requestedBy) asks")
            }
            if approve {
                Section {
                    HoursPicker(title: "For", maxHours: maxHours, hours: $hours)
                } footer: {
                    Text("Read-only access to the production database, ending on its own.")
                }
            } else {
                Section("Reason, optional") {
                    TextField("They see this and can ask again", text: $reason, axis: .vertical)
                }
            }
        } send: { code in
            struct Approval: Encodable { let hours: Int; let code: String }
            struct Decline: Encodable { let reason: String? }
            let path = "database-access/requests/\(request.id)/\(approve ? "approve" : "decline")"
            if approve {
                try await app.api.postIgnoringResponse(path, body: Approval(hours: hours, code: code))
            } else {
                try await app.api.postIgnoringResponse(path, body: Decline(reason: reason.trimmedOrNil))
            }
        } done: { done() }
    }
}

private struct GiveAccessSheet: View {
    @Environment(AppModel.self) private var app
    let maxHours: Int
    let done: () -> Void
    @State private var userName = ""
    @State private var hours = 1
    @State private var reason = ""

    var body: some View {
        ApproverSheet("Give access", confirm: "Give access", canConfirm: userName.trimmedOrNil != nil && reason.trimmedOrNil != nil) {
            Section {
                TextField("User name, usually their email", text: $userName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                HoursPicker(title: "For", maxHours: maxHours, hours: $hours)
                TextField("Reason", text: $reason, axis: .vertical)
            } footer: {
                Text("Read-only access to the production database, ending on its own.")
            }
        } send: { code in
            struct Grant: Encodable { let userName: String; let hours: Int; let reason: String; let code: String }
            try await app.api.postIgnoringResponse(
                "database-access/grants",
                body: Grant(userName: userName.trimmedOrNil ?? "", hours: hours, reason: reason.trimmedOrNil ?? "", code: code)
            )
        } done: { done() }
    }
}

private struct ExtendSheet: View {
    @Environment(AppModel.self) private var app
    let grant: DatabaseAccessGrant
    let maxHours: Int
    let done: () -> Void
    @State private var hours = 1

    var body: some View {
        ApproverSheet("Extend access", confirm: "Extend") {
            Section {
                LabeledContent("Ends at") { Text(grant.expiresAt, format: .dateTime.hour().minute()) }
                HoursPicker(title: "Add", maxHours: maxHours, hours: $hours)
            } header: {
                Text(grant.userName)
            } footer: {
                Text("Access can last at most \(hoursText(maxHours)) from now.")
            }
        } send: { code in
            struct Extension: Encodable { let hours: Int; let code: String }
            try await app.api.postIgnoringResponse("database-access/grants/\(grant.id)/extend", body: Extension(hours: hours, code: code))
        } done: { done() }
    }
}

private struct RevokeSheet: View {
    @Environment(AppModel.self) private var app
    let grant: DatabaseAccessGrant
    let done: () -> Void

    var body: some View {
        ApproverSheet("Revoke access", confirm: "Revoke", destructive: true) {
            Section {
                Text("\(grant.userName) loses access to the production database now, instead of at \(grant.expiresAt, format: .dateTime.hour().minute()).")
            }
        } send: { code in
            struct Revoke: Encodable { let code: String }
            try await app.api.postIgnoringResponse("database-access/grants/\(grant.id)/revoke", body: Revoke(code: code))
        } done: { done() }
    }
}

private extension String {
    /// The text without surrounding spaces, or nil when nothing is left.
    var trimmedOrNil: String? { trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty }
}
