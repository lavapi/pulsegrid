import Foundation

/// Items in sections by day, newest first.
struct DayGroup<Item: Identifiable>: Identifiable {
    let day: Date
    let items: [Item]

    var id: Date { day }

    /// "Today", "Yesterday", or the date.
    var title: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInYesterday(day) { return "Yesterday" }
        return day.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }

    static func grouping(_ items: [Item], by date: (Item) -> Date) -> [DayGroup] {
        let calendar = Calendar.current
        var groups: [DayGroup] = []
        for item in items.sorted(by: { date($0) > date($1) }) {
            let day = calendar.startOfDay(for: date(item))
            if let last = groups.last, last.day == day {
                groups[groups.count - 1] = DayGroup(day: day, items: last.items + [item])
            } else {
                groups.append(DayGroup(day: day, items: [item]))
            }
        }
        return groups
    }
}
