import ActivityKit
import Foundation
import WidgetKit

/// Keeps the Lock Screen countdowns in line with what PulseGrid reports: starts one when something begins,
/// moves its end when it's extended, and ends it once it's over or decided.
enum LiveActivities {
    /// A production release waiting for a decision, or nil when none is.
    static func follow(release: ProductionRelease?) {
        let wanted = release.flatMap { release -> (PulseGridActivity, PulseGridActivity.ContentState)? in
            guard release.isWaiting, let deadline = release.holdUntil else { return nil }
            let attributes = PulseGridActivity(
                kind: .productionRelease,
                subject: release.id,
                title: "Release waiting",
                detail: release.components.map { "\($0.name) \($0.tag)" }.joined(separator: ", ")
            )
            return (attributes, .init(startsAt: release.createdAt ?? .now, endsAt: deadline))
        }
        sync(.productionRelease, to: wanted)
    }

    /// The person's own database access while it's active, or nil.
    static func follow(access grant: DatabaseAccessGrant?) {
        let wanted = grant.flatMap { grant -> (PulseGridActivity, PulseGridActivity.ContentState)? in
            guard grant.status == "active" else { return nil }
            let attributes = PulseGridActivity(kind: .databaseAccess, subject: grant.id, title: "Database access", detail: "Read-only · production")
            return (attributes, .init(startsAt: grant.startsAt, endsAt: grant.expiresAt))
        }
        sync(.databaseAccess, to: wanted)
    }

    private static func sync(_ kind: PulseGridActivity.Kind, to wanted: (attributes: PulseGridActivity, state: PulseGridActivity.ContentState)?) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let running = Activity<PulseGridActivity>.activities.filter { $0.attributes.kind == kind }
        for activity in running {
            if let wanted, activity.attributes.subject == wanted.attributes.subject, wanted.state.endsAt > .now {
                if activity.content.state != wanted.state {
                    let id = activity.id, state = wanted.state
                    Task { await update(id: id, to: state) }
                }
            } else {
                let id = activity.id
                Task { await end(id: id) }
            }
        }
        guard let wanted, wanted.state.endsAt > .now, !running.contains(where: { $0.attributes.subject == wanted.attributes.subject }) else { return }
        _ = try? Activity.request(attributes: wanted.attributes, content: ActivityContent(state: wanted.state, staleDate: wanted.state.endsAt))
    }

    // Activities aren't Sendable, so each change finds its activity again by ID where it runs.
    private nonisolated static func update(id: String, to state: PulseGridActivity.ContentState) async {
        await Activity<PulseGridActivity>.activities.first { $0.id == id }?.update(ActivityContent(state: state, staleDate: state.endsAt))
    }

    private nonisolated static func end(id: String) async {
        await Activity<PulseGridActivity>.activities.first { $0.id == id }?.end(nil, dismissalPolicy: .immediate)
    }
}

extension HomeSnapshot {
    /// Saves what the Home Screen widgets show and asks them to redraw.
    func saveForWidgets(account: CloudAccount) {
        let health = health
        WidgetSnapshot(
            account: account.title,
            healthy: health.healthy,
            degraded: health.degraded,
            stopped: health.stopped,
            total: health.total,
            needsYou: needsYou.count,
            savedAt: .now
        ).save()
        WidgetCenter.shared.reloadAllTimelines()
    }
}
