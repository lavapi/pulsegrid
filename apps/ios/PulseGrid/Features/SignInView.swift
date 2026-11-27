import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var signingIn = false

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            BrandHeader(title: "PulseGrid", subtitle: "Sign in to \(app.server?.host() ?? "your server") with your PulseGrid account.")
            if let error = app.error { InlineProblem(error: error) }
            Spacer()
            VStack(spacing: 12) {
                Button {
                    signingIn = true
                    Task {
                        await app.signIn()
                        signingIn = false
                    }
                } label: {
                    Text(signingIn ? "Signing in…" : "Sign in").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(signingIn)
                Button("Change server") { Task { await app.changeServer() } }
                    .font(.subheadline)
            }
        }
        .padding(24)
    }
}

struct LockedView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            BrandHeader(title: "PulseGrid is locked", subtitle: "Unlock with Face ID to carry on.")
            if let error = app.error { InlineProblem(error: error) }
            Spacer()
            VStack(spacing: 12) {
                Button { Task { await app.unlock() } } label: {
                    Label("Unlock", systemImage: "faceid").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                Button("Sign out", role: .destructive) { Task { await app.signOut() } }
                    .font(.subheadline)
            }
        }
        .padding(24)
        // Not `.task`: unlocking replaces this screen, which would cancel the loading it starts.
        .onAppear { Task { await app.unlock() } }
    }
}
