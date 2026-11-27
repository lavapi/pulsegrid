import Foundation
import Testing
@testable import PulseGrid

private func item(_ fields: String) throws -> FailoverRunItem {
    let json = #"{"region":"eu-central-1","templateId":"EXT1","label":"Database failover","experimentId":null\#(fields)}"#
    return try JSONCoding.decoder.decode(FailoverRunItem.self, from: Data(json.utf8))
}

struct FailoverRunsTests {
    @Test func readsEachTestInARunLikeTheWebsite() throws {
        #expect(try item(#","error":"AWS refused this experiment.""#).status.text == "Didn't start")
        #expect(try item(#","skipped":"staging-valkey isn't available""#).status.text == "Skipped")
        #expect(try item(#","cancelled":true,"waiting":true"#).status.text == "Cancelled")
        #expect(try item(#","waiting":true,"note":"Waiting its turn.""#).status == ("Waiting", "unknown"))
        #expect(try item(#","state":"running""#).status == ("Running", "running"))
        #expect(try item(#","state":"completed","report":{"result":"passed","reason":null}"#).status == ("Passed", "passed"))
        #expect(try item(#","state":"failed""#).status == ("Failed", "failed"))
        #expect(try item(#","waiting":true,"note":"Waiting its turn.""#).detail == "Waiting its turn.")
    }

    @Test func namesStatesAndSteps() {
        #expect(FailoverState.isActive("stopping") && !FailoverState.isActive("completed"))
        #expect(FailoverState.label(of: "completed") == "Passed" && FailoverState.label(of: "cancelled") == "Failed")
        #expect(FailoverState.tone(of: "initiating") == "running")
        #expect(FailoverState.stepLabel(of: "pending") == "Waiting" && FailoverState.stepTone(of: "pending") == "unknown")
        #expect(FailoverState.stepLabel(of: "running") == "Running")
    }

    @Test func writesStepDurations() {
        #expect(failoverDuration("PT5M") == "5 min")
        #expect(failoverDuration("PT1H30M") == "1 h 30 min")
        #expect(failoverDuration("PT45S") == "45 s")
        #expect(failoverDuration("P1D") == nil && failoverDuration(nil) == nil)
    }

    @Test func startsOnlyWhenTheNameIsTypedExactly() {
        #expect(FailoverConfirmation.matches(" All tests ", "All tests"))
        #expect(!FailoverConfirmation.matches("all tests", "All tests"))
        #expect(!FailoverConfirmation.matches("", "All tests"))
    }

    @Test func refreshesOnlyWhileSomethingRuns() throws {
        let json = #"{"templates":[],"experiments":[{"id":"E1","region":"eu-central-1","templateId":"T","label":"T","state":"%@","reason":null,"startedAt":null,"endedAt":null}],"groups":[],"runs":[],"access":{"canRun":true,"blockedReason":null},"error":null}"#
        let decode = { (state: String) in try JSONCoding.decoder.decode(FailoverOverview.self, from: Data(json.replacingOccurrences(of: "%@", with: state).utf8)) }
        #expect(try decode("running").hasActiveTests)
        #expect(try !decode("completed").hasActiveTests)
    }
}
