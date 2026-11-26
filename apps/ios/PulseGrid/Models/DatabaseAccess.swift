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

nonisolated struct DatabaseAccessGrant: Decodable, Equatable {
    let id: String
    let grantedBy: String
    let userName: String
    let status: String
    let failure: String?
    let expiresAt: Date
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
