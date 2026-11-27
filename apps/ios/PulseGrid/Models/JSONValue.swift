import Foundation

/// Any JSON value, for the free-form details the cloud reports about a resource.
nonisolated enum JSONValue: Decodable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    /// Readable text for a plain value or a list of plain values; nil for anything nested or empty.
    var displayText: String? {
        switch self {
        case .string(let value): value.isEmpty ? nil : value
        case .number(let value): value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
        case .bool(let value): value ? "Yes" : "No"
        case .array(let values):
            values.allSatisfy(\.isPlain) ? values.compactMap(\.displayText).joined(separator: ", ").nilIfEmpty : nil
        case .object, .null: nil
        }
    }

    private var isPlain: Bool {
        switch self {
        case .string, .number, .bool: true
        default: false
        }
    }
}

nonisolated extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }

    /// "desiredCount" or "desired_count" → "Desired count".
    var labelFromKey: String {
        var words = ""
        for character in self {
            if character == "_" || character == "-" { words.append(" ") }
            else if character.isUppercase, !words.isEmpty, words.last != " " { words.append(" \(character.lowercased())") }
            else { words.append(character) }
        }
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}
