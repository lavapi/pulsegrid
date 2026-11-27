import Foundation
import Testing
@testable import PulseGrid

private func resource(_ id: String, _ type: String, _ name: String, health: String = "healthy", region: String = "eu-central-1", details: String = "{}") throws -> Resource {
    let json = #"{"id":"\#(id)","type":"\#(type)","name":"\#(name)","status":"ACTIVE","health":"\#(health)","region":"\#(region)","details":\#(details)}"#
    return try JSONCoding.decoder.decode(Resource.self, from: Data(json.utf8))
}

struct ResourceInventoryTests {
    @Test func putsMembersUnderTheirClusterAndKeepsTheRestApart() throws {
        let inventory = ResourceInventory([
            try resource("c1", "ecs-cluster", "main"),
            try resource("s1", "ecs-service", "api", details: #"{"cluster":"main"}"#),
            try resource("s2", "ecs-service", "worker", health: "degraded", details: #"{"cluster":"main"}"#),
            try resource("s3", "ecs-service", "other-region", region: "us-east-1", details: #"{"cluster":"main"}"#),
            try resource("s4", "ecs-service", "lost", details: #"{"cluster":"gone"}"#),
        ])
        let cluster = try #require(inventory.clusters.first)
        #expect(cluster.members.map(\.id) == ["s1", "s2"])
        #expect(cluster.health.healthy == 1 && cluster.health.degraded == 1 && cluster.health.total == 2)
        #expect(inventory.standalone.map(\.id) == ["s3", "s4"])
        #expect(inventory.cluster(named: "main", in: "eu-central-1")?.id == "c1")
        #expect(inventory.cluster(named: "main", in: "us-east-1") == nil)
    }

    @Test func groupsDatabaseInstancesAndCacheNodes() throws {
        let databases = ResourceInventory([
            try resource("c", "rds-cluster", "orders"),
            try resource("i", "rds-instance", "orders-1", details: #"{"cluster":"orders"}"#),
        ])
        let caches = ResourceInventory([
            try resource("g", "elasticache-replication-group", "sessions"),
            try resource("n", "elasticache-cluster", "sessions-001", details: #"{"replicationGroup":"sessions"}"#),
        ])
        #expect(databases.clusters.first?.members.map(\.id) == ["i"])
        #expect(caches.clusters.first?.members.map(\.id) == ["n"])
        #expect(caches.clusters.first?.membership.counting(1) == "1 node")
        #expect(databases.clusters.first?.membership.counting(2) == "2 instances")
    }

    @Test func readsTheNextPageCursor() throws {
        let page = try JSONCoding.decoder.decode(ResourcePage.self, from: Data(#"{"resources":[],"nextCursor":"abc"}"#.utf8))
        #expect(page.nextCursor == "abc")
    }
}

struct AccessHistoryTests {
    private func grant(status: String, endReason: String? = nil, revokedBy: String? = nil, revokedAt: String? = nil) throws -> DatabaseAccessGrant {
        let json = """
        {"id":"g","grantedBy":"Ana","userName":"dev@example.com","userId":null,"reason":"Look at orders","status":"\(status)",
         "change":null,"failure":null,"startsAt":"2026-11-27T10:00:00.000Z","expiresAt":"2026-11-27T13:00:00.000Z",
         "revokedAt":\(revokedAt.map { "\"\($0)\"" } ?? "null"),"revokedBy":\(revokedBy.map { "\"\($0)\"" } ?? "null"),
         "endReason":\(endReason.map { "\"\($0)\"" } ?? "null")}
        """
        return try JSONCoding.decoder.decode(DatabaseAccessGrant.self, from: Data(json.utf8))
    }

    @Test func describesHowEachGrantEnded() throws {
        #expect(try grant(status: "expired", endReason: "expired").ending == "Expired")
        #expect(try grant(status: "revoked", endReason: "manual", revokedBy: "Ben", revokedAt: "2026-11-27T11:00:00.000Z").ending == "Revoked by Ben")
        #expect(try grant(status: "failed").ending == "Failed")
    }

    @Test func countsHoursUntilItEnded() throws {
        #expect(try grant(status: "expired", endReason: "expired").hours == 3)
        #expect(try grant(status: "revoked", endReason: "manual", revokedAt: "2026-11-27T11:00:00.000Z").hours == 1)
    }
}
