import Foundation

/// The PulseGrid server a person types in: "pulsegrid.example.com" becomes "https://pulsegrid.example.com".
enum ServerAddress {
    static func parse(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains(where: \.isWhitespace) else { return nil }
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard
            let components = URLComponents(string: withScheme),
            let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
            let host = components.host, !host.isEmpty
        else { return nil }
        var origin = URLComponents()
        origin.scheme = scheme
        origin.host = host
        origin.port = components.port
        return origin.url
    }
}
