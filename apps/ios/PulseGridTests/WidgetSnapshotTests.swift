import Foundation
import Testing
@testable import PulseGrid

struct WidgetSnapshotTests {
    @Test func countsAnEmptyAccountAsHealthy() {
        let empty = WidgetSnapshot(account: "Staging", healthy: 0, degraded: 0, stopped: 0, total: 0, needsYou: 0, savedAt: .now)
        let some = WidgetSnapshot(account: "Staging", healthy: 3, degraded: 1, stopped: 0, total: 4, needsYou: 2, savedAt: .now)
        #expect(empty.healthyShare == 1)
        #expect(some.healthyShare == 0.75)
    }

    @Test func readsBackWhatWasSaved() throws {
        let snapshot = WidgetSnapshot(account: "Production", healthy: 5, degraded: 0, stopped: 1, total: 6, needsYou: 1, savedAt: Date(timeIntervalSince1970: 1_800_000_000))
        let data = try JSONEncoder().encode(snapshot)
        #expect(try JSONDecoder().decode(WidgetSnapshot.self, from: data) == snapshot)
    }
}
