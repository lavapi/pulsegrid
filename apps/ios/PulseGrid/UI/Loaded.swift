import SwiftUI

/// Loads a screen's data, shows it, reloads on pull-to-refresh and whenever `id` changes, and explains failures.
struct Loaded<Value, Content: View>: View {
    let id: String
    let load: () async throws -> Value
    @ViewBuilder let content: (Value, _ reload: @escaping () async -> Void) -> Content

    @State private var value: Value?
    @State private var error: AppError?

    var body: some View {
        Group {
            if let value {
                content(value, reload)
                    .safeAreaInset(edge: .top) {
                        if let error { RefreshBanner(error: error).padding(.horizontal) }
                    }
                    .transition(.opacity)
            } else if let error {
                ErrorView(error: error) { Task { await reload() } }
            } else {
                SkeletonList()
            }
        }
        .animation(.easeOut(duration: 0.2), value: value == nil)
        .task(id: id) { await reload() }
    }

    private func reload() async {
        do {
            value = try await load()
            error = nil
        } catch {
            let appError = AppError.from(error)
            if appError != .cancelled { self.error = appError }
        }
    }
}

struct ErrorView: View {
    let error: AppError
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(error.needsVPN ? "Turn on your VPN" : "Couldn't load this", systemImage: error.needsVPN ? "lock.shield" : "exclamationmark.triangle")
        } description: {
            Text(error.message ?? "")
        } actions: {
            Button("Try Again", action: retry).buttonStyle(.borderedProminent)
        }
    }
}

/// Shown above data already on screen when a refresh fails: the VPN reminder, or the readable reason.
struct RefreshBanner: View {
    let error: AppError

    var body: some View {
        Label(error.message ?? "", systemImage: error.needsVPN ? "lock.shield" : "exclamationmark.triangle")
            .font(.footnote.weight(.medium))
            .foregroundStyle(.white)
            .padding(10)
            .frame(maxWidth: .infinity)
            .background(error.needsVPN ? .orange : .red, in: .rect(cornerRadius: 10))
    }
}
