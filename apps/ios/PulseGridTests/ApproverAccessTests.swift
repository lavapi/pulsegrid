import Foundation
import Testing
@testable import PulseGrid

private func grantJSON(status: String, change: String? = nil) -> String {
    let changeJSON = change.map { #""\#($0)""# } ?? "null"
    return #"{"id":"g-\#(status)-\#(change ?? "none")","grantedBy":"gus@example.test","userName":"vic@example.test","reason":"Check a payout","status":"\#(status)","change":\#(changeJSON),"failure":null,"startsAt":"2026-11-27T10:00:00.000Z","expiresAt":"2026-11-27T12:00:00.000Z","revokedAt":null,"revokedBy":null,"endReason":null}"#
}

private func overview(_ grants: [String], outside: String = "[]") throws -> DatabaseAccessOverview {
    let json = #"{"ready":true,"maxHours":8,"grants":[\#(grants.joined(separator: ","))],"outside":\#(outside),"outsideCheckedAt":null,"connect":null,"missingConnect":[]}"#
    return try JSONCoding.decoder.decode(DatabaseAccessOverview.self, from: Data(json.utf8))
}

struct ApproverAccessTests {
    @Test func onlyActiveAccessWithNothingRunningCanChange() throws {
        let decode = { (json: String) in try JSONCoding.decoder.decode(DatabaseAccessGrant.self, from: Data(json.utf8)) }
        let active = try decode(grantJSON(status: "active"))
        let extending = try decode(grantJSON(status: "active", change: "extending"))
        let granting = try decode(grantJSON(status: "granting"))
        #expect(active.isChangeable && active.progress == nil)
        #expect(!extending.isChangeable && extending.progress == "Extending")
        #expect(!granting.isChangeable && granting.progress == "Granting")
    }

    @Test func keepsRefreshingOnlyWhileAwsIsWorking() throws {
        #expect(try !overview([grantJSON(status: "active")]).isBusy)
        #expect(try overview([grantJSON(status: "active"), grantJSON(status: "active", change: "revoking")]).isBusy)
        #expect(try overview([grantJSON(status: "granting")]).isBusy)
    }

    @Test func readsOutsideAccessAndProblems() throws {
        guard case let .ready(maxHours, _, outside, _) = try overview([], outside: #"[{"userId":"u-1","expiresAt":null},{"userId":"u-2","expiresAt":"2026-11-27T12:00:00.000Z"}]"#) else {
            Issue.record("Expected ready access")
            return
        }
        #expect(maxHours == 8)
        #expect(outside.map(\.id) == ["u-1", "u-2"] && outside[0].expiresAt == nil && outside[1].expiresAt != nil)

        let unavailable = try JSONCoding.decoder.decode(DatabaseAccessOverview.self, from: Data(#"{"ready":false,"problems":["Connect AWS account 1 to this project."]}"#.utf8))
        guard case .unavailable(let problems) = unavailable else {
            Issue.record("Expected problems")
            return
        }
        #expect(problems == ["Connect AWS account 1 to this project."])
        #expect(!unavailable.isBusy)
    }

    @Test func writesHours() {
        #expect(hoursText(1) == "1 hour")
        #expect(hoursText(3) == "3 hours")
    }
}
