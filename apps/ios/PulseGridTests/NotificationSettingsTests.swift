import Foundation
import Testing
@testable import PulseGrid

struct NotificationSettingsTests {
    @Test func readsTheChoicesAndIgnoresTopicsItDoesntKnow() throws {
        let settings = try JSONCoding.decoder.decode(NotificationSettings.self, from: Data(#"""
        {"database_access":true,"production_releases":true,"unhealthy_production":true,"unhealthy_staging":false,"failed_pipelines":false,"something_new":true}
        """#.utf8))
        #expect(settings.isOn(.unhealthyProduction))
        #expect(!settings.isOn(.unhealthyStaging) && !settings.isOn(.failedPipelines))
        #expect(settings.choices.count == 5)
    }

    @Test func sendsOneChangeAsTheServerTakesIt() throws {
        let json = try JSONSerialization.jsonObject(with: JSONCoding.encoder.encode(NotificationChange(topic: .unhealthyStaging, on: true))) as? [String: Bool]
        #expect(json == ["unhealthy_staging": true])
        #expect(NotificationSettings(choices: [:]).setting(.failedPipelines, to: true).isOn(.failedPipelines))
    }

    @Test func listsEveryTopicTheServerHas() {
        #expect(NotificationTopic.allCases.map(\.rawValue) == ["database_access", "production_releases", "unhealthy_production", "unhealthy_staging", "failed_pipelines", "failover_tests", "cost_increases"])
    }
}

struct NotificationLinkTests {
    @Test func opensAFailedRunFromItsNotification() {
        #expect(AppRoute(path: "/pipelines/runs/app-1/987") == .pipelineRun(appId: "app-1", runId: "987"))
        #expect(AppRoute(path: "/pipelines/runs/app-1/987")?.tab == .deploys)
        #expect(AppRoute(path: "/pipelines/runs/app-1") == nil)
    }

    @Test func opensAnUnhealthyServiceFromItsNotification() {
        #expect(AppRoute(path: "/infrastructure/ecs/r1") == .resource(id: "r1"))
        #expect(AppRoute(path: "/infrastructure/ecs/r1")?.tab == .services)
    }

    @Test func opensActivityButNotCloudActivityAsActivity() {
        #expect(AppRoute(path: "/activity") == .activity)
        #expect(AppRoute(path: "/activity/cloud") == .cloudActivity)
    }
}
