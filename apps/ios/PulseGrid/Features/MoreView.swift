import SwiftUI

/// Work, history and the person's own settings, as grouped Settings-style rows.
struct MoreView: View {
    @Environment(AppModel.self) private var app
    @Environment(PushRegistrar.self) private var push
    @Binding var openPage: MorePage?
    @State private var confirmingSignOut = false

    var body: some View {
        NavigationStack {
            List {
                if let user = app.user {
                    Section { ProfileHeader(user: user) }
                }
                Section("Work") {
                    NavigationLink { PipelinesView() } label: { IconRow(title: "Pipelines", symbol: "arrow.triangle.pull", color: .indigo) }
                    NavigationLink { EnvironmentsView() } label: { IconRow(title: "Environments", symbol: "square.stack.3d.up.fill", color: .teal) }
                    if app.user?.can(.viewCosts) == true {
                        NavigationLink { CostsView() } label: { IconRow(title: "Costs", symbol: "dollarsign", color: .green) }
                    }
                    NavigationLink { FailoverTestsView() } label: { IconRow(title: "Failover tests", symbol: "bolt.shield.fill", color: .orange) }
                }
                if app.user?.can(.viewActivity) == true {
                    Section("History") {
                        NavigationLink { ActivityView() } label: { IconRow(title: "Activity", symbol: "clock.fill", color: .blue) }
                        NavigationLink { CloudActivityView() } label: { IconRow(title: "Cloud activity", symbol: "cloud.fill", color: .cyan) }
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
                                    if project.id == app.user?.tenant?.id { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                        }
                    }
                }
                Section {
                    NavigationLink { NotificationSettingsView() } label: {
                        IconRow(title: "Notifications", symbol: "bell.badge.fill", color: .red, value: push.statusText)
                    }
                    Label {
                        LabeledContent("Server", value: app.server?.host() ?? "")
                    } icon: {
                        IconTile(symbol: "server.rack", color: .gray)
                    }
                    Button { Task { await app.changeServer() } } label: {
                        Label { Text("Change server") } icon: { IconTile(symbol: "arrow.left.arrow.right", color: .gray) }
                    }
                    Button(role: .destructive) { confirmingSignOut = true } label: {
                        Label { Text("Sign out") } icon: { IconTile(symbol: "rectangle.portrait.and.arrow.right", color: .red) }
                    }
                } header: {
                    Text("You")
                } footer: {
                    Text("If your PulseGrid is only reachable on your company network, keep your VPN on to use the app.")
                }
            }
            .navigationTitle("More")
            .confirmationDialog("Sign out of PulseGrid on this iPhone?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await app.signOut() } }
            }
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

/// The signed-in person: initials, name, role and email.
private struct ProfileHeader: View {
    let user: CurrentUser

    private var initials: String {
        user.displayName.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }

    var body: some View {
        HStack(spacing: 14) {
            Text(initials.isEmpty ? "?" : initials)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(Color.accentColor.gradient, in: .circle)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(user.displayName).font(.headline)
                Text(user.email).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Text(user.roleName).font(.caption.weight(.medium)).foregroundStyle(.tint)
            }
        }
        .padding(.vertical, 4)
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
