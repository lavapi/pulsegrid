import Foundation

nonisolated struct CloudActivityEvent: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let occurredAt: Date
    let actor: String
    let action: String
    let label: String
    let resource: String?
    let region: String
    let errorCode: String?
    let viaDashboard: Bool
}

nonisolated struct CloudActivityPage: Decodable, Equatable, Sendable {
    let events: [CloudActivityEvent]
    /// Pass as `before` for the next, older page; null when there's nothing older.
    let before: String?
    let error: String?
}

/// What the search box looks in, as the API filters.
nonisolated enum CloudActivitySearch: String, CaseIterable, Identifiable {
    case actor, resource

    var id: String { rawValue }
    var label: String { self == .actor ? "Person" : "Resource" }
}

/// The filters of one look at an account's cloud activity.
nonisolated struct CloudActivityQuery: Equatable {
    var text = ""
    var searchIn: CloudActivitySearch = .actor
    var includeReads = false

    func parameters(before: String?) -> [String: String] {
        var query = ["reads": includeReads ? "true" : "false"]
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { query[searchIn.rawValue] = trimmed }
        if let before { query["before"] = before }
        return query
    }
}
