import Foundation
import Testing
@testable import PulseGrid

struct PKCETests {
    @Test func makesTheStandardChallenge() {
        // The example from RFC 7636, appendix B.
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func makesFreshURLSafeSecrets() {
        let first = PKCE(), second = PKCE()
        #expect(first.verifier != second.verifier)
        #expect(first.state != second.state)
        #expect(first.verifier.count == 43)
        #expect(first.verifier.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
    }
}

struct AppErrorTests {
    @Test(arguments: [URLError.Code.cannotFindHost, .timedOut, .cannotConnectToHost, .notConnectedToInternet, .networkConnectionLost])
    func tellsToTurnOnTheVPNWhenPulseGridCantBeReached(code: URLError.Code) {
        let error = AppError.from(URLError(code))
        #expect(error == .unreachable)
        #expect(error.needsVPN)
        #expect(error.message == "Can't reach PulseGrid. Turn on your company VPN and try again.")
    }

    @Test func showsNothingForACancelledAction() {
        #expect(AppError.from(URLError(.cancelled)).message == nil)
        #expect(AppError.from(CancellationError()).message == nil)
    }

    @Test func neverShowsRawErrors() {
        struct Strange: Error {}
        #expect(AppError.from(Strange()).message == "Something went wrong. Please try again.")
        #expect(AppError.from(URLError(.badServerResponse)).message == "Something went wrong. Please try again.")
    }
}

struct APIClientTests {
    final class Recorder {
        var requests: [URLRequest] = []
    }

    func client(status: Int, body: String, token: String? = "secret-token", recorder: Recorder = Recorder()) -> APIClient {
        APIClient(baseURL: { URL(string: "https://pulsegrid.example")! }, token: { token }) { request in
            recorder.requests.append(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }

    @Test func sendsTheSignInAsABearerTokenToTheAPIPath() async throws {
        let recorder = Recorder()
        let api = client(status: 200, body: #"{"id":"p1","name":"Acme"}"#, recorder: recorder)
        let project: Project = try await api.get("projects/current", query: ["account": "a1"])
        #expect(project.name == "Acme")
        let request = try #require(recorder.requests.first)
        #expect(request.url?.absoluteString == "https://pulsegrid.example/api/projects/current?account=a1")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret-token")
    }

    @Test func showsPulseGridsOwnMessageWhenItRefuses() async {
        let api = client(status: 409, body: #"{"message":"Someone already answered this request."}"#)
        await #expect(throws: AppError.refused("Someone already answered this request.")) {
            let _: Project = try await api.get("x")
        }
    }

    @Test func signsOutWhenTheSignInHasEnded() async {
        var signedOut = false
        let api = client(status: 401, body: "{}")
        api.onSignedOut = { signedOut = true }
        await #expect(throws: AppError.signedOut) {
            let _: Project = try await api.get("me")
        }
        #expect(signedOut)
    }

    @Test func treatsAnUnreachableGatewayAsTheVPN() {
        #expect(APIClient.refusal(from: Data(), status: 504) == .unreachable)
        #expect(APIClient.refusal(from: Data("<html>".utf8), status: 500) == .unexpected)
    }

    @Test func reportsNetworkFailuresAsUnreachable() async {
        let api = APIClient(baseURL: { URL(string: "https://pulsegrid.example")! }, token: { nil }) { _ in
            throw URLError(.timedOut)
        }
        await #expect(throws: AppError.unreachable) {
            let _: Project = try await api.get("me")
        }
    }
}

struct DecodingTests {
    func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
    }

    @Test func readsDatesWithAndWithoutFractions() {
        #expect(JSONCoding.parseDate("2026-11-26T12:00:00.123Z") != nil)
        #expect(JSONCoding.parseDate("2026-11-26T12:00:00Z") != nil)
        #expect(JSONCoding.parseDate("yesterday") == nil)
    }

