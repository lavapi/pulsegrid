import SwiftUI

/// Why an insight shows nothing: the person may not read it, or the cloud couldn't give it.
struct InsightNotice: View {
    let access: LogAccess
    let problem: LogProblem?

    var body: some View {
        if !access.allowed {
            Label(access.reason ?? "You can't read these logs.", systemImage: "lock").foregroundStyle(.secondary)
        } else if let problem {
            Label(problem.message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
        }
    }
}
