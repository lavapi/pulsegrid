import Foundation

/// Sends requests to PulseGrid's API with the app's own sign-in, and turns failures into readable `AppError`s.
final class APIClient {
    typealias Transport = (URLRequest) async throws -> (Data, URLResponse)

    private let baseURL: () -> URL?
    private let token: () -> String?
    private let transport: Transport
    /// Called when PulseGrid says the sign-in has ended, so the app can go back to signing in.
    var onSignedOut: () -> Void = {}

    init(
        baseURL: @escaping () -> URL?,
        token: @escaping () -> String?,
        transport: @escaping Transport = { try await URLSession.shared.data(for: $0) }
    ) {
        self.baseURL = baseURL
        self.token = token
        self.transport = transport
    }

    func get<Response: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> Response {
        try await decode(send("GET", path, query: query, body: nil))
    }

    /// A file the API sends, such as a PDF report.
    func file(_ path: String, query: [String: String] = [:]) async throws -> Data {
        try await send("GET", path, query: query, body: nil)
    }

    func post<Response: Decodable>(_ path: String, body: some Encodable) async throws -> Response {
        try await decode(send("POST", path, query: [:], body: JSONCoding.encoder.encode(body)))
    }

    func put<Response: Decodable>(_ path: String, body: some Encodable) async throws -> Response {
        try await decode(send("PUT", path, query: [:], body: JSONCoding.encoder.encode(body)))
    }

    func put(_ path: String, body: some Encodable) async throws {
        _ = try await send("PUT", path, query: [:], body: JSONCoding.encoder.encode(body))
    }

    func delete(_ path: String) async throws {
        _ = try await send("DELETE", path, query: [:], body: nil)
    }

    /// For calls answered with nothing worth reading.
    func postIgnoringResponse(_ path: String, body: some Encodable = Empty()) async throws {
        _ = try await send("POST", path, query: [:], body: JSONCoding.encoder.encode(body))
    }

    struct Empty: Codable {}

    private func send(_ method: String, _ path: String, query: [String: String], body: Data?) async throws -> Data {
        let (data, status) = try await exchange(method, path, query: query, body: body)
        switch status {
        case 200..<300:
            return data
        case 401 where await isSignedIn():
            // Still signed in, so PulseGrid refused something else, such as a wrong authenticator code.
            throw APIClient.refusal(from: data, status: status)
        case 401:
            onSignedOut()
            throw AppError.signedOut
        default:
            throw APIClient.refusal(from: data, status: status)
        }
    }

    /// Whether the sign-in still works, asked again after a refusal that might mean it ended.
    private func isSignedIn() async -> Bool {
        let status = try? await exchange("GET", "me", query: [:], body: nil).status
        return status.map { 200..<300 ~= $0 } ?? false
    }

    private func exchange(_ method: String, _ path: String, query: [String: String], body: Data?) async throws -> (data: Data, status: Int) {
        guard let base = baseURL() else { throw AppError.unexpected }
        var components = URLComponents(url: base.appending(path: "api").appending(path: path), resolvingAgainstBaseURL: false)
        if !query.isEmpty {
            components?.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else { throw AppError.unexpected }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = token() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await transport(request)
        } catch {
            throw AppError.from(error)
        }
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    private func decode<Response: Decodable>(_ data: Data) throws -> Response {
        do {
            return try JSONCoding.decoder.decode(Response.self, from: data)
        } catch {
            throw AppError.unexpected
        }
    }

    /// PulseGrid's own message when it gave one; a plain sentence otherwise. Never the status code.
    static func refusal(from data: Data, status: Int) -> AppError {
        struct Failure: Decodable { let message: String? }
        if let message = (try? JSONDecoder().decode(Failure.self, from: data))?.message, !message.isEmpty {
            return .refused(message)
        }
        return status == 502 || status == 503 || status == 504 ? .unreachable : .unexpected
    }
}
