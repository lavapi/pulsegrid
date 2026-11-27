import Foundation

nonisolated struct ServiceCost: Decodable, Equatable, Identifiable {
    let service: String
    let thisMonth: Double
    let lastMonth: Double

    var id: String { service }
}

nonisolated struct AccountCosts: Decodable, Equatable, Identifiable {
    let accountId: String
    let accountName: String
    let environmentName: String?
    let isProduction: Bool
    let currency: String?
    let services: [ServiceCost]
    let updatedAt: Date?
    let error: String?

    var id: String { accountId }
    var thisMonth: Double { services.reduce(0) { $0 + $1.thisMonth } }
    var lastMonth: Double { services.reduce(0) { $0 + $1.lastMonth } }

    /// The services that cost most this month, biggest first.
    func biggest(_ count: Int) -> [ServiceCost] {
        Array(services.sorted { $0.thisMonth > $1.thisMonth }.prefix(count))
    }

    func format(_ amount: Double) -> String {
        amount.formatted(.currency(code: currency ?? "USD").precision(.fractionLength(0...2)))
    }
}

nonisolated struct CostOverview: Decodable, Equatable {
    /// "2026-11".
    let month: String
    let lastMonth: String
    let accounts: [AccountCosts]
}
