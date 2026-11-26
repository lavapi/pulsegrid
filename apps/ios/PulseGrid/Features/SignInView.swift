import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var signingIn = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "waveform.path.ecg.rectangle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
            VStack(spacing: 8) {
                Text("PulseGrid").font(.largeTitle.bold())
                Text("Sign in to \(app.server?.host() ?? "your server") with your PulseGrid account.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            if let message = app.error?.message {
                Label(message, systemImage: app.error?.needsVPN == true ? "lock.shield" : "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(app.error?.needsVPN == true ? .orange : .red)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            Button {
                signingIn = true
                Task {
                    await app.signIn()
                    signingIn = false
                }
            } label: {
                Text(signingIn ? "Signing in…" : "Sign in").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(signingIn)
            Button("Change server") { Task { await app.changeServer() } }
                .font(.footnote)
        }
        .padding(24)
    }
}

struct LockedView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "faceid").font(.system(size: 56)).foregroundStyle(.tint)
            Text("PulseGrid is locked").font(.title2.bold())
            if let message = app.error?.message {
                Text(message).font(.callout).foregroundStyle(app.error?.needsVPN == true ? .orange : .red).multilineTextAlignment(.center)
            }
            Button("Unlock") { Task { await app.unlock() } }.buttonStyle(.borderedProminent).controlSize(.large)
            Button("Sign out", role: .destructive) { Task { await app.signOut() } }.font(.footnote)
        }
        .padding(24)
        // Not `.task`: unlocking replaces this screen, which would cancel the loading it starts.
        .onAppear { Task { await app.unlock() } }
    }
}
