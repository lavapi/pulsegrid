import Foundation
import Testing
@testable import PulseGrid

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONCoding.decoder.decode(T.self, from: Data(json.utf8))
}

struct ResourceDetailTests {
    @Test func showsPlainDetailsAsReadableFacts() throws {
        let resource = try decode(Resource.self, #"""
        {"id":"r1","type":"ecs-service","name":"api","displayName":"API","status":"ACTIVE","health":"healthy",
         "region":"eu-central-1","lastSeenAt":"2026-11-27T10:00:00.000Z",
         "details":{"desiredCount":2,"launchType":"FARGATE","subnets":["a","b"],"public":false,"cpuUnits":0.5,
                    "network":{"vpc":"v1"},"empty":"","nothing":null}}
        """#)
        #expect(resource.title == "API")
        #expect(resource.lastSeenAt != nil)
        #expect(resource.facts.map(\.label) == ["Cpu units", "Desired count", "Launch type", "Public", "Subnets"])
        #expect(resource.facts.map(\.value) == ["0.50", "2", "FARGATE", "No", "a, b"])
        #expect(resource.hasLoad && resource.hasLogs)
    }

    @Test func offersLoadAndLogsOnlyWhereTheAPIHasThem() throws {
        let bucket = try decode(Resource.self, #"{"id":"r2","type":"s3-bucket","name":"files","status":"ok","health":"unknown","region":"eu-central-1"}"#)
        let database = try decode(Resource.self, #"{"id":"r3","type":"rds-instance","name":"db","status":"available","health":"healthy","region":"eu-central-1"}"#)
        #expect(!bucket.hasLoad && !bucket.hasLogs && bucket.facts.isEmpty)
        #expect(database.hasLoad && !database.hasLogs)
    }

    @Test(arguments: [("desiredCount", "Desired count"), ("instance_class", "Instance class"), ("engine", "Engine")])
    func labelsKeysAsSentences(key: String, label: String) {
        #expect(key.labelFromKey == label)
    }
}

struct LoadTests {
    @Test func formatsValuesByUnit() throws {
        let load = try decode(ResourceLoad.self, #"""
        {"available":true,"error":null,"hiddenSeries":0,"capacity":[{"label":"vCPUs","value":"2"}],
         "charts":[{"id":"cpu","label":"CPU","unit":"percent","limit":100,"warnAbove":80,"total":null,"note":null,
                    "series":[{"label":"api","points":[{"timestamp":"2026-11-27T10:00:00Z","value":41.6},{"timestamp":"2026-11-27T10:01:00Z","value":57.2}]}]}]}
        """#)
        let chart = try #require(load.charts.first)
        #expect(chart.latest == 57.2)
        #expect(chart.format(57.2) == "57%")
        #expect(LoadChart.sample(unit: "milliseconds").format(12.4) == "12 ms")
        #expect(LoadChart.sample(unit: "count").format(3) == "3")
    }
}

struct ResourceActionTests {
    @Test func offersOnlyTheActionsTheAppKnows() throws {
        let options = try decode([ResourceActionOption].self, #"""
        [{"permission":"service.redeploy","blockedReason":null},{"permission":"experiment.run","blockedReason":null},
         {"permission":"database.reboot","blockedReason":"A reboot is already running."}]
        """#)
        #expect(options.compactMap(\.action) == [.redeployService, .rebootDatabase])
        #expect(options[2].blockedReason == "A reboot is already running.")
    }

    @Test func readsAnActionRun() throws {
        let run = try decode(ActionRun.self, #"""
        {"id":"a1","resourceId":"r1","title":"Force deploy api","status":"running","summary":"Starting new tasks",
         "startedBy":"ada@example.test","startedAt":"2026-11-27T10:00:00Z","finishedAt":null}
        """#)
        #expect(run.isRunning)
    }
}

extension LoadChart {
    static func sample(unit: String) -> LoadChart {
        try! JSONCoding.decoder.decode(LoadChart.self, from: Data(#"{"id":"x","label":"X","unit":"\#(unit)","limit":null,"warnAbove":null,"note":null,"series":[]}"#.utf8))
    }
}
