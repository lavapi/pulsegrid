import SwiftUI

/// The first screen: each company runs its own PulseGrid, so the app starts by connecting to theirs.
struct ServerSetupView: View {
    @Environment(AppModel.self) private var app
    @State private var address = ""
    @State private var connecting = false
    @FocusState private var focused: Bool

    private var canConnect: Bool { !connecting && !address.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            BrandHeader(title: "Connect to PulseGrid", subtitle: "Enter the address your company opens PulseGrid at in a browser.")
            VStack(spacing: 12) {
                TextField("pulsegrid.example.com", text: $address)
                    .font(.title3)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focused)
                    .onSubmit { if canConnect { connect() } }
                    .padding(14)
                    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 14, style: .continuous))
                if let error = app.error { InlineProblem(error: error) }
            }
            Label("If PulseGrid is only reachable on your company network, turn on your VPN first.", systemImage: "lock.shield")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer()
            Button(action: connect) {
                Text(connecting ? "Connecting…" : "Connect").font(.headline).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!canConnect)
        }
        .padding(24)
        .onAppear { focused = true }
        .sensoryFeedback(.error, trigger: app.error) { _, new in new != nil }
    }

    private func connect() {
        connecting = true
        Task {
            await app.connect(to: address)
            connecting = false
        }
    }
}
