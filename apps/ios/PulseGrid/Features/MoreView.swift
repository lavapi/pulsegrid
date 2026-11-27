import SwiftUI

/// Pipelines, environments, activity, and the person's own account: project, notifications, server and sign-out.
struct MoreView: View {
    @Environment(AppModel.self) private var app
    @Environment(PushRegistrar.self) private var push
    @Binding var showEnvironments: Bool

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink("Pipelines") { PipelinesView() }
                    NavigationLink("Environments") { EnvironmentsView() }
                    if app.user?.can(.viewActivity) == true {
                        NavigationLink("Activity") { ActivityView() }
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
                    LabeledContent("Notifications", value: push.statusText)
                    if push.canAsk {
                        Button("Turn on notifications") { Task { await push.ask() } }
                    }
                } footer: {
                    Text("Database access requests and their answers, and production releases waiting for a decision.")
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
            .navigationDestination(isPresented: $showEnvironments) { EnvironmentsView() }
        }
    }
}