    @Test func readsMyDatabaseAccess() throws {
        let unavailable: MyDatabaseAccess = try decode(#"{"ready":false,"message":"Not here."}"#)
        guard case .unavailable(let message) = unavailable else { Issue.record("expected unavailable"); return }
        #expect(message == "Not here.")

        let ready: MyDatabaseAccess = try decode(#"""
        {"ready":true,"maxHours":8,"suggestedUserName":"vic@example.test","connect":null,"grant":null,
         "request":{"id":"r1","requestedBy":"Vic","requestedByEmail":"vic@example.test","userName":"vic@example.test",
                    "hours":2,"reason":"Check","status":"pending","createdAt":"2026-11-26T11:00:00.000Z",
                    "expiresAt":"2026-11-27T11:00:00.000Z","decidedBy":null,"decidedAt":null,"declineReason":null,"grantId":null}}
        """#)
        guard case let .ready(maxHours, _, request, grant) = ready else { Issue.record("expected ready"); return }
        #expect(maxHours == 8)
        #expect(request?.status == "pending")
        #expect(grant == nil)
    }

    @Test func readsTheProductionReleaseWaitingForADecision() throws {
        let view: ProductionReleasesView = try decode(#"""
        {"ready":true,"current":{"id":"rel-1","status":"HOLD","components":[{"name":"backend","tag":"main-1a2b3c4"}],
         "requestedBy":"ada@example.test","createdAt":"2026-11-18T09:30:00.000Z","holdStartedAt":null,
         "holdUntil":"2026-11-18T17:40:00.000Z","decision":null,"decidedBy":null,"snapshot":null}}
        """#)
        guard case .ready(let release?) = view else { Issue.record("expected a release"); return }
        #expect(release.isWaiting)
        #expect(release.components.first?.tag == "main-1a2b3c4")

        let notSetUp: ProductionReleasesView = try decode(#"{"ready":false}"#)
        guard case .notSetUp = notSetUp else { Issue.record("expected not set up"); return }
    }

    @Test func namesActivityFromItsAction() throws {
        let event: AuditEvent = try decode(#"""
        {"id":"e1","action":"database_access.request_approved","actorEmail":"gus@example.test","targetType":null,"targetId":null,
         "ipAddress":null,"metadata":{"label":"vic@example.test","hours":2},"occurredAt":"2026-11-26T12:00:00Z","targetDisplayName":null}
        """#)
        #expect(event.title == "Request approved")
        #expect(event.subject == "vic@example.test")
    }
}

struct NotificationRoutingTests {
    @Test func opensTheScreenANotificationIsAbout() {
        #expect(MainTabs.tab(for: "/settings/database-access") == .access)
        #expect(MainTabs.tab(for: "/database-access") == .access)
        #expect(MainTabs.tab(for: "/production-releases") == .releases)
        #expect(MainTabs.tab(for: "/infrastructure/r1") == .infrastructure)
        #expect(MainTabs.resourceId(in: "/infrastructure/r1") == "r1")
        #expect(MainTabs.resourceId(in: "/infrastructure") == nil)
        #expect(MainTabs.tab(for: "/somewhere-else") == nil)
    }
}

struct ResourceLabelTests {
    @Test func namesResourceTypesAsTheWebDoes() throws {
        let resource: Resource = try JSONCoding.decoder.decode(Resource.self, from: Data(#"""
        {"id":"r1","type":"ecs-service","name":"worker","displayName":null,"status":"ACTIVE","health":"degraded","region":"eu-central-1"}
        """#.utf8))
        #expect(resource.typeLabel == "ECS service")
        #expect(resource.title == "worker")
    }
}

struct ServerAddressTests {
    @Test(arguments: [
        ("pulsegrid.example.com", "https://pulsegrid.example.com"),
        ("  https://pulsegrid.example.com/  ", "https://pulsegrid.example.com"),
        ("https://pulsegrid.example.com/settings/team", "https://pulsegrid.example.com"),
        ("http://localhost:4300", "http://localhost:4300"),
        ("PulseGrid.Example.com:8443", "https://PulseGrid.Example.com:8443"),
    ])
    func keepsOnlyTheSiteAddress(typed: String, expected: String) {
        #expect(ServerAddress.parse(typed)?.absoluteString == expected)
    }

    @Test(arguments: ["", "   ", "pulse grid.example.com", "ftp://pulsegrid.example.com", "https://"])
    func refusesWhatIsntAnAddress(typed: String) {
        #expect(ServerAddress.parse(typed) == nil)
    }
}
