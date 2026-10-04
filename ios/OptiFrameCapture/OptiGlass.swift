import SwiftUI

enum OptiPalette {
    static let background = Color(red: 0.063, green: 0.067, blue: 0.071)
    static let surface = Color(red: 0.16, green: 0.18, blue: 0.20)
    static let contour = Color(red: 0.35, green: 0.79, blue: 1)
}

private struct OptiGlassSurface: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var opaque
    let radius: CGFloat
    func body(content: Content) -> some View {
        content
            .background {
                if opaque { RoundedRectangle(cornerRadius: radius).fill(OptiPalette.surface) }
                else { RoundedRectangle(cornerRadius: radius).fill(.ultraThinMaterial) }
            }
            .overlay {
                RoundedRectangle(cornerRadius: radius)
                    .strokeBorder(.white.opacity(0.16), lineWidth: 0.75)
                    .allowsHitTesting(false)
            }
    }
}

extension View {
    func optiGlass(radius: CGFloat = 24) -> some View {
        modifier(OptiGlassSurface(radius: radius))
    }
}

struct OptiGlassButtonStyle: ButtonStyle {
    var primary = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20).padding(.vertical, 12)
            .frame(minHeight: 48)
            .foregroundStyle(primary ? OptiPalette.background : .white)
            .background {
                if primary { Capsule().fill(Color(white: 0.94)) }
                else { Color.clear.optiGlass(radius: 32) }
            }
            .contentShape(Capsule())
            .opacity(!enabled ? 0.4 : configuration.isPressed ? 0.76 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
    }
}
