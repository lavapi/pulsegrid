import SwiftUI

/// The account switcher, as on the web: screens that follow it reload when it changes.
struct AccountPicker: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        if app.accounts.count > 1 {
            Menu {
                Picker("Account", selection: $app.selectedAccountId) {
                    ForEach(app.accounts) { account in
                        Text(account.environmentName ?? account.name).tag(Optional(account.id))
                    }
                }
            } label: {
                Label(app.selectedAccount?.environmentName ?? app.selectedAccount?.name ?? "Account", systemImage: "chevron.up.chevron.down")
                    .labelStyle(.titleAndIcon)
            }
        }
    }
}

struct NoAccountView: View {
    var body: some View {
        ContentUnavailableView(
            "No connected accounts",
            systemImage: "cloud",
            description: Text("Connect an AWS account on the PulseGrid website to see it here.")
        )
    }
}
