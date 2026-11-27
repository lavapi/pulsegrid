import SwiftUI

extension View {
    /// Tapping the screen's title switches the AWS account, as on the website's top bar.
    /// The selected account shows under the title.
    func accountTitleMenu() -> some View {
        modifier(AccountTitleMenu())
    }
}

private struct AccountTitleMenu: ViewModifier {
    @Environment(AppModel.self) private var app

    func body(content: Content) -> some View {
        @Bindable var app = app
        content
            .toolbarTitleMenu {
                Picker("Account", selection: $app.selectedAccountId) {
                    ForEach(app.accounts) { account in
                        Text(account.title).tag(Optional(account.id))
                    }
                }
            }
            .modifier(AccountSubtitle(title: app.selectedAccount?.title))
    }
}

/// The account's name under the title, where iOS shows subtitles.
private struct AccountSubtitle: ViewModifier {
    let title: String?

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *), let title {
            content.navigationSubtitle(title)
        } else {
            content
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
