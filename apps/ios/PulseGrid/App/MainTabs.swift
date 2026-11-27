import SwiftUI

struct MainTabs: View {
    enum Tab: Hashable { case overview, infrastructure, releases, access, more }

    @Environment(AppModel.self) private var app
    @State private var tab: Tab = .overview
    @State private var showProduction = false
    @State private var openResourceId: String?

    var body: some View {
        TabView(selection: $tab) {
            OverviewView().tabItem { Label("Overview", systemImage: "gauge.with.dots.needle.33percent") }.tag(Tab.overview)
            InfrastructureView(openResourceId: $openResourceId).tabItem { Label("Infrastructure", systemImage: "server.rack") }.tag(Tab.infrastructure)
            ReleasesView(showProduction: $showProduction).tabItem { Label("Releases", systemImage: "shippingbox") }.tag(Tab.releases)
            AccessView().tabItem { Label("Access", systemImage: "cylinder.split.1x2") }.tag(Tab.access)
            MoreView().tabItem { Label("More", systemImage: "ellipsis.circle") }.tag(Tab.more)
        }
        .onChange(of: app.pendingPath, initial: true) { _, path in
            guard let path else { return }
            tab = MainTabs.tab(for: path) ?? tab
            showProduction = path.hasPrefix("/production-releases")
            openResourceId = MainTabs.resourceId(in: path)
            app.pendingPath = nil
        }
    }

    /// The tab a notification's web path belongs to.
    static func tab(for path: String) -> Tab? {
        if path.hasPrefix("/production-releases") { return .releases }
        if path.hasPrefix("/settings/database-access") || path.hasPrefix("/database-access") { return .access }
        if path.hasPrefix("/releases") { return .releases }
        if path.hasPrefix("/infrastructure") { return .infrastructure }
        if path.hasPrefix("/account") { return .more }
        return nil
    }

    /// The resource in a path such as "/infrastructure/<id>", to open its page.
    static func resourceId(in path: String) -> String? {
        let parts = path.split(separator: "/").map(String.init)
        return parts.count == 2 && parts[0] == "infrastructure" ? parts[1] : nil
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
