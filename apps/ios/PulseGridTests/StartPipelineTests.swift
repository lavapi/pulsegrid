import Foundation
import Testing
@testable import PulseGrid

private let options: PipelineRunOptions = try! JSONCoding.decoder.decode(PipelineRunOptions.self, from: Data(#"""
{"definition":{"manual":true,"environments":[],"environmentRule":null,"opaqueEnvironment":false,
  "inputs":[{"name":"version","description":"Tag to deploy","required":true,"type":"string","defaultValue":null,"options":[]},
            {"name":"dry_run","description":null,"required":false,"type":"boolean","defaultValue":"false","options":[]},
            {"name":"region","description":null,"required":false,"type":"choice","defaultValue":null,"options":["eu","us"]}]},
 "access":{"canAct":true,"production":false,"reason":null},
 "branchAccess":{"branch":"main","matched":{"canAct":false,"production":true,"reason":"You can't run production pipelines."},
                 "otherwise":{"canAct":true,"production":false,"reason":null}},
 "defaultBranch":"main","branches":["main","develop"]}
"""#.utf8))

struct StartPipelineTests {
    @Test func checksAccessForTheChosenBranch() {
        #expect(options.access(for: "main").reason == "You can't run production pipelines.")
        #expect(options.access(for: "develop").canAct)
        #expect(options.canStart)
    }

    @Test func startsWithDefaultsAndAsksForRequiredInputs() {
        #expect(options.initialValues == ["version": "", "dry_run": "false", "region": ""])
        #expect(options.missingInputs(in: options.initialValues) == ["version"])
        #expect(options.missingInputs(in: ["version": "1.4.0"]).isEmpty)
    }

    @Test func offersChoicesForYesNoAndChoiceInputs() {
        #expect(options.definition.inputs.map(\.choices) == [nil, ["true", "false"], ["eu", "us"]])
    }

    @Test func leavesOutEmptyInputs() throws {
        let request = StartPipelineRequest(appId: "a1", workflowId: "deploy.yml", branch: "develop", values: ["version": "1.4.0", "region": ""])
        let json = try JSONSerialization.jsonObject(with: JSONCoding.encoder.encode(request)) as? [String: Any]
        #expect(json?["inputs"] as? [String: String] == ["version": "1.4.0"])
        #expect(json?["branch"] as? String == "develop")
    }
}
