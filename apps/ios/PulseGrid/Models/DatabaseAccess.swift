import Foundation

nonisolated struct DatabaseAccessRequest: Decodable, Identifiable, Equatable {
    let id: String
    let requestedBy: String
    let requestedByEmail: String
    let userName: String
    let hours: Int
    let reason: String
    let status: String
    let createdAt: Date
    let expiresAt: Date
    let decidedBy: String?
    let declineReason: String?
}

nonisolated struct DatabaseAccessGrant: Decodable, Identifiable, Equatable {
    let id: String
    let grantedBy: String
    let userName: String
    let reason: String
    let status: String
    /// A change running in AWS on active access: "extending" or "revoking".
    let change: String?
    let failure: String?
    let startsAt: Date
    let expiresAt: Date
    let revokedAt: Date?
    let revokedBy: String?
    let endReason: String?

    /// When the access stopped, or will stop.
    var endsAt: Date { revokedAt ?? expiresAt }

    /// How long the access lasted, in whole hours, at least one.
    var hours: Int { max(1, Int((endsAt.timeIntervalSince(startsAt) / 3600).rounded())) }

    /// How the grant ended, in the website's words: "Revoked by Ana", "Expired", "Failed".
    var ending: String {
        switch status {
        case "active": "Active"
        case "granting": "Granting"
        case "failed": "Failed"
        default: (endReason == "manual" ? "Revoked" : "Expired") + (revokedBy.map { " by \($0)" } ?? "")
        }
    }

    /// Active access with nothing else running on it, so it can be extended or revoked.
    var isChangeable: Bool { status == "active" && change == nil }

    /// What AWS is still doing with it: "Granting", "Extending" or "Revoking".
    var progress: String? {
        if status == "granting" { return "Granting" }
        return change?.sentenceCased
    }
}

/// Access AWS has that PulseGrid didn't grant.
nonisolated struct OutsideDatabaseAccess: Decodable, Identifiable, Equatable {
    let userId: String
    let expiresAt: Date?

    var id: String { userId }
}

/// What approvers see: not set up, with the problems to fix, or who has access now.
nonisolated enum DatabaseAccessOverview: Decodable {
    case unavailable(problems: [String])
    case ready(maxHours: Int, grants: [DatabaseAccessGrant], outside: [OutsideDatabaseAccess], outsideCheckedAt: Date?)

    private enum Keys: String, CodingKey { case ready, problems, maxHours, grants, outside, outsideCheckedAt }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        guard try container.decode(Bool.self, forKey: .ready) else {
            self = .unavailable(problems: try container.decode([String].self, forKey: .problems))
            return
        }
        self = .ready(
            maxHours: try container.decode(Int.self, forKey: .maxHours),
            grants: try container.decode([DatabaseAccessGrant].self, forKey: .grants),
            outside: try container.decode([OutsideDatabaseAccess].self, forKey: .outside),
            outsideCheckedAt: try container.decodeIfPresent(Date.self, forKey: .outsideCheckedAt)
        )
    }

    /// Whether AWS is still granting or changing some access, so the screen keeps refreshing.
    var isBusy: Bool {
        guard case .ready(_, let grants, _, _) = self else { return false }
        return grants.contains { $0.progress != nil }
    }
}

/// One of the person's own requests and the grant it led to.
nonisolated struct MyDatabaseAccessHistoryEntry: Decodable, Identifiable {
    let request: DatabaseAccessRequest
    let grant: DatabaseAccessGrant?

    var id: String { request.id }

    /// What came of the request: the grant's ending once approved, or the request's answer.
    var outcome: String {
        if let grant { return grant.ending }
        switch request.status {
        case "pending": return "Waiting"
        case "declined": return request.decidedBy.map { "Declined by \($0)" } ?? "Declined"
        case "cancelled": return "Cancelled"
        case "expired": return "No answer"
        default: return request.status.sentenceCased
        }
    }

    /// The decline reason or the grant's failure, when there is one.
    var note: String? { request.declineReason ?? grant?.failure }
}

/// A person's own access: unavailable in this project, or their latest request and the grant it led to.
nonisolated enum MyDatabaseAccess: Decodable {
    case unavailable(message: String)
    case ready(maxHours: Int, suggestedUserName: String, request: DatabaseAccessRequest?, grant: DatabaseAccessGrant?)

    private enum Keys: String, CodingKey { case ready, message, maxHours, suggestedUserName, request, grant }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        guard try container.decode(Bool.self, forKey: .ready) else {
            self = .unavailable(message: try container.decode(String.self, forKey: .message))
            return
        }
        self = .ready(
            maxHours: try container.decode(Int.self, forKey: .maxHours),
            suggestedUserName: try container.decode(String.self, forKey: .suggestedUserName),
            request: try container.decodeIfPresent(DatabaseAccessRequest.self, forKey: .request),
            grant: try container.decodeIfPresent(DatabaseAccessGrant.self, forKey: .grant)
        )
    }
}
