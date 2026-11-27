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
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("This month so far").font(.caption).foregroundStyle(.secondary)
                        Text(account.format(account.thisMonth)).font(.title.weight(.bold).monospacedDigit())
                        if let change = account.monthChange { ChangeBadge(change: change) }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("Last month").font(.caption).foregroundStyle(.secondary)
                        Text(account.format(account.lastMonth)).font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
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
                        Label {
                            LabeledContent(service.service, value: account.format(service.thisMonth))
                        } icon: {
                            IconTile(.category(service.category ?? ""))
                        }
                    }
                }
                if let updated = account.updatedAt {
                    Text("Updated \(updated, format: .relative(presentation: .named))").font(.caption).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text(accountTitle(name: account.accountName, environment: account.environmentName))
        } footer: {
            if account.isProduction { Text("Production") }
        }
    }
}

/// How this month so far compares with all of last month: up in orange, down in green.
struct ChangeBadge: View {
    let change: Double

    /// Below half a percent, the months are the same.
    private var same: Bool { abs(change) < 0.005 }

    var body: some View {
        Group {
            if same {
                Label("Same as last month", systemImage: "equal")
            } else {
                Label(change.formatted(.percent.precision(.fractionLength(0)).sign(strategy: .always())), systemImage: change > 0 ? "arrow.up.right" : "arrow.down.right")
                    .accessibilityLabel("\(Int((abs(change) * 100).rounded())) percent \(change > 0 ? "more" : "less") than last month so far")
            }
        }
        .labelStyle(.titleAndIcon)
        .font(.caption.weight(.semibold).monospacedDigit())
        .foregroundStyle(same ? .secondary : change > 0 ? Color.orange : Color.green)
    }
}
