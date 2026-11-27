import SwiftUI

/// The app's tabs.
enum AppTab: Hashable {
    case home, services, deploys, access, search
}

/// A screen a notification opens, read from its web path, and the tab it lives in.
enum AppRoute: Hashable, Identifiable {
    case resource(id: String)
    case productionRelease
    case pipelineRun(appId: String, runId: String)
    case failoverTests
    case failoverReport(FailoverReport)
    case environments, costs, activity, cloudActivity, notifications
    /// Paths that only pick a tab.
    case databaseAccess, releases, services

    var id: Self { self }

    init?(path: String) {
        let parts = path.split(separator: "/").map(String.init)
        if let report = FailoverReport(path: path) {
            self = .failoverReport(report)
            return
        }
        switch parts.first {
        case "infrastructure":
            // "/infrastructure/<category>/<id>", as the website links a resource; anything shorter just opens Services.
            self = parts.count == 3 ? .resource(id: parts[2]) : .services
        case "pipelines" where parts.count == 4 && parts[1] == "runs":
            self = .pipelineRun(appId: parts[2], runId: parts[3])
        case "production-releases": self = .productionRelease
        case "releases": self = .releases
        case "database-access": self = .databaseAccess
        case "settings" where parts.dropFirst().first == "database-access": self = .databaseAccess
        case "failover-tests": self = .failoverTests
        case "environments": self = .environments
        case "costs": self = .costs
        case "activity": self = parts.dropFirst().first == "cloud" ? .cloudActivity : .activity
        case "account" where parts.dropFirst().first == "notifications": self = .notifications
        default: return nil
        }
    }

    var tab: AppTab {
        switch self {
        case .resource, .failoverTests, .failoverReport, .cloudActivity, .services: .services
        case .productionRelease, .pipelineRun, .activity, .releases: .deploys
        case .environments, .costs, .notifications: .home
        case .databaseAccess: .access
        }
    }

    /// Whether the route opens a screen of its own, rather than only its tab.
    var opensScreen: Bool {
        switch self {
        case .databaseAccess, .releases, .services: false
        default: true
        }
    }
}

/// The screen for a route, pushed onto its tab.
struct AppRouteScreen: View {
    @Environment(AppModel.self) private var app
    let route: AppRoute

    var body: some View {
        switch route {
        case .resource(let id):
            if let account = app.selectedAccount { ResourceDetailView(resourceId: id, account: account) } else { NoAccountView() }
        case .productionRelease: ProductionReleaseView()
        case .pipelineRun(let appId, let runId): PipelineRunView(appId: appId, runId: runId)
        case .failoverTests: FailoverTestsView()
        case .failoverReport(let report): FailoverReportView(report: report)
        case .environments: EnvironmentsView()
        case .costs: CostsView()
        case .activity: ActivityView()
        case .cloudActivity: CloudActivityView()
        case .notifications: NotificationSettingsView()
        case .databaseAccess, .releases, .services: EmptyView()
        }
    }
}
