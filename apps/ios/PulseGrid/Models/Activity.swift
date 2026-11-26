import Foundation

nonisolated struct AuditEvent: Decodable, Identifiable {
    let id: String
    let action: String
    let actorEmail: String?
    let occurredAt: Date
    let targetDisplayName: String?
    let label: String?

    private enum Keys: String, CodingKey { case id, action, actorEmail, occurredAt, targetDisplayName, metadata }
    private struct Metadata: Decodable { let label: String? }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        id = try container.decode(String.self, forKey: .id)
        action = try container.decode(String.self, forKey: .action)
        actorEmail = try container.decodeIfPresent(String.self, forKey: .actorEmail)
        occurredAt = try container.decode(Date.self, forKey: .occurredAt)
        targetDisplayName = try container.decodeIfPresent(String.self, forKey: .targetDisplayName)
        label = (try? container.decodeIfPresent(Metadata.self, forKey: .metadata))?.label
    }

    /// "Database access approved" from "database_access.request_approved": the web's labels, without the table.
    var title: String {
        let last = action.split(separator: ".").last.map(String.init) ?? action
        let words = last.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    var subject: String? { targetDisplayName ?? label }
}

nonisolated struct AuditEventPage: Decodable {
    let events: [AuditEvent]
    let nextCursor: String?
}
