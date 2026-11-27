import SwiftUI

/// How each kind of cloud service looks across the app: its symbol and color, as on a Settings row.
struct ServiceStyle: Equatable {
    let symbol: String
    let color: Color

    private static let byCategory: [String: ServiceStyle] = [
        "ecs": .init(symbol: "shippingbox.fill", color: .orange),
        "rds": .init(symbol: "cylinder.split.1x2.fill", color: .blue),
        "elasticache": .init(symbol: "bolt.fill", color: .red),
        "ec2": .init(symbol: "server.rack", color: .indigo),
        "s3": .init(symbol: "archivebox.fill", color: .green),
        "secrets-manager": .init(symbol: "key.fill", color: .yellow),
        "load-balancing": .init(symbol: "arrow.triangle.branch", color: .purple),
        "vpc": .init(symbol: "network", color: .teal),
    ]

    private static let fallback = ServiceStyle(symbol: "square.stack.3d.up.fill", color: .gray)

    /// For a service category, such as "rds".
    static func category(_ category: String) -> ServiceStyle { byCategory[category] ?? fallback }

    /// For a resource, through its category.
    static func of(_ resource: Resource) -> ServiceStyle { category(resource.category) }
}

/// A white symbol on a small colored rounded square, the icon style of iPhone Settings.
struct IconTile: View {
    let symbol: String
    let color: Color
    var size: CGFloat = 29

    init(_ style: ServiceStyle, size: CGFloat = 29) {
        symbol = style.symbol
        color = style.color
        self.size = size
    }

    init(symbol: String, color: Color, size: CGFloat = 29) {
        self.symbol = symbol
        self.color = color
        self.size = size
    }

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.5, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(color.gradient, in: .rect(cornerRadius: size * 0.24, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A navigation row in Settings style: icon tile, title, and an optional value on the trailing side.
struct IconRow: View {
    let title: String
    let symbol: String
    let color: Color
    var value: String?

    var body: some View {
        Label {
            if let value { LabeledContent(title, value: value) } else { Text(title) }
        } icon: {
            IconTile(symbol: symbol, color: color)
        }
    }
}
