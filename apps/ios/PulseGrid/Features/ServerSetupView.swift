import SwiftUI

/// The first screen: each company runs its own PulseGrid, so the app starts by connecting to theirs.
struct ServerSetupView: View {
    @Environment(AppModel.self) private var app
    @State private var address = ""
    @State private var connecting = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Spacer()
            Image(systemName: "server.rack").font(.system(size: 48)).foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 8) {
                Text("Connect to your PulseGrid").font(.largeTitle.bold())
                Text("Enter the address your company opens PulseGrid at in a browser.")
                    .foregroundStyle(.secondary)
            }
            TextField("pulsegrid.example.com", text: $address)
                .textFieldStyle(.roundedBorder)
                .font(.title3)
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused($focused)
                .onSubmit(connect)
            if let message = app.error?.message {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(.red)
            }
            Label("If PulseGrid is only reachable on your company network, turn on your VPN first.", systemImage: "lock.shield")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer()
            Button(action: connect) {
                Text(connecting ? "Connecting…" : "Connect").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(connecting || address.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(24)
        .onAppear { focused = true }
    }

    private func connect() {
        connecting = true
        Task {
            await app.connect(to: address)
            connecting = false
        }
    }
}
