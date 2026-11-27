import SwiftUI

/// The PulseGrid logo with a title and a line under it, for the screens before the app is open.
struct BrandHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 14) {
            Image("Logo")
                .resizable()
                .frame(width: 84, height: 84)
                .clipShape(.rect(cornerRadius: 19, style: .continuous))
                .shadow(color: .accentColor.opacity(0.3), radius: 14, y: 6)
                .accessibilityHidden(true)
            VStack(spacing: 6) {
                Text(title).font(.title.bold())
                Text(subtitle).font(.callout).foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
        }
    }
}

/// A plain-words problem under a form, orange when the VPN is the likely cause.
struct InlineProblem: View {
    let error: AppError

    var body: some View {
        Label(error.message ?? "", systemImage: error.needsVPN ? "lock.shield.fill" : "exclamationmark.triangle.fill")
            .font(.callout)
            .foregroundStyle(error.needsVPN ? .orange : .red)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background((error.needsVPN ? Color.orange : Color.red).opacity(0.1), in: .rect(cornerRadius: 12, style: .continuous))
    }
}
