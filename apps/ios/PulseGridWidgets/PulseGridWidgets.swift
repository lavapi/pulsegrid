import SwiftUI
import WidgetKit

@main
struct PulseGridWidgets: WidgetBundle {
    var body: some Widget {
        CountdownActivityWidget()
        HealthWidget()
        NeedsYouWidget()
    }
}
