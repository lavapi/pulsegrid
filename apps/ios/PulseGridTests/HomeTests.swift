import Foundation
import Testing
@testable import PulseGrid

private func decode<T: Decodable>(_ json: String) throws -> T {
    try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
}

struct HomeTests {
    @Test func putsTheMostUrgentFirst() throws {
        let release: ProductionRelease = try decode(#"{"id":"r1","status":"HOLD","components":[{"name":"api","tag":"v2"}],"requestedBy":null,"createdAt":null,"holdUntil":null,"decision":null,"decidedBy":null}"#)
        let request: DatabaseAccessRequest = try decode(#"{"id":"q1","requestedBy":"vic","requestedByEmail":"vic@example.test","userName":"vic@example.test","hours":2,"reason":"Check","status":"pending","createdAt":"2026-11-27T10:00:00Z","expiresAt":"2026-11-28T10:00:00Z","decidedBy":null,"declineReason":null}"#)
        let resource: Resource = try decode(#"{"id":"s1","type":"ecs-service","name":"worker","status":"ACTIVE","health":"degraded","region":"eu-central-1"}"#)
        let test: FailoverTest = try decode(#"{"id":"E1","region":"eu-central-1","label":"Stop tasks","state":"running","reason":null,"startedAt":null,"endedAt":null}"#)
        let ended: FailoverTest = try decode(#"{"id":"E2","region":"eu-central-1","label":"Old","state":"completed","reason":null,"startedAt":null,"endedAt":null}"#)

        let items = NeedsYou.items(release: release, requests: [request], unhealthy: [resource], failedPipelines: [], failover: [ended, test])
        #expect(items.map(\.id) == ["release-r1", "requests", "resource-s1", "failover"])
        guard case .failoverRunning(let running) = items[3] else { Issue.record("Expected running tests"); return }
        #expect(running.map(\.id) == ["E1"])
    }

    @Test func leavesOutADecidedReleaseAndEmptyLists() throws {
        let decided: ProductionRelease = try decode(#"{"id":"r1","status":"HOLD","components":[],"requestedBy":null,"createdAt":null,"holdUntil":null,"decision":"FINISH","decidedBy":"ada"}"#)
        #expect(NeedsYou.items(release: decided, requests: [], unhealthy: [], failedPipelines: [], failover: []).isEmpty)
    }
}
