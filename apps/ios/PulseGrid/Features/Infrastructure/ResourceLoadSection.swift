import Charts
import SwiftUI

/// CPU, memory and the other load charts the API has for this resource, over a chosen range.
struct ResourceLoadSection: View {
    @Environment(AppModel.self) private var app
    let resourceId: String
    @State private var range = "1h"
    @State private var load: ResourceLoad?
    @State private var error: AppError?

    private static let ranges = [("1h", "1 hour"), ("24h", "24 hours"), ("7d", "7 days")]

    var body: some View {
        Section {
            Picker("Range", selection: $range) {
                ForEach(Self.ranges, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.segmented)
            if let error {
                Text(error.message ?? "").font(.footnote).foregroundStyle(.secondary)
            } else if let load {
                if let message = load.error ?? (load.available ? nil : "Load isn't available for this resource.") {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(load.charts) { LoadChartView(chart: $0) }
                ForEach(load.capacity, id: \.label) { LabeledContent($0.label, value: $0.value) }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        } header: {
            Text("Load")
        }
        .task(id: range) { await read() }
    }

    private func read() async {
        do {
            load = try await app.api.get("resources/\(resourceId)/load", query: ["range": range])
            error = nil
        } catch {
            let appError = AppError.from(error)
            if appError != .cancelled { self.error = appError }
        }
    }
}

/// One load chart: a filled line per series, the warning level, and the value under the finger while touching it.
private struct LoadChartView: View {
    let chart: LoadChart
    @State private var touched: Date?

    /// The values at the touched time, nearest point per series.
    private var reading: [(label: String, value: Double)] {
        guard let touched else { return [] }
        return chart.series.compactMap { series in
            series.points.min { abs($0.timestamp.timeIntervalSince(touched)) < abs($1.timestamp.timeIntervalSince(touched)) }
                .map { (series.label, $0.value) }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(chart.label).font(.subheadline.weight(.medium))
                Spacer()
                if let first = reading.first, let touched {
                    Text("\(chart.format(first.value)) · \(touched, format: .dateTime.hour().minute())").font(.subheadline.monospacedDigit()).foregroundStyle(.tint)
                } else if let latest = chart.latest {
                    Text(chart.format(latest)).font(.title3.weight(.semibold).monospacedDigit())
                }
            }
            if let note = chart.note { Text(note).font(.caption).foregroundStyle(.secondary) }
            Chart {
                ForEach(chart.series) { series in
                    ForEach(series.points, id: \.timestamp) { point in
                        if chart.series.count == 1 {
                            AreaMark(x: .value("Time", point.timestamp), y: .value(chart.label, point.value))
                                .foregroundStyle(LinearGradient(colors: [Color.accentColor.opacity(0.3), Color.accentColor.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                                .interpolationMethod(.monotone)
                        }
                        LineMark(x: .value("Time", point.timestamp), y: .value(chart.label, point.value))
                            .foregroundStyle(by: .value("Series", series.label))
                            .interpolationMethod(.monotone)
                            .lineStyle(StrokeStyle(lineWidth: 2))
                    }
                }
                if let warn = chart.warnAbove {
                    RuleMark(y: .value("Warning", warn)).foregroundStyle(.orange.opacity(0.6)).lineStyle(StrokeStyle(dash: [4, 4]))
                }
                if let touched {
                    RuleMark(x: .value("Touched", touched)).foregroundStyle(.secondary.opacity(0.5))
                }
            }
            .chartForegroundStyleScale(range: chart.series.count == 1 ? [Color.accentColor] : [Color.accentColor, .orange, .teal, .pink])
            .chartXSelection(value: $touched)
            .chartLegend(chart.series.count > 1 ? .visible : .hidden)
            .chartYAxis { AxisMarks { value in AxisValueLabel { Text(value.as(Double.self).map(chart.format) ?? "") } } }
            .frame(height: 130)
            .sensoryFeedback(.selection, trigger: touched == nil)
        }
        .padding(.vertical, 4)
    }
}
