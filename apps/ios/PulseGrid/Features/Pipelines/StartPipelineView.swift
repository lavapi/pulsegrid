import SwiftUI

/// The selected account's pipelines, each opening the form to start a new run.
struct StartPipelineView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let account: CloudAccount
    let started: () -> Void

    var body: some View {
        NavigationStack {
            Loaded(id: account.id) {
                try await app.api.get("pipelines/environment/\(account.environmentId ?? "")") as [PipelineSummary]
            } content: { pipelines, reload in
                List {
                    if pipelines.isEmpty {
                        Text("No pipelines are linked to \(account.environmentName ?? "this environment") yet.").foregroundStyle(.secondary)
                    }
                    ForEach(pipelines) { pipeline in
                        NavigationLink {
                            StartPipelineForm(pipeline: pipeline, environmentId: account.environmentId) {
                                started()
                                dismiss()
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(pipeline.name).font(.body.weight(.medium))
                                    if pipeline.production { StatusBadge(text: "Production", tone: .warning) }
                                }
                                Text(pipeline.repository).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .refreshable { await reload() }
            }
            .navigationTitle("Start a pipeline")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

/// Branch and inputs for a new run, confirmed before it starts.
private struct StartPipelineForm: View {
    @Environment(AppModel.self) private var app
    let pipeline: PipelineSummary
    let environmentId: String?
    let started: () -> Void

    var body: some View {
        Loaded(id: pipeline.id) {
            let query = ["app": pipeline.appId, "workflow": pipeline.workflowId, "environment": environmentId ?? "none"]
            return try await app.api.get("pipelines/history", query: query) as PipelineHistory
        } content: { history, _ in
            RunForm(pipeline: pipeline, options: history.options, started: started)
        }
        .navigationTitle(pipeline.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct RunForm: View {
    @Environment(AppModel.self) private var app
    let pipeline: PipelineSummary
    let options: PipelineRunOptions
    let started: () -> Void
    @State private var branch: String
    @State private var values: [String: String]
    @State private var confirming = false
    @State private var starting = false

    init(pipeline: PipelineSummary, options: PipelineRunOptions, started: @escaping () -> Void) {
        self.pipeline = pipeline
        self.options = options
        self.started = started
        _branch = State(initialValue: options.defaultBranch)
        _values = State(initialValue: options.initialValues)
    }

    private var access: PipelineActionAccess { options.access(for: branch) }
    private var missing: [String] { options.missingInputs(in: values) }

    var body: some View {
        Form {
            if !options.definition.manual {
                Text("This pipeline can't be started by hand. It runs on its own, for example on each push.").foregroundStyle(.secondary)
            } else {
                Section {
                    Picker("Branch", selection: $branch) {
                        ForEach(options.branches, id: \.self) { Text($0).tag($0) }
                    }
                }
                if !options.definition.inputs.isEmpty {
                    Section("Inputs") {
                        ForEach(options.definition.inputs) { input in
                            InputField(input: input, value: binding(for: input))
                        }
                    }
                }
                Section {
                    Button(starting ? "Starting…" : "Start pipeline") { confirming = true }
                        .disabled(!access.canAct || !missing.isEmpty || starting)
                } footer: {
                    if let reason = access.reason, !access.canAct { Text(reason) }
                    else if !missing.isEmpty { Text("Fill in \(missing.joined(separator: ", ")).") }
                    else if access.production { Text("This run deploys to production.") }
                }
            }
        }
        .confirmationDialog(
            "Start \(pipeline.name) on \(branch)?",
            isPresented: $confirming,
            titleVisibility: .visible
        ) {
            Button(access.production ? "Start in production" : "Start pipeline", role: access.production ? .destructive : nil) {
                Task { await start() }
            }
        } message: {
            Text("This starts a new run in \(pipeline.repository).")
        }
    }

    private func binding(for input: PipelineInput) -> Binding<String> {
        Binding(get: { values[input.name] ?? "" }, set: { values[input.name] = $0 })
    }

    private func start() async {
        starting = true
        defer { starting = false }
        do {
            let request = StartPipelineRequest(appId: pipeline.appId, workflowId: pipeline.workflowId, branch: branch, values: values)
            try await app.api.postIgnoringResponse("pipelines/runs", body: request)
            started()
        } catch {
            app.show(error)
        }
    }
}

private struct InputField: View {
    let input: PipelineInput
    @Binding var value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let choices = input.choices {
                Picker(input.required ? "\(input.name) (required)" : input.name, selection: $value) {
                    if !input.required { Text("Not set").tag("") }
                    ForEach(choices, id: \.self) { Text($0).tag($0) }
                }
            } else {
                TextField(input.required ? "\(input.name) (required)" : input.name, text: $value)
                    .keyboardType(input.type == "number" ? .decimalPad : .default)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            if let description = input.description { Text(description).font(.caption).foregroundStyle(.secondary) }
        }
    }
}
