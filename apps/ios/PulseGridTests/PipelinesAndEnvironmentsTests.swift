import Foundation
import Testing
@testable import PulseGrid

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
}

private func runDetail(status: String, rerunsFailedJobs: Bool = true, canAct: Bool = true) throws -> PipelineRunDetail {
    try decode(PipelineRunDetail.self, #"""
    {"app":{"id":"a1","name":"shop","repository":"acme/shop","connectionId":null},"rerunsFailedJobs":\#(rerunsFailedJobs),
     "run":{"id":"9","workflowName":"Deploy","repository":"acme/shop","number":12,"title":"Fix login","branch":"main","commit":"abc1234",
            "actor":"ada","status":"\#(status)","startedAt":"2026-11-27T10:00:00Z","finishedAt":null,"url":"https://github.com/acme/shop/actions/runs/9"},
     "jobs":[{"id":"j1","name":"build","status":"success","durationSeconds":95,"url":"https://github.com","steps":[]}],
     "access":{"canAct":\#(canAct),"production":false,"reason":\#(canAct ? "null" : "\"You can't run staging pipelines.\"")},"environmentName":"staging"}
    """#)
}

struct PipelineRunTests {
    @Test func offersCancelWhileARunIsGoing() throws {
        let detail = try runDetail(status: "running")
        #expect(detail.isActive)
        #expect(PipelineRunAction.cancel.path == "pipelines/runs/cancel")
    }

    @Test func offersRerunningOnlyFailedJobsWhenTheProviderCan() throws {
        #expect(try runDetail(status: "failure").canRerunFailedJobs)
        #expect(try !runDetail(status: "failure", rerunsFailedJobs: false).canRerunFailedJobs)
        #expect(try !runDetail(status: "success").canRerunFailedJobs)
        #expect(PipelineRunAction.rerun(failedOnly: true).title == "Re-run failed jobs")
        #expect(PipelineRunAction.rerun(failedOnly: false).path == "pipelines/runs/rerun")
    }

    @Test func saysWhyThePersonCantAct() throws {
        let detail = try runDetail(status: "failure", canAct: false)
        #expect(!detail.access.canAct)
        #expect(detail.access.reason == "You can't run staging pipelines.")
        #expect(detail.jobs.first?.durationSeconds == 95)
    }
}

struct EnvironmentTests {
    @Test func readsAnEnvironmentWithItsServicesAndAddresses() throws {
        let environment = try decode(EnvironmentSummary.self, #"""
        {"id":"e1","name":"staging","accounts":[{"id":"c1","accountId":"123456789012","name":"Staging"}],
         "health":{"healthy":5,"degraded":1,"stopped":0,"unknown":0,"total":6},
         "services":[{"service":"ecs","health":{"healthy":2,"degraded":1,"stopped":0,"unknown":0,"total":3}},
                     {"service":"secrets","health":{"healthy":1,"degraded":0,"stopped":0,"unknown":0,"total":1}}],
         "lastSyncedAt":"2026-11-27T10:00:00Z","domains":[{"id":"d1","kind":"web","label":null,"url":"https://staging.example.com"}]}
        """#)
        #expect(environment.services.map(\.label) == ["ECS", "Secrets Manager"])
        #expect(environment.health.degraded == 1)
        #expect(environment.domains.first?.url == "https://staging.example.com")
    }

    @Test func opensEnvironmentsFromALink() {
        #expect(MainTabs.tab(for: "/environments") == .more)
    }
}
