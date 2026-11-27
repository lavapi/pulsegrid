import Foundation

nonisolated struct CurrentUser: Decodable, Equatable {
    struct Tenant: Decodable, Equatable {
        let id: String
        let slug: String
        let name: String
    }

    let id: String
    let email: String
    let displayName: String
    let roleName: String
    let permissions: [String]
    let isOwner: Bool
    let mustChangePassword: Bool
    let twoFactorEnabled: Bool
    let tenant: Tenant?

    func can(_ permission: Permission) -> Bool { isOwner || permissions.contains(permission.rawValue) }
}

/// The permissions the app's screens depend on.
nonisolated enum Permission: String {
    case grantDatabaseAccess = "production.database_access.grant"
    case decideProductionReleases = "production.release.decide"
    case viewActivity = "activity.view"
    case viewCosts = "costs.view"
}

nonisolated struct Project: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
}

nonisolated struct ProjectList: Decodable {
    let currentId: String?
    let projects: [Project]
}

nonisolated struct CloudAccount: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let accountId: String
    let status: String
    let environmentId: String?
    let environmentName: String?
    let isProduction: Bool

    /// Accounts the switcher offers: connected ones, as on the web.
    var isSelectable: Bool { status == "connected" }
}

nonisolated struct SignedInDevice: Decodable, Identifiable {
    let id: String
    let name: String
    let signedInAt: Date
    let lastUsedAt: Date?
    let current: Bool
}

nonisolated struct DeviceToken: Decodable {
    let token: String
}
