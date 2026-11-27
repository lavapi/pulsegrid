import Foundation
import Testing
@testable import PulseGrid

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
}

struct RequestLogTests {
    @Test func readsTheSummaryAndRequests() throws {
        let summary = try decode(RequestLogSummary.self, #"""
        {"access":{"allowed":true,"reason":null},"problem":null,"requests":1200,"errorRate":0.025,"p50Ms":42,"p95Ms":310,"p99Ms":900,
         "topPaths":[{"key":"/api/orders","count":400}],"topHosts":[],"noTarget":3,"partial":false}
        """#)
        #expect(summary.topPaths.first?.count == 400)
        let page = try decode(RequestLogPage.self, #"""
        {"access":{"allowed":true,"reason":null},"problem":null,"older":null,"canShowQuery":false,"entries":[
          {"time":"2026-11-27T10:00:00Z","host":"shop.example.com","method":"GET","path":"/api/orders","elbStatus":502,"targetStatus":null,
           "responseMs":null,"service":null,"userAgent":"curl","edgeIp":"203.0.113.7","protocol":"https"},
          {"time":"2026-11-27T10:00:01Z","host":"shop.example.com","method":"POST","path":"/api/pay","elbStatus":null,"targetStatus":201,
           "responseMs":120.5,"service":"api","userAgent":"curl","edgeIp":"203.0.113.7","protocol":"https"}]}
        """#)
        #expect(page.entries.map(\.status) == [502, 201])
    }

    @Test func asksForTheLastHourWithTheChosenStatus() {
        let now = Date(timeIntervalSince1970: 1_795_000_000)
        #expect(RequestStatusFilter.serverErrors.query(until: now)["status"] == "5xx")
        #expect(RequestStatusFilter.all.query(until: now)["status"] == nil)
        let query = RequestStatusFilter.all.query(until: now)
        #expect(query["from"] == now.addingTimeInterval(-3600).formatted(.iso8601))
    }

    @Test func saysWhenThePersonCantReadLogs() throws {
        let summary = try decode(RequestLogSummary.self, #"""
        {"access":{"allowed":false,"reason":"You need permission to read logs."},"problem":null,"requests":0,"errorRate":0,
         "p50Ms":null,"p95Ms":null,"p99Ms":null,"topPaths":[],"topHosts":[],"noTarget":0,"partial":false}
        """#)
        #expect(!summary.access.allowed && summary.access.reason == "You need permission to read logs.")
    }
}

struct DatabaseActivityTests {
    @Test func readsTopStatementsAndLogs() throws {
        let top = try decode(TopSqlReport.self, #"""
        {"access":{"allowed":true,"reason":null},"problem":null,"instances":[{"instance":"orders-db","unavailable":null,"load":1.2,
          "statements":[{"id":"s1","statement":"SELECT * FROM orders WHERE id = ?","load":0.8,"share":0.66,"waits":[],"callsPerSecond":12.5,"avgLatencyMs":3.2}]}]}
        """#)
        #expect(top.instances.first?.statements.first?.share == 0.66)
        let log = try decode(DatabaseLogReport.self, #"""
        {"access":{"allowed":true,"reason":null},"problem":{"message":"Logs aren't exported for this database.","principal":null},
         "lines":[{"id":"l1","time":"2026-11-27T10:00:00Z","instance":"orders-db","severity":"ERROR","message":"deadlock detected"}],
         "slowQueries":[{"id":"q1","time":"2026-11-27T10:00:00Z","instance":"orders-db","durationMs":1500,"statement":"SELECT pg_sleep(1.5)"}],
         "partial":true,"showsValues":false}
        """#)
        #expect(log.problem?.message == "Logs aren't exported for this database.")
        #expect(log.lines.count == 1 && log.slowQueries.first?.durationMs == 1500 && log.partial)
    }

    @Test(arguments: [("load-balancer", true, false), ("rds-cluster", false, true), ("rds-instance", false, true), ("ecs-service", false, false)])
    func offersInsightsByType(type: String, requests: Bool, database: Bool) throws {
        let resource = try decode(Resource.self, #"{"id":"r","type":"\#(type)","name":"n","status":"ok","health":"healthy","region":"eu-central-1"}"#)
        #expect(resource.hasRequestLogs == requests && resource.hasDatabaseActivity == database)
    }

    @Test func namesLevelsAsTheWebDoes() {
        #expect(DatabaseLogLevel.allCases.map(\.rawValue) == ["problems", "errors", "warnings", "deadlocks", "connections", "all"])
        #expect(DatabaseLogLevel.problems.label == "Errors and warnings")
    }
}

struct ReleaseHistoryTests {
    @Test(arguments: [("FINISH", "Finished"), ("ROLLBACK", "Rolled back")])
    func namesHowAReleaseEnded(decision: String, outcome: String) throws {
        let release = try decode(ProductionRelease.self, #"""
        {"id":"rel-9","status":"DONE","components":[{"name":"api","tag":"1.4.0"}],"requestedBy":"ada","createdAt":"2026-11-27T10:00:00Z",
         "holdUntil":null,"decision":"\#(decision)","decidedBy":"vic"}
        """#)
        #expect(release.outcome == outcome)
    }
}
