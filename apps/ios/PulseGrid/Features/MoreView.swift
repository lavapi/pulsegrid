import SwiftUI

/// Pipelines, environments, costs, failover tests, activity, and the person's own account: project, notifications, server and sign-out.
struct MoreView: View {
    @Environment(AppModel.self) private var app
    @Environment(PushRegistrar.self) private var push
    @Binding var openPage: MorePage?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink("Pipelines") { PipelinesView() }
                    NavigationLink("Environments") { EnvironmentsView() }
                    if app.user?.can(.viewCosts) == true {
                        NavigationLink("Costs") { CostsView() }
                    }
                    NavigationLink("Failover tests") { FailoverTestsView() }
                    if app.user?.can(.viewActivity) == true {
                        NavigationLink("Activity") { ActivityView() }
                        NavigationLink("Cloud activity") { CloudActivityView() }
                    }
                }
                if let user = app.user {
                    Section("Signed in") {
                        LabeledContent(user.displayName, value: user.roleName)
                        Text(user.email).foregroundStyle(.secondary)
                    }
                }
                if app.projects.count > 1 {
                    Section("Project") {
                        ForEach(app.projects) { project in
                            Button {
                                Task { await app.switchProject(to: project) }
                            } label: {
                                HStack {
                                    Text(project.name).foregroundStyle(.primary)
                                    Spacer()
                                    if project.id == app.user?.tenant?.id { Image(systemName: "checkmark") }
                                }
                            }
                        }
                    }
                }
                Section {
                    NavigationLink { NotificationSettingsView() } label: {
                        LabeledContent("Notifications", value: push.statusText)
                    }
                }
                Section {
                    LabeledContent("Server", value: app.server?.host() ?? "")
                    Button("Change server") { Task { await app.changeServer() } }
                    Button("Sign out", role: .destructive) { Task { await app.signOut() } }
                } footer: {
                    Text("If your PulseGrid is only reachable on your company network, keep your VPN on to use the app.")
                }
            }
            .navigationTitle("More")
            .navigationDestination(item: $openPage) { page in
                switch page {
                case .environments: EnvironmentsView()
                case .costs: CostsView()
                case .failoverTests: FailoverTestsView()
                case .notifications: NotificationSettingsView()
                case .pipelineRun(let appId, let runId): PipelineRunView(appId: appId, runId: runId)
                case .failoverReport(let report): FailoverReportView(report: report)
                case .cloudActivity: CloudActivityView()
                }
            }
        }
    }
}

/// The pages under More that a link can open, by their web path.
enum MorePage: Hashable {
    case environments, costs, failoverTests, notifications, cloudActivity
    case pipelineRun(appId: String, runId: String)
    case failoverReport(FailoverReport)

    init?(path: String) {
        if let report = FailoverReport(path: path) {
            self = .failoverReport(report)
            return
        }
        let parts = path.split(separator: "/").map(String.init)
        if parts.count == 4, parts[0] == "pipelines", parts[1] == "runs" {
            self = .pipelineRun(appId: parts[2], runId: parts[3])
            return
        }
        switch path {
        case _ where path.hasPrefix("/environments"): self = .environments
        case _ where path.hasPrefix("/costs"): self = .costs
        case _ where path.hasPrefix("/failover-tests"): self = .failoverTests
        case _ where path.hasPrefix("/account/notifications"): self = .notifications
        case _ where path.hasPrefix("/activity/cloud"): self = .cloudActivity
        default: return nil
        }
    }
}
