import SwiftUI

/// Four tabs and Search. Notifications open their screen on the tab it belongs to.
struct MainTabs: View {
    @Environment(AppModel.self) private var app
    @State private var tab: AppTab = .home
    @State private var route: AppRoute?

    var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                TabRoot(tab: .home, route: $route) { OverviewView() }
            }
            Tab("Services", systemImage: "server.rack", value: AppTab.services) {
                TabRoot(tab: .services, route: $route) { InfrastructureView() }
            }
            Tab("Deploys", systemImage: "shippingbox", value: AppTab.deploys) {
                TabRoot(tab: .deploys, route: $route) { ReleasesView() }
            }
            Tab("Access", systemImage: "cylinder.split.1x2", value: AppTab.access) {
                TabRoot(tab: .access, route: $route, followsAccount: false) { AccessView() }
            }
            Tab(value: AppTab.search, role: .search) {
                TabRoot(tab: .search, route: $route) { SearchView() }
            }
        }
        .modifier(MinimizingTabBar())
        .onChange(of: app.pendingPath, initial: true) { _, path in
            guard let path else { return }
            if let opened = AppRoute(path: path) {
                tab = opened.tab
                route = opened.opensScreen ? opened : nil
            }
            app.pendingPath = nil
        }
    }
}

/// A tab's navigation, with the account menu on its title, the person's picture, and the screen a notification opened.
private struct TabRoot<Content: View>: View {
    let tab: AppTab
    @Binding var route: AppRoute?
    var followsAccount = true
    @ViewBuilder let content: Content

    var body: some View {
        NavigationStack {
            content
                .modifier(OptionalAccountMenu(enabled: followsAccount))
                .toolbar { ToolbarItem(placement: .topBarTrailing) { ProfileButton() } }
                .navigationDestination(item: openedHere) { AppRouteScreen(route: $0) }
        }
    }

    private var openedHere: Binding<AppRoute?> {
        Binding(get: { route?.tab == tab ? route : nil }, set: { route = $0 })
    }
}

private struct OptionalAccountMenu: ViewModifier {
    let enabled: Bool

    func body(content: Content) -> some View {
        if enabled { content.accountTitleMenu() } else { content }
    }
}

/// The tab bar shrinks while scrolling down, where iOS supports it.
private struct MinimizingTabBar: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            content
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(PushRegistrar.self) private var push
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch app.phase {
            case .needsServer: ServerSetupView()
            case .signedOut: SignInView()
            case .locked: LockedView()
            case .loading: ProgressView("Loading…")
            case .ready: MainTabs()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { app.lock() }
        }
        .onChange(of: app.phase) { _, phase in
            if phase == .ready { Task { await push.registerIfAllowed() } }
        }
        .alert(
            app.error?.needsVPN == true ? "Turn on your VPN" : "Something went wrong",
            isPresented: Binding(get: { app.phase == .ready && app.error != nil }, set: { if !$0 { app.error = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(app.error?.message ?? "")
        }
    }
}
