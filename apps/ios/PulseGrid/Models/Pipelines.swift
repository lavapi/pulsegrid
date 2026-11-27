import Foundation

nonisolated struct PipelineRun: Decodable, Equatable {
    let id: String
    let workflowName: String
    let repository: String
    let number: Int
    let title: String
    let branch: String
    let commit: String
    let actor: String?
    let status: String
    let startedAt: Date?
    let finishedAt: Date?
    let url: String
}

nonisolated struct PipelineActivityItem: Decodable, Identifiable {
    let appId: String
    let appName: String
    let workflowId: String
    let name: String
    let environmentName: String?
    let run: PipelineRun

    var id: String { "\(workflowId)-\(run.id)" }
}

nonisolated struct PipelineActivity: Decodable {
    let configured: Bool
    let running: [PipelineActivityItem]
    let failed: [PipelineActivityItem]
    let issues: [String]
}

nonisolated struct PipelineJob: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let status: String
    let durationSeconds: Int?
    let url: String
}

/// Whether the person may re-run or cancel a run, and why not when they can't.
nonisolated struct PipelineActionAccess: Decodable, Equatable {
    let canAct: Bool
    let production: Bool
    let reason: String?
}

nonisolated struct PipelineRunDetail: Decodable {
    struct App: Decodable, Equatable {
        let id: String
        let name: String
    }

    let app: App
    let rerunsFailedJobs: Bool
    let run: PipelineRun
    let jobs: [PipelineJob]
    let access: PipelineActionAccess
    let environmentName: String?

    var isActive: Bool { ["queued", "running"].contains(run.status) }
    var canRerunFailedJobs: Bool { rerunsFailedJobs && run.status == "failure" }
}

/// What a person can do with a finished or running pipeline run.
nonisolated enum PipelineRunAction: Equatable {
    case rerun(failedOnly: Bool)
    case cancel

    var title: String {
        switch self {
        case .rerun(failedOnly: true): "Re-run failed jobs"
        case .rerun: "Re-run all jobs"
        case .cancel: "Cancel run"
        }
    }

    var path: String {
        self == .cancel ? "pipelines/runs/cancel" : "pipelines/runs/rerun"
    }
}

/// A pipeline of an app, as listed for an environment.
nonisolated struct PipelineSummary: Decodable, Equatable, Identifiable {
    let appId: String
    let repository: String
    let workflowId: String
    let name: String
    let environmentName: String?
    let production: Bool
    let latestRun: PipelineRun?

    var id: String { "\(appId)-\(workflowId)" }
}

nonisolated struct PipelineInput: Decodable, Equatable, Identifiable {
    let name: String
    let description: String?
    let required: Bool
    /// "string", "boolean", "choice", "number" or "environment".
    let type: String
    let defaultValue: String?
    let options: [String]

    var id: String { name }

    /// The values to pick from, when the input is a choice rather than typed text.
    var choices: [String]? {
        switch type {
        case "boolean": ["true", "false"]
        case "choice": options
        default: nil
        }
    }
}

nonisolated struct PipelineRunOptions: Decodable, Equatable {
    struct Definition: Decodable, Equatable {
        let manual: Bool
        let inputs: [PipelineInput]
    }

    struct BranchAccess: Decodable, Equatable {
        let branch: String
        let matched: PipelineActionAccess
        let otherwise: PipelineActionAccess
    }

    let definition: Definition
    let access: PipelineActionAccess
    let branchAccess: BranchAccess?
    let defaultBranch: String
    let branches: [String]

    /// Whether this pipeline can be started by hand at all, by this person.
    var canStart: Bool { access.canAct && definition.manual }

    /// Who may run it can depend on the branch, as on the web.
    func access(for branch: String) -> PipelineActionAccess {
        guard let branchAccess else { return access }
        return branch == branchAccess.branch ? branchAccess.matched : branchAccess.otherwise
    }

    /// Each input's default, or empty when it has none.
    var initialValues: [String: String] {
        Dictionary(uniqueKeysWithValues: definition.inputs.map { ($0.name, $0.defaultValue ?? "") })
    }

    /// The required inputs still empty in these values.
    func missingInputs(in values: [String: String]) -> [String] {
        definition.inputs.filter { $0.required && (values[$0.name] ?? "").isEmpty }.map(\.name)
    }
}

nonisolated struct PipelineHistory: Decodable {
    let options: PipelineRunOptions
}

nonisolated struct StartPipelineRequest: Encodable, Equatable {
    let appId: String
    let workflowId: String
    let branch: String
    let inputs: [String: String]

    /// Empty inputs are left out, so the pipeline uses its own defaults, as on the web.
    init(appId: String, workflowId: String, branch: String, values: [String: String]) {
        self.appId = appId
        self.workflowId = workflowId
        self.branch = branch
        inputs = values.filter { !$0.value.isEmpty }
    }
}
