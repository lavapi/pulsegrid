import Foundation

/// PulseGrid sends dates as ISO 8601, with or without fractions of a second.
enum JSONCoding {
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            guard let date = parseDate(text) else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a date"))
            }
            return date
        }
        return decoder
    }()

    static let encoder = JSONEncoder()

    static func parseDate(_ text: String) -> Date? {
        let withFractions = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        return (try? withFractions.parse(text)) ?? (try? Date.ISO8601FormatStyle().parse(text))
    }
}
