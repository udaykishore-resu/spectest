import Foundation

struct PriceCalculator {
    func discount(price: Double, percent: Int) -> Double? {
        guard percent >= 0 && percent <= 100 else { return nil }
        return price * Double(100 - percent) / 100
    }
}
