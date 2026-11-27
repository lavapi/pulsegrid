import Charts
import SwiftUI

/// This month's cost so far against last month, per AWS account, with the services that cost most.
struct CostsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loaded(id: app.user?.tenant?.id ?? "") {
            try await app.api.get("costs") as CostOverview
        } content: { overview, reload in
            List {
                if overview.accounts.isEmpty {
                    Text("No AWS accounts with costs yet.").foregroundStyle(.secondary)
                }
                ForEach(overview.accounts) { account in
                    AccountCostsSection(account: account)
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle("Costs")
    }
}

private struct AccountCostsSection: View {
    let account: AccountCosts

    var body: some View {
        Section {
            if let error = account.error {
                Text(error).font(.footnote).foregroundStyle(.secondary)
            } else {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading) {
                        Text("This month so far").font(.caption).foregroundStyle(.secondary)
                        Text(account.format(account.thisMonth)).font(.title2.weight(.semibold).monospacedDigit())
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("Last month").font(.caption).foregroundStyle(.secondary)
                        Text(account.format(account.lastMonth)).font(.body.monospacedDigit())
                    }
                }
                let biggest = account.biggest(5)
                if !biggest.isEmpty {
                    Chart(biggest) { service in
                        BarMark(x: .value("Cost", service.lastMonth), y: .value("Service", service.service))
                            .foregroundStyle(by: .value("Month", "Last month"))
                            .position(by: .value("Month", "Last month"))
                        BarMark(x: .value("Cost", service.thisMonth), y: .value("Service", service.service))
                            .foregroundStyle(by: .value("Month", "This month"))
                            .position(by: .value("Month", "This month"))
                    }
                    .chartForegroundStyleScale(["This month": Color.accentColor, "Last month": Color.secondary.opacity(0.5)])
                    .frame(height: CGFloat(biggest.count) * 44 + 30)
                    ForEach(biggest) { service in
                        LabeledContent(service.service, value: account.format(service.thisMonth))
                    }
                }
                if let updated = account.updatedAt {
                    Text("Updated \(updated, format: .relative(presentation: .named))").font(.caption).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text([account.accountName, account.environmentName].compactMap { $0 }.joined(separator: " · "))
        } footer: {
            if account.isProduction { Text("Production") }
        }
    }
}
