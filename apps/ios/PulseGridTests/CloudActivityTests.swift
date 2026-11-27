import Foundation
import Testing
@testable import PulseGrid

struct CloudActivityTests {
    @Test func readsAPageOfEvents() throws {
        let page = try JSONCoding.decoder.decode(CloudActivityPage.self, from: Data(#"""
        {"events":[{"id":"e1","occurredAt":"2026-11-27T10:00:00Z","actor":"ada@example.test","action":"UpdateService","label":"Updated service",
          "resource":"api","region":"eu-central-1","sourceIp":null,"errorCode":"AccessDenied","viaDashboard":true}],
         "before":"2026-11-27T09:00:00.000Z","error":null}
        """#.utf8))
        #expect(page.events.first?.errorCode == "AccessDenied" && page.events.first?.viaDashboard == true)
        #expect(page.before == "2026-11-27T09:00:00.000Z")
    }

    @Test func asksForWhatThePersonSearchesAndOlderPages() {
        var query = CloudActivityQuery()
        #expect(query.parameters(before: nil) == ["reads": "false"])
        query.text = "  ada@example.test "
        query.includeReads = true
        #expect(query.parameters(before: "2026-11-27T09:00:00.000Z") == ["reads": "true", "actor": "ada@example.test", "before": "2026-11-27T09:00:00.000Z"])
        query.searchIn = .resource
        query.text = "api"
        #expect(query.parameters(before: nil)["resource"] == "api")
    }
}

struct FailoverReportLinkTests {
    @Test func opensTheReportANotificationIsAbout() {
        #expect(FailoverReport(path: "/failover-tests/tests/r1") == .test(reportId: "r1", title: "Failover test"))
        #expect(FailoverReport(path: "/failover-tests/runs/a1/run1") == .run(accountId: "a1", runId: "run1", title: "Failover tests"))
        #expect(FailoverReport(path: "/failover-tests") == nil)
        #expect(AppRoute(path: "/failover-tests/tests/r1") == .failoverReport(.test(reportId: "r1", title: "Failover test")))
        #expect(AppRoute(path: "/failover-tests") == .failoverTests)
        #expect(AppRoute(path: "/failover-tests/runs/a1/run1")?.tab == .services)
    }

    @Test func asksForTheRightPDF() {
        #expect(FailoverReport.run(accountId: "a1", runId: "run1", title: "x").path.path == "experiment-reports/runs/run1/pdf")
        #expect(FailoverReport.run(accountId: "a1", runId: "run1", title: "x").path.query == ["account": "a1"])
        #expect(FailoverReport.test(reportId: "r1", title: "x").path.path == "experiment-reports/r1/pdf")
    }
}
