import Foundation
import Testing
@testable import PulseGrid

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
}

struct CostsTests {
    @Test func addsUpEachAccountAndFindsTheBiggestServices() throws {
        let overview = try decode(CostOverview.self, #"""
        {"month":"2026-11","lastMonth":"2026-10","accounts":[{"accountId":"c1","accountName":"Staging","environmentId":"e1",
          "environmentName":"staging","isProduction":false,"currency":"USD","updatedAt":"2026-11-27T08:00:00Z","error":null,
          "services":[{"service":"Amazon RDS","category":"rds","thisMonth":120.5,"lastMonth":140},
                      {"service":"Amazon ECS","category":"ecs","thisMonth":80.25,"lastMonth":75},
                      {"service":"Amazon S3","category":"s3","thisMonth":3,"lastMonth":2.5}]}]}
        """#)
        let account = try #require(overview.accounts.first)
        #expect(account.thisMonth == 203.75)
        #expect(account.lastMonth == 217.5)
        #expect(account.biggest(2).map(\.service) == ["Amazon RDS", "Amazon ECS"])
        #expect(account.format(203.75) == 203.75.formatted(.currency(code: "USD").precision(.fractionLength(0...2))))
    }
}

struct FailoverHistoryTests {
    @Test func findsTheReportOfATestAndOfAGroupRun() throws {
        let history = try decode(FailoverHistory.self, #"""
        {"labels":[],"entries":[
          {"kind":"run","id":"r1","label":"Run all","accountId":"c1","accountName":"Staging","environmentName":"staging",
           "startedBy":"ada","startedAt":"2026-11-27T08:00:00Z","endedAt":null,"result":"failed",
           "counts":{"total":3,"passed":2,"stopped":0,"failed":1,"notStarted":0,"waiting":0,"cancelled":0,"skipped":0,"repairs":0}},
          {"kind":"test","id":"t1","label":"Stop a task","accountId":"c1","accountName":"Staging","environmentName":null,
           "startedBy":null,"startedAt":null,"endedAt":null,"result":"passed","counts":null}]}
        """#)
        let run = history.entries[0], test = history.entries[1]
        #expect(run.isGroupRun && run.counts?.passed == 2)
        #expect(run.reportPath.path == "experiment-reports/runs/r1/pdf" && run.reportPath.query == ["account": "c1"])
        #expect(test.reportPath.path == "experiment-reports/t1/pdf" && test.reportPath.query.isEmpty)
    }
}
