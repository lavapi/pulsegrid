import SwiftUI

/// The signed-in person, opened from their picture at the top of each tab: their project, notifications,
/// the server and signing out.
struct ProfileView: View {
    @Environment(AppModel.self) private var app
    @Environment(PushRegistrar.self) private var push
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingSignOut = false

    var body: some View {
        NavigationStack {
            List {
                if let user = app.user {
                    Section { ProfileHeader(user: user) }
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
                } footer: {
                    Text("If your PulseGrid is only reachable on your company network, keep your VPN on to use the app.")
                }
            }
            .navigationTitle("You")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Sign out of PulseGrid on this iPhone?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await app.signOut() } }
            }
        }
    }
}

/// The person's initials in a circle, at the top of each tab, opening their profile.
struct ProfileButton: View {
    @Environment(AppModel.self) private var app
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            Initials(name: app.user?.displayName ?? "", size: 30)
        }
        .accessibilityLabel("You")
        .sheet(isPresented: $open) { ProfileView() }
    }
}

/// The signed-in person: initials, name, role and email.
private struct ProfileHeader: View {
    let user: CurrentUser

    var body: some View {
        HStack(spacing: 14) {
            Initials(name: user.displayName, size: 56)
            VStack(alignment: .leading, spacing: 3) {
                Text(user.displayName).font(.headline)
                Text(user.email).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Text(user.roleName).font(.caption.weight(.medium)).foregroundStyle(.tint)
            }
        }
        .padding(.vertical, 4)
    }
}
